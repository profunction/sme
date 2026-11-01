# Connector compatibility

No named ERP/POS/WMS/TMS vendor is certified. All plans permit the same existing connector framework. Custom integration and implementation work can be quoted separately; lower plans must not lose basic connectivity categories.

| Adapter | Verified scope | Not verified / absent |
| --- | --- | --- |
| Generic REST | HTTPS allowlist, fixed relative paths, environment bearer reference, read/write permission, bounded read retry, no write retry, exact approval snapshot, HTTP mock tests | vendor schemas, authentication variants, version compatibility, live acceptance, DNS/private-egress controls |
| Mock ERP/POS/WMS/TMS | explicit development fixtures and permission/approval tests across all three plans | any real vendor operations |
| Business Webhook | no implementation found | signed outbound/inbound delivery, replay protection, capabilities and approval rules |
| Browser/Windows integration | deterministic user-reviewed plans; local fixtures | arbitrary vendor compatibility or secure credential-reference login automation |

Payment Stripe webhook processing is not the generic business webhook connector. The current static capability description is not a negotiated vendor capability/version registry. Persist a connector acceptance record before enabling a real customer workflow: vendor/version/API terms, authentication/secret handling, tested endpoints, read/write capabilities, scope/rate/retry rules, idempotency/unknown outcomes, approval requirements, sample schema, test date/results and accepted limitations.

Initial pilot should export a customer-reviewed CSV/XLSX mapping. Direct ERP submission stays disabled until its exact connector is implemented, tested and accepted. Official API access may require a separate commercial license.
