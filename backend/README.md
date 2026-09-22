# Books Print on Demand KE — API (backend)

A small Express API that does the things a static GitHub Pages site can't
do safely: talk to Safaricom's Daraja API with real credentials, and store
customer/order data somewhere shared instead of one browser's `localStorage`.

## M-Pesa endpoints

| Method | Path | Purpose |
|---|---|---|
| POST | `/api/mpesa/stkpush` | Starts an STK push (the "enter your M-Pesa PIN" prompt) on the customer's phone |
| POST | `/api/mpesa/callback` | Safaricom calls this when the customer finishes (or cancels) the payment |
| GET | `/api/mpesa/status/:checkoutRequestId` | The frontend polls this to find out what happened |

Payment attempt status (pending/success/failed) is tracked in
`data/payments.json` regardless of whether a database is configured — it's
just short-lived bookkeeping for the polling flow, not customer data.

## Orders endpoints (customers & orders)

| Method | Path | Auth | Purpose |
|---|---|---|---|
| POST | `/api/orders` | none | Customer submits a quote request |
| POST | `/api/orders/:id/mpesa-code` | none | Customer self-reports their M-Pesa code after paying manually |
| GET | `/api/orders` | `x-admin-key` header | Studio mode's order queue |
| PATCH | `/api/orders/:id` | `x-admin-key` header | Update status / payment status / M-Pesa code |
| DELETE | `/api/orders/:id` | `x-admin-key` header | Remove an order |

These require `DATABASE_URL` (a Postgres connection string) to actually
persist anything. Without it, the site still runs — the frontend just falls
back to browser-only `localStorage`, exactly like before this was added.

### Setting up the database

1. Get a free Postgres instance — Render and Railway both offer one from
   their dashboards ("New → PostgreSQL").
2. Copy its connection string into `DATABASE_URL` in your `.env` (or your
   host's environment variables once deployed).
3. Nothing else to run manually — `server.js` creates the `orders` table
   automatically on startup if it doesn't exist yet.
4. Set `ADMIN_API_KEY` to a password only you know. This is what protects
   customer names/phone numbers from being readable by anyone who finds
   your backend URL — enter this same value into Studio mode → Backend sync
   in the browser you use to manage the site.

## 1. Get Daraja credentials

1. Create an account at <https://developer.safaricom.co.ke>.
2. Create a new app to get a **Consumer Key** and **Consumer Secret** (sandbox works immediately).
3. For **sandbox** testing, use shortcode `174379` and the sample passkey shown in Safaricom's docs under "Lipa na M-Pesa Online" — Safaricom publishes a fixed sandbox passkey you can copy directly from their portal.
4. For **production** (real money into Till **5356215**), you'll need to go through Safaricom's go-live process for that Till/Paybill to get a production Consumer Key/Secret and the real Passkey. This is a business process with Safaricom, not something code can shortcut.

## 2. Configure

```bash
cp .env.example .env
```

Fill in `.env` with your values. The important ones:

- `MPESA_CONSUMER_KEY`, `MPESA_CONSUMER_SECRET` — from your Daraja app
- `MPESA_SHORTCODE`, `MPESA_PASSKEY` — sandbox `174379` + Safaricom's sandbox passkey while testing
- `MPESA_TILL_NUMBER` — `5356215` (Epiq Graphics) for production Buy Goods pushes
- `MPESA_CALLBACK_URL` — **must be a public HTTPS URL**. Safaricom cannot reach `localhost`.

## 3. Run locally

```bash
npm install
npm start
```

The API listens on `http://localhost:4000` by default.

### Testing the callback locally

Safaricom needs a real public URL to call back to. Use a tunnel while developing:

```bash
npx ngrok http 4000
```

Then set `MPESA_CALLBACK_URL` in `.env` to the ngrok HTTPS URL + `/api/mpesa/callback`,
e.g. `https://abcd1234.ngrok-free.app/api/mpesa/callback`, and restart the server.

## 4. Deploy somewhere that stays online

GitHub Pages only serves static files — it cannot run this server. Deploy it to
a host that runs Node.js continuously and gives you a permanent HTTPS URL, e.g.:

- **Render** (render.com) — free tier, easiest: "New Web Service" → connect this repo's
  `backend` folder → build command `npm install` → start command `npm start` → add
  the same environment variables from `.env` in the dashboard.
- **Railway** (railway.app) — similar one-click deploy from a GitHub repo.
- Any VPS running Node 18+ behind HTTPS (e.g. via Caddy or nginx + Let's Encrypt).

Once deployed, take the resulting URL (e.g. `https://books-pod-ke-api.onrender.com`) and:

1. Set `MPESA_CALLBACK_URL` to `https://<your-backend-url>/api/mpesa/callback` in that host's environment variables.
2. Set `FRONTEND_ORIGIN` to your GitHub Pages URL (e.g. `https://yourusername.github.io`) to lock down CORS.
3. Put the same backend URL into `frontend/js/config.js` as `API_BASE_URL`.

## 5. Going live with real payments

Sandbox STK pushes only work with Safaricom's test phone numbers and never move
real money. To accept real payments into Till 5356215:

1. Complete Safaricom's go-live application for that Till (they'll ask for
   business documents).
2. Once approved, Safaricom issues **production** credentials — update
   `MPESA_ENV=production` and the production Consumer Key/Secret/Passkey in
   your deployed environment variables.
3. Re-test end to end with a small real amount before relying on it.

## Notes on security

- Never put `MPESA_CONSUMER_SECRET`, `MPESA_PASSKEY`, `DATABASE_URL`, or
  `ADMIN_API_KEY` in the frontend or in git — they belong only in this
  backend's environment variables.
- `data/payments.json` is gitignored on purpose; it will contain phone numbers
  and receipt numbers once you're live.
- `ADMIN_API_KEY` is the only thing standing between "anyone with your
  backend URL" and "every customer's name and phone number." Pick something
  long and random, not a word you'd find in a dictionary.
