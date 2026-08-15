"""Unit tests for Document IR Pydantic models."""

import json
import unittest
from pydantic import ValidationError

from worker.document_ir import (
    BBox,
    BlockRelationship,
    BlockType,
    ContentBlock,
    ContentSource,
    DocumentIR,
    DocumentPage,
    ProcessingPlan,
    RelationshipType,
    SemanticRole,
    generate_block_id,
)


class TestDocumentIR(unittest.TestCase):
    def test_valid_document_ir_serialization(self):
        block_id1 = generate_block_id(1, "heading", 1, "Título Principal")
        block1 = ContentBlock(
            id=block_id1,
            pageNumber=1,
            type=BlockType.HEADING,
            semanticRole=SemanticRole.TITLE,
            text="Título Principal",
            bbox=BBox(x0=10.0, y0=20.0, x1=500.0, y1=60.0),
            source=ContentSource.PDF_NATIVE,
            confidence=1.0,
        )

        block_id2 = generate_block_id(1, "handwriting", 2, "Anotação à mão")
        block2 = ContentBlock(
            id=block_id2,
            pageNumber=1,
            type=BlockType.HANDWRITING,
            semanticRole=SemanticRole.BODY,
            text="Anotação à mão",
            bbox=BBox(x0=15.0, y0=70.0, x1=200.0, y1=100.0),
            source=ContentSource.VISION_MODEL,
            confidence=0.92,
            relationships=[
                BlockRelationship(
                    type=RelationshipType.COMMENTS_ON,
                    targetBlockId=block_id1,
                    confidence=0.88,
                )
            ],
        )

        page = DocumentPage(
            pageNumber=1,
            width=595.0,
            height=842.0,
            rotation=0,
            blocks=[block1, block2],
        )

        doc_ir = DocumentIR(
            documentId="doc-test-123",
            sourceHash="e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
            pageCount=1,
            createdAt="2026-07-24T15:00:00Z",
            pages=[page],
        )

        dumped_json = doc_ir.model_dump_json()
        parsed_data = json.loads(dumped_json)

        self.assertEqual(parsed_data["schemaVersion"], "1.0.0")
        self.assertEqual(parsed_data["documentId"], "doc-test-123")
        self.assertEqual(len(parsed_data["pages"]), 1)
        self.assertEqual(len(parsed_data["pages"][0]["blocks"]), 2)

    def test_invalid_bbox_coordinates(self):
        with self.assertRaises(ValidationError):
            BBox(x0=100.0, y0=50.0, x1=50.0, y1=80.0)

        with self.assertRaises(ValidationError):
            BBox(x0=10.0, y0=150.0, x1=50.0, y1=80.0)

    def test_confidence_out_of_bounds(self):
        with self.assertRaises(ValidationError):
            ContentBlock(
                id="p1-native_text-01-abcdef",
                pageNumber=1,
                type=BlockType.NATIVE_TEXT,
                bbox=BBox(x0=0.0, y0=0.0, x1=10.0, y1=10.0),
                source=ContentSource.PDF_NATIVE,
                confidence=1.5,
            )

    def test_relationship_pointing_to_non_existent_block(self):
        block1 = ContentBlock(
            id="p1-heading-01-aaaaaa",
            pageNumber=1,
            type=BlockType.HEADING,
            bbox=BBox(x0=0.0, y0=0.0, x1=10.0, y1=10.0),
            source=ContentSource.PDF_NATIVE,
            relationships=[
                BlockRelationship(
                    type=RelationshipType.COMMENTS_ON,
                    targetBlockId="p1-non-existent-block-id",
                    confidence=0.9,
                )
            ],
        )

        page = DocumentPage(pageNumber=1, width=100.0, height=100.0, blocks=[block1])

        with self.assertRaises(ValidationError) as ctx:
            DocumentIR(
                documentId="doc-test-invalid-rel",
                sourceHash="abc",
                pageCount=1,
                createdAt="2026-07-24T15:00:00Z",
                pages=[page],
            )
        self.assertIn("targetBlockId inexistente", str(ctx.exception))

    def test_incompatible_schema_version(self):
        with self.assertRaises(ValidationError):
            DocumentIR(
                schemaVersion="2.0.0",
                documentId="doc-incompatible",
                sourceHash="abc",
                pageCount=0,
                createdAt="2026-07-24T15:00:00Z",
                pages=[],
            )

    def test_documents_without_pages(self):
        doc_ir = DocumentIR(
            documentId="doc-empty",
            sourceHash="hash-empty",
            pageCount=0,
            createdAt="2026-07-24T15:00:00Z",
            pages=[],
        )
        self.assertEqual(doc_ir.pageCount, 0)
        self.assertEqual(len(doc_ir.pages), 0)

    def test_pages_without_blocks(self):
        page = DocumentPage(pageNumber=1, width=100.0, height=100.0, blocks=[])
        doc_ir = DocumentIR(
            documentId="doc-empty-page",
            sourceHash="hash-empty-page",
            pageCount=1,
            createdAt="2026-07-24T15:00:00Z",
            pages=[page],
        )
        self.assertEqual(len(doc_ir.pages[0].blocks), 0)


if __name__ == "__main__":
    unittest.main()
