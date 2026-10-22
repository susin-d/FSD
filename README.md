# Nearby

Nearby is a nationwide services marketplace for customers and local providers in India. Customers discover services by exact six-digit pincode, request a time, pay in INR after provider acceptance, and can message, review, or raise a dispute about a booking. Providers manage their service areas, listings, availability, and booking requests. Admins manage marketplace policy, provider review, linked payout accounts, and disputes.

The app is a responsive English-language web product. It does not use radius search, maps, or geocoding. The API is versioned under `/api/v1`.

## Current scope and launch status

The repository contains a React/Vite web app and an Express/MongoDB API for accounts, provider profiles, service listings, exact-pincode discovery, availability, bookings, Razorpay checkout/Route, reviews, booking-linked chat, email notifications, disputes, and admin operations. Payment processing and live verification require external accounts and configuration; a successful local build does not mean a production marketplace is ready to accept bookings.

Provider KYC documents stay with the selected verification vendor. Nearby stores verification status and reference data only. The adapter is deliberately fail-closed: development can create a pending verification reference, while live verification is unavailable until a vendor adapter is selected and configured.

Before launch, an operator must configure and review:

- A KYC vendor and its production adapter.
- Razorpay Checkout and Route approval, credentials, webhook secret, and linked provider accounts.
- Commission, cancellation/refund policy, checkout timeout, and completion review period in admin settings.
- Production MongoDB, domain, hosting secrets, allowed origins, email delivery, backups, monitoring, and incident procedures.
- Privacy notices, retention/deletion behavior, payment/refund terms, and operations against current Indian requirements. This README is not legal advice or a compliance claim.

Never put production credentials or private KYC documents in the repository or chat.

## Technology

- **Web:** React, Vite, React Router, Tailwind CSS v4, Socket.IO client.
- **API:** Node.js, Express, CommonJS, Socket.IO.
- **Data:** MongoDB and Mongoose.
- **Security:** JWT, bcryptjs, Zod, Helmet, CORS allowlist, rate limits, role checks, payment webhook signatures, and admin/payment audit records.
- **Payments:** Razorpay Checkout and Route, using integer paise internally and fixed INR listing prices.

## Repository layout

```text
server/
  src/
    app.js                 Express middleware and /api/v1 route mounts
    index.js               Database-first startup, Socket.IO, worker, shutdown
    config/                MongoDB connection
    middleware/            Authentication and authorization
    modules/               Auth, users, providers, services, bookings,
                           availability, payments, reviews, messaging,
                           disputes, admin, and marketplace settings
    utils/                 Validation and booking/payment lifecycle helpers
  scripts/create-admin.js  One-time admin provisioning
  scripts/seed-demo.js   Guarded local demo data setup
  tests/                   Focused Node test suite
website/
  src/                     Responsive React app, pages, components, API client
  .env.example             Browser-safe API URL example
  vercel.json              SPA route fallback
```

## Local setup

Requirements: Node.js current LTS, npm, and MongoDB local or Atlas access.

### API

```powershell
cd server
npm install
Copy-Item .env.example .env
```

Set `MONGO_URI` and a long, random `JWT_SECRET` in `server/.env`. The server defaults to port `4000` and waits for MongoDB before listening. If your local network blocks MongoDB SRV DNS queries, set `MONGODB_DNS_SERVERS` to a comma-separated resolver IP list for local development only. Do not commit `.env`.

```powershell
npm run dev
```

The API root is `http://localhost:4000/`; readiness is `http://localhost:4000/health`. Health returns HTTP 503 until MongoDB can answer a ping.

### Web app

In another terminal:

```powershell
cd website
npm install
Copy-Item .env.example .env
npm run dev
```

The Vite app defaults to `http://localhost:5173`. `VITE_API_URL` should be `http://localhost:4000/api/v1` locally. Only browser-safe values belong in variables prefixed with `VITE_`.

## Provisioning an administrator

Public registration does not allow the admin role. Create an initial admin from a trusted deployment environment after setting `BOOTSTRAP_ADMIN_EMAIL` and `BOOTSTRAP_ADMIN_PASSWORD` (at least 12 characters) alongside `MONGO_URI`:

