# Commercial authority — Phase 7

Deploy `billing_service.app:app` separately behind HTTPS, with its own private database and secrets. Do not ship this service, merchant secrets, gateway provider key or signing private key in the desktop installer. It supports all three configurable plans, credits, extra computers, setup/custom connector fees, mock billing, Stripe Checkout/Portal, signature-verified webhooks, short-lived Ed25519 device grants, server-side device/employee/task quotas and an included-credit inference gateway. Integration categories are never tier-gated. `/marketplace` is a built-in connector catalog/custom quote foundation, not an arbitrary plugin installer.

## Development and production

The desktop defaults to explicitly labeled unlicensed development mode. Packaged builds enforce licensing. `NIGHTBREW_ENFORCE_LICENSE=1` enables enforcement in development too. SQLite cannot manufacture a valid grant: the trusted public key is outside the database, and grants check issuer/audience/version, device hash and expiry. Mock grants are rejected unless explicitly enabled in a development environment. Licensed task quotas and employee seats are reserved online; offline/failed authority checks fail closed. Existing files/history remain accessible. Grants last at most 24 hours, so an offline license can remain usable until expiry; no hard DRM or tamper-proof local clock is claimed.

Authority secrets/configuration:

- `NIGHTBREW_BILLING_DB`: durable private authority SQLite path (set explicitly; default /tmp is for development only).
- `NIGHTBREW_BILLING_ADMIN_KEY`: high-entropy administrator credential, not a customer key.
- `NIGHTBREW_LICENSE_PRIVATE_KEY`: base64url raw Ed25519 signing key; generate privately and never log/commit it. Desktop receives only the corresponding public key.
- `NIGHTBREW_BILLING_MODE`: mock or stripe; mock confirmation requires authority administrator authentication and never claims a real payment.
- `NIGHTBREW_BILLING_PLANS_JSON`: optional authority-owned prices, seats/devices, monthly task limits and included credit allowances.
- Stripe mode: `NIGHTBREW_STRIPE_SECRET_KEY`, `NIGHTBREW_STRIPE_WEBHOOK_SECRET`, `NIGHTBREW_STRIPE_PRICE_STARTER/BUSINESS/ENTERPRISE/CREDITS/COMPUTER/SETUP/CUSTOM_CONNECTOR`, and HTTPS `NIGHTBREW_CHECKOUT_SUCCESS_URL` / `NIGHTBREW_CHECKOUT_CANCEL_URL`.
- Included AI: `NIGHTBREW_GATEWAY_API_KEY`, `NIGHTBREW_GATEWAY_MODEL`, optional HTTPS `NIGHTBREW_GATEWAY_URL`, verified nonnegative `NIGHTBREW_GATEWAY_INPUT_USD_PER_MILLION` / `NIGHTBREW_GATEWAY_OUTPUT_USD_PER_MILLION`. Credit pack USD amount is `NIGHTBREW_CREDIT_PACK_USD` (default 10).

An authorized administrator creates a customer using `/admin/accounts`; return the generated customer key once through a secure channel. The customer key authenticates only that account. Never put keys in chat, source or desktop SQLite. On Windows the desktop can store it in Credential Manager; Linux uses `NIGHTBREW_LICENSE_ACCOUNT_KEY`. Desktop also needs trusted `NIGHTBREW_LICENSE_URL` and `NIGHTBREW_LICENSE_PUBLIC_KEY` (embedded release policy in packaged production).

## Payment and credits

Checkout creates a session, not a charge or paid entitlement. The customer explicitly opens the returned Stripe URL and completes payment. Existing subscriptions use the billing portal rather than creating duplicate subscriptions. Fulfillment requires verified Stripe webhook signatures and known server-created checkout IDs. Events and invoices are idempotent. Subscription changes/renewals consult canonical provider state. Refund events suspend the affected account pending reconciliation. Setup/custom development fees are recorded but do not grant software rights.

Webhook endpoint: POST `/stripe/webhook`; configure checkout.session.completed, invoice.paid, customer.subscription.updated/deleted and charge.refunded. Invoice events arriving before checkout reconciliation return a retryable failure. Secure deployment, TLS, backup/restore, merchant configuration, event reconciliation and live test-mode payment validation are operator prerequisites. No actual merchant account/payment was used during cloud development.

BYOK sends the customer's provider key directly from the local backend; the customer pays that provider. INCLUDED sends consented inference through the authority gateway, where the company provider key and purchased-credit ledger stay server-side. The gateway prices/reserves before calling the provider and reconciles provider-reported usage; unknown billed outcomes keep reservations and never auto-replay. Desktop USD budgets/employee caps add local controls, but do not prove payment. Pricing estimates cannot guarantee a provider's invoice. Gateway deployment needs operational rate limits/monitoring and scoped provider credentials before public rollout.

Do not describe mock tests or signed mock grants as real billing validation. This code is a deployable commercial foundation, not a deployed payment service or a completed business compliance process.
