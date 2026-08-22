# Ledger — a simple spend tracker

A mobile-first, single-user spend tracker. React frontend, Go backend, SQLite storage. Track one-off income/expenses and recurring items (paycheque, rent), and see a breakdown by month, year, or custom date range.

## Stack

- **Frontend:** React + Vite, no UI framework, hand-rolled CSS (dark "ledger" theme). Installable as a PWA (works great on iOS via "Add to Home Screen") and works offline — see below. Served by nginx in production, which also proxies `/api` to the backend.
- **Backend:** Go, standard library `net/http`, `modernc.org/sqlite` (pure-Go SQLite driver, no CGO needed).
- **Database:** SQLite, stored on a Docker volume so data survives container restarts.

## Run it

```bash
docker compose up --build
```

Then open **http://localhost:8081**.

The first build downloads Go and npm dependencies, so it needs internet access and may take a couple of minutes. Subsequent builds are cached.

To stop:

```bash
docker compose down
```

Your data lives in the `spend-data` Docker volume and survives `docker compose down`. To wipe it, run `docker compose down -v`.

### Changing the port

Edit the `ports` mapping in `docker-compose.yml` (`"8081:80"`) if 8081 is already taken on your machine.

## Frontend dev server (hot reload)

**Option A — plain Node, fastest:**

```bash
cd frontend
npm install
npm run dev
# open http://localhost:5173
# Vite proxies /api and /uploads to http://backend:8080 by default (the
# Docker service name). Running the backend outside Docker too? Point the
# proxy at it instead:
VITE_PROXY_TARGET=http://localhost:8080 npm run dev
```

**Option B — Docker, no local Node needed:**

```bash
docker compose up -d backend
docker compose -f docker-compose.yml -f docker-compose.dev.yml up frontend-dev
# open http://localhost:5173
```

This runs Vite inside a `node:20-alpine` container with `frontend/` bind-mounted in, so edits to `src/` hot-reload immediately — no rebuild needed. It's additive: it defines a separate `frontend-dev` service and never touches the production `frontend` (nginx) service from `docker-compose.yml`, so `docker compose up` for the real deploy is unaffected. Stop it with Ctrl+C.

## Backend (without Docker)

```bash
cd backend
DB_PATH=./spend.db go run .
# listens on :8080
```

## Installing on iOS (PWA)

Ledger is an installable Progressive Web App. Once it's deployed somewhere reachable from your phone (see **Run it** above — `docker compose up` and open the site on your phone over the same network, or deploy it somewhere with a real URL):

1. Open the site in **Safari** on iOS (it must be Safari — Chrome/Firefox on iOS can't install PWAs, since they're all really Safari under the hood but Apple only exposes this to Safari itself).
2. Tap the **Share** icon (square with an arrow) in the toolbar.
3. Tap **Add to Home Screen**.
4. Tap **Add**.

It now launches full-screen from your home screen like a native app, with its own icon, no Safari address bar, and works offline (see below). A few iOS-specific realities worth knowing:

