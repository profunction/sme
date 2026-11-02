# 0.9.5: visible AI selection and specific cloud failures

## Reported issue and evidence

A customer had saved an API key and confirmed that chat was already in Cloud AI mode, yet the app showed only “AI provider unavailable or returned an invalid response.” The old handler discarded the underlying failure category. This evidence does **not** establish an Ollama issue, invalid key, insufficient balance, or provider outage. Customer credentials and provider responses were not available in the development environment.

## Changes

- `backend/provider_errors.py`: classify cloud/local HTTP errors, network failures, timeouts and invalid response formats. Return only fixed safe codes/messages, the selected model/mode and an HTTP status when present. Never return provider response bodies, URLs, authorization headers or raw exception strings.
- `backend/app.py`: use these structured diagnostics in actual chat inference and the explicit model-list connection check. Preserve existing budget settlement, consent, privacy, license enforcement and no-fallback behavior.
- `src/api.ts`: parse known structured errors and provide Chinese/English guidance. Distinguish cloud API-key/permission errors (401/403), billing/balance errors (402), endpoint/model errors (404), rate/quota limits (429), server errors, network failures and timeouts. Treat these as reported categories, not a completed diagnosis.
- `src/Assistant.tsx`, `src/main.tsx`: show processing mode and selected model above the conversation. Keep manual selections across navigation in the running app. Reflect an already authorized cloud policy on chat entry, while leaving per-message consent unchecked. A saved key without cloud permission and confirmed pricing keeps the local default and explains that the key is not being used. No automatic request is dispatched. Keep unsent text after failures and translate structured errors when switching language.
- `src/AIConnection.tsx`: use the same localized error handling for model-list checks.
- Windows CI builds/verifies/uploads API-PREVIEW first so customers need not wait for the other development variants.

No database schema or credential-vault identifier changed. Updating API-PREVIEW 0.9.4 to API-PREVIEW 0.9.5 retains its existing workspace and key. Changing between API-PREVIEW and LOCAL-PREVIEW still selects their separate existing databases.

## Verification

- Backend/deployment suite: 345 passed, 14 platform/database-dependent skips.
- Desktop/build checks: 16 passed.
- Chromium UI suite: 14 passed.
- TypeScript/Vite build passed.

New tests use owned HTTP responses for 401/403/402/404/429/400/302/503, local errors, network failure, timeout and invalid replies. They verify that secrets/business content are absent from errors, no automatic retry or fallback occurs, and failed provider calls do not create a successful conversation entry. UI tests verify visible cloud selection, unchecked consent, retained drafts, language switching and preserved manual choices. These mocked tests are not real provider acceptance tests.

The existing local usage meter conservatively holds estimated budget on failures when provider billing is unknown (`failed_estimated`); this is **not** a verified API charge or purchased credit debit. Do not infer actual provider billing from the local estimate.

## Using the new diagnostics

After updating, send a short non-sensitive message in Cloud AI mode, with consent. If it fails, the page displays the reported category, model and HTTP code. API keys must remain on the user's own computer; do not send them through chat or screenshots.

- 401/403: check that the key belongs to the selected provider and has access.
- 402: inspect the provider's own API balance/billing, not just the app's local budget.
- 404: check the API base URL and exact model name.
- 429: check provider rate/quota limits before retrying.
- Timeout: the provider may have processed a request; check provider usage before deciding to retry.

No live customer key was supplied. The customer's original failure cause and live connectivity remain unverified until their actual provider response is observed. Native installer evidence is tracked separately against the exact code commit. These remain development previews, not signed commercial releases.
