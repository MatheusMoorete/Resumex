"""Page Analysis module for visual classification and candidate region detection."""

from __future__ import annotations

import hashlib
import json
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import pymupdf as fitz
from pydantic import BaseModel, Field

try:
    from worker.document_ir import BBox
except ImportError:
    from document_ir import BBox


class CandidateRegion(BaseModel):
    regionId: str
    pageNumber: int = Field(ge=1)
    bbox: BBox
    reason: str
    type: str  # "handwriting" | "diagram" | "table" | "screenshot" | "annotation" | "unknown_visual"
    confidence: float = Field(ge=0.0, le=1.0, default=1.0)
    requiresHighResolution: bool = False
    suggestedDpi: int = 300
    overlapsBlockIds: List[str] = Field(default_factory=list)
    cropPath: Optional[str] = None
    cropHash: Optional[str] = None


class PageAnalysisResult(BaseModel):
    pageNumber: int = Field(ge=1)
    nativeTextCoverage: float = Field(ge=0.0, le=1.0, default=0.0)
    rasterImageCoverage: float = Field(ge=0.0, le=1.0, default=0.0)
    hasTables: bool = False
    hasDiagrams: bool = False
    hasHighlights: bool = False
    hasHandwriting: bool = False
    hasArrowsOrConnectors: bool = False
    hasScreenshots: bool = False
    requiresPrintedOcr: bool = False
    requiresLayoutAnalysis: bool = True
    requiresVisionUnderstanding: bool = False
    requiresFullPageVision: bool = False
    confidence: float = Field(ge=0.0, le=1.0, default=0.95)
    reasons: List[str] = Field(default_factory=list)
    candidateRegions: List[CandidateRegion] = Field(default_factory=list)


def clip_bbox(b: BBox, page_width: float, page_height: float, padding: float = 5.0) -> BBox:
    x0 = max(0.0, min(page_width, b.x0 - padding))
    y0 = max(0.0, min(page_height, b.y0 - padding))
    x1 = max(x0, min(page_width, b.x1 + padding))
    y1 = max(y0, min(page_height, b.y1 + padding))
    return BBox(x0=round(x0, 2), y0=round(y0, 2), x1=round(x1, 2), y1=round(y1, 2), coordinateSpace="pdf_points")


def bboxes_overlap_or_close(b1: BBox, b2: BBox, margin: float = 15.0) -> bool:
    return not (
        b1.x1 + margin < b2.x0
        or b2.x1 + margin < b1.x0
        or b1.y1 + margin < b2.y0
        or b2.y1 + margin < b1.y0
    )


def merge_candidate_regions(
    regions: List[CandidateRegion], page_width: float, page_height: float
) -> List[CandidateRegion]:
    if not regions:
        return []

    merged: List[CandidateRegion] = []
    used = [False] * len(regions)

    for i in range(len(regions)):
        if used[i]:
            continue
        cur = regions[i]
        used[i] = True

        cur_x0, cur_y0, cur_x1, cur_y1 = cur.bbox.x0, cur.bbox.y0, cur.bbox.x1, cur.bbox.y1
        overlaps_ids = set(cur.overlapsBlockIds)
        reasons = {cur.reason}
        region_type = cur.type
        high_res = cur.requiresHighResolution

        changed = True
        while changed:
            changed = False
            for j in range(len(regions)):
                if not used[j]:
                    candidate = regions[j]
                    temp_bbox = BBox(x0=cur_x0, y0=cur_y0, x1=cur_x1, y1=cur_y1)
                    if bboxes_overlap_or_close(temp_bbox, candidate.bbox):
                        used[j] = True
                        changed = True
                        cur_x0 = min(cur_x0, candidate.bbox.x0)
                        cur_y0 = min(cur_y0, candidate.bbox.y0)
                        cur_x1 = max(cur_x1, candidate.bbox.x1)
                        cur_y1 = max(cur_y1, candidate.bbox.y1)
                        overlaps_ids.update(candidate.overlapsBlockIds)
                        reasons.add(candidate.reason)
                        if candidate.requiresHighResolution:
                            high_res = True

        merged_bbox = clip_bbox(
            BBox(x0=cur_x0, y0=cur_y0, x1=cur_x1, y1=cur_y1), page_width, page_height, padding=2.0
        )

        merged.append(
            CandidateRegion(
                regionId=f"p{cur.pageNumber}-region-{region_type}-{len(merged) + 1:02d}",
                pageNumber=cur.pageNumber,
                bbox=merged_bbox,
                reason=" | ".join(sorted(reasons)),
                type=region_type,
                confidence=cur.confidence,
                requiresHighResolution=high_res,
                suggestedDpi=300 if high_res else 150,
                overlapsBlockIds=sorted(list(overlaps_ids)),
            )
        )

    return merged