- **No Background Sync / Push.** iOS doesn't support the Background Sync API, so pending changes don't sync silently in the background the way they might on Android. Ledger works around this by syncing whenever the app is open and online (checking on launch, on the `online` event, and every 20 seconds as a fallback, since iOS doesn't always fire that event reliably) — so just opening the app while connected is enough.
- **Storage isn't permanent.** iOS Safari can evict a PWA's local storage (including the offline cache) if the app goes unused for a long time or the device is low on space. Your data always lives safely in the backend's SQLite database regardless — the offline cache is just a convenience copy for when you're offline, not the source of truth.
- **HTTPS in production.** Service workers require a "secure context." `localhost` and plain HTTP over a local network (e.g. `http://192.168.x.x:8081` while testing on your home Wi-Fi) both count, but a real public deployment needs HTTPS — put it behind a reverse proxy with TLS (Caddy, nginx + certbot, Cloudflare Tunnel, Tailscale, etc.) if you're exposing it beyond your LAN.

Android and desktop Chrome/Edge support the same "Install app" flow from the browser menu, with fuller PWA support (including background sync) if you'd rather use it there.

## Offline sync

The app works with no connection at all — not just "read-only cached data," but actually creating, editing, and deleting entries offline:

- On first load (and periodically), the app pulls your full dataset into an on-device cache (IndexedDB) via `GET /api/sync`.
- While offline, any add/edit/delete is applied immediately in the UI and queued locally. New entries get a temporary ID until they sync.
- The **Entries** and **Overview** tabs work fully offline: recurring items (paycheque, rent, etc.) are expanded into dated occurrences on-device, using the same date logic as the backend, so month/year/custom-range views are accurate even with zero connectivity.
- A small pill in the header shows **Offline** or **Syncing N changes…** whenever there's something to report; it disappears once everything's synced.
- When the connection comes back, queued changes replay against the real API in order, and temporary IDs are swapped for the real ones the server assigns.

### Settings → Offline & sync

The Settings tab has a dedicated panel for this:

- **Offline mode switch** — forces the app to behave as if there's no connection, regardless of what the device actually has. Flip it on before a flight, to test the offline flow, or just to keep everything queued locally on purpose. Flip it off and Ledger immediately re-checks the server and flushes anything queued.
- **Device network** — the browser's raw connectivity signal (`navigator.onLine`).
- **App mode** — "Live" or "Forced offline," reflecting the switch above.
- **Server** — an active ping to `GET /api/health`, distinct from device network: your phone can have Wi-Fi (device "Online") while the backend itself is down or unreachable, and this is what actually tells you that.
- **Sync status** — how many changes are queued and waiting, or confirmation everything's synced, plus a manual **Sync now** button.
- **Connection errors** — if the last attempt to reach the server failed, the message is shown here (dismissible).
- **Sync issues** — a log of mutations the server actively rejected (not connectivity failures — a validation error, a 404, etc.). These can't succeed as-is so they're not retried automatically, but they're kept visible here rather than silently disappearing, along with what was rejected and why. Dismissible once you've seen them.

**Known limits:**
- **Receipt photos require a connection.** Queuing an offline file upload (and reconciling it against a transaction that might itself still be un-synced) adds a lot of complexity for what's already an optional feature. Attaching a receipt while offline (including with the manual toggle on) shows a clear "you're offline" message instead of silently failing later.
- **Single device at a time, effectively.** If you use Ledger on two devices and both go offline and edit the *same* entry before either reconnects, the last one to sync wins — there's no conflict merging. For a single-user app used from one phone, this basically never comes up in practice, but it's worth knowing if you install it on multiple devices.

## How it works

- **One-off entries** (a grocery run, a specific payment) are stored as `transactions`.
- **Recurring entries** (a paycheque every two weeks, rent on the 1st) are stored as `recurring_items` — a template with a frequency (weekly / every 2 weeks / monthly), a start date, and an optional end date. The backend expands these into actual dated occurrences whenever you view a date range, so you never have to manually re-enter them.
- The **Overview** tab shows a single balance bar for the selected period: the track represents your income, the red fill shows how much of it you've spent, and a hatched overflow shows spending that exceeds income. Below it, a per-category breakdown for the same period.
- The **Entries** tab lists every one-off and recurring occurrence in the selected period, filterable by category, with inline edit/delete for one-off entries (recurring items are managed from the Recurring tab, since editing one changes every future occurrence).
- The **Recurring** tab manages your recurring income and expense templates.
- The **Settings** tab manages the category list (add/delete, saved to the database). Categories are split by income/expense; the entry form only offers categories that match the type you're logging. Deleting a category only removes it from the picker — past entries keep whatever category they already had.
- Pick **Month**, **Year**, or **Custom** range at the top of any tab — it drives every view.

### Receipts

One-off expenses can have a photo attached: tap **Add entry** (or edit an existing expense), choose **Expense**, and use **Add a photo of the receipt**. On mobile this opens the camera directly; on desktop it opens a file picker. Photos are stored on the backend's `/data/receipts` volume (so they survive `docker compose down`) and are viewable from the Entries list via the small camera icon next to a category. Recurring templates don't carry receipts, since they're not a single dated transaction.

**OCR is not implemented** — this release only wires up the plumbing so it can be added later without any schema or upload-flow changes:
- Every `transactions` row has `receipt_path`, `ocr_status` (`none` / `pending` / `done` / `failed`), and `ocr_text`.
- Uploading a receipt sets `ocr_status` to `pending`.
- A future worker can poll `GET /api/transactions?...` (or query the DB directly) for entries with `ocr_status = "pending"`, download the image from `receipt_path`, run OCR, and report the result back via `PUT /api/transactions/:id/ocr` with `{ "ocr_status": "done", "ocr_text": "..." }`. That endpoint already exists and is ready to be called.

## API

All endpoints are under `/api`:

| Method | Path | Description |
|---|---|---|
| GET | `/transactions?start=&end=&category=` | One-off + materialized recurring occurrences in range |
| POST | `/transactions` | Create a one-off entry |
| PUT | `/transactions/:id` | Update a one-off entry |
| DELETE | `/transactions/:id` | Delete a one-off entry (also removes its receipt, if any) |
| POST | `/transactions/:id/receipt` | Upload/replace a receipt photo (`multipart/form-data`, field `receipt`, max 10MB, jpg/png/webp/heic) |
| DELETE | `/transactions/:id/receipt` | Remove a transaction's receipt |
| PUT | `/transactions/:id/ocr` | Extension point for a future OCR worker to report results |
| GET | `/recurring` | List recurring templates |
| POST | `/recurring` | Create a recurring template |
| PUT | `/recurring/:id` | Update a recurring template |
| DELETE | `/recurring/:id` | Delete a recurring template |
| GET | `/summary?start=&end=` | Income/expense/net totals + category breakdown for range |
| GET | `/sync` | Full raw snapshot (all transactions, recurring items, categories) — used to seed the offline cache |
| GET | `/health` | Basic liveness check — used by the Settings "Server" status ping |
| GET | `/categories?type=` | List categories, optionally filtered to `income` or `expense` |
| POST | `/categories` | Create a category (`{name, type}`) |
| DELETE | `/categories/:id` | Delete a category |

Uploaded receipt images are served back at `/uploads/<filename>` (not under `/api`), proxied by nginx in production and by Vite's dev server locally.

Dates are `YYYY-MM-DD`. This is a single-user app with no auth — don't expose it directly to the internet without putting it behind your own authentication (e.g. a reverse proxy with basic auth, or a VPN/Tailscale).
