# Security review scope and requirements

Read [SECURITY_GAPS.md](SECURITY_GAPS.md) for prioritized findings and [../SECURITY.md](../SECURITY.md) for implemented boundaries. This audit does not establish legal compliance, complete tenant isolation or production safety.

Preserve: session-authenticated loopback API, minimal validated Electron IPC, renderer isolation, OS-native secret vault, no unrestricted AI shell/code, opaque file IDs, file/extraction bounds, explicit cloud consent, local-only privacy, immutable approved tool actions, no write replay and signed device grants. Uploaded documents and model/provider/connector output remain untrusted data. Prompt text is not authorization.

Required before paid pilot: trusted user/membership roles, tenant-scoped database access and tests; authoritative employee/model/tool/cost controls; exact money ledger; accountable approvals; safe document parser resources; privacy/retention/export procedures; signed delivery; off-server restore and incident response. Secrets/signing/provider keys stay on the authority or customer-controlled vault, never renderer/package/GitHub. Do not log prompt contents, tokens, Authorization headers or site documents.

Review Malaysia PDPA and Singapore PDPA obligations with a qualified reviewer: controller/processor roles, cross-border provider transfers, purpose/notice/consent, retention, access/correction/deletion, breach response and vendor contracts. Local-only processing must prevent cloud transmission independently of prompts. Do not label the product compliant until review and operational controls exist.
