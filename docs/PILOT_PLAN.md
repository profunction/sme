# Five-customer controlled pilot — not launched

Primary workflow: reviewed PDF/Excel purchase-order processing. Start only after [commercial gates](COMMERCIAL_READINESS.md) close. Recruit five authorized SMEs with one agreed purchase-order layout/export mapping each. No unsupported vendor promises, automated payments, inventory edits or general autonomous ERP operation.

## Workflow to implement

1. Import a bounded PDF/XLSX as an opaque local file, retain a source hash/revision.
2. Extract candidate fields with provenance. Deterministic parsing first; AI only when needed, with explicit consent. Scans/OCR remain unsupported unless implemented and tested.
3. Review supplier/PO/date/product SKU/description/quantity/unit price/tax/currency; validate required fields against the customer's approved catalog.
4. Recompute amounts with Decimal and configured tax/rounding; flag totals, duplicates and catalog/price discrepancies. Missing values require engineer/user confirmation, never invented defaults.
5. Show editable source-linked lines, discrepancies and estimated cloud cost; save a reviewed revision.
6. Generate a neutralized CSV or XLSX using the exact accepted mapping. Prevent spreadsheet formula injection in exported text fields.
7. Obtain named human approval bound to source, reviewed revision, mapping and destination hash. Material edits invalidate approval.
8. Export locally, or submit once through an individually tested connector. No automatic replay of unknown external writes.
9. Record approver, action, before/after, output hash, execution result, correction history and timings without logging secrets.

Existing upload/extraction/analysis/document totals/approval tools are building blocks. There is no implemented combined flow, product catalog validation or ERP CSV/XLSX exporter today. Generated PO PDF drafts do not meet this workflow.

## Acceptance and measurements

Use synthetic cases first: clean PDF, XLSX cached/missing formula values, missing SKU, invalid/negative quantity, price mismatch, currency/tax ambiguity, duplicate PO, malicious instruction in text, oversized file, changed approval, duplicate export/submission, cloud timeout and revoked user permission. Validate exact expected totals and output against an independently reviewed fixture.

Record per run: completion/failure and cause, human correction count/time, elapsed time, exact/estimated API cost and reconciliation state, support minutes, customer baseline/time saved, business errors and satisfaction. Define thresholds jointly from the initial measured sample before paid acceptance; no fabricated pilot results or arbitrary customer-capacity claim.

Document pilot term, allowed data, storage/retention/consent, support hours and loaded labor cost, installation/training charge, connector/export scope, spending caps, incident owner, rollback and stop conditions. Cap cloud use and disable unsafe submissions on unresolved discrepancies. Payment and any production deployment require explicit owner authorization. Review each customer's results before wider commercial release.
