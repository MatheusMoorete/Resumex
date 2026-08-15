"""Document Intermediate Representation (Document IR) - Pydantic models for Python worker."""

from __future__ import annotations

import hashlib
import re
from enum import Enum
from typing import Any, Dict, List, Optional
from pydantic import BaseModel, Field, field_validator, model_validator


SCHEMA_VERSION = "1.0.0"


class BlockType(str, Enum):
    NATIVE_TEXT = "native_text"
    PRINTED_OCR = "printed_ocr"
    HANDWRITING = "handwriting"
    HEADING = "heading"
    PARAGRAPH = "paragraph"
    LIST_ITEM = "list_item"
    TABLE = "table"
    TABLE_ROW = "table_row"
    TABLE_CELL = "table_cell"
    IMAGE = "image"
    IMAGE_CAPTION = "image_caption"
    DIAGRAM = "diagram"
    CHART = "chart"
    HIGHLIGHT = "highlight"
    UNDERLINE = "underline"
    STRIKEOUT = "strikeout"
    ARROW = "arrow"
    CALLOUT = "callout"
    ANNOTATION = "annotation"
    DECORATIVE = "decorative"


class SemanticRole(str, Enum):
    TITLE = "title"
    SUBTITLE = "subtitle"
    BODY = "body"
    DEFINITION = "definition"
    EXAMPLE = "example"
    WARNING = "warning"
    EXAM_TIP = "exam_tip"
    CAPTION = "caption"
    FOOTNOTE = "footnote"
    TABLE_HEADER = "table_header"
    TABLE_VALUE = "table_value"
    UNKNOWN = "unknown"


class ContentSource(str, Enum):
    PDF_NATIVE = "pdf_native"
    PDF_ANNOTATION = "pdf_annotation"
    PDF_VECTOR = "pdf_vector"
    PDF_EMBEDDED_IMAGE = "pdf_embedded_image"
    LOCAL_OCR = "local_ocr"
    CLOUD_OCR = "cloud_ocr"
    VISION_MODEL = "vision_model"
    USER_CORRECTION = "user_correction"


class RelationshipType(str, Enum):
    COMMENTS_ON = "comments_on"
    POINTS_TO = "points_to"
    HIGHLIGHTS = "highlights"
    CORRECTS = "corrects"
    CONTRADICTS = "contradicts"
    LABELS = "labels"
    CAPTION_OF = "caption_of"
    CONTINUATION_OF = "continuation_of"
    BELONGS_TO_TABLE = "belongs_to_table"
    BELONGS_TO_SECTION = "belongs_to_section"


class BBox(BaseModel):
    x0: float
    y0: float
    x1: float
    y1: float
    coordinateSpace: str = Field(default="pdf_points")

    @model_validator(mode="after")
    def validate_coordinates(self) -> BBox:
        if self.x0 > self.x1:
            raise ValueError(f"x0 ({self.x0}) não pode ser maior que x1 ({self.x1})")
        if self.y0 > self.y1:
            raise ValueError(f"y0 ({self.y0}) não pode ser maior que y1 ({self.y1})")
        return self


class BlockRelationship(BaseModel):
    type: RelationshipType
    targetBlockId: str
    confidence: float = Field(ge=0.0, le=1.0)
    metadata: Optional[Dict[str, Any]] = None


def generate_block_id(page_number: int, block_type: str, sequence: int, content_sample: str = "") -> str:
    cleaned_sample = (content_sample or "").strip().encode("utf-8")
    short_hash = hashlib.sha256(cleaned_sample).hexdigest()[:6] if cleaned_sample else "000000"
    seq_str = f"{sequence:02d}"
    return f"p{page_number}-{block_type}-{seq_str}-{short_hash}"


class ContentBlock(BaseModel):
    id: str
    pageNumber: int = Field(ge=1)
    type: BlockType
    semanticRole: SemanticRole = SemanticRole.UNKNOWN
    text: str = ""
    bbox: BBox
    polygon: Optional[List[Dict[str, float]]] = None
    readingOrder: int = Field(ge=0, default=0)
    source: ContentSource
    confidence: float = Field(ge=0.0, le=1.0, default=1.0)
    language: Optional[str] = None
    visualAttributes: Dict[str, Any] = Field(default_factory=dict)
    relationships: List[BlockRelationship] = Field(default_factory=list)
    checksum: str = ""
    metadata: Dict[str, Any] = Field(default_factory=dict)

    @model_validator(mode="after")
    def ensure_checksum(self) -> ContentBlock:
        if not self.checksum:
            raw = f"{self.id}:{self.type}:{self.text}".encode("utf-8")
            self.checksum = hashlib.sha256(raw).hexdigest()
        return self


class RasterReference(BaseModel):
    id: str
    path: str
    format: str = "jpeg"
    pageNumber: int = Field(ge=1)
    bbox: Optional[BBox] = None


class VisualRegion(BaseModel):
    bbox: BBox
    reason: str


class ProcessingPlan(BaseModel):
    useNativeText: bool = True
    runPrintedOcr: bool = False
    runLayoutAnalysis: bool = True
    detectHandwriting: bool = True
    analyzeVisualRelations: bool = True
    useFullPageVision: bool = False
    visualRegions: List[VisualRegion] = Field(default_factory=list)
    reasons: List[str] = Field(default_factory=list)


class DocumentPage(BaseModel):
    pageNumber: int = Field(ge=1)
    width: float = Field(gt=0.0)
    height: float = Field(gt=0.0)
    rotation: int = Field(default=0)
    nativeTextCoverage: float = Field(ge=0.0, le=1.0, default=0.0)
    rasterImageCoverage: float = Field(ge=0.0, le=1.0, default=0.0)
    flags: List[str] = Field(default_factory=list)
    processingPlan: ProcessingPlan = Field(default_factory=ProcessingPlan)
    blocks: List[ContentBlock] = Field(default_factory=list)
    rasterReferences: List[RasterReference] = Field(default_factory=list)
    warnings: List[str] = Field(default_factory=list)

    @field_validator("rotation")
    @classmethod
    def validate_rotation(cls, v: int) -> int:
        if v not in (0, 90, 180, 270):
            raise ValueError("rotation deve ser 0, 90, 180 ou 270")
        return v


class DocumentIR(BaseModel):
    schemaVersion: str = SCHEMA_VERSION
    documentId: str
    sourceHash: str
    pageCount: int = Field(ge=0)
    createdAt: str
    extractorVersion: str = "1.0.0"
    pages: List[DocumentPage] = Field(default_factory=list)
    warnings: List[str] = Field(default_factory=list)

    @field_validator("schemaVersion")
    @classmethod
    def validate_schema_version(cls, v: str) -> str:
        if not v.startswith("1."):
            raise ValueError(f"Incompatible schemaVersion: {v}. Expected 1.x.x")
        return v

    @model_validator(mode="after")
    def validate_page_count_and_relationships(self) -> DocumentIR:
        if len(self.pages) != self.pageCount:
            raise ValueError(
                f"pageCount ({self.pageCount}) não corresponde ao número de páginas fornecido ({len(self.pages)})"
            )

        all_block_ids = {block.id for page in self.pages for block in page.blocks}
        for page in self.pages:
            for block in page.blocks:
                for rel in block.relationships:
                    if rel.targetBlockId not in all_block_ids:
                        raise ValueError(
                            f"Relacionamento no bloco '{block.id}' aponta para targetBlockId inexistente: '{rel.targetBlockId}'"
                        )
        return self