```powershell
cd server
npm run admin:create
```

The command does not print the password. Remove the bootstrap password from the environment after provisioning. It exits if the email belongs to a non-admin account; use this only for a deliberate, trusted bootstrap operation.

## Demo data (local development only)

`server/scripts/seed-demo.js` can create demo customer, provider, and admin accounts, a verified demo provider with cleaning, plumbing, and electrical listings, two weeks of availability, and sample bookings including a dispute. Its sample dates are generated relative to the current Asia/Kolkata date. It refuses to run in production or against a database that already contains documents. Use a fresh, disposable development database only.

Set `ALLOW_DEMO_SEED=true` and `DEMO_PASSWORD` in `server/.env` (the password must be 12–72 UTF-8 bytes), then run:

```powershell
cd server
node scripts/seed-demo.js
```

The script prints the demo email addresses and generated record IDs. All seeded accounts share the supplied demo password. Remove both seed-only variables when finished. Never enable this on a production database.

## API and realtime contracts

Base URL: `http://localhost:4000/api/v1`. Successful JSON responses use `{ "success": true, "data": ... }`; errors use `{ "success": false, "error": { "code": ..., "message": ... } }`. Authenticated requests send `Authorization: Bearer <JWT>`.

| Route group | Main operations | Access / behavior |
| --- | --- | --- |
| `/auth` | `POST /register`, `POST /login`, `POST /password-reset/request`, `POST /password-reset/confirm`, `GET /me` | Customer/provider registration; six-digit email reset codes expire in 10 minutes and are limited to five attempts; reset request responses do not disclose whether an account exists |
| `/users` | `GET /me` | Authenticated account profile |
| `/providers` | `POST /me`, `GET /me`, `POST /me/verification`, `GET /:id` | Provider profile and replaceable KYC adapter; public profiles expose no KYC documents |
| `/services` | `GET /`, `GET /:id`, `GET /mine`, `POST /`, `PATCH/DELETE /:id` | Search/filter by category and exact `pincode`; only active listings from verified providers are discoverable |
| `/availability` | `PUT /me`, `GET /:providerId?date=YYYY-MM-DD&pincode=123456` | Provider publishes date-scoped `HH:mm` windows; public response marks conflicts with `available` |
| `/bookings` | `POST /`, `GET /`, `GET /:bookingId`, `POST /:bookingId/accept`, `/reject`, `/checkout`, `/complete`, `/cancel` | Exact service pincode, availability and overlapping booking checks; checkout begins after acceptance |
| `/payments` | `POST /webhook`, `GET /:bookingId`, `POST /verify`, admin refund operation | Raw-body webhook signature validation, duplicate event protection, checkout/refund state, and held Route transfers |
| `/reviews` | `POST /`, `GET /service/:serviceId` | A participant can review a completed booking once |
| `/messages` | `GET/POST /:bookingId` plus Socket.IO | Only booking participants; realtime handshake uses `auth.token`, then `booking:join` and `message:send` |
| `/disputes` | `POST /`, `GET /`, `GET /:disputeId`, admin `PATCH /:disputeId` | Participant disputes and an admin resolution queue; open disputes pause payout |
| `/admin` | `GET /stats`, `GET /providers`, `PATCH /providers/:providerId/verification`, `GET /disputes`, `GET /audit`, `PATCH /providers/:providerId/route-account` | Admin-only operations; KYC review records the result for an existing vendor reference without receiving documents |
| `/settings` | `GET /public`, admin `GET/PATCH /admin` | Public checkout readiness and configurable marketplace policy |

Availability dates and slot times are interpreted in `Asia/Kolkata`. Provider acceptance creates a temporary slot hold. The checkout timeout releases an unpaid hold. A paid booking retains earnings until completion; either participant can mark it complete, after which the configured review period can auto-complete it unless a dispute is open. For a cancellation with a partial refund, the configured commission is applied to the amount retained: Nearby keeps its commission and the provider receives the balance as a cancellation fee. The provider's Route transfer stays held while a refund is pending, failed, or requires reconciliation; a full refund leaves no provider transfer. Admin refund and payout actions are recorded for audit.

