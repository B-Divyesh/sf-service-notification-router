# Handoff — Service Notification Router

## What shipped

- Rust 2021 `axum` service on `PORT` with SQLite migrations, structured JSON
  logs, graceful shutdown, security headers, request-size limits, compression,
  endpoint rate limits and `/health` build metadata.
- First-run administrator setup and login. Passwords use Argon2; bearer sessions
  expire after seven days and are stored only in browser session storage.
- `POST /api/bookings` accepts the normalized booking contract and verifies the
  exact body with HMAC-SHA256 before parsing. External IDs are idempotent.
- Priority-ordered exact matches on `service` or `provider`; unmatched bookings
  remain visible without notifying a shared group.
- Consented email recipients through operator-supplied STARTTLS SMTP and outgoing
  JSON webhooks. Webhook bodies are signed, failures retry on a backoff schedule,
  and an administrator can retry immediately.
- Per-notice public acknowledgment links and a delivery board with received,
  delivered, acknowledged and unmatched totals.
- Booking payloads encrypted with AES-256-GCM. The key is created separately from
  SQLite at `DATA_DIR/router.key` with mode 0600. Scheduled and manual retention
  purge remove encrypted payloads after 1–720 configured hours.
- A useful free tier (three recipients and three rules) and the required $39
  one-time Sociobot license unlock. Checkout, query-string capture, local storage,
  once-daily cached verification and paste-to-restore follow the paid-unlock
  contract; the backend independently verifies before removing limits.
- Vite + TypeScript PWA console with setup, error, empty, offline, retry and mobile
  states; one-h1 semantic pages, designed focus, 44 px targets and reduced motion.
- Product-specific risograph collage system, generated/verified original hero,
  optimized responsive WebP assets, privacy/terms pages, MIT license, Dockerfile
  and complete operator README.

## Run and verify

```sh
npm install --prefix frontend
npm test
npm run check
npm run build
DATA_DIR=./data PUBLIC_BASE_URL=http://localhost:8080 cargo run
```

Container build command:

```sh
docker build --build-arg BUILD_SHA=$(git rev-parse --short HEAD) -t service-notification-router .
```

The multi-stage Dockerfile builds Vite, compiles a locked Rust release, runs as a
non-root Alpine user, exposes 8080 and persists `/data`.

## Verification performed 2026-08-27

- `npm test`: 2 Vitest tests and 4 Rust tests pass. The Rust integration test
  covers setup, recipient/rule creation, signed intake, encrypted ingest, exact
  routing, provider failure state and acknowledgment.
- `npm run check`: strict TypeScript and `cargo check` pass.
- `npm run build`: passes; Vite output is in `frontend/dist`.
- `cargo build --release --locked`: passes.
- Live local end-to-end exercise: created an installation, recipient and rule;
  sent a correctly signed booking to a real local recipient webhook; observed a
  signed `booking.routed` event; opened its token and acknowledged it. Final
  metrics were received 1, delivered 1, acknowledged 1, unmatched 0.
- `/opt/fleet/lib/verify-url.sh`: HTTP 200, no console/page errors, title present,
  `lang=en`, exactly one h1, main landmark, no missing alt text and no unlabeled
  buttons. Desktop/mobile screenshots are in `.factory/evidence/`.
- Axe-core 4.13 WCAG 2 A/AA/2.1 AA audit at 390×844: 0 violations, 17 rule groups
  passed. The bundled CLI could not locate its Selenium Chrome binary, so the
  same axe engine was injected through the worker's Playwright Chromium with CSP
  bypass enabled for the audit only.
- Lighthouse mobile: Performance 100, Accessibility 100, Best Practices 100,
  SEO 100; FCP 0.9 s, LCP 1.5 s, speed index 0.9 s, TBT 0 ms, CLS 0, transferred
  weight 71 KiB.
- Lighthouse desktop: 100/100/100/100; LCP 0.4 s, CLS 0, 134 KiB transferred.
- Asset budgets: initial JavaScript 32.19 KB (10.16 KB gzip), CSS 12.08 KB
  (3.60 KB gzip), mobile hero 54 KB, desktop hero 118 KB. No runtime CDN, font,
  tracker or analytics request.
- Load smoke: release server handled 1,000 `/health` requests at concurrency 100,
  1,000 successful in 0.634 s (1,578 requests/s in this worker).
- Cache behavior checked: Vite hashed JS/CSS receive one-year immutable caching;
  other assets receive seven days; HTML is revalidated; API and health are
  `no-store`.

## Known deployment checks

- This worker does not contain a Docker engine, so the Dockerfile could not be
  executed locally. Both constituent locked production builds passed, and the
  stage paths were checked against their output.
- Real SMTP delivery was not attempted because no relay credentials belong in the
  repository. The integration path verifies its immediate actionable failure and
  retry state; webhook delivery was exercised successfully end to end.
- The factory must register the Sociobot product and choose production vs pilot
  `BILLING_API_BASE`. Live checkout/license verification was intentionally not
  invoked before registration.
- Set `PUBLIC_BASE_URL` to the final HTTPS origin, mount persistent `/data`, supply
  SMTP variables if email is used, and back up `router.db` together with
  `router.key`. Configure the edge proxy to preserve the real client address for
  useful rate limiting.
