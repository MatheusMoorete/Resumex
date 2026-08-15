"""Acceptance and unit tests for Page Analysis module using SUS annotated fixture."""

import json
import tempfile
import unittest
from pathlib import Path

from tests.fixtures.create_sus_fixture import create_sus_annotated_pdf
from worker.process_pdf import process_pdf_document


class TestPageAnalysisAcceptance(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp_dir = tempfile.TemporaryDirectory()
        cls.base_dir = Path(cls.temp_dir.name)
        cls.fixture_pdf = create_sus_annotated_pdf(cls.base_dir / "aspectos-historicos-sus-annotated.pdf")

    @classmethod
    def tearDownClass(cls):
        cls.temp_dir.cleanup()

    def setUp(self):
        self.output_json = self.base_dir / f"doc-ir-{self._testMethodName}.json"
        self.artifacts_dir = self.base_dir / f"artifacts-{self._testMethodName}"
        self.doc_ir = process_pdf_document(self.fixture_pdf, self.output_json, self.artifacts_dir)

    def test_page_1_classification(self):
        page1 = self.doc_ir.pages[0]
        self.assertEqual(page1.pageNumber, 1)
        self.assertTrue(page1.processingPlan.detectHandwriting or ("hasPdfAnnotations" in page1.flags))
        self.assertIn("hasNativeText", page1.flags)

    def test_page_3_highlights_handwriting_relations(self):
        page3 = self.doc_ir.pages[2]
        self.assertEqual(page3.pageNumber, 3)
        self.assertIn("hasPdfAnnotations", page3.flags)
        self.assertTrue(page3.processingPlan.detectHandwriting)

    def test_page_4_visual_or_scanned_classification(self):
        page4 = self.doc_ir.pages[3]
        self.assertEqual(page4.pageNumber, 4)
        self.assertTrue(page4.processingPlan.useFullPageVision or page4.processingPlan.runPrintedOcr)

    def test_pages_6_7_10_table_preservation(self):
        page6 = self.doc_ir.pages[5]
        page7 = self.doc_ir.pages[6]
        page10 = self.doc_ir.pages[9]

        self.assertTrue(page6.processingPlan.useNativeText)
        self.assertTrue(page7.processingPlan.useNativeText)
        self.assertTrue(page10.processingPlan.useNativeText)

    def test_all_pages_have_processing_plan(self):
        for page in self.doc_ir.pages:
            self.assertIsNotNone(page.processingPlan)
            self.assertIsInstance(page.processingPlan.reasons, list)

    def test_native_text_does_not_prevent_handwriting_detection(self):
        page1 = self.doc_ir.pages[0]
        self.assertIn("hasNativeText", page1.flags)
        self.assertTrue(page1.processingPlan.detectHandwriting)

    def test_page_analysis_report_generated(self):
        report_path = self.artifacts_dir / "page-analysis-report.json"
        self.assertTrue(report_path.exists())

        report_content = json.loads(report_path.read_text(encoding="utf-8"))
        self.assertEqual(len(report_content), 10)
        for page_rep in report_content:
            self.assertIn("pageNumber", page_rep)
            self.assertIn("flags", page_rep)
            self.assertIn("reasons", page_rep)


if __name__ == "__main__":
    unittest.main()
