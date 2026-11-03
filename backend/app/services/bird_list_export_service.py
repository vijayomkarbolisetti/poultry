"""CSV / XLSX export for dead and sold bird lists."""

from __future__ import annotations

import csv
import io
from datetime import date
from typing import Literal

from openpyxl import Workbook

from app.schemas.flock import DeadBirdHitOut, SoldBirdHitOut

ExportFormat = Literal["csv", "xlsx"]

DEAD_HEADERS = ("Bird band/ID", "Breed", "Batch", "Shed", "Died on", "Death reason")
SOLD_HEADERS = (
    "Bird band/ID",
    "Breed",
    "Batch",
    "Shed",
    "Sold on",
    "Buyer name",
    "Buyer mobile",
)

CSV_MEDIA = "text/csv; charset=utf-8"
XLSX_MEDIA = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"


class BirdListExportError(Exception):
    def __init__(self, message: str, code: str = "EXPORT_ERROR") -> None:
        self.message = message
        self.code = code
        super().__init__(message)


def _bird_label(band_id: str | None, display_code: str | None, bird_id) -> str:
    return (band_id or display_code or str(bird_id)[:8]).strip()


def _shed_label(shed_name: str | None, shed_code: str | None) -> str:
    return (shed_name or shed_code or "—").strip()


def _iso(d: date | None) -> str:
    return d.isoformat() if d else ""


def dead_rows(items: list[DeadBirdHitOut]) -> list[tuple[str, ...]]:
    rows: list[tuple[str, ...]] = []
    for item in items:
        rows.append(
            (
                _bird_label(item.band_id, item.display_code, item.id),
                (item.breed or "").strip(),
                (item.batch_code or "").strip(),
                _shed_label(item.shed_name, item.shed_code),
                _iso(item.died_on),
                (item.reason or "").strip(),
            )
        )
    return rows


def sold_rows(items: list[SoldBirdHitOut]) -> list[tuple[str, ...]]:
    rows: list[tuple[str, ...]] = []
    for item in items:
        rows.append(
            (
                _bird_label(item.band_id, item.display_code, item.id),
                (item.breed or "").strip(),
                (item.batch_code or "").strip(),
                _shed_label(item.shed_name, item.shed_code),
                _iso(item.sold_on),
                (item.buyer_name or "").strip(),
                (item.buyer_mobile or "").strip(),
            )
        )
    return rows


def _csv_bytes(headers: tuple[str, ...], rows: list[tuple[str, ...]]) -> bytes:
    buf = io.StringIO(newline="")
    writer = csv.writer(buf)
    writer.writerow(headers)
    writer.writerows(rows)
    # UTF-8 BOM helps Excel open CSV with non-ASCII names correctly.
    return ("\ufeff" + buf.getvalue()).encode("utf-8")


def _xlsx_bytes(headers: tuple[str, ...], rows: list[tuple[str, ...]], sheet_title: str) -> bytes:
    wb = Workbook()
    ws = wb.active
    ws.title = sheet_title[:31] or "Export"
    ws.append(list(headers))
    for row in rows:
        ws.append(list(row))
    out = io.BytesIO()
    wb.save(out)
    return out.getvalue()


def build_export_filename(
    kind: Literal["dead-birds", "sold-birds"],
    fmt: ExportFormat,
    *,
    date_from: date | None,
    date_to: date | None,
) -> str:
    ext = "csv" if fmt == "csv" else "xlsx"
    if date_from and date_to:
        span = f"{date_from.isoformat()}_to_{date_to.isoformat()}"
    elif date_from:
        span = f"from_{date_from.isoformat()}"
    elif date_to:
        span = f"to_{date_to.isoformat()}"
    else:
        span = "all"
    return f"{kind}-{span}.{ext}"


def render_dead_export(items: list[DeadBirdHitOut], fmt: ExportFormat) -> tuple[bytes, str]:
    rows = dead_rows(items)
    if fmt == "csv":
        return _csv_bytes(DEAD_HEADERS, rows), CSV_MEDIA
    if fmt == "xlsx":
        return _xlsx_bytes(DEAD_HEADERS, rows, "Dead Birds"), XLSX_MEDIA
    raise BirdListExportError(f"Unsupported format: {fmt}", "INVALID")


def render_sold_export(items: list[SoldBirdHitOut], fmt: ExportFormat) -> tuple[bytes, str]:
    rows = sold_rows(items)
    if fmt == "csv":
        return _csv_bytes(SOLD_HEADERS, rows), CSV_MEDIA
    if fmt == "xlsx":
        return _xlsx_bytes(SOLD_HEADERS, rows, "Sold Birds"), XLSX_MEDIA
    raise BirdListExportError(f"Unsupported format: {fmt}", "INVALID")


def parse_export_format(raw: str | None) -> ExportFormat:
    value = (raw or "csv").strip().lower()
    if value in {"csv", "xlsx"}:
        return value  # type: ignore[return-value]
    raise BirdListExportError("format must be csv or xlsx", "INVALID")
