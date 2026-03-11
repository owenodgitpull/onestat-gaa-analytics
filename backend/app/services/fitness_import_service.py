"""
Fitness Test File Import Service.

Accepts any file format (XLSX, DOCX, CSV, PDF), extracts text content,
and uses Claude Haiku to structure the data into fitness test records.
"""

import json
import logging
import csv
import io
from datetime import date, datetime
from typing import Optional

logger = logging.getLogger(__name__)


# All metric fields we support
METRIC_FIELDS = [
    "weight_kg", "body_fat_percentage",
    "ktw_right_cm", "ktw_left_cm", "overhead_squat_score",
    "cmj_cm", "squat_jump_cm",
    "press_ups_60s", "pull_ups_60s",
    "sprint_0_10m_sec", "bronco_test_min",
    "eur", "mas_100_percent", "mas_120_percent",
]

EXTRACTION_PROMPT = """You are a fitness test data extractor. Given raw text content from a fitness testing document, extract ALL player fitness test data into structured JSON.

The document may be in any format (spreadsheet, individual reports, tables, etc). Extract every player and every metric you can find.

IMPORTANT RULES:
- Values like "INJ" (injured), "DNS" (did not show), "DNT" (did not test), "N/A", or blank = null (omit the metric)
- Bronco times in "M:SS" format (e.g. "4:52") must be converted to decimal minutes (4:52 → 4.87)
- If the document contains MULTIPLE test dates, return separate entries for each date
- Only include metrics where you find actual numeric values
- Player names should be in "First Last" format as found in the document

Return ONLY valid JSON in this exact format (no other text):
{
  "test_sessions": [
    {
      "test_date": "YYYY-MM-DD",
      "players": [
        {
          "name": "Player Name",
          "metrics": {
            "weight_kg": 86.6,
            "body_fat_percentage": 12.0,
            "ktw_right_cm": 12.0,
            "ktw_left_cm": 12.0,
            "overhead_squat_score": 2,
            "cmj_cm": 37.9,
            "squat_jump_cm": 32.7,
            "press_ups_60s": 51,
            "pull_ups_60s": 14,
            "sprint_0_10m_sec": 1.882,
            "bronco_test_min": 4.87,
            "eur": 1.16,
            "mas_100_percent": 4.11,
            "mas_120_percent": 4.93
          }
        }
      ]
    }
  ]
}

Only include metrics that have actual numeric values. Omit any metric that is null/missing/INJ/DNS/DNT."""


def extract_text_from_xlsx(file_bytes: bytes) -> str:
    """Extract text content from an XLSX file."""
    import openpyxl
    wb = openpyxl.load_workbook(io.BytesIO(file_bytes), data_only=True)

    lines = []
    for sheet_name in wb.sheetnames:
        ws = wb[sheet_name]
        lines.append(f"=== Sheet: {sheet_name} ===")
        for row in ws.iter_rows(values_only=True):
            # Convert each cell to string, handling dates
            cells = []
            for cell in row:
                if cell is None:
                    cells.append("")
                elif isinstance(cell, datetime):
                    cells.append(cell.strftime("%Y-%m-%d"))
                elif isinstance(cell, date):
                    cells.append(cell.isoformat())
                else:
                    cells.append(str(cell))
            lines.append(" | ".join(cells))
        lines.append("")

    return "\n".join(lines)


def extract_text_from_docx(file_bytes: bytes) -> str:
    """Extract text content from a DOCX file, preserving document order.

    Iterates body elements in order so paragraphs and tables stay interleaved
    (critical for individual-report formats where player name precedes their data table).
    """
    from docx import Document
    from docx.table import Table as DocxTable
    from docx.text.paragraph import Paragraph
    from docx.oxml.ns import qn

    doc = Document(io.BytesIO(file_bytes))
    lines = []
    table_idx = 0

    for element in doc.element.body:
        tag = element.tag
        if tag == qn("w:p"):
            para = Paragraph(element, doc)
            if para.text.strip():
                lines.append(para.text)
        elif tag == qn("w:tbl"):
            table_idx += 1
            table = DocxTable(element, doc)
            lines.append(f"\n=== Table {table_idx} ===")
            for row in table.rows:
                cells = [cell.text.strip() for cell in row.cells]
                lines.append(" | ".join(cells))

    return "\n".join(lines)


