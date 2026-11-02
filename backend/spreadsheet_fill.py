"""Deterministic reviewed XLSX template edits; never executes Excel or formulas."""

import hashlib
import io
import json
import math
import re
import zipfile
from datetime import date, datetime, time
from decimal import Decimal, InvalidOperation

from openpyxl import load_workbook
from openpyxl.cell.cell import MergedCell
from openpyxl.utils.cell import coordinate_to_tuple
from pydantic import BaseModel, ConfigDict, Field, model_validator
from typing import Literal

from backend import files, store

MAX_CELLS = 100000
MAX_ROWS = 10000
MAX_COLUMNS = 1000
MAX_PREVIEW = 200
UNSAFE_FORMULA = re.compile(r"\[|\]|\||https?://|\b(?:WEBSERVICE|HYPERLINK|RTD|DDE|CALL|EXEC|REGISTER\.ID)\s*\(", re.I)


class Inspect(BaseModel):
    model_config = ConfigDict(extra="forbid")
    file_id: str = Field(pattern=r"^[a-f0-9]{32}$")


class CellValue(BaseModel):
    model_config = ConfigDict(extra="forbid")
    sheet: str = Field(min_length=1, max_length=31)
    cell: str = Field(pattern=r"^[A-Z]{1,3}[1-9][0-9]{0,6}$")
    kind: Literal["text", "number", "boolean", "blank"] = "text"
    value: str = Field(default="", max_length=4000)

    @model_validator(mode="after")
    def supported_cell(self):
        row, column = coordinate_to_tuple(self.cell)
        if row > MAX_ROWS or column > MAX_COLUMNS:
            raise ValueError("Cell exceeds supported template limits")
        normalized(self)
        return self


class Preview(Inspect):
    source_sha256: str = Field(pattern=r"^[a-f0-9]{64}$")
    values: list[CellValue] = Field(min_length=1, max_length=100)

    @model_validator(mode="after")
    def no_duplicate_cells(self):
        destinations = [(value.sheet, value.cell) for value in self.values]
        if len(set(destinations)) != len(destinations):
            raise ValueError("Each destination cell may appear only once")
        return self


class Fill(Preview):
    preview_hash: str = Field(pattern=r"^[a-f0-9]{64}$")


def normalized(edit):
    """Return only deliberately selected literal types, never formula expressions."""
    if re.search(r"[\x00-\x08\x0b\x0c\x0e-\x1f]", edit.value):
        raise ValueError("Cell value contains unsupported control characters")
    if edit.kind == "blank":
        if edit.value:
            raise ValueError("Blank cell edits must have an empty value")
        return None
    if edit.kind == "boolean":
        if edit.value not in ("true", "false"):
            raise ValueError("Boolean cell values must be true or false")
        return edit.value == "true"
    if edit.kind == "number":
        if not re.fullmatch(r"-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?", edit.value):
            raise ValueError("Use an ordinary decimal number without formulas or separators")
        try:
            number = Decimal(edit.value)
            if (not number.is_finite() or abs(number) > Decimal("1000000000000")
                    or len(number.as_tuple().digits) > 15 or number.as_tuple().exponent < -10):
                raise ValueError()
        except (InvalidOperation, ValueError):
            raise ValueError("Number exceeds Excel's supported precision; use text for exact long identifiers") from None
        return int(number) if number == number.to_integral_value() else float(number)
    if edit.value.lstrip().startswith(("=", "@")):
        raise ValueError("Formula-like values are not allowed")
    # A phone number such as +6012... stays an XLSX string, never a formula.
    return edit.value


def shown(value):
    if value is None or isinstance(value, (str, bool, int)):
        return value
    if isinstance(value, float):
        if not math.isfinite(value):
            raise ValueError("Workbook contains a non-finite numeric value")
        return value
    if isinstance(value, (datetime, date, time)):
        return value.isoformat()
    return str(value)


def open_template(source, checkpoint):
    files.validate(source, ".xlsx")
    with zipfile.ZipFile(io.BytesIO(source)) as archive:
        forbidden = ("xl/externallinks/", "xl/embeddings/", "xl/activex/", "xl/macrosheets/", "xl/dialogsheets/", "customui/")
        if any(name.lower().startswith(forbidden) or name.lower() == "xl/connections.xml"
               for name in archive.namelist()):
            raise ValueError("External links, embedded objects and active content are unsupported")
        content_types = archive.read("[Content_Types].xml").lower()
        if b"macroenabled" in content_types or b"macrosheet" in content_types:
            raise ValueError("Macro-enabled workbooks are unsupported")
    book = load_workbook(io.BytesIO(source), data_only=False, keep_links=False)
    try:
        if len(book.worksheets) > 20:
            raise ValueError("Maximum 20 template sheets")
        total = 0
        for sheet in book.worksheets:
            checkpoint()
            total += sheet.max_row * sheet.max_column
            if sheet.max_row > MAX_ROWS or sheet.max_column > MAX_COLUMNS or total > MAX_CELLS:
                raise ValueError("Template exceeds bounded worksheet limits")
            if len(sheet.merged_cells.ranges) > 1000:
                raise ValueError("Template contains too many merged ranges")
            for row in sheet.iter_rows():
                checkpoint()
                for cell in row:
                    if cell.data_type == "f" and UNSAFE_FORMULA.search(str(cell.value)):
                        raise ValueError("External or active workbook formulas are unsupported")
        return book
    except Exception:
        book.close()
        raise


