# Commercial plans and trusted entitlements

| Plan | Monthly MYR | Preferred AI mode | Employees | Computers |
|---|---:|---|---:|---:|
| Starter | 299 | Local | 2 | 1 |
| Business | 599 | Cloud | 5 | 1 |
| Enterprise | 1,499+ | Hybrid | 10+ | Multiple (development default 10) |

The separate authority's configurable catalog controls prices, employee/device allowances, monthly task quota and included cloud credit allowance. Stripe price IDs must match the operator-approved products/prices; catalog metadata alone does not update a merchant price. Desktop `/plans` remains explicitly mock editable display configuration and never proves payment. Existing subscriptions change through the provider portal to avoid duplicate subscriptions.

ERP/POS/WMS/TMS/API integration categories and existing supported connectors remain available in every plan. Connector permissions and human approval protect actions independently of tier. Custom connector development/maintenance can be quoted separately; marketplace foundation is a built-in adapter catalog, not arbitrary downloaded code.

Subscriptions, additional device purchases, credit packs, setup fees and custom connector fees have server-created checkout flows. Setup/custom fees do not grant software entitlements. Known signed payment events fulfill purchases idempotently; refunds suspend affected accounts for reconciliation. Mock purchases require authority-admin confirmation, are labeled mock and are not real payments.

Device activation issues signed short-lived grants; online operation and employee-seat checks enforce active subscriptions/quotas on the trusted service. Included credits stay on that service and its inference gateway. Customer BYOK is separate, with local budget controls. Production needs configured/deployed authority, Stripe merchant/webhooks and secure signing/update infrastructure; cloud mocks do not establish successful live billing.