### Discovery and service prices

Service listings have a fixed INR price. The API accepts `price` in rupees for service creation/update, stores the amount as integer `pricePaise`, and returns both fields. Pincodes are six digits and must match the service and provider's configured service area exactly. There is no distance/radius fallback.

### Payments and chat

Set the Razorpay environment values in `server/.env` and configure the webhook URL as `https://<api-host>/api/v1/payments/webhook`. Checkout remains disabled until all policy values are configured and an admin enables Route. Configure Route linked accounts through the admin provider flow; never expose their IDs publicly. Test checkout, webhook signatures, duplicate/out-of-order events, refunds, and transfers in Razorpay sandbox before any production use.

Socket.IO connects to the API origin with `{ auth: { token: "<JWT>" } }`. Join a booking room with `booking:join` and `{ bookingId }`, send with `message:send` and `{ bookingId, text }`, receive `message:new`, and handle `message:error`. REST message access uses the same participant and booking-state checks.

## Environment variables

See `server/.env.example` and `website/.env.example` for complete examples.

| Variable | Purpose |
| --- | --- |
| `PORT` | API port; defaults to `4000` |
| `MONGO_URI` | Required MongoDB URI; `MONGODB_URI` is accepted only as migration fallback |
| `JWT_SECRET`, `JWT_EXPIRES_IN` | JWT signing and expiry |
| `CLIENT_ORIGINS` | Comma-separated exact browser origins; `CLIENT_ORIGIN` is a single-origin fallback |
| `TRUST_PROXY` | Set to `1` behind the single Render proxy; local example disables proxy trust |
| `MONGODB_DNS_SERVERS` | Optional local DNS resolver IPs for blocked MongoDB SRV lookups; unset in production by default |
| `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET` | Server-side checkout, Route, and webhook configuration |
| `KYC_PROVIDER` | Local example uses the pending-only `development_stub`; production adapter must be implemented/configured for the selected vendor |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASSWORD`, `EMAIL_FROM` | Booking, dispute, and password recovery email notifications |
| `BOOTSTRAP_ADMIN_EMAIL`, `BOOTSTRAP_ADMIN_PASSWORD` | Temporary one-time admin provisioning inputs |
| `ALLOW_DEMO_SEED`, `DEMO_PASSWORD` | Local-only demo seeding guard and shared demo password; keep disabled and unset outside disposable development databases |
| `VITE_API_URL` | Public API base URL used by the browser app |

## Deployment notes

- The API can be deployed to Render as a Node service with `server` as its root, `npm install` as the build command, `npm start` as the start command, and `/health` as the health check. This repository currently has no Render manifest; configure the service and secrets in Render directly. Provide `MONGO_URI`, a strong `JWT_SECRET`, `CLIENT_ORIGINS`, Razorpay secrets, and SMTP credentials through the service environment. Do not set the local DNS override in production unless the deployment network requires it.
- Set the Vercel project root directory to `website`; `website/vercel.json` provides SPA route fallback. Set the production `VITE_API_URL` to the deployed API's `/api/v1` URL and allow the deployed website origin in Render's `CLIENT_ORIGINS`.
- Configure Atlas network access, backups/restore drills, monitoring and alerts, HTTPS, email delivery, and log retention before launch. No hosting or database account is configured by this repository.
- Keep MongoDB credentials, JWT secrets, Razorpay secrets, SMTP passwords, and KYC documents out of browser bundles and version control.

## Commands and verification

```powershell
# server/
npm test
npm run dev

# website/
npm run lint
npm run build
```

Live sandbox and production checks require external credentials and infrastructure. The local checks do not establish Razorpay approval, vendor KYC readiness, legal compliance, backup recoverability, or production deployment health.

## Design

Nearby uses a white page canvas with brand-yellow navigation and highlighted cards, blue buttons, and dark readable text. The colors are defined in `website/src/index.css`, with component surfaces in `website/src/App.css`. The responsive English-language web app includes customer, provider, and admin experiences.

## License

No license is specified. Add a `LICENSE` file before distributing this project as open-source software.
