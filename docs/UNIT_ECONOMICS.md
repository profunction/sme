# Unit economics design — dashboard not implemented

Use actual usage and recorded human labor. No provider price, customer capacity or profitability is assumed. The UI currently shows local usage, not commercial financial reporting.

| Measure | Definition |
| --- | --- |
| MRR | normalized recurring subscription revenue, excluding one-time setup/credit sales/taxes; handle annual periods when implemented |
| Revenue by plan | recognized recurring revenue for each plan/version; show discounts/refunds separately |
| AI cost | provider-reconciled cost or explicitly labeled estimates grouped by tenant/model/employee/task |
| Gross margin | recognized revenue less consistently defined cost of goods sold; publish what is included |
| Customer contribution profit | customer revenue less variable AI, payment, infrastructure allocation, support and service delivery costs |
| Company operating profit | aggregate contribution less fixed operating expenses and other operating adjustments |

Contribution profit is not net profit. Credit purchases are cash receipts and may be deferred revenue until consumed; do not double count purchase and consumption. RM50/RM150 internal budget assumptions are not customer cash allowances. Keep provider cost currency, FX conversion and customer invoice currency separate with dated assumptions.

Proposed inputs: plan price/version, active customers, recognized revenue, exact API costs, provider reconciliation state, credit purchases/liabilities/expiry, actual VPS invoice, storage/backups, payment fees, FX, support minutes * loaded hourly cost, installation hours allocated over an explicitly chosen period, training, refunds and fixed expenses. Missing costs show **unknown**, not zero.

Internal dashboard should show monthly totals, per-customer contribution, heavy use, unallocated usage and customers approaching negative contribution. Margin alerts recommend review; they cannot auto-charge, purchase resources or silently downgrade model quality. Price custom connectors, installation/training, workflow changes, added devices and premium support separately through reviewed service quotations. Current setup/custom-connector SKUs do not implement scope/hours/acceptance/change-order records.

For the pilot, record cost/task, support time/customer, correction time, completion rate and time saved. Choose pricing/credit conversion after observing representative tasks and support load; do not sell unlimited AI. See [PILOT_PLAN.md](PILOT_PLAN.md).
