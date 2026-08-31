# Mini Budget — a simple spend tracker

A mobile-first, single-user spend tracker. React frontend, Go backend, SQLite storage. Track one-off income/expenses and recurring items (paycheque, rent), and see a breakdown by month, year, or custom date range.

## Stack

- **Frontend:** React + Vite, no UI framework, hand-rolled CSS (dark "ledger" theme). Installable as a PWA (works great on iOS via "Add to Home Screen") and works offline — see below. Served by nginx in production, which also proxies `/api` to the backend.
- **Backend:** Go, standard library `net/http`, `modernc.org/sqlite` (pure-Go SQLite driver, no CGO needed). Receipt photos are read with **Tesseract OCR**, running self-hosted inside the same container — see **Receipts & OCR** below.
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

OCR needs the `tesseract` binary on your PATH (the Docker image installs it automatically; running outside Docker, install it yourself — e.g. `apt install tesseract-ocr` / `brew install tesseract`). If it's missing, the backend logs a warning and disables OCR rather than failing to start; receipts still upload and display fine, they just won't get read automatically.

## Installing as an app (PWA)

Mini Budget is an installable Progressive Web App — it works the same everywhere, but how you install it differs by platform.

### iOS (Safari)

Once it's deployed somewhere reachable from your phone (see **Run it** above — `docker compose up` and open the site on your phone over the same network, or deploy it somewhere with a real URL):

1. Open the site in **Safari** on iOS (it must be Safari — Chrome/Firefox on iOS can't install PWAs, since they're all really Safari under the hood but Apple only exposes this to Safari itself).
2. Tap the **Share** icon (square with an arrow) in the toolbar.
3. Tap **Add to Home Screen**.
4. Tap **Add**.

It now launches full-screen from your home screen like a native app, with its own icon, no Safari address bar, and works offline (see below). A few iOS-specific realities worth knowing:

