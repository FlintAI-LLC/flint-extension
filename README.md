# Flint Apply Browser Extension

Chrome MV3 extension (Firefox-compatible) that captures job descriptions from
job boards and opens them in **Flint Apply** for resume tailoring.

## Scope

- Email/password and Google login against the Flint Apply API
- JD extraction from LinkedIn, Greenhouse, Jobright, Lever, and similar hosts
- Save job to Flint Apply (`POST /api/job-descriptions`)
- **Tailor in Flint Apply** — opens the web wizard with JD pre-filled
- **Autofill (beta)** — fill supported application forms from a tailored resume
- **Prep in Flint (desktop)** — interview prep handoff (disabled until desktop app ships)

## Floating panel

On LinkedIn, Greenhouse, and Jobright job pages the extension injects a
floating logo (bottom-right FAB). Click it to open a ~360px in-page drawer
with the same popup UI in an extension-origin iframe.

On Chrome, the toolbar icon expands the floating panel on the active tab.
Firefox keeps the classic popup (`default_popup`).

## Requirements

- Node.js >= 18
- Flint Apply API at `http://localhost:8000` (dev) or `http://localhost:8001` (staging sim)
- Flint Apply web app at `http://localhost:3100` (dev) or `http://localhost:3001` (staging)

## Setup

```bash
cp .env.example .env          # dev (:3100 / :8000)
# or
cp .env.staging .env          # local staging sim (:3001 / :8001)

npm install
npm run build
```

From `smart-resume`, run `./scripts/sync-extension-staging-env.sh` to write
`../flint-extension/.env` from `backend/.env.staging`.

Load `dist/` as an unpacked extension in `chrome://extensions/` (Developer mode on).

**Do not load `dist/` in Chrome after `npm run firefox:dev`** — that command patches
`dist/manifest.json` for Firefox only. For Chrome, run `npm run build` first.

## Development

```bash
npm run dev        # watch mode (Chrome: reload at chrome://extensions)
npm run firefox:dev  # build + Firefox manifest patch + web-ext run
npm test           # vitest unit tests
npm run lint:ext   # web-ext lint against dist/
```

## Environment

| Variable | Default | Purpose |
|---|---|---|
| `VITE_API_BASE_URL` | `http://localhost:8000` | Flint Apply API base URL |
| `VITE_WEB_APP_BASE_URL` | `http://localhost:3100` | Flint Apply web app (tailoring wizard) |
| `VITE_GOOGLE_CLIENT_ID` | — | Same Google OAuth client ID as the backend |

### Google SSO (extension)

Use the **same** Google OAuth client as the web app. Add authorized redirect URIs in [Google Cloud Console](https://console.cloud.google.com/apis/credentials):

```
http://localhost:3100/auth/extension/google/callback   # pnpm dev
http://localhost:3001/auth/extension/google/callback   # local staging sim
```

The web app uses `/api/auth/callback/google` on the same host. Do not point the extension at the NextAuth callback.

## Security notes

- Tokens are stored in `chrome.storage.local` (not `sessionStorage` or cookies).
- Token values are never written to `console.*` or any log.
- JD text is sent only via `Bearer` header to the API, never embedded in URLs.
- Desktop `flint://` handoff is disabled until the interview app ships.
- `web_accessible_resources` matches the floating-panel / autofill runner hosts (LinkedIn, Greenhouse, Lever, Ashby, Workday, iCIMS, UKG, Jobright) so the drawer iframe can load on those pages without exposing popup/chunks to every origin.
- No `eval`, no `innerHTML` assignment anywhere in the extension.

## Permissions justification

| Permission | Reason |
|---|---|
| `storage` | Persist auth tokens across service worker restarts |
| `activeTab` | Read current tab URL and inject content script on demand |
| `scripting` | Inject content scripts when the popup opens on a job page |
| `alarms` | Schedule token refresh every 25 minutes |
| `identity` | Google sign-in via Chrome identity API |
| `tabs` / `webNavigation` | OAuth sign-in tab flow |

## Architecture

See [ADR-002](docs/adr/002-extension-desktop-ipc.md) — `flint://` deep link
selected over native messaging; native messaging deferred to a later phase.