def fingerprint(payload, changes):
    data = {"input": payload.model_dump(exclude={"preview_hash"}), "changes": changes}
    return hashlib.sha256(json.dumps(data, sort_keys=True, separators=(",", ":")).encode()).hexdigest()


def preview_changes(book, payload, checkpoint):
    changes = []
    extents = {sheet.title: [sheet.max_row, sheet.max_column] for sheet in book.worksheets}
    for edit in payload.values:
        checkpoint()
        if edit.sheet not in book.sheetnames:
            raise ValueError("Unknown worksheet")
        sheet = book[edit.sheet]
        row, column = coordinate_to_tuple(edit.cell)
        if max(sheet.max_row, row) * max(sheet.max_column, column) > MAX_CELLS:
            raise ValueError("Edit would extend the template beyond supported limits")
        target = sheet[edit.cell]
        if sheet.sheet_state != "visible" or sheet.protection.sheet or book.security.lockStructure:
            raise ValueError("Hidden/protected worksheets or protected workbooks cannot be edited")
        if isinstance(target, MergedCell) or any(edit.cell in merged for merged in sheet.merged_cells.ranges):
            raise ValueError("Merged cells cannot be edited by this tool")
        if target.data_type == "f":
            raise ValueError("Formula cells cannot be overwritten")
        if any(edit.cell in validation for validation in sheet.data_validations.dataValidation):
            raise ValueError("Cells with Excel validation rules require manual editing")
        extents[edit.sheet] = [max(extents[edit.sheet][0], row), max(extents[edit.sheet][1], column)]
        changes.append({"sheet": edit.sheet, "cell": edit.cell, "before": shown(target.value),
                        "after": shown(normalized(edit)), "kind": edit.kind})
    if sum(rows * columns for rows, columns in extents.values()) > MAX_CELLS:
        raise ValueError("Edits would extend the workbook beyond supported limits")
    return changes


def prepare(tool, payload):
    models = {"excel.inspect": Inspect, "excel.preview": Preview, "excel.fill": Fill}
    if tool not in models:
        raise ValueError("Unknown spreadsheet tool")
    return models[tool].model_validate(payload).model_dump()


def run(tool, payload, connect, db_path, checkpoint):
    checkpoint()
    parsed = {"excel.inspect": Inspect, "excel.preview": Preview, "excel.fill": Fill}[tool].model_validate(payload)
    path, original = files.locate(connect, db_path, parsed.file_id)
    if path.suffix != ".xlsx":
        raise ValueError("Template filling supports uploaded XLSX only")
    source = path.read_bytes()
    source_hash = hashlib.sha256(source).hexdigest()
    if tool != "excel.inspect" and parsed.source_sha256 != source_hash:
        raise ValueError("Source workbook changed; inspect and review it again")
    book = open_template(source, checkpoint)
    try:
        if tool == "excel.inspect":
            sheets, count = [], 0
            for sheet in book.worksheets:
                if sheet.sheet_state != "visible":
                    continue
                cells = []
                for row in sheet.iter_rows():
                    checkpoint()
                    for cell in row:
                        if cell.value is None or count >= MAX_PREVIEW:
                            continue
                        value = shown(cell.value)
                        cells.append({"cell": cell.coordinate, "value": value[:500] if isinstance(value, str) else value,
                                      "kind": "formula" if cell.data_type == "f" else "value",
                                      "editable": not (sheet.protection.sheet or book.security.lockStructure
                                          or cell.data_type == "f" or any(cell.coordinate in merged for merged in sheet.merged_cells.ranges)
                                          or any(cell.coordinate in validation for validation in sheet.data_validations.dataValidation))})
                        count += 1
                sheets.append({"name": sheet.title, "rows": sheet.max_row, "columns": sheet.max_column, "cells": cells})
            return {"spreadsheet": {"file_id": parsed.file_id, "source_sha256": source_hash, "sheets": sheets,
                                     "preview_limit": MAX_PREVIEW},
                    "note": "Local XLSX template. Only a bounded cell preview is displayed; formulas are not calculated."}
        changes = preview_changes(book, parsed, checkpoint)
        digest = fingerprint(parsed, changes)
        preview = {"changes": changes, "preview_hash": digest,
                   "fill": parsed.model_dump(exclude={"preview_hash"})}
        if tool == "excel.preview":
            return {"spreadsheet_preview": preview}
        if parsed.preview_hash != digest:
            raise ValueError("Changes differ from the inspected preview; request a new review")
        for edit in parsed.values:
            checkpoint()
            target = book[edit.sheet][edit.cell]
            target.value = normalized(edit)
            if edit.kind == "text":
                target.data_type = "s"
        output = io.BytesIO()
        book.save(output)
        data = output.getvalue()
        checkpoint()
        file = files.save(connect, db_path, "filled-" + original["name"], data, trusted=True)
        try:
            with connect() as db:
                store.audit(db, "spreadsheet_filled", file["id"], "source=" + source_hash + ";review=" + digest)
        except Exception:
            files.delete(connect, db_path, file["id"])
            raise
        return {"file": file, "changes": changes, "source_sha256": source_hash, "preview_hash": digest,
                "output_sha256": hashlib.sha256(data).hexdigest(),
                "note": "Created a new workbook; original preserved. Formulas were not recalculated. Review in Excel before business use."}
    finally:
        book.close()
