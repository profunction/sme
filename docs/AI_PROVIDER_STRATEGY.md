# AI provider strategy

2026-11-01. Current application supports Ollama text and one configured OpenAI-compatible text endpoint. DeepSeek is the default cloud candidate. Gateway defaults are configurable, not proof a model remains available. No live paid inference, model capability certification or current price verification was performed.

| Provider | Existing integration | Next acceptance work |
| --- | --- | --- |
| Ollama | loopback list/generate and measured benchmark; mocked adapter tests | actual Windows hardware/model test; exact weights/license review; explicit download consent UI |
| DeepSeek | configurable `/chat/completions`, bearer key, usage parsing; HTTP mocks | official API/model/pricing check, approved synthetic live call, invoice reconciliation |
| OpenAI | generic compatible text protocol, not a dedicated capability adapter | selected model/API acceptance and usage semantics; do not assume every model uses identical parameters |
| Gemini | no native adapter | implement supported Google protocol/auth/schema, image and usage accounting only after model verification |
| Claude | no native adapter | implement Anthropic Messages protocol/auth/schema, usage/cache handling and model acceptance |

Do not send a generic OpenAI payload to Gemini/Claude and call them integrated. Do not silently switch provider, model, cost tier or quality. Cloud consent and local-only privacy remain mandatory.

## Official-source research

Official upstream README/API pages were retrieved through HTTPS on 2026-11-01: [OpenAI Python](https://github.com/openai/openai-python), [Google GenAI](https://github.com/googleapis/python-genai), [Anthropic Python](https://github.com/anthropics/anthropic-sdk-python), [Ollama API](https://github.com/ollama/ollama/blob/main/docs/api.md), [DeepSeek V3](https://github.com/deepseek-ai/DeepSeek-V3). Google documents `client.models.generate_content`, Anthropic `client.messages.create`, OpenAI `client.responses.create`; these demonstrate distinct protocols, not complete adapters here. The DeepSeek V3 model README does not verify current hosted API pricing or model availability. Ollama's page points to its newer hosted API documentation.

Provider billing/model documentation domains are outside this environment's configured HTTP destinations. Current pricing, context windows, model availability and capability claims therefore remain **UNVERIFIED**. No bypass or provider credential was used. Before enabling a model, consult the provider's official console/documentation and record source URL, date, exact model revision and verification result.

## Phase 2 design, not yet implemented

A trusted registry should store provider, model ID/version, capabilities(TEXT/VISION/STRUCTURED_OUTPUT/TOOL_CALLING/LONG_CONTEXT/REASONING), context/output limits, tokenizer/reservation policy, pricing version, timeout/retry limits and verification status. Reject unsupported combinations before reservation or network calls. An OpenAI-compatible URL is not a capability declaration.

Adapters return normalized text/structured payload, provider request ID, input/output/cache/reasoning/image/audio usage, status and sanitized errors. Preserve unknown billing outcomes for reconciliation. No inference retry or provider failover after an ambiguous response; safe retries require documented provider idempotency and a new approved policy. Bound timeouts/output/concurrency. Do not assume byte counts are a verified tokenizer upper bound for every provider.

Routing proposal: LEVEL 0 deterministic tools; LEVEL 1 benchmarked local; LEVEL 2 verified low-cost cloud; LEVEL 3 specifically approved advanced model; LEVEL 4 accountable human review. Select only after server subscription, capability, privacy, availability and budget checks. Escalation must show additional cost and obtain approval. This classifier is not present in the current code.

No new SDK dependency or model was added during Phase 1. Existing dependency licenses are inventoried in [../LICENSE_AUDIT.md](../LICENSE_AUDIT.md); each exact model's weights and all distribution notices need separate commercial review.
