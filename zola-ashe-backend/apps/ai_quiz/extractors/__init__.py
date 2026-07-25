"""Extracteurs de contenu — YouTube (transcription) et PDF (texte)."""
from .pdf import PDFExtractionError, extract_pdf_text, extract_pdf_text_from_bytes
from .youtube import (
    TranscriptNotAvailable,
    extract_youtube_id,
    extract_youtube_transcript,
)

__all__ = [
    "TranscriptNotAvailable",
    "extract_youtube_id",
    "extract_youtube_transcript",
    "PDFExtractionError",
    "extract_pdf_text",
    "extract_pdf_text_from_bytes",
]