def extract_text_from_csv(file_bytes: bytes) -> str:
    """Extract text content from a CSV file."""
    text = file_bytes.decode("utf-8-sig")
    return text


def extract_text_from_pdf(file_bytes: bytes) -> str:
    """Extract text content from a PDF file."""
    try:
        import fitz  # pymupdf
        doc = fitz.open(stream=file_bytes, filetype="pdf")
        lines = []
        for page in doc:
            lines.append(page.get_text())
        return "\n".join(lines)
    except ImportError:
        raise ValueError("PDF support requires pymupdf. Install with: pip install pymupdf")


EXTRACTORS = {
    ".xlsx": extract_text_from_xlsx,
    ".xls": extract_text_from_xlsx,
    ".docx": extract_text_from_docx,
    ".csv": extract_text_from_csv,
    ".txt": extract_text_from_csv,
    ".pdf": extract_text_from_pdf,
}


async def import_fitness_file(file_bytes: bytes, filename: str, fallback_date: Optional[str] = None) -> dict:
    """
    Parse a fitness test file of any format and return structured data.

    Returns: {
        "test_sessions": [
            {
                "test_date": "YYYY-MM-DD",
                "players": [
                    {"name": "...", "metrics": {...}}
                ]
            }
        ]
    }
    """
    import os

    # Determine file type
    ext = os.path.splitext(filename)[1].lower()
    extractor = EXTRACTORS.get(ext)
    if not extractor:
        raise ValueError(f"Unsupported file type: {ext}. Supported: {', '.join(EXTRACTORS.keys())}")

    # Extract text
    raw_text = extractor(file_bytes)
    if not raw_text or len(raw_text.strip()) < 20:
        raise ValueError("File appears to be empty or could not be read.")

    # Truncate if very large (Haiku context is 200k but let's be reasonable)
    if len(raw_text) > 50000:
        raw_text = raw_text[:50000] + "\n\n[... truncated ...]"

    # Send to Claude Haiku for extraction
    from app.services.ai._shared import client

    logger.info(f"Sending {filename} ({len(raw_text)} chars) to Haiku for fitness data extraction")

    response = client.messages.create(
        model="claude-haiku-4-5-20251001",
        max_tokens=8000,
        messages=[
            {
                "role": "user",
                "content": f"{EXTRACTION_PROMPT}\n\n--- DOCUMENT CONTENT ---\n{raw_text}"
            }
        ],
    )

    # Parse the response
    response_text = response.content[0].text.strip()

    # Try to extract JSON from the response
    try:
        # Handle case where response has markdown code block
        if "```json" in response_text:
            response_text = response_text.split("```json")[1].split("```")[0].strip()
        elif "```" in response_text:
            response_text = response_text.split("```")[1].split("```")[0].strip()

        result = json.loads(response_text)
    except json.JSONDecodeError as e:
        logger.error(f"Failed to parse Haiku response as JSON: {e}\nResponse: {response_text[:500]}")
        raise ValueError("AI could not parse the file. Please check the file format and try again.")

    # Validate structure
    if "test_sessions" not in result:
        # Try to wrap if it's a flat structure
        if "players" in result:
            result = {"test_sessions": [result]}
        else:
            raise ValueError("AI extraction returned unexpected format.")

    # Apply fallback date if sessions don't have dates
    for session in result["test_sessions"]:
        if not session.get("test_date") or session["test_date"] in ("unknown", "null", "N/A"):
            session["test_date"] = fallback_date or date.today().isoformat()

        # Clean up metrics — ensure only valid fields and numeric values
        for player in session.get("players", []):
            clean_metrics = {}
            for key, val in player.get("metrics", {}).items():
                if key in METRIC_FIELDS and val is not None:
                    try:
                        clean_metrics[key] = float(val)
                    except (ValueError, TypeError):
                        continue
            player["metrics"] = clean_metrics

    logger.info(f"Extracted {sum(len(s.get('players', [])) for s in result['test_sessions'])} players from {len(result['test_sessions'])} session(s)")

    return result
