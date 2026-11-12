"""FINNOS Document Intelligence: deterministic document-to-financial-data core.

Review-only by design: nothing in this package writes to Firestore, the
wallet or the Ledger. Heavy OCR packages are imported lazily by the engines.
"""

from finnos.document_intelligence.service import classify_document, extract_text_document

__all__ = ["classify_document", "extract_text_document"]
