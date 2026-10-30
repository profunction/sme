# Configurable mock commercial plans

| Plan | Monthly MYR | AI mode | Employees | Computers |
|---|---:|---|---:|---:|
| Starter | 299 | Local | 2 | 1 |
| Business | 599 | Cloud | 5 | 1 |
| Enterprise | 1,499+ | Hybrid | 10+ | Multiple |

`GET /plans` exposes defaults and `PUT /plans` updates mock plan prices/capacities/modes. The Enterprise development default is 10 computers; final allowances must be agreed commercially. These settings do not implement billing, device licensing, employee quotas or paid entitlements.

ERP, POS, WMS, TMS and API integrations are available to every plan. All existing supported connectors must remain available across tiers; no category gating exists. Custom connector development/maintenance may be billed separately.

Cloud input/output prices, monthly spending allowance, development credit balance and max output tokens are configurable in AI & privacy. These USD controls are independent of MYR plan prices and are not proof of a paid cloud credit purchase. Trusted-backend subscription validation, optional credit purchases, setup fees, device fees, custom quotes and expiration enforcement belong to Phase 7. Never accept local SQLite as authoritative payment evidence.