- **No Background Sync / Push.** iOS doesn't support the Background Sync API, so pending changes don't sync silently in the background. Mini Budget works around this the same way on every platform, not just iOS: it syncs whenever the app is open and online (checking on launch, on the `online` event, and every 20 seconds as a fallback, since iOS doesn't always fire that event reliably) — so just opening the app while connected is enough.
- **Storage isn't permanent.** iOS Safari can evict a PWA's local storage (including the offline cache) if the app goes unused for a long time or the device is low on space. Your data always lives safely in the backend's SQLite database regardless — the offline cache is just a convenience copy for when you're offline, not the source of truth.
- **HTTPS in production.** Service workers require a "secure context." `localhost` and plain HTTP over a local network (e.g. `http://192.168.x.x:8081` while testing on your home Wi-Fi) both count, but a real public deployment needs HTTPS — put it behind a reverse proxy with TLS (Caddy, nginx + certbot, Cloudflare Tunnel, Tailscale, etc.) if you're exposing it beyond your LAN.

### Desktop (Chrome / Edge)

1. Open the site in Chrome or Edge.
2. Either click the **install icon** in the address bar (⊕ or a small monitor icon, right-hand side), or open the browser menu (⋮) and choose **Install Mini Budget…**.
3. Confirm in the dialog that appears.

It opens in its own window — no tabs, no address bar — with an icon in your dock/taskbar, and works offline the same way it does everywhere else. There's also an **Install app** button inside the app itself (Settings tab, top of the page): it uses the browser's native `beforeinstallprompt` API, so it only appears once Chrome/Edge decide the install criteria are met, and it's just a shortcut to the same dialog — it doesn't do anything the browser's own install icon can't.

Once installed, right-click the taskbar/dock icon for two shortcuts straight into the app: **Add entry** and **Overview**.

### Android

Chrome on Android shows the same install prompt as desktop Chrome (an "Install app" banner or a menu item), and Mini Budget's "Install app" button in Settings works there too.

## Offline sync

The app works with no connection at all — not just "read-only cached data," but actually creating, editing, and deleting entries offline:

- On first load (and periodically), the app pulls your full dataset into an on-device cache (IndexedDB) via `GET /api/sync`.
- While offline, any add/edit/delete is applied immediately in the UI and queued locally. New entries get a temporary ID until they sync.
- The **Entries** and **Overview** tabs work fully offline: recurring items (paycheque, rent, etc.) are expanded into dated occurrences on-device, using the same date logic as the backend, so month/year/custom-range views are accurate even with zero connectivity.
- A small pill in the header shows **Offline** or **Syncing N changes…** whenever there's something to report; it disappears once everything's synced.
- When the connection comes back, queued changes replay against the real API in order, and temporary IDs are swapped for the real ones the server assigns.

### Settings → Offline & sync

The Settings tab has a dedicated panel for this:

- **Offline mode switch** — forces the app to behave as if there's no connection, regardless of what the device actually has. Flip it on before a flight, to test the offline flow, or just to keep everything queued locally on purpose. Flip it off and Mini Budget immediately re-checks the server and flushes anything queued.
- **Device network** — the browser's raw connectivity signal (`navigator.onLine`).
- **App mode** — "Live" or "Forced offline," reflecting the switch above.
- **Server** — an active ping to `GET /api/health`, distinct from device network: your phone can have Wi-Fi (device "Online") while the backend itself is down or unreachable, and this is what actually tells you that.
- **Sync status** — how many changes are queued and waiting, or confirmation everything's synced, plus a manual **Sync now** button.
- **Connection errors** — if the last attempt to reach the server failed, the message is shown here (dismissible).
- **Sync issues** — a log of mutations the server actively rejected (not connectivity failures — a validation error, a 404, etc.). These can't succeed as-is so they're not retried automatically, but they're kept visible here rather than silently disappearing, along with what was rejected and why. Dismissible once you've seen them.

**Known limits:**
- **Receipt photos require a connection.** Queuing an offline file upload (and reconciling it against a transaction that might itself still be un-synced) adds a lot of complexity for what's already an optional feature. Attaching a receipt while offline (including with the manual toggle on) shows a clear "you're offline" message instead of silently failing later.
- **Single device at a time, effectively.** If you use Mini Budget on two devices and both go offline and edit the *same* entry before either reconnects, the last one to sync wins — there's no conflict merging. For a single-user app used from one phone, this basically never comes up in practice, but it's worth knowing if you install it on multiple devices.

## How it works

- **One-off entries** (a grocery run, a specific payment) are stored as `transactions`.
- **Recurring entries** (a paycheque every two weeks, rent on the 1st) are stored as `recurring_items` — a template with a frequency (weekly / every 2 weeks / monthly), a start date, and an optional end date. The backend expands these into actual dated occurrences whenever you view a date range, so you never have to manually re-enter them.
- The **Overview** tab shows a single balance bar for the selected period: the track represents your income, the red fill shows how much of it you've spent, and a hatched overflow shows spending that exceeds income. Below it, a per-category breakdown for the same period.
- The **Entries** tab lists every one-off and recurring occurrence in the selected period, filterable by category, with inline edit/delete for one-off entries (recurring items are managed from the Recurring tab, since editing one changes every future occurrence).
- The **Recurring** tab manages your recurring income and expense templates.
- The **Settings** tab has four things: an install-as-app card (see **Installing as an app** above), the offline & sync panel (see **Offline sync** below), import/export (see below), and the category list (add/delete, saved to the database). Categories are split by income/expense; the entry form only offers categories that match the type you're logging. Deleting a category only removes it from the picker — past entries keep whatever category they already had.
- Pick **Month**, **Year**, or **Custom** range at the top of any tab — it drives every view.

### Import & export (Settings)

- **Export CSV** downloads everything — every one-off entry and every recurring template — as a single CSV file, pulling the freshest copy from the server (or, if you're offline, the last-known local cache). It's a portable backup and it's a normal CSV, so it opens fine in Excel/Sheets/Numbers too. Receipt photos aren't included (there's no sane way to put an image in a CSV cell).
- **Import CSV** accepts that same format back, row by row: create the entry via the normal API (so it goes through the same validation, and queues normally if you're offline), and if any category in the file doesn't exist yet in Settings, it's added automatically so the picker stays accurate.
- **Graceful per-row failure is the whole point.** A row missing a name, a usable amount, a category, or a valid date is skipped — not the entire import. You get a count of how many entries imported, plus a line-by-line list of what got skipped and why (e.g. `Row 14: missing or invalid amount`), referencing the actual spreadsheet row number.
- **It's forgiving about format**, so plain exports from a bank or budgeting app tend to work too, not just round-tripped exports from this app: dates can be `YYYY-MM-DD` or `MM/DD/YYYY`; amounts can have `$` and thousands separators; and if there's no income/expense column at all, the sign of the amount decides it (negative → expense, positive → income).
- The full column set is `kind,name,amount,category,type,date,frequency,end_date,description` — `kind` (`transaction` or `recurring`, defaults to `transaction` if the column's absent), `frequency`/`end_date` only matter for recurring rows. An unparseable `end_date` isn't treated as critical — it's just dropped, not skipped.

### Receipts & OCR

One-off expenses can have a photo attached: tap **Add entry** (or edit an existing expense), choose **Expense**, and use **Add a photo of the receipt**. On mobile this opens the camera directly; on desktop it opens a file picker. Photos are stored on the backend's `/data/receipts` volume (so they survive `docker compose down`) and are viewable from the Entries list via the small camera icon next to a category. Recurring templates don't carry receipts, since they're not a single dated transaction.

Every uploaded receipt is automatically read with **Tesseract OCR**, running inside the backend container — no external service, no API key, nothing to configure to get it working. The flow:

1. You upload a photo. It's saved and the response comes back immediately (`ocr_status: "pending"`) — OCR runs in the background, not in the request.
2. Before Tesseract ever sees it, the image goes through a preprocessing pass (`backend/ocr_preprocess.go`, pure Go, no external tools) that fixes the two things that hurt phone-photographed receipts the most:
   - **Orientation.** Phones typically save a photo with pixels in landscape and an EXIF tag saying "rotate for display" — normal, correct JPEG behavior that most image-processing code (including Go's standard library) simply ignores. Skip this step and a portrait phone photo produces near-total garbage; this was measured directly, not assumed.
   - **Uneven lighting.** A hand-held photo almost always has some shadow or brightness gradient across the receipt. The pipeline estimates that gradient and divides it back out, then restretches contrast — this mattered more than denoising or sharpening in testing, and naive contrast/sharpen filters were tried and made things measurably *worse* (they amplify sensor noise into phantom text), so they're deliberately not used.
3. A small in-process worker pool (2 workers by default) runs the preprocessed image through `tesseract` and writes the result back.
4. Reopen that entry and you'll see either **"Text extracted"** with an expandable **Extracted text** block showing exactly what it found, or **"Couldn't read text"** if the image was still too blurry/dark/skewed for Tesseract to make sense of (the photo itself is still saved either way — a failed read never loses the receipt).

A few things worth knowing:

- **Nothing is auto-filled.** This phase only extracts and displays raw text — it doesn't parse out a merchant, amount, or date, and it never silently overwrites what you typed. Turning the extracted text into one-tap field suggestions is a natural next step, not yet built.
- **Free OCR still has real limits.** Even with preprocessing, Tesseract struggles with things like creased thermal paper, very faded ink, or a receipt photographed at a sharp angle (preprocessing fixes *orientation* and *lighting*, not perspective skew). Treat "Couldn't read text" as normal sometimes, not necessarily a bug.
- **If a server restarts mid-job** (deploy, crash, `docker compose restart`), anything still stuck at `pending` gets automatically re-queued the next time the backend starts — nothing gets permanently stuck.
- **Turning it off:** set `OCR_PROVIDER=none` (see `docker-compose.yml`) if you'd rather not run OCR at all. Receipts still upload and display normally; they just stay at `ocr_status: "pending"` forever, same as if no worker existed.
- **Swapping in a better engine later:** OCR is implemented behind a small Go interface (`OCRProvider` in `backend/ocr.go`) specifically so a cloud vision API or a multimodal LLM can be dropped in later without touching the upload flow, the queue, the schema, or the frontend — only `newOCRProvider()` would need a new case. Worth knowing if Tesseract's accuracy isn't cutting it: paid options are meaningfully better at this specific task.

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
| PUT | `/transactions/:id/ocr` | Write back an OCR result — used internally by the built-in Tesseract worker, and open to an external worker too if you ever swap it out |
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
