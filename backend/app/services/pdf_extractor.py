"""
PDF receipt extractor.
Uses PyMuPDF to extract text from each page. If a page has very little
extractable text (scanned image), falls back to Tesseract OCR via PyMuPDF's
built-in OCR integration.
"""

import io
from pathlib import Path

import fitz  # PyMuPDF


_OCR_TEXT_THRESHOLD = 30   # characters — below this, treat page as scanned


def extract_text_from_pdf(pdf_bytes: bytes) -> str:
    """Return the full extracted text of a PDF, using OCR for scanned pages."""
    doc = fitz.open(stream=pdf_bytes, filetype="pdf")
    pages_text: list[str] = []

    for page in doc:
        text = page.get_text()
        if len(text.strip()) < _OCR_TEXT_THRESHOLD:
            # Page is likely a scanned image — try OCR
            try:
                text = page.get_textpage_ocr(flags=0, dpi=300).extractTEXT()
            except Exception:  # noqa: BLE001
                # Tesseract not installed or OCR failed — use whatever text is there
                pass
        pages_text.append(text.strip())

    return "\n\n--- PAGE BREAK ---\n\n".join(filter(None, pages_text))
