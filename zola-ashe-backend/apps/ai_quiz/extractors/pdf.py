"""Extraction de texte depuis un PDF stocké dans le bucket (R2 en prod, local en dev).

Utilise PyMuPDF (fitz) — rapide, robuste, mieux que PyPDF2 sur les PDF
scannés/mixtes. Nettoie les headers/footers répétés, collapse les espaces,
et tronque au-delà de MAX_CHARS pour ne pas exploser le prompt Gemini.
"""
from __future__ import annotations

import logging
import re
from collections import Counter

from django.core.files.storage import default_storage

logger = logging.getLogger("ai_quiz")

MAX_CHARS = 200_000  # ~50k tokens — laisse de la marge sous la fenêtre de Gemini 2.5 Flash


class PDFExtractionError(RuntimeError):
    """Impossible d'extraire le texte du PDF."""


def extract_pdf_text(resource_id: int) -> str:
    """Extrait le texte d'une content.Resource de type PDF.

    Lève PDFExtractionError si :
      - la ressource n'est pas un PDF
      - le bucket_key est vide
      - le fichier est illisible / vide
    """
    from apps.content.models import Resource, ResourceType

    try:
        resource = Resource.objects.get(pk=resource_id)
    except Resource.DoesNotExist as exc:
        raise PDFExtractionError(f"Resource {resource_id} introuvable.") from exc

    if resource.resource_type != ResourceType.PDF:
        raise PDFExtractionError(
            f"Resource {resource_id} n'est pas un PDF (type={resource.resource_type})."
        )
    if not resource.bucket_key:
        raise PDFExtractionError(
            f"Resource {resource_id} sans bucket_key — fichier absent."
        )

    logger.info("pdf.extract resource_id=%d bucket_key=%s", resource_id, resource.bucket_key)

    try:
        with default_storage.open(resource.bucket_key, "rb") as fh:
            data = fh.read()
    except Exception as exc:
        raise PDFExtractionError(
            f"Lecture du bucket échouée pour {resource.bucket_key}: {exc}"
        ) from exc

    if not data:
        raise PDFExtractionError(f"Fichier {resource.bucket_key} vide.")

    return extract_pdf_text_from_bytes(data, source_hint=resource.bucket_key)


def extract_pdf_text_from_bytes(data: bytes, *, source_hint: str = "") -> str:
    """Variante utilitaire : parse directement des bytes (tests, uploads directs)."""
    import fitz  # PyMuPDF

    try:
        doc = fitz.open(stream=data, filetype="pdf")
    except Exception as exc:
        raise PDFExtractionError(f"PDF corrompu ou illisible ({source_hint}): {exc}") from exc

    pages: list[str] = []
    try:
        for page in doc:
            text = page.get_text("text", sort=True) or ""
            pages.append(text)
    finally:
        doc.close()

    if not any(p.strip() for p in pages):
        raise PDFExtractionError(
            f"PDF sans texte extractible ({source_hint}) — probablement scanné, "
            "OCR requis."
        )

    cleaned = _clean_pages(pages)
    truncated = False
    if len(cleaned) > MAX_CHARS:
        cleaned = cleaned[:MAX_CHARS]
        truncated = True

    logger.info(
        "pdf.extract source=%s pages=%d chars=%d truncated=%s",
        source_hint or "<bytes>",
        len(pages),
        len(cleaned),
        truncated,
    )
    return cleaned


# --- Nettoyage --------------------------------------------------------------

_CONTROL_CHARS_RE = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]")
_MULTI_SPACE_RE = re.compile(r"[ \t]+")
_MULTI_NEWLINE_RE = re.compile(r"\n{3,}")


def _clean_pages(pages: list[str]) -> str:
    """Retire les en-têtes/pieds répétés puis normalise les espaces."""
    # Heuristique : si une ligne apparaît sur ≥ 50 % des pages en position
    # première/dernière, c'est un header/footer → on la retire.
    if len(pages) >= 4:
        first_lines = Counter()
        last_lines = Counter()
        for p in pages:
            lines = [l.strip() for l in p.splitlines() if l.strip()]
            if lines:
                first_lines[lines[0]] += 1
                last_lines[lines[-1]] += 1
        threshold = max(2, len(pages) // 2)
        common_first = {ln for ln, n in first_lines.items() if n >= threshold}
        common_last = {ln for ln, n in last_lines.items() if n >= threshold}

        cleaned_pages = []
        for p in pages:
            lines = p.splitlines()
            # Drop first non-empty line si dans common_first.
            for i, line in enumerate(lines):
                if line.strip() in common_first:
                    lines[i] = ""
                    break
                if line.strip():
                    break
            # Drop last non-empty line si dans common_last.
            for i in range(len(lines) - 1, -1, -1):
                if lines[i].strip() in common_last:
                    lines[i] = ""
                    break
                if lines[i].strip():
                    break
            cleaned_pages.append("\n".join(lines))
        pages = cleaned_pages

    text = "\n\n".join(pages)
    text = _CONTROL_CHARS_RE.sub("", text)
    text = _MULTI_SPACE_RE.sub(" ", text)
    text = _MULTI_NEWLINE_RE.sub("\n\n", text)
    return text.strip()
