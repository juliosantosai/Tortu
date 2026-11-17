# Tortulive

MVP multi-tenant Node service with a separately hostable static PWA overlay.
Requires Node.js 22.5 or newer (uses the built-in `node:sqlite` module).

## Run locally

From the project root, run `npm start` for the combined web and API server, then open `http://localhost:8080/dashboard.html`.

## Run as two independent services

Start each command in its own terminal/process from the project root.

PowerShell:

```powershell
$env:API_PORT = "8081"
$env:API_ALLOWED_ORIGINS = "http://localhost:8082"
npm.cmd run start:api
```

In another terminal:

```powershell
$env:WEB_PORT = "8082"
npm.cmd run start:web
```

Edit `webserver/api-config.js` for a static web host and set:

```js
window.TORTULIVE_API_BASE_URL = 'https://api.example.com';
```

Use the public web origin in `API_ALLOWED_ORIGINS`, for example `https://app.example.com`. Values are exact origins (scheme, host, and optional port), separated by commas. The API allows credentialed CORS only for these configured origins. The frontend calls the API with credentials so account-session cookies work; use HTTPS in production and configure `COOKIE_SECURE=true`. Keep the web and API on the same site where possible (for example `app.example.com` and `api.example.com`) to avoid browser third-party-cookie restrictions. `COOKIE_SAME_SITE=None` requires Secure cookies and HTTPS.

Each independently deployed service needs access to the project code. Only the API process opens the SQLite database. Set `DB_PATH` to durable storage on the API host; do not put the database in the static web root or share one SQLite file across multiple API hosts. This deployment supports one API instance; horizontal scaling needs a shared database and shared event pub/sub.

## Services

- `npm start`: combined web + API, `PORT` (default 8080).
- `npm run start:web`: static web/PWA only, `WEB_PORT` (default 8080).
- `npm run start:api`: API only, `API_PORT` (default 8080).
- `npm run check`: syntax checks.

The web PWA and dashboard are served from `webserver/`. The public OBS URL is `/overlay/<publicId>`. The private event-ingest credential is only for the backend and must never be embedded in the public overlay or designer HTML.

## Current product boundary

Accounts, per-account overlay ownership, event credentials, event persistence/deduplication, SSE delivery, team assignment, race meters, and winner calculation are implemented. Selected TikTok profiles connect through the community-maintained, unofficial `tiktok-live-connector`; the dashboard shows connection state, retries every five seconds for up to five minutes, and allows reconnecting after expiration. The connector may break when TikTok changes its service and may use a third-party signing service; don't provide TikTok passwords or cookies. Turbo and gift-class speed rules remain undefined. See `webserver\CONTRATO.md` for the single contract and the remaining project checklist.
