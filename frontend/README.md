# Books Print on Demand KE

An instant book-printing quote site with a live M-Pesa checkout and
WhatsApp confirmation, split into two independently-deployable pieces:

```
frontend/   Static site → GitHub Pages
backend/    Node.js API → Render / Railway / any Node host (handles real M-Pesa STK push)
```

GitHub Pages only serves static files, so it can host `frontend/` but not a
live server. The M-Pesa Daraja API also requires holding a Consumer
Secret and Passkey, which must never sit in client-side code — so that part
lives in `backend/`, deployed separately with its own HTTPS URL.

## Quick start

### 1. Frontend → GitHub Pages

1. Push this repo to GitHub.
2. In the repo's **Settings → Pages**, set the source to the `frontend` folder
   on your main branch (or copy the contents of `frontend/` into the repo
   root / a `docs/` folder if your GitHub Pages setup expects that instead —
   GitHub Pages only serves from the repo root or a `/docs` folder, not
   arbitrary folder names).
3. Your site goes live at `https://<yourusername>.github.io/<repo>/`.

Until you deploy the backend, the site still works fully — quotes, the
order queue, WhatsApp confirmation and manual M-Pesa Till payment all run
client-side with no server needed. Only the **live "Pay now" push button**
needs the backend; see `frontend/js/config.js`.

### 2. Backend → Render/Railway (for live M-Pesa push)

See `backend/README.md` for full step-by-step instructions: getting Daraja
credentials from Safaricom, testing locally with ngrok, and deploying so
Safaricom's payment callback has a permanent HTTPS URL to reach.

Once deployed, put its URL into `frontend/js/config.js`:

```js
window.APP_CONFIG = {
  API_BASE_URL: "https://your-backend-url.onrender.com"
};
```

Without this step, the "Pay now" button simply doesn't appear — clients
still see the manual Till number + confirmation-code fallback, so the site
never breaks, it just falls back to manual payment confirmation.

## What's stored where

- **Pricing, binding types, lamination options, WhatsApp number, M-Pesa Till
  instructions** — edited in Studio mode, stored in the visitor's own browser
  (`localStorage`). This is deliberately simple config, meant to be set once
  on the device/browser you use to manage the site.
- **Customers and orders** — stored in a real Postgres database once you set
  `DATABASE_URL` on the backend (see `backend/README.md`). Every quote a
  customer submits is saved there — name, contact, notes, items, total,
  status, and payment info — so you can see every order from any device,
  not just the browser it was submitted from. If `DATABASE_URL` isn't set,
  the site still works fine; orders just stay local to whichever browser
  created them, same as before.
- **M-Pesa payment status** — tracked server-side in the same database
  (or, if you skip the STK-push feature, in `backend/data/payments.json`),
  so a payment can be confirmed even if the client closes the page mid-payment.
  When Safaricom confirms a push, the backend automatically marks the
  matching order "Paid" using the order ID it sent as the payment reference.

### Seeing orders from any device (Studio mode)

Once the backend has `DATABASE_URL` and `ADMIN_API_KEY` set:

1. Open Studio mode on the site.
2. Under **Backend sync**, paste in the same `ADMIN_API_KEY` value.
3. The "Quote requests" list now syncs live from the database — from any
   browser, any device, as long as you enter that same key there too.

The admin key is a shared secret between you and the backend — never share
it publicly, and don't put it in `config.js` (that file ends up on GitHub
Pages, visible to anyone).
