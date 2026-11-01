# DeepSeek cloud provider

DeepSeek is the initial default OpenAI-compatible provider for AI Employee cloud inference. Default API root: `https://api.deepseek.com/v1`; default configurable model identifier: `deepseek-chat`. Model availability and prices must be checked in the provider account before live use. No live paid DeepSeek request has been made by this change.

## Company-funded cloud AI (trusted gateway)

Set these in the **server's private .env or secret bindings**, never in Electron, GitHub source, a screenshot or chat:

```dotenv
NIGHTBREW_GATEWAY_API_KEY=YOUR_PRIVATE_DEEPSEEK_KEY
NIGHTBREW_GATEWAY_URL=https://api.deepseek.com/v1
NIGHTBREW_GATEWAY_MODEL=deepseek-chat
NIGHTBREW_GATEWAY_INPUT_USD_PER_MILLION=YOUR_VERIFIED_INPUT_RATE
NIGHTBREW_GATEWAY_OUTPUT_USD_PER_MILLION=YOUR_VERIFIED_OUTPUT_RATE
```

The rates above are placeholders, not valid numeric prices. Use current USD-per-million prices for the chosen model. Until configured correctly, requests/estimates fail closed. Use cache-miss input pricing conservatively: current accounting uses total prompt/completion tokens and configured rates; it does not claim exact DeepSeek cache-discount invoice reconciliation. Quotes/reservations are not provider invoices. No currency conversion from MYR budgets is inferred.

Keep the Ed25519 private signing key, admin credential and provider key on the trusted server. The server authenticates the customer, checks active device/subscription, consent, credits and quotas, reserves cost, and makes the provider request with a timeout and redirects disabled. A consumed request ID cannot be replayed. Unknown provider outcomes retain the reservation; do not add uncontrolled automatic retries.

Existing environment overrides remain supported for other OpenAI-compatible providers. Shared secrets are never returned with provider answers or estimates. The fixed server-only API key variable is `NIGHTBREW_GATEWAY_API_KEY` (not the earlier unused `NIGHTBREW_GATEWAY_KEY`).

## Customer BYOK

New model configurations default to DeepSeek. Existing saved configuration is deliberately preserved. In “AI 与隐私设置”, click “使用 DeepSeek 预设”, review and save. Store the **matching DeepSeek key** using the OS credential vault, confirm verified prices/budget, and explicitly enable cloud use. Each potentially cloud-bound message still needs consent; private messages remain local-only. A ChatGPT subscription is not a DeepSeek API account or credit balance.

The Windows LOCAL-PREVIEW package remains Ollama-only and rejects cloud inference. Selecting DeepSeek as the platform's cloud provider does not silently enable cloud access in this preview. Use an appropriately configured/licensed cloud build or a separately configured source development session for BYOK testing.

## Validation and remaining setup

Tests simulate the provider HTTP boundary and assert endpoint/model selection, server-side authorization header, consent rejection before transmission, token cost settlement, duplicate-request rejection, and no key in the response. Unsafe HTTP/embedded credentials/query/alternate-port provider roots are rejected. These are mocked provider tests, not a real DeepSeek connectivity or billing verification.

Remaining owner setup: secure provider key, funded provider account and verified current prices; deployed trusted gateway/authority and HTTPS; active customer/device and allowance; a deliberately authorized small live request. VPS/PostgreSQL/backup readiness remains separately documented in DEPLOYMENT.md. No server, API credits or paid infrastructure was purchased.

Provider reference for current account setup, model availability and pricing: https://api-docs.deepseek.com/ . Check the live provider documentation before configuring production rates.