def analyze_page_layers(
    page: fitz.Page,
    page_number: int,
    existing_blocks: List[Any],
    artifacts_dir: Path,
) -> PageAnalysisResult:
    rect = page.rect
    width = max(float(rect.width), 1.0)
    height = max(float(rect.height), 1.0)
    page_area = width * height

    reasons: List[str] = []
    candidates: List[CandidateRegion] = []

    # --- CAMADA 1: Sinais Nativos do PDF ---
    text_dict = page.get_text("dict")
    total_chars = 0
    text_area = 0.0

    for b in text_dict.get("blocks", []):
        if b.get("type") == 0:
            for l in b.get("lines", []):
                for s in l.get("spans", []):
                    stext = s.get("text", "").strip()
                    if stext:
                        total_chars += len(stext)
            bbox = b.get("bbox", (0, 0, 0, 0))
            text_area += max(0.0, bbox[2] - bbox[0]) * max(0.0, bbox[3] - bbox[1])

    native_coverage = min(1.0, round(text_area / max(page_area, 1.0), 4))

    image_info = page.get_image_info()
    image_area = sum(max(0.0, img["bbox"][2] - img["bbox"][0]) * max(0.0, img["bbox"][3] - img["bbox"][1]) for img in image_info)
    raster_coverage = min(1.0, round(image_area / max(page_area, 1.0), 4))

    annots = list(page.annots() or [])
    drawings = list(page.get_drawings() or [])

    has_tables = False
    try:
        tabs = page.find_tables()
        if tabs and tabs.tables:
            has_tables = True
            for t_idx, tab in enumerate(tabs.tables, start=1):
                tb_bbox = safe_bbox_from_rect(tab.bbox, width, height)
                candidates.append(
                    CandidateRegion(
                        regionId=f"p{page_number}-cand-table-{t_idx}",
                        pageNumber=page_number,
                        bbox=tb_bbox,
                        reason="native_table_detected",
                        type="table",
                        confidence=0.9,
                        requiresHighResolution=False,
                    )
                )
    except Exception:
        pass

    has_highlights = False
    has_handwriting = False
    has_arrows = False
    has_diagrams = False
    has_screenshots = False

    for a in annots:
        atype = str(a.type[1]).lower() if hasattr(a, "type") and isinstance(a.type, tuple) else ""
        abbox = safe_bbox_from_rect(a.rect, width, height)
        if "highlight" in atype:
            has_highlights = True
            candidates.append(
                CandidateRegion(
                    regionId=f"p{page_number}-cand-hl",
                    pageNumber=page_number,
                    bbox=abbox,
                    reason="pdf_highlight_annotation",
                    type="annotation",
                    confidence=0.95,
                )
            )
        elif "ink" in atype or "freetext" in atype or "stamp" in atype:
            has_handwriting = True
            candidates.append(
                CandidateRegion(
                    regionId=f"p{page_number}-cand-ink",
                    pageNumber=page_number,
                    bbox=abbox,
                    reason="pdf_ink_handwriting_annotation",
                    type="handwriting",
                    confidence=0.95,
                    requiresHighResolution=True,
                )
            )
        elif "line" in atype or "arrow" in atype:
            has_arrows = True

    # --- CAMADA 2: Heurísticas Visuais & Desenhos Vetoriais ---
    if drawings:
        for d in drawings:
            drect = safe_bbox_from_rect(d["rect"], width, height)
            darea = (drect.x1 - drect.x0) * (drect.y1 - drect.y0)
            if darea > 100:
                stroke_color = d.get("color")
                fill_color = d.get("fill")
                # Identificar tintas coloridas (azul/vermelho/verde) ou marca-texto
                if is_colored_stroke(stroke_color) or is_colored_stroke(fill_color):
                    has_handwriting = True
                    candidates.append(
                        CandidateRegion(
                            regionId=f"p{page_number}-cand-draw-ink",
                            pageNumber=page_number,
                            bbox=drect,
                            reason="colored_vector_stroke_ink",
                            type="handwriting",
                            confidence=0.88,
                            requiresHighResolution=True,
                        )
                    )

    # Inspeção de Pixels da Imagem (Pillow / Pixmap) para cores de caneta em slides
    try:
        pix = page.get_pixmap(matrix=fitz.Matrix(1.5, 1.5), alpha=False)
        colored_regions = detect_ink_color_regions(pix, width, height)
        pix = None
        for cbbox in colored_regions:
            has_handwriting = True
            candidates.append(
                CandidateRegion(
                    regionId=f"p{page_number}-cand-color-ink",
                    pageNumber=page_number,
                    bbox=cbbox,
                    reason="pen_color_ink_detected",
                    type="handwriting",
                    confidence=0.9,
                    requiresHighResolution=True,
                )
            )
    except Exception:
        pass

    # --- CAMADA 3: Classificação & Decisão ---
    if total_chars < 150:
        reasons.append("little_selectable_text")

    if raster_coverage >= 0.08:
        reasons.append("embedded_image")

    if has_handwriting:
        reasons.append("handwriting_detected")

    if has_highlights:
        reasons.append("highlights_detected")

    if has_tables:
        reasons.append("table_detected")

    if has_arrows:
        reasons.append("arrows_or_connectors_detected")

    requires_ocr = (native_coverage < 0.1 and raster_coverage >= 0.4)
    requires_vision = bool(has_handwriting or has_arrows or has_diagrams or (native_coverage < 0.2 and raster_coverage >= 0.5))
    requires_full_page = (native_coverage < 0.05 and raster_coverage >= 0.6) or ("likely_slide_box" in reasons)

    merged_candidates = merge_candidate_regions(candidates, width, height)

    # Processar Crops a 300 DPI para CandidateRegions com alta resolução necessária
    crops_dir = artifacts_dir / "crops"
    crops_dir.mkdir(parents=True, exist_ok=True)

    for cand in merged_candidates:
        if cand.requiresHighResolution:
            crop_filename = f"page-{page_number:04d}-{cand.regionId}.jpg"
            crop_path = crops_dir / crop_filename
            try:
                # Renderizar crop exato a 300 DPI
                rect_crop = fitz.Rect(cand.bbox.x0, cand.bbox.y0, cand.bbox.x1, cand.bbox.y1)
                pix_crop = page.get_pixmap(clip=rect_crop, matrix=fitz.Matrix(300 / 72, 300 / 72), alpha=False)
                crop_bytes = pix_crop.tobytes("jpeg", jpg_quality=92)
                crop_path.write_bytes(crop_bytes)

                cand.cropPath = f"crops/{crop_filename}"
                cand.cropHash = hashlib.sha256(crop_bytes).hexdigest()
                pix_crop = None
                crop_bytes = None
            except Exception:
                pass

    return PageAnalysisResult(
        pageNumber=page_number,
        nativeTextCoverage=native_coverage,
        rasterImageCoverage=raster_coverage,
        hasTables=has_tables,
        hasDiagrams=has_diagrams,
        hasHighlights=has_highlights,
        hasHandwriting=has_handwriting,
        hasArrowsOrConnectors=has_arrows,
        hasScreenshots=has_screenshots,
        requiresPrintedOcr=requires_ocr,
        requiresLayoutAnalysis=True,
        requiresVisionUnderstanding=requires_vision,
        requiresFullPageVision=requires_full_page,
        confidence=0.95,
        reasons=reasons,
        candidateRegions=merged_candidates,
    )


