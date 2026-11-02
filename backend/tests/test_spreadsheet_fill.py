"""Owned XLSX fixtures: no real Excel process, shell, AI or external services."""

import hashlib
import io
import zipfile

import pytest
from openpyxl import Workbook, load_workbook
from openpyxl.styles import Font
from openpyxl.worksheet.datavalidation import DataValidation

from backend import files, spreadsheet_fill as tool, store


@pytest.fixture
def template(tmp_path):
    connect = lambda: store.open_db(tmp_path / "spreadsheet.sqlite3")
    book = Workbook()
    sheet = book.active
    sheet.title = "Form"
    sheet["A1"] = "Customer"
    sheet["A1"].font = Font(bold=True)
    sheet["A2"] = "Quantity"
    sheet["B2"] = 2
    sheet["C3"] = "=SUM(B2,2)"
    output = io.BytesIO()
    book.save(output)
    book.close()
    data = output.getvalue()
    entry = files.save(connect, tmp_path / "spreadsheet.sqlite3", "template.xlsx", data)
    return connect, tmp_path / "spreadsheet.sqlite3", entry, data


def execute(template, name, payload):
    connect, db_path, _, _ = template
    normalized = tool.prepare(name, payload)
    return tool.run(name, normalized, connect, db_path, lambda: None)


def changes(template, **overrides):
    _, _, file, data = template
    return {"file_id": file["id"], "source_sha256": hashlib.sha256(data).hexdigest(),
            "values": [{"sheet": "Form", "cell": "B1", "kind": "text", "value": "+60123456789"},
                       {"sheet": "Form", "cell": "B2", "kind": "number", "value": "3.25"},
                       {"sheet": "Form", "cell": "B4", "kind": "boolean", "value": "true"}], **overrides}


def test_inspection_is_bounded_and_never_creates_output(template):
    result = execute(template, "excel.inspect", {"file_id": template[2]["id"]})["spreadsheet"]
    assert result["source_sha256"] == hashlib.sha256(template[3]).hexdigest()
    cells = {cell["cell"]: cell for cell in result["sheets"][0]["cells"]}
    assert cells["C3"]["kind"] == "formula" and cells["C3"]["editable"] is False
    assert cells["A1"]["editable"] is True
    with template[0]() as db:
        assert db.execute("SELECT COUNT(*) FROM files").fetchone()[0] == 1


def test_reviewed_fill_preserves_original_styles_formulas_and_literal_types(template):
    payload = changes(template)
    review = execute(template, "excel.preview", payload)["spreadsheet_preview"]
    assert review["changes"][0] == {"sheet": "Form", "cell": "B1", "before": None,
                                     "after": "+60123456789", "kind": "text"}
    result = execute(template, "excel.fill", {**payload, "preview_hash": review["preview_hash"]})
    source_path, _ = files.locate(template[0], template[1], template[2]["id"])
    assert source_path.read_bytes() == template[3]
    output_path, _ = files.locate(template[0], template[1], result["file"]["id"])
    book = load_workbook(output_path, data_only=False)
    assert book["Form"]["B1"].value == "+60123456789" and book["Form"]["B1"].data_type == "s"
    assert book["Form"]["B2"].value == 3.25
    assert book["Form"]["B4"].value is True
    assert book["Form"]["C3"].value == "=SUM(B2,2)"
    assert book["Form"]["A1"].font.bold is True
    book.close()
    assert result["output_sha256"] == hashlib.sha256(output_path.read_bytes()).hexdigest()
    with template[0]() as db:
        row = db.execute("SELECT * FROM audit WHERE event='spreadsheet_filled'").fetchone()
        assert row and "+60123456789" not in row["detail"]


@pytest.mark.parametrize("patch", [{"value": "=SUM(A1:A2)"}, {"value": " @HYPERLINK(1)"},
    {"value": "bad\x00text"}, {"kind": "number", "value": "NaN"},
    {"kind": "number", "value": "1e8"}, {"kind": "number", "value": "1234567890123456"},
    {"kind": "boolean", "value": "yes"}, {"kind": "blank", "value": "not blank"},
    {"cell": "XFD1048576"}, {"cell": "A0"}])
def test_untrusted_cell_payloads_are_rejected(template, patch):
    payload = changes(template)
    payload["values"] = [{**payload["values"][0], **patch}]
    with pytest.raises(ValueError):
        tool.prepare("excel.preview", payload)


def test_formula_cell_and_duplicate_cell_edits_are_rejected(template):
    payload = changes(template)
    with pytest.raises(ValueError, match="Formula cells"):
        execute(template, "excel.preview", {**payload, "values": [{"sheet": "Form", "cell": "C3", "value": "new"}]})
    with pytest.raises(ValueError, match="only once"):
        tool.prepare("excel.preview", {**payload, "values": [payload["values"][0], payload["values"][0]]})


@pytest.mark.parametrize("mode", ["protected", "merged", "validation", "hidden"])
def test_unsupported_targets_are_not_silently_changed(template, mode):
    source, _ = files.locate(template[0], template[1], template[2]["id"])
    book = load_workbook(source)
    if mode == "protected":
        book["Form"].protection.sheet = True
    elif mode == "merged":
        book["Form"].merge_cells("B1:C1")
    elif mode == "validation":
        validation = DataValidation(type="list", formula1='"A,B"')
        book["Form"].add_data_validation(validation)
        validation.add("B1")
    else:
        book.create_sheet("Visible")
        book["Form"].sheet_state = "hidden"
    book.save(source)
    book.close()
    payload = changes(template, source_sha256=hashlib.sha256(source.read_bytes()).hexdigest())
    with pytest.raises(ValueError):
        execute(template, "excel.preview", payload)


def test_changed_source_or_preview_cannot_be_exported(template):
    payload = changes(template)
    review = execute(template, "excel.preview", payload)["spreadsheet_preview"]
    altered = {**payload, "values": [{"sheet": "Form", "cell": "B1", "value": "different"}]}
    with pytest.raises(ValueError, match="differ"):
        execute(template, "excel.fill", {**altered, "preview_hash": review["preview_hash"]})
    source, _ = files.locate(template[0], template[1], template[2]["id"])
    source.write_bytes(template[3] + b"changed")
    with pytest.raises(ValueError, match="changed"):
        execute(template, "excel.fill", {**payload, "preview_hash": review["preview_hash"]})
    with template[0]() as db:
        assert db.execute("SELECT COUNT(*) FROM files").fetchone()[0] == 1


@pytest.mark.parametrize("entry", ["xl/externalLinks/externalLink1.xml", "xl/macrosheets/sheet1.xml"])
def test_active_external_workbook_content_is_not_reexported(template, entry):
    buffer = io.BytesIO()
    with zipfile.ZipFile(io.BytesIO(template[3])) as source, zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as dest:
        for name in source.namelist():
            dest.writestr(name, source.read(name))
        dest.writestr(entry, "<externalLink/>")
    with pytest.raises(ValueError, match="External links"):
        tool.open_template(buffer.getvalue(), lambda: None)
