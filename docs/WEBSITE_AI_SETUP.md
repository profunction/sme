# Website DeepSeek key entry and personal AI backend

## What changed

The website's **Connections / 连接与设置** page now includes a real DeepSeek API-key panel. The workspace also has **Enter DeepSeek API key / 填写 DeepSeek API Key** linking directly to it.

The panel uses a dedicated same-origin website backend. It does not send a key from a public static page directly to a provider or arbitrary proxy. On GitHub Pages without this backend, the input is visible but disabled with an explanation. Adding a text field alone cannot make static hosting execute Python or safely store credentials.

When the backend is running at the same origin:

1. Sign in using the personal website workspace password chosen during setup. This is not the DeepSeek account password.
2. Enter a customer-owned DeepSeek API key and save it. The input is cleared after the save attempt. The service encrypts it with Fernet and returns only a presence flag.
3. Configure the model, verified current input/output prices and a monthly internal cost cap. Prices are not fetched or guessed; this cap is not the provider account balance or purchased credits.
4. Explicitly check the model-list endpoint if desired. This does not generate a reply or prove that the account has funds.
5. Open the workspace, enter a non-sensitive message and click **Consent and send to cloud / 同意云端处理并发送**. Chat history is stored by the personal backend and can be loaded after refreshing. Each generation sends only the current message and language instruction, not all stored history.

Task briefs, employee drafts, local file selection and quotation CSV generation still use the existing session-only preview logic. This change does not implement web employee agents, document uploads, multi-user companies, billing, paid entitlements or customer-computer control.

## Local run

Node 24 and Python 3.12 are the current development targets. This installs only the website subset of dependencies already pinned in the main lock:

```sh
npm ci
python -m venv .venv-web
# Windows: .venv-web\Scripts\python -m pip install -r backend/requirements-web.lock.txt
.venv-web/bin/python -m pip install -r backend/requirements-web.lock.txt
.venv-web/bin/python scripts/run-web.py --build --open
```

On Windows, use `.venv-web\Scripts\python` for the final command too. First run asks for a new workspace password of at least 12 characters using a hidden terminal prompt. It creates a private config and SQLite database below `~/.nightbrew/personal-web/`. It does not import desktop credentials automatically. Open the printed local origin (default `http://127.0.0.1:8787`), not the HTML file directly. This local address works on the computer running the service; it is not an Internet URL.

Do not commit or publish `private-config.json`. It contains the encryption master key and owner-password hash. Back up it and the database securely; losing the master key prevents decrypting stored API keys. Existing data is not overwritten when configuration is missing.

## Existing-server recipe

The website backend can run without a GPU. It is one small FastAPI service with a SQLite volume for this **single-owner personal test workspace**, using external DeepSeek inference. There is no cloud purchase or provisioning script.

`Dockerfile.web` and `docker-compose.web.yml` are prepared recipes, not a claim of a tested production deployment. The complete owner/login/provider flow was tested with a real local FastAPI server and owned provider fixtures; the Docker image and public VPS deployment have not been executed in this change.

For an existing VPS, configure `NIGHTBREW_WEB_ORIGIN` to the exact HTTPS origin, place a TLS reverse proxy in front of loopback port 8787, then initialize the private volume interactively before starting the service:

```sh
docker compose -f docker-compose.web.yml build
docker compose -f docker-compose.web.yml run --rm -it personal-web python scripts/run-web.py --data-dir /data --init-only
docker compose -f docker-compose.web.yml up -d
```

Keep the named volume, do not expose the database, protect backups and preserve the master key during migration. Cloud multi-tenant deployment, PostgreSQL, production identity/RBAC, trusted spending/credits and operational acceptance remain separate release work. Do not put the privileged desktop API on the public Internet.

## Security boundaries and limitations

- One configured owner, hashed password, eight-hour expiring/revocable HttpOnly SameSite=Strict sessions; Secure cookies on HTTPS.
- Exact configured origin and session-bound CSRF header for mutations. Secret validation failures do not echo inputs. 64 KiB request cap and bounded login attempts.
- Encrypted server-side key storage; no key-readback endpoint, browser storage or source-code credential. The private config must remain outside the served assets and under OS account permissions.
- Fixed HTTPS DeepSeek destination; no user-selected proxy URL or redirects. Two concurrent generation calls maximum, request timeouts, bounded provider replies and no automatic retry/fallback.
- Existing BYOK budget reservation/usage settlement. Unknown provider billing conservatively keeps an estimate (`failed_estimated`), which is not a verified provider invoice.
- Login and credentials are isolated from the desktop service. Hardware, Windows/macOS automation, arbitrary files and task-execution routes are not exposed by the website backend.
- Business conversation content uses SQLite storage under OS permissions, not field-level encryption. This personal test service does not claim Malaysian/Singapore PDPA compliance or commercial SaaS readiness.

## Executed verification

`backend/tests/test_web_ai.py` covers login, cookie flags/session-token hashing, CSRF, expiry/revocation, rate limiting, encrypted keys/no readback, secret redaction, request limits, provider checks, per-message consent, private-data rejection, budget enforcement, provider-error classification and concurrent-request bounds.

The website browser test starts an actual FastAPI service, signs in, saves a fixture key, configures rates, checks models, sends an approved message and reloads its stored history. Only outbound provider responses are mocked; no customer key or paid inference was used. The separate static-preview tests verify that a missing backend leaves the key input disabled and sends no secret-bearing request.


Executed results for this implementation: **354 backend/deployment tests passed, 14 platform/database-dependent skips**; **9 website backend tests passed again in a clean environment containing only the 21-package website dependency subset plus pytest**; **4 website browser tests passed**, including the actual website-to-FastAPI login/key/chat flow; TypeScript and Vite builds passed. The provider itself was mocked and no real API key was used. Docker build/deployment and public-server hosting were not executed. Static output includes full React/React DOM/Scheduler MIT notices.