def safe_bbox_from_rect(rect: Any, page_width: float, page_height: float) -> BBox:
    x0 = max(0.0, min(page_width, float(rect[0])))
    y0 = max(0.0, min(page_height, float(rect[1])))
    x1 = max(x0, min(page_width, float(rect[2])))
    y1 = max(y0, min(page_height, float(rect[3])))
    return BBox(x0=round(x0, 2), y0=round(y0, 2), x1=round(x1, 2), y1=round(y1, 2), coordinateSpace="pdf_points")


def is_colored_stroke(color: Any) -> bool:
    if not color or not isinstance(color, (list, tuple)) or len(color) < 3:
        return False
    r, g, b = color[0], color[1], color[2]
    # Identificar azul (b > r + 0.15) ou vermelho (r > g + 0.2)
    if b > r + 0.15 and b > g + 0.15:
        return True
    if r > g + 0.2 and r > b + 0.2:
        return True
    return False


def detect_ink_color_regions(pix: fitz.Pixmap, page_width: float, page_height: float) -> List[BBox]:
    # Analisa amostras de pixmap para identificar traços de caneta azul/vermelha
    if pix.width == 0 or pix.height == 0:
        return []

    scale_x = page_width / float(pix.width)
    scale_y = page_height / float(pix.height)

    # Checar se há amostras de cor
    samples = pix.samples
    stride = pix.stride
    n = pix.n

    boxes: List[BBox] = []
    # Analisa grid simplificado
    step = 10
    for y in range(0, pix.height, step):
        for x in range(0, pix.width, step):
            idx = y * stride + x * n
            if idx + 2 < len(samples):
                r, g, b = samples[idx], samples[idx + 1], samples[idx + 2]
                # Caneta azul (B > R + 30 e B > G + 30) ou Caneta vermelha (R > G + 40 e R > B + 40)
                if (b > r + 30 and b > g + 30) or (r > g + 40 and r > b + 40):
                    px0 = max(0.0, (x - 20) * scale_x)
                    py0 = max(0.0, (y - 20) * scale_y)
                    px1 = min(page_width, (x + 30) * scale_x)
                    py1 = min(page_height, (y + 30) * scale_y)
                    boxes.append(BBox(x0=round(px0, 2), y0=round(py0, 2), x1=round(px1, 2), y1=round(py1, 2)))

    return boxes
