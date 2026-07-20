"""Extract PDF text and render only pages that need visual analysis."""

from __future__ import annotations

import argparse
import json
from pathlib import Path


def bbox_area(value) -> float:
    if hasattr(value, "width"):
        return max(0, value.width) * max(0, value.height)
    x0, y0, x1, y1 = value
    return max(0, x1 - x0) * max(0, y1 - y0)


def vision_reasons(page, text: str) -> list[str]:
    reasons: list[str] = []
    if len(text.strip()) < 150:
        reasons.append("little_selectable_text")

    annotations = list(page.annots() or [])
    if any(annotation.type[1] in {"Ink", "Line", "FreeText"} for annotation in annotations):
        reasons.append("annotation")

    page_area = max(page.rect.width * page.rect.height, 1)
    image_area = sum(
        bbox_area(info["bbox"])
        for info in page.get_image_info()
    )
    if image_area / page_area >= 0.08:
        reasons.append("embedded_image")

    return reasons


def render_page(page, destination: Path) -> None:
    import pymupdf as fitz

    pixmap = page.get_pixmap(matrix=fitz.Matrix(1.6, 1.6), alpha=False)
    destination.write_bytes(pixmap.tobytes("jpeg", jpg_quality=76))


def process(files: list[Path], output_dir: Path, mode: str, manual_pages: set[int]) -> dict:
    import pymupdf as fitz

    output_dir.mkdir(parents=True, exist_ok=True)
    pages = []
    global_page = 0

    for source_index, file_path in enumerate(files):
        with fitz.open(file_path) as document:
            if document.needs_pass:
                raise ValueError(f"PDF protegido por senha: {file_path.name}")

            for source_page, page in enumerate(document, start=1):
                global_page += 1
                if global_page > 300:
                    raise ValueError("Limite de 300 páginas por job excedido")
                text = page.get_text("text", sort=True).strip()
                reasons = vision_reasons(page, text)
                needs_vision = (
                    mode == "all"
                    or (mode == "manual" and global_page in manual_pages)
                    or (mode == "auto" and bool(reasons))
                )
                image_path = None
                if needs_vision:
                    image_path = output_dir / f"page-{global_page}.jpg"
                    render_page(page, image_path)

                pages.append({
                    "page": global_page,
                    "sourceIndex": source_index,
                    "sourceName": file_path.name,
                    "sourcePage": source_page,
                    "text": text,
                    "needsVision": needs_vision,
                    "reasons": reasons,
                    "imagePath": str(image_path) if image_path else None,
                })

    return {"pageCount": len(pages), "pages": pages}


def self_test() -> None:
    class Annotation:
        type = (15, "Ink")

    class Page:
        class Rect:
            width = 100
            height = 100

        rect = Rect()

        @staticmethod
        def annots():
            return [Annotation()]

        @staticmethod
        def get_image_info():
            return [{"bbox": (0, 0, 50, 50)}]

    assert vision_reasons(Page(), "curto") == [
        "little_selectable_text",
        "annotation",
        "embedded_image",
    ]
    print("ok")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("files", nargs="*")
    parser.add_argument("--output-dir")
    parser.add_argument("--vision-mode", choices=("off", "auto", "all", "manual"), default="auto")
    parser.add_argument("--vision-pages", default="")
    parser.add_argument("--self-test", action="store_true")
    args = parser.parse_args()

    if args.self_test:
        self_test()
        return
    if not args.files or not args.output_dir:
        parser.error("files and --output-dir are required")

    manual_pages = {int(value) for value in args.vision_pages.split(",") if value.strip().isdigit()}
    result = process(
        [Path(value) for value in args.files],
        Path(args.output_dir),
        args.vision_mode,
        manual_pages,
    )
    print(json.dumps(result, ensure_ascii=False))


if __name__ == "__main__":
    main()
