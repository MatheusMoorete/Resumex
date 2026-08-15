"""Extract PDF layout, text, tables, vector drawings, annotations, and produce Document IR."""

from __future__ import annotations

import argparse
from contextlib import redirect_stdout
import hashlib
import json
import re
import sys
import uuid
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import pymupdf as fitz

try:
    from worker.document_ir import (
        BBox,
        BlockRelationship,
        BlockType,
        ContentBlock,
        ContentSource,
        DocumentIR,
        DocumentPage,
        ProcessingPlan,
        RasterReference,
        RelationshipType,
        SemanticRole,
        VisualRegion,
        generate_block_id,
    )
    from worker.page_analysis import analyze_page_layers
except ImportError:
    from document_ir import (
        BBox,
        BlockRelationship,
        BlockType,
        ContentBlock,
        ContentSource,
        DocumentIR,
        DocumentPage,
        ProcessingPlan,
        RasterReference,
        RelationshipType,
        SemanticRole,
        VisualRegion,
        generate_block_id,
    )
    from page_analysis import analyze_page_layers


def clean_text(text: str) -> str:
    if not text:
        return ""
    text = re.sub(r"[ \t]+", " ", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


def calculate_file_hash(file_path: Path) -> str:
    sha256 = hashlib.sha256()
    with file_path.open("rb") as f:
        while chunk := f.read(65536):
            sha256.update(chunk)
    return sha256.hexdigest()


def safe_bbox(rect: Any, page_width: float, page_height: float) -> BBox:
    x0 = round(max(0.0, min(page_width, float(rect[0]))), 2)
    y0 = round(max(0.0, min(page_height, float(rect[1]))), 2)
    x1 = round(max(x0, min(page_width, float(rect[2]))), 2)
    y1 = round(max(y0, min(page_height, float(rect[3]))), 2)
    return BBox(x0=x0, y0=y0, x1=x1, y1=y1, coordinateSpace="pdf_points")


def map_annotation_type(annot_type_name: str) -> Tuple[BlockType, SemanticRole]:
    name = annot_type_name.lower()
    if "highlight" in name:
        return BlockType.HIGHLIGHT, SemanticRole.UNKNOWN
    if "underline" in name:
        return BlockType.UNDERLINE, SemanticRole.UNKNOWN
    if "strikeout" in name:
        return BlockType.STRIKEOUT, SemanticRole.UNKNOWN
    if "freetext" in name or "text" in name or "stamp" in name:
        return BlockType.ANNOTATION, SemanticRole.BODY
    if "ink" in name:
        return BlockType.HANDWRITING, SemanticRole.BODY
    if "line" in name or "polyline" in name or "arrow" in name:
        return BlockType.ARROW, SemanticRole.UNKNOWN
    return BlockType.ANNOTATION, SemanticRole.UNKNOWN


def process_pdf_document(
    input_path: Path,
    output_path: Path,
    artifacts_dir: Path,
    document_id: str = "",
    schema_version: str = "1.0.0",
    max_pages: int = 300,
    max_file_size_mb: int = 100,
) -> DocumentIR:
    if not input_path.exists():
        raise FileNotFoundError(f"Arquivo não encontrado: {input_path}")

    file_size_bytes = input_path.stat().st_size
    if file_size_bytes > max_file_size_mb * 1024 * 1024:
        raise ValueError(f"Arquivo excede limite de {max_file_size_mb} MB")

    with input_path.open("rb") as f:
        header = f.read(1024)
        if b"%PDF-" not in header:
            raise ValueError(f"Arquivo {input_path.name} não é um PDF válido")

    doc_id = document_id or str(uuid.uuid4())
    source_hash = calculate_file_hash(input_path)

    artifacts_dir.mkdir(parents=True, exist_ok=True)
    pages_dir = artifacts_dir / "pages"
    embedded_dir = artifacts_dir / "embedded-images"
    annotations_dir = artifacts_dir / "annotations"
    pages_dir.mkdir(exist_ok=True)
    embedded_dir.mkdir(exist_ok=True)
    annotations_dir.mkdir(exist_ok=True)

    document_warnings: List[str] = []
    doc_pages: List[DocumentPage] = []

    with fitz.open(input_path) as document:
        if document.needs_pass:
            raise ValueError(f"PDF protegido por senha: {input_path.name}")

        page_count = len(document)
        if page_count > max_pages:
            raise ValueError(f"PDF com {page_count} páginas excede o limite de {max_pages}")

        for page_idx, page in enumerate(document, start=1):
            page_warnings: List[str] = []
            rect = page.rect
            width = max(float(rect.width), 1.0)
            height = max(float(rect.height), 1.0)
            page_area = width * height
            rotation = int(page.rotation or 0)

            blocks: List[ContentBlock] = []
            raster_refs: List[RasterReference] = []
            block_sequence = 0

            # 1. Extração de Texto Nativo e Spans
            text_dict = page.get_text("dict", flags=fitz.TEXT_PRESERVE_WHITESPACE)
            native_text_area = 0.0
            total_native_chars = 0

            for b in text_dict.get("blocks", []):
                if b.get("type") == 0:  # Block type 0 = text
                    block_bbox = safe_bbox(b["bbox"], width, height)
                    lines_text = []
                    is_bold = False
                    is_title = False
                    font_sizes = []

                    for line in b.get("lines", []):
                        line_spans = []
                        for span in line.get("spans", []):
                            stext = span.get("text", "").strip()
                            if stext:
                                line_spans.append(stext)
                                total_native_chars += len(stext)
                                font_sizes.append(span.get("size", 10.0))
                                flags = span.get("flags", 0)
                                if flags & 2 or "bold" in span.get("font", "").lower():
                                    is_bold = True
                        if line_spans:
                            lines_text.append(" ".join(line_spans))

                    block_str = clean_text("\n".join(lines_text))
                    if block_str:
                        native_text_area += (block_bbox.x1 - block_bbox.x0) * (block_bbox.y1 - block_bbox.y0)
                        block_sequence += 1

                        avg_font_size = sum(font_sizes) / len(font_sizes) if font_sizes else 10.0
                        if avg_font_size >= 16.0 or (is_bold and avg_font_size >= 13.0):
                            block_type = BlockType.HEADING
                            semantic_role = SemanticRole.TITLE if avg_font_size >= 18.0 else SemanticRole.SUBTITLE
                        else:
                            block_type = BlockType.PARAGRAPH
                            semantic_role = SemanticRole.BODY

                        blocks.append(
                            ContentBlock(
                                id=generate_block_id(page_idx, block_type.value, block_sequence, block_str[:20]),
                                pageNumber=page_idx,
                                type=block_type,
                                semanticRole=semantic_role,
                                text=block_str,
                                bbox=block_bbox,
                                readingOrder=block_sequence,
                                source=ContentSource.PDF_NATIVE,
                                confidence=1.0,
                                visualAttributes={"avgFontSize": avg_font_size, "isBold": is_bold},
                            )
                        )

            native_coverage = min(1.0, round(native_text_area / max(page_area, 1.0), 4))

            # 2. Imagens Incorporadas
            image_info = page.get_image_info()
            total_image_area = 0.0
            for img_idx, img in enumerate(image_info, start=1):
                img_bbox = safe_bbox(img["bbox"], width, height)
                total_image_area += (img_bbox.x1 - img_bbox.x0) * (img_bbox.y1 - img_bbox.y0)
                img_id = f"p{page_idx}-img-{img_idx}"
                img_filename = f"page-{page_idx:04d}-img-{img_idx}.jpg"
                img_path = embedded_dir / img_filename

                xref = img.get("xref", 0)
                if xref > 0:
                    try:
                        pix = fitz.Pixmap(document, xref)
                        if pix.n >= 5:
                            pix = fitz.Pixmap(fitz.csRGB, pix)
                        pix.save(str(img_path))
                        pix = None
                    except Exception as e:
                        page_warnings.append(f"Falha ao salvar imagem xref {xref}: {str(e)}")
                else:
                    try:
                        pix = page.get_pixmap(clip=img_bbox, matrix=fitz.Matrix(1.5, 1.5))
                        pix.save(str(img_path))
                        pix = None
                    except Exception as e:
                        page_warnings.append(f"Falha ao renderizar imagem de região: {str(e)}")

                raster_refs.append(
                    RasterReference(
                        id=img_id,
                        path=f"embedded-images/{img_filename}",
                        format="jpeg",
                        pageNumber=page_idx,
                        bbox=img_bbox,
                    )
                )

                block_sequence += 1
                blocks.append(
                    ContentBlock(
                        id=generate_block_id(page_idx, "image", block_sequence),
                        pageNumber=page_idx,
                        type=BlockType.IMAGE,
                        semanticRole=SemanticRole.UNKNOWN,
                        text=f"[Imagem incorporada {img_filename}]",
                        bbox=img_bbox,
                        readingOrder=block_sequence,
                        source=ContentSource.PDF_EMBEDDED_IMAGE,
                        confidence=1.0,
                    )
                )

            raster_coverage = min(1.0, round(total_image_area / max(page_area, 1.0), 4))

            # 3. Anotações Nativas do PDF
            annots = list(page.annots() or [])
            has_pdf_annotations = len(annots) > 0
            for annot in annots:
                annot_type_name = str(annot.type[1]) if hasattr(annot, "type") and isinstance(annot.type, tuple) else "Annotation"
                annot_rect = safe_bbox(annot.rect, width, height)
                annot_info = annot.info or {}
                content = clean_text(annot_info.get("content", ""))

                b_type, s_role = map_annotation_type(annot_type_name)
                block_sequence += 1
                blocks.append(
                    ContentBlock(
                        id=generate_block_id(page_idx, b_type.value, block_sequence, content[:20]),
                        pageNumber=page_idx,
                        type=b_type,
                        semanticRole=s_role,
                        text=content or f"[{annot_type_name}]",
                        bbox=annot_rect,
                        readingOrder=block_sequence,
                        source=ContentSource.PDF_ANNOTATION,
                        confidence=0.9,
                        metadata={"annotType": annot_type_name, "author": annot_info.get("title", "")},
                    )
                )

            # 4. Desenhos Vetoriais
            drawings = list(page.get_drawings() or [])
            has_vector_drawings = len(drawings) > 0
            if has_vector_drawings and native_coverage < 0.2:
                for draw in drawings[:10]:
                    d_rect = safe_bbox(draw["rect"], width, height)
                    if (d_rect.x1 - d_rect.x0) * (d_rect.y1 - d_rect.y0) > 100:
                        block_sequence += 1
                        blocks.append(
                            ContentBlock(
                                id=generate_block_id(page_idx, "decorative", block_sequence),
                                pageNumber=page_idx,
                                type=BlockType.DECORATIVE,
                                semanticRole=SemanticRole.UNKNOWN,
                                text="[Traço vetorial]",
                                bbox=d_rect,
                                readingOrder=block_sequence,
                                source=ContentSource.PDF_VECTOR,
                                confidence=0.8,
                            )
                        )

            # 5. Detecção de Tabelas
            has_detected_table = False
            try:
                tables = page.find_tables()
                if tables and tables.tables:
                    has_detected_table = True
                    for tab in tables.tables:
                        tab_bbox = safe_bbox(tab.bbox, width, height)
                        block_sequence += 1
                        table_block_id = generate_block_id(page_idx, "table", block_sequence)

                        blocks.append(
                            ContentBlock(
                                id=table_block_id,
                                pageNumber=page_idx,
                                type=BlockType.TABLE,
                                semanticRole=SemanticRole.UNKNOWN,
                                text=f"[Tabela com {len(tab.extract())} linhas]",
                                bbox=tab_bbox,
                                readingOrder=block_sequence,
                                source=ContentSource.PDF_NATIVE,
                                confidence=0.9,
                            )
                        )

                        table_data = tab.extract()
                        for r_idx, row in enumerate(table_data):
                            is_hdr = (r_idx == 0)
                            for c_idx, cell in enumerate(row):
                                cell_text = clean_text(cell or "")
                                if cell_text:
                                    block_sequence += 1
                                    cell_id = generate_block_id(page_idx, "table_cell", block_sequence, cell_text[:10])
                                    blocks.append(
                                        ContentBlock(
                                            id=cell_id,
                                            pageNumber=page_idx,
                                            type=BlockType.TABLE_CELL,
                                            semanticRole=SemanticRole.TABLE_HEADER if is_hdr else SemanticRole.TABLE_VALUE,
                                            text=cell_text,
                                            bbox=tab_bbox,
                                            readingOrder=block_sequence,
                                            source=ContentSource.PDF_NATIVE,
                                            confidence=0.85,
                                            relationships=[
                                                BlockRelationship(
                                                    type=RelationshipType.BELONGS_TO_TABLE,
                                                    targetBlockId=table_block_id,
                                                    confidence=1.0,
                                                    metadata={"rowIndex": r_idx, "columnIndex": c_idx, "isHeader": is_hdr},
                                                )
                                            ],
                                            metadata={"rowIndex": r_idx, "columnIndex": c_idx, "isHeader": is_hdr},
                                        )
                                    )
            except Exception:
                pass

            # 6. Classificação de Camadas & ProcessingPlan via Page Analysis Module
            page_analysis_res = analyze_page_layers(page, page_idx, blocks, artifacts_dir)

            flags = []
            if total_native_chars > 0:
                flags.append("hasNativeText")
            if total_native_chars < 150:
                flags.append("lowNativeTextCoverage")
            if len(image_info) > 0:
                flags.append("hasEmbeddedImages")
            if has_pdf_annotations:
                flags.append("hasPdfAnnotations")
            if has_vector_drawings:
                flags.append("hasVectorDrawings")
            if has_detected_table:
                flags.append("hasDetectedTable")
            if native_coverage < 0.1 and raster_coverage >= 0.5:
                flags.append("likelyScanned")
            if has_pdf_annotations or has_vector_drawings or has_detected_table or page_analysis_res.hasHandwriting:
                flags.append("likelyComplexLayout")

            # Renderizar preview da página 120-150 DPI (Matriz 1.8x, JPEG 85)
            preview_filename = f"page-{page_idx:04d}-preview.jpg"
            preview_path = pages_dir / preview_filename
            pix = page.get_pixmap(matrix=fitz.Matrix(1.8, 1.8), alpha=False)
            preview_path.write_bytes(pix.tobytes("jpeg", jpg_quality=85))
            pix = None

            raster_refs.append(
                RasterReference(
                    id=f"p{page_idx}-preview",
                    path=f"pages/{preview_filename}",
                    format="jpeg",
                    pageNumber=page_idx,
                    bbox=BBox(x0=0, y0=0, x1=width, y1=height),
                )
            )

            visual_regions = [
                VisualRegion(
                    bbox=cand.bbox,
                    reason=cand.reason,
                )
                for cand in page_analysis_res.candidateRegions
            ]

            plan = ProcessingPlan(
                useNativeText=True,
                runPrintedOcr=page_analysis_res.requiresPrintedOcr,
                runLayoutAnalysis=page_analysis_res.requiresLayoutAnalysis,
                detectHandwriting=page_analysis_res.hasHandwriting or has_pdf_annotations,
                analyzeVisualRelations=page_analysis_res.hasArrowsOrConnectors or has_detected_table,
                useFullPageVision=page_analysis_res.requiresFullPageVision,
                visualRegions=visual_regions,
                reasons=page_analysis_res.reasons,
            )

            doc_page = DocumentPage(
                pageNumber=page_idx,
                width=width,
                height=height,
                rotation=rotation,
                nativeTextCoverage=native_coverage,
                rasterImageCoverage=raster_coverage,
                flags=flags,
                processingPlan=plan,
                blocks=blocks,
                rasterReferences=raster_refs,
                warnings=page_warnings,
            )
            doc_pages.append(doc_page)

            print(json.dumps({"event": "page_processed", "pageNumber": page_idx, "flags": flags, "blocksCount": len(blocks)}), flush=True)
            fitz.TOOLS.store_shrink(100)

    # Gravando relatório de análise de páginas para desenvolvimento em artifacts/page-analysis-report.json
    report_data = [
        {
            "pageNumber": p.pageNumber,
            "flags": p.flags,
            "reasons": p.processingPlan.reasons,
            "regionsCount": len(p.processingPlan.visualRegions),
            "useFullPageVision": p.processingPlan.useFullPageVision,
        }
        for p in doc_pages
    ]
    (artifacts_dir / "page-analysis-report.json").write_text(json.dumps(report_data, indent=2), encoding="utf-8")

    manifest_content = {
        "documentId": doc_id,
        "sourceHash": source_hash,
        "pageCount": len(doc_pages),
        "artifacts": {
            "pages": len(doc_pages),
            "embeddedImages": len(list(embedded_dir.glob("*.jpg"))),
        },
    }
    (artifacts_dir / "manifest.json").write_text(json.dumps(manifest_content, indent=2), encoding="utf-8")

    doc_ir = DocumentIR(
        schemaVersion=schema_version,
        documentId=doc_id,
        sourceHash=source_hash,
        pageCount=len(doc_pages),
        createdAt=fitz.get_pdf_now(),
        pages=doc_pages,
        warnings=document_warnings,
    )

    output_path.write_text(doc_ir.model_dump_json(indent=2), encoding="utf-8")
    print(json.dumps({"event": "completed", "outputPath": str(output_path), "pageCount": len(doc_pages)}), flush=True)
    return doc_ir


def legacy_process(
    files: list[Path],
    output_dir: Path,
    mode: str = "auto",
    manual_pages: set[int] | None = None,
    max_vision_pages: int = 300,
) -> dict:
    output_dir.mkdir(parents=True, exist_ok=True)
    manual_pages = manual_pages or set()
    legacy_pages = []
    vision_page_count = 0

    for source_index, file_path in enumerate(files):
        source_dir = output_dir / f"source-{source_index}"
        artifacts_dir = source_dir / "artifacts"
        remaining_pages = 300 - len(legacy_pages)
        if remaining_pages <= 0:
            raise ValueError("Limite de 300 paginas por job excedido")

        # O protocolo legado reserva stdout para o JSON final consumido pelo Node.
        with redirect_stdout(sys.stderr):
            doc_ir = process_pdf_document(
                input_path=file_path,
                output_path=source_dir / "document-ir.json",
                artifacts_dir=artifacts_dir,
                max_pages=remaining_pages,
            )

        for page in doc_ir.pages:
            global_page = len(legacy_pages) + 1
            reasons = page.processingPlan.reasons
            needs_vis = should_use_vision(mode, global_page, manual_pages, reasons)
            if needs_vis:
                vision_page_count += 1
                if vision_page_count > max_vision_pages:
                    raise ValueError(
                        f"Limite de {max_vision_pages} paginas visuais por job excedido"
                    )
            img_path = (
                artifacts_dir / "pages" / f"page-{page.pageNumber:04d}-preview.jpg"
                if needs_vis else None
            )
            page_text = "\n".join(b.text for b in page.blocks if b.text)

            legacy_pages.append({
                "page": global_page,
                "sourceIndex": source_index,
                "sourceName": file_path.name,
                "sourcePage": page.pageNumber,
                "text": page_text,
                "blocks": [
                    {
                        "bbox": [
                            round(b.bbox.x0 / page.width, 4),
                            round(b.bbox.y0 / page.height, 4),
                            round(b.bbox.x1 / page.width, 4),
                            round(b.bbox.y1 / page.height, 4),
                        ],
                        "text": b.text,
                        "type": "text" if b.type != BlockType.IMAGE else "image",
                    }
                    for b in page.blocks
                ],
                "ocrUsed": False,
                "needsVision": needs_vis,
                "reasons": reasons,
                "imagePath": str(img_path) if img_path else None,
            })

    return {"pageCount": len(legacy_pages), "pages": legacy_pages}


def should_use_vision(mode: str, page: int, manual_pages: set[int], reasons: list[str]) -> bool:
    return mode == "all" or (mode == "manual" and page in manual_pages) or (mode == "auto" and bool(reasons))


def main() -> None:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    if hasattr(sys.stderr, "reconfigure"):
        sys.stderr.reconfigure(encoding="utf-8")

    parser = argparse.ArgumentParser(description="ResumeX Document IR PDF Processor")
    parser.add_argument("--input", help="Caminho do arquivo PDF de entrada")
    parser.add_argument("--output", help="Caminho para salvar o documento Document IR JSON")
    parser.add_argument("--artifacts-dir", help="Diretório para salvar imagens e manifestos")
    parser.add_argument("--document-id", default="", help="UUID do documento")
    parser.add_argument("--schema-version", default="1.0.0", help="Versão do schema do Document IR")
    parser.add_argument("--max-pages", type=int, default=300, help="Limite máximo de páginas")
    parser.add_argument("--max-file-size", type=int, default=100, help="Limite máximo em MB")

    # Argumentos legados para compatibilidade
    parser.add_argument("files", nargs="*", help="[Legado] Lista de arquivos PDF")
    parser.add_argument("--output-dir", help="[Legado] Diretório de saída")
    parser.add_argument("--vision-mode", choices=("off", "auto", "all", "manual"), default="auto")
    parser.add_argument("--vision-pages", default="")
    parser.add_argument("--max-vision-pages", type=int, default=300)

    args = parser.parse_args()

    if args.input and args.output and args.artifacts_dir:
        process_pdf_document(
            input_path=Path(args.input),
            output_path=Path(args.output),
            artifacts_dir=Path(args.artifacts_dir),
            document_id=args.document_id,
            schema_version=args.schema_version,
            max_pages=args.max_pages,
            max_file_size_mb=args.max_file_size,
        )
    elif args.files and args.output_dir:
        manual_pages = {int(v) for v in args.vision_pages.split(",") if v.strip().isdigit()}
        res = legacy_process(
            files=[Path(p) for p in args.files],
            output_dir=Path(args.output_dir),
            mode=args.vision_mode,
            manual_pages=manual_pages,
            max_vision_pages=args.max_vision_pages,
        )
        print(json.dumps(res, ensure_ascii=False))
    else:
        parser.error("Informe --input, --output e --artifacts-dir (ou o formato de argumentos legado)")


if __name__ == "__main__":
    main()
