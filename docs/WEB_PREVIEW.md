# NightBrew website interface preview

This website is built independently alongside the existing Electron desktop app. It is not a production SaaS release. The static GitHub Pages variant has no backend; the new personal website backend provides protected DeepSeek key entry and chat when served at the same origin. See [website AI setup](WEBSITE_AI_SETUP.md).

Working features:

- Responsive navigation for workspace, documents, employee drafts, draft history and connection status.
- Chinese/English switching that preserves unsent form values.
- Session-only task briefs and employee configuration drafts, clearly labelled as unexecuted.
- Exact integer-decimal quotation calculations with CSV download. Uploaded files, product data and tax rates are not guessed. Spreadsheet formula prefixes in text fields are neutralized on export. CSV output is a draft requiring review, not an issued invoice or accounting entry.
- Local file selection lists only metadata; it does not upload or read contents.
- The static variant makes only a same-origin backend availability check. Its API-key input remains disabled without the personal backend and owner login. It does not transmit provider keys, upload files, activate subscriptions or control computers. Business drafts remain session-only; only language preferences use browser storage.

## Build and run

Use the repository's existing Node dependencies; no new runtime dependency is required:

```sh
npm ci
node_modules/.bin/tsc --noEmit
node_modules/.bin/vite build --config vite.web.config.ts
node_modules/.bin/playwright test --config playwright.web.config.ts
```

Output: `build/web-preview/index.html` and its assets. Local development: `node_modules/.bin/vite --config vite.web.config.ts`, then open `/web-preview.html` on that server. This environment's localhost address is not a public website URL.

The dedicated entry is `src/web-main.tsx`; desktop entrypoints and authentication remain unchanged. The preview CSP permits only same-origin connections and disables native form submissions. It does not provide a proxy to the privileged local backend.

## Publication

`.github/workflows/web-preview.yml` builds and tests the preview, uploads the reviewable static artifact, and publishes only that artifact to GitHub Pages. Enabling Pages may require the repository owner's settings permission. A deployment is not successful until its deploy step and Pages result confirm it; do not present an anticipated URL as a verified live site.

New build-only actions are pinned to verified version-tag commits and carry MIT licenses (official LICENSE files checked before integration):

- `actions/configure-pages` v5: `983d7736d9b0ae728b81ab479565c72886d7745b`
- `actions/upload-pages-artifact` v3: `56afc609e74202658d3ffba0e8f6dda462b719fa`
- `actions/deploy-pages` v4: `d6db90164ac5ed86f2b6aed7e0febac5b3c0c03e`

## Executed verification

TypeScript and the Vite website build passed. Three Playwright browser tests passed for draft retention/language switching/downloads with no mutating network requests, quotation rounding and CSV formula protection, truthful employee/file state and phone-width navigation. This is not an AI integration test. No provider credentials or paid hosting were used.

## Next server milestone

Real AI chat and persistent business data require a backend with protected login, same-origin APIs, server-side key protection, spending enforcement and clearly scoped user/tenant authorization. The existing desktop backend must not be exposed publicly without that boundary. Website control of a customer's Windows/macOS software additionally requires an explicitly connected local companion; this preview does not implement that connection.


## Initial publication result

Code commit `12502a3`, [workflow run](https://github.com/profunction/sme/actions/runs/41658859688): website build, three browser tests and both static artifact uploads passed. The GitHub Pages configuration/deploy job was blocked: `Resource not accessible by integration` when creating the Pages site. The site is not yet published and no public preview URL has been verified.

The repository owner must open [Pages settings](https://github.com/profunction/sme/settings/pages), then set **Build and deployment → Source → GitHub Actions**. The workflow can then be run again from [the website workflow](https://github.com/profunction/sme/actions/workflows/web-preview.yml). The current workflow token cannot grant itself repository-administration permission; no personal access token is requested.

The built artifact is **NightBrew-Web-Preview** on the verified build run. The local task preview is served by Vite at `/web-preview.html`; its localhost address is an environment-local address, not a public link for the customer's computer.
