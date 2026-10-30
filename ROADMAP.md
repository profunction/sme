# Roadmap

| Phase | Current state |
|---|---|
| 1 — Desktop foundation | Implemented: Electron/React, FastAPI/SQLite, local/cloud chat and authentication. Linux build/API checks pass; Windows runtime remains unverified. |
| 2 — Hybrid AI | Implemented: hardware/model inspection, measured local benchmark, hardware-bound hybrid routing, privacy controls, Windows BYOK path, estimates and usage budgets. Live inference/Windows vault need runtime validation. |
| 3 — Business automation | Implemented: deterministic PDF/Word business drafts, bounded Excel analysis, document extraction, restricted files, task history, approval, cooperative cancellation and emergency stop. Native parsers still need production process isolation. |
| 4 — Integration framework | Implemented: registry, Generic REST adapter, mock ERP/POS/WMS/TMS, permissions, connection tests, audit, retry/rate controls and all-plan availability. Real vendor integration remains unverified. |
| 5 — Computer automation | Not implemented: controlled Playwright tools, Windows UI Automation, screenshot capture, planning and result verification. Playwright currently tests the application only. |
| 6 — Digital workforce | Not implemented: employee roles, assignments, scoped tools and employee task history. |
| 7 — Commercial features | Not implemented: trusted subscription validation, paid credits, device licensing and marketplace. Only configurable mock plan metadata/local budgets exist. |
| 8 — Windows release | Not implemented: bundled backend, signed installer, managed process lifecycle, secure updates and Windows integration tests. |

Advance through small tested changes. Never claim vendor support based on mocks, Windows verification based on Linux, or payment validity based on local SQLite.
