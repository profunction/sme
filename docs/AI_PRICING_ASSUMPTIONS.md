# AI pricing and credits assumptions

0.9.2 now uses an exact trusted USD ledger and per-request immutable pricing snapshot; see [the fix report](BUGFIX_REPORT_0.9.2.md). REAL authority columns are compatibility projections, never spend authorization. Production requires administrator-reviewed model and price configuration; this is not live independent verification. Legacy accounts require reviewed opening balances. Separate customer Credits/conversion/expiry, complete pricing dimensions and provider invoice reconciliation remain unfinished. The limitations below describe the original audit baseline.

No current API price is asserted in this audit. DeepSeek, Gemini, Claude and OpenAI rates/capabilities are **UNVERIFIED**. The existing `.env.example` leaves rates empty; gateway requests fail closed until an administrator supplies valid rates. Synthetic rates in tests are test fixtures, not market prices.

Current limitations: mutable environment input/output USD rates; REAL/float usage and balances; no immutable price snapshots, separate Credit units or cache/reasoning/image/audio tariffs. Historical authority rows contain charged amount/status, not the complete token/pricing attribution required for customer billing. Do not use these records as a complete customer invoice ledger.

## Proposed authoritative records

`price_version`: provider/model/revision, effective_from, currency, unit, input/output/cache/reasoning/image/audio/tool prices as decimal strings, official source, verification_status, verified_at. Unverified or unsupported pricing must block customer-funded model use. Changes create a new version. Each reservation/usage event stores the selected immutable snapshot; historical charges never recalculate with new prices.

`usage_event`: organization/user/employee/task/request IDs, provider/model, all supported usage dimensions, retry count, estimate/actual, billable-cost availability, currency, timestamps, status and price snapshot. Provider invoice cost, conservative estimate and customer Credit charge must remain separate. Missing usage is an uncertain outcome, not zero cost.

Text cost is computed with Decimal as `(billable input * input rate + billable output * output rate + verified additional dimensions) / documented unit`. Avoid double counting nested reasoning/cache fields; exact inclusion depends on the provider. Customer credit conversion/markup is administrator-configured and versioned, not a hardcoded RM rate. Reserve before dispatch, settle once by tenant-scoped idempotency key, return unused reserved Credits through an explicit ledger entry, and reconcile unknown outcomes. A retry may create additional provider cost even when the customer-facing request ID is unchanged.

Business RM50 and Enterprise RM150 are provisional **internal monthly AI cost budgets** only. They are not customer cash or included Credits. The existing legacy catalog grants USD10/USD50 balances; this mismatch is a migration blocker, not an entitlement promise. Starter cloud use needs separately purchased Credits and explicit permission. Subscription prices remain RM299/RM599/RM1,499 starting defaults; taxes, FX, gateway fees and commercial terms require separate configuration.

Require per-organization monthly/daily limits, per-employee/model/tool limits and per-task cost/calls/steps/retries/time/output limits on the trusted server. Concurrent reservations count against limits. If actual cost can exceed the verified bound, hold for reconciliation and expose the liability; do not silently floor balances or treat reservation as a guaranteed provider invoice cap.
