# Zescrow

Minimal Next.js MVP for an escrow-enabled transaction platform focused on
high-value phone sales.

## What is included

- Marketing-style homepage for the product concept
- Seller onboarding flow with signup, OTP verification, KYC, bank setup, and login
- Protected seller dashboard for creating customer payment links
- Buyer payment-link flow backed by PostgreSQL
- Persistent buyer, payment, delivery, and transaction history records
- Test-mode provider adapters for Quickteller and Sendbox

## Routes

- `/`
- `/seller`
- `/seller/dashboard`
- `/pay/[slug]`
- `/admin`

## Run locally

1. Install dependencies:

```bash
npm install
```

2. Start the dev server:

```bash
npm run dev
```

3. Open `http://localhost:3001`

## Environment variables

Copy `.env.example` to `.env.local` or `.env` and fill in the values you have.

### Core app

- `APP_URL`
- `NEXT_PUBLIC_APP_URL`
- `DATABASE_URL`
- `AUTH_JWT_SECRET`

### Authentication

- Seller authentication now uses signed JWT session cookies.
- `AUTH_JWT_SECRET` should be a long random string in every environment.

### Email notifications

- `EMAIL_MODE`
  - `mock` or `brevo`
- `EMAIL_FROM_NAME`
- `EMAIL_FROM_ADDRESS`
- `ADMIN_ALERT_EMAILS`
- `BREVO_API_KEY`
- `BREVO_API_BASE_URL`

### Dispute attachments

- `PINATA_JWT`
- `PINATA_GATEWAY_URL`

### Payment provider

- `PAYMENT_PROVIDER`
  - `mock` or `interswitch`
- `PAYMENT_ENV`
  - `test` or `live`
- `INTERSWITCH_MERCHANT_CODE`
- `INTERSWITCH_PAY_ITEM_ID`
- `INTERSWITCH_PAY_ITEM_NAME`
- `INTERSWITCH_CURRENCY`

### Delivery provider

- `DELIVERY_PROVIDER`
  - `mock` or `sendbox`
- `DELIVERY_ENV`
  - `test` or `live`
- `SENDBOX_API_BASE_URL`
- `SENDBOX_API_KEY`
- `SENDBOX_AUTH_HEADER`
- `SENDBOX_AUTH_PREFIX`
- `SENDBOX_QUOTE_PATH`
- `SENDBOX_CREATE_ORDER_PATH`
- `SENDBOX_TRACK_PATH`

## Provider modes

### Local-safe mode

Use this when you want the app fully usable without external credentials.

- `PAYMENT_PROVIDER=mock`
- `DELIVERY_PROVIDER=mock`

### Integration mode

Use this when you have test credentials from Interswitch and Sendbox.

- `PAYMENT_PROVIDER=interswitch`
- `PAYMENT_ENV=test`
- `DELIVERY_PROVIDER=sendbox`
- `DELIVERY_ENV=test`

## External setup you still need

### Interswitch Quickteller

- A test merchant account
- `merchant_code`
- `pay_item_id`
- Confirmation that your merchant profile can use web checkout in test mode

### Sendbox delivery

- A Sendbox developer/app account with sandbox access
- A sandbox API key
- The base API URL for your environment
- The exact quote, create-order, and tracking endpoint paths for your app
- The auth header format your Sendbox app expects

### Local testing tools

- A publicly reachable URL if you want to test callbacks and redirects on other devices
- `ngrok` or Cloudflare Tunnel if you want your local machine reachable from the internet

## Current implementation notes

- Buyer records are now persisted per transaction.
- Payment initialization and confirmation are stored in PostgreSQL.
- Delivery quotes and booking records are stored in PostgreSQL.
- Payment confirmation emails can be sent to buyers, sellers, and admin recipients.
- Dispute open and resolution emails can be sent when Brevo is configured.
- Dispute attachments upload through Pinata when `PINATA_JWT` is set.
- Quickteller is wired as a real provider path, but it only becomes active after the required Interswitch credentials are added.
- Sendbox is wired through an env-driven adapter. Because the private docs are not publicly readable, the exact request and response field mapping may need a small adjustment to match your issued sandbox endpoints.

## Deployment

### Railway

Railway is now a clean fit because the app uses PostgreSQL through `DATABASE_URL`.

1. Push the repo to GitHub.
2. Create a new Railway project from the GitHub repo.
3. Add a PostgreSQL service in Railway.
4. Set these environment variables in your web service:

```env
NODE_ENV=production
DATABASE_URL=postgresql://...
APP_URL=https://your-app-domain.up.railway.app
NEXT_PUBLIC_APP_URL=https://your-app-domain.up.railway.app
PAYMENT_PROVIDER=mock
PAYMENT_ENV=test
DELIVERY_PROVIDER=mock
DELIVERY_ENV=test
```

5. Add your Interswitch and Sendbox variables when you are ready to test integrations.
6. Deploy.

Notes:

- The app now respects Railway's dynamic `PORT`.
- If `APP_URL` is omitted, the app can also fall back to `RAILWAY_PUBLIC_DOMAIN`.

### Vercel

Vercel is now viable too, as long as `DATABASE_URL` points to a reachable PostgreSQL instance.

For Vercel:

- set `DATABASE_URL`
- set `APP_URL` and `NEXT_PUBLIC_APP_URL` to your Vercel domain
- keep Pinata and Brevo env vars in the project settings
