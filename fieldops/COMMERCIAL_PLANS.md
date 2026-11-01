# Commercial plan foundation

Suggested configurable commercial targets: Starter RM49 per engineer/month, Pro RM99 per engineer/month, Enterprise by quotation. Prices live in `server/plans.json` and are configuration, not a contractual offer or authorization to charge.

Phase 1 `/plans` is owner/admin-only and explicitly returns `billing_enabled:false`. It accepts no payment and grants no paid service. Billing records and storage/AI quota enforcement are not implemented. A later trusted backend must own subscription state, seats, paid allowances, invoice/payment webhooks and price revisions. Mobile local state cannot prove payment.

Potential tier differences: AI allowance, stored reports, storage capacity, analytics, company knowledge bases, external integrations and support. Do not scatter prices in clients. Do not block initial owner testing behind a missing commercial license server. Company login is a data-security boundary, distinct from paid entitlement verification.
