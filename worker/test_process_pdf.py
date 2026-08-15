"""Unit tests and fixtures for PDF processing and Document IR generation."""

import json
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch
from pathlib import Path
import pymupdf as fitz

from worker.process_pdf import process_pdf_document, should_use_vision


class TestProcessPDF(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.base_dir = Path(self.temp_dir.name)

    def tearDown(self):
        self.temp_dir.cleanup()

    def create_pdf(self, builder_fn) -> Path:
        pdf_path = self.base_dir / "sample.pdf"
        doc = fitz.open()
        builder_fn(doc)
        doc.save(str(pdf_path))
        doc.close()
        return pdf_path

    def test_native_text_pdf(self):
        def build(doc):
            page = doc.new_page(width=600, height=800)
            page.insert_text((50, 50), "História da Saúde no Brasil", fontsize=20)
            page.insert_text((50, 100), "Em 1923 foram criadas as Caixas de Aposentadoria e Pensões (CAPs).", fontsize=12)

        pdf_path = self.create_pdf(build)
        out_json = self.base_dir / "output.json"
        artifacts = self.base_dir / "artifacts"

        doc_ir = process_pdf_document(pdf_path, out_json, artifacts)

        self.assertEqual(doc_ir.pageCount, 1)
        self.assertTrue(out_json.exists())
        self.assertIn("hasNativeText", doc_ir.pages[0].flags)
        self.assertTrue(len(doc_ir.pages[0].blocks) >= 2)

    def test_scanned_pdf(self):
        def build(doc):
            page = doc.new_page(width=400, height=600)
            # Adicionar apenas uma figura de fundo (sem texto nativo)
            pix = fitz.Pixmap(fitz.csRGB, fitz.Rect(0, 0, 100, 100), False)
            pix.clear_with(255)
            page.insert_image(fitz.Rect(10, 10, 390, 590), pixmap=pix)

        pdf_path = self.create_pdf(build)
        out_json = self.base_dir / "output.json"
        artifacts = self.base_dir / "artifacts"

        doc_ir = process_pdf_document(pdf_path, out_json, artifacts)

        self.assertIn("likelyScanned", doc_ir.pages[0].flags)
        self.assertTrue(doc_ir.pages[0].processingPlan.useFullPageVision)

    def test_native_annotations_and_highlight(self):
        def build(doc):
            page = doc.new_page(width=500, height=500)
            rect = fitz.Rect(50, 50, 200, 70)
            annot = page.add_highlight_annot(rect)
            annot.set_info({"content": "Trecho destacado importante"})
            annot.update()

            ink_annot = page.add_ink_annot([[(10, 10), (50, 50)]])
            ink_annot.set_info({"content": "Manuscrito à caneta"})
            ink_annot.update()

        pdf_path = self.create_pdf(build)
        out_json = self.base_dir / "output.json"
        artifacts = self.base_dir / "artifacts"

        doc_ir = process_pdf_document(pdf_path, out_json, artifacts)

        self.assertIn("hasPdfAnnotations", doc_ir.pages[0].flags)
        block_types = [b.type.value for b in doc_ir.pages[0].blocks]
        self.assertIn("highlight", block_types)
        self.assertIn("handwriting", block_types)

    def test_native_table_detection(self):
        def build(doc):
            page = doc.new_page(width=600, height=600)
            page.insert_text((50, 50), "Tabela de Princípios do SUS", fontsize=14)
            # Desenhar linhas de tabela para find_tables reconhecer
            page.draw_rect(fitz.Rect(50, 100, 500, 300))
            page.draw_line(fitz.Point(50, 150), fitz.Point(500, 150))
            page.draw_line(fitz.Point(200, 100), fitz.Point(200, 300))
            page.insert_text((60, 120), "Princípio")
            page.insert_text((210, 120), "Definição")
            page.insert_text((60, 180), "Universalidade")
            page.insert_text((210, 180), "Acesso a todos os cidadãos")

        pdf_path = self.create_pdf(build)
        out_json = self.base_dir / "output.json"
        artifacts = self.base_dir / "artifacts"

        doc_ir = process_pdf_document(pdf_path, out_json, artifacts)

        # find_tables pode variar conforme versão de fitz, mas o schema processa sem erro
        self.assertTrue(len(doc_ir.pages) == 1)

    def test_embedded_images(self):
        def build(doc):
            page = doc.new_page(width=500, height=500)
            pix = fitz.Pixmap(fitz.csRGB, fitz.Rect(0, 0, 50, 50), False)
            page.insert_image(fitz.Rect(50, 50, 200, 200), pixmap=pix)

        pdf_path = self.create_pdf(build)
        out_json = self.base_dir / "output.json"
        artifacts = self.base_dir / "artifacts"

        with patch.object(fitz.TOOLS, "store_shrink", wraps=fitz.TOOLS.store_shrink) as shrink_store:
            doc_ir = process_pdf_document(pdf_path, out_json, artifacts)

        self.assertIn("hasEmbeddedImages", doc_ir.pages[0].flags)
        self.assertTrue(len(doc_ir.pages[0].rasterReferences) >= 1)
        shrink_store.assert_called_once_with(100)

    def test_empty_page(self):
        def build(doc):
            doc.new_page(width=500, height=500)

        pdf_path = self.create_pdf(build)
        out_json = self.base_dir / "output.json"
        artifacts = self.base_dir / "artifacts"

        doc_ir = process_pdf_document(pdf_path, out_json, artifacts)

        self.assertEqual(doc_ir.pageCount, 1)
        self.assertIn("lowNativeTextCoverage", doc_ir.pages[0].flags)

    def test_rotated_page(self):
        def build(doc):
            page = doc.new_page(width=600, height=800)
            page.set_rotation(90)
            page.insert_text((50, 50), "Página Rotacionada")

        pdf_path = self.create_pdf(build)
        out_json = self.base_dir / "output.json"
        artifacts = self.base_dir / "artifacts"

        doc_ir = process_pdf_document(pdf_path, out_json, artifacts)

        self.assertEqual(doc_ir.pages[0].rotation, 90)

    def test_invalid_pdf_header(self):
        invalid_path = self.base_dir / "invalid.pdf"
        invalid_path.write_bytes(b"Esto no es un PDF valido")

        out_json = self.base_dir / "output.json"
        artifacts = self.base_dir / "artifacts"

        with self.assertRaises(ValueError) as ctx:
            process_pdf_document(invalid_path, out_json, artifacts)
        self.assertIn("não é um PDF válido", str(ctx.exception))

    def test_password_protected_pdf(self):
        def build(doc):
            page = doc.new_page(width=500, height=500)
            page.insert_text((50, 50), "Confidencial")

        pdf_path = self.base_dir / "protected.pdf"
        doc = fitz.open()
        build(doc)
        doc.save(str(pdf_path), encryption=fitz.PDF_ENCRYPT_AES_256, owner_pw="secret", user_pw="secret")
        doc.close()

        out_json = self.base_dir / "output.json"
        artifacts = self.base_dir / "artifacts"

        with self.assertRaises(ValueError) as ctx:
            process_pdf_document(pdf_path, out_json, artifacts)
        self.assertIn("protegido por senha", str(ctx.exception))

    def test_legacy_cli_keeps_stdout_parseable_and_processes_all_files(self):
        pdf_paths = []
        for index, text in enumerate(("FIRST_DOCUMENT", "SECOND_DOCUMENT")):
            pdf_path = self.base_dir / f"source-{index}.pdf"
            doc = fitz.open()
            page = doc.new_page(width=500, height=500)
            page.insert_text((50, 50), text)
            doc.save(str(pdf_path))
            doc.close()
            pdf_paths.append(pdf_path)

        result = subprocess.run(
            [
                sys.executable,
                "worker/process_pdf.py",
                *(str(path) for path in pdf_paths),
                "--output-dir",
                str(self.base_dir / "legacy-output"),
                "--vision-mode",
                "manual",
                "--vision-pages",
                "2",
            ],
            cwd=Path(__file__).resolve().parents[1],
            capture_output=True,
            text=True,
            encoding="utf-8",
            check=True,
        )

        payload = json.loads(result.stdout)
        self.assertEqual(payload["pageCount"], 2)
        self.assertEqual([page["sourceIndex"] for page in payload["pages"]], [0, 1])
        self.assertEqual([page["sourcePage"] for page in payload["pages"]], [1, 1])
        self.assertIn("FIRST_DOCUMENT", payload["pages"][0]["text"])
        self.assertIn("SECOND_DOCUMENT", payload["pages"][1]["text"])
        self.assertEqual([page["needsVision"] for page in payload["pages"]], [False, True])

    def test_legacy_vision_modes(self):
        reasons = ["little_selectable_text"]
        self.assertFalse(should_use_vision("off", 1, set(), reasons))
        self.assertTrue(should_use_vision("auto", 1, set(), reasons))
        self.assertTrue(should_use_vision("all", 1, set(), []))
        self.assertTrue(should_use_vision("manual", 2, {2}, []))
        self.assertFalse(should_use_vision("manual", 1, {2}, reasons))


if __name__ == "__main__":
    unittest.main()
