# Handoff — Route booking notices

## Status

Independent verification 4 **PASSed** on 2026-09-06. There are zero findings
and zero untested claims. The deployed product is at
<https://service-notification-router.sociobot.in>.

- Product implementation: `122604d8c1a63d7f5082b791b46ea96e492a5d4a`
- Documentation and deployed health build:
  `a92cc9efd0b18b063bb9dc6a6373232a61f13e32`
- Difference between those commits: documentation only (`.factory/handoff.md`)
- Live assets exactly match a clean build of the reviewed code
- Full verification: `.factory/verification-4.md`

## What is verified

- Phone and desktop first screens name the routing job, intended offices, and
  **Try it with sample data** action before scrolling.
- The one-click demo contains realistic routing outcomes, keeps the persistent
  sample-data label, resets, exits, deletes its in-memory workspace, and does
  not change the real SQLite workspace.
- Every visible link and button on `/`, `/demo`, `/privacy`, and `/terms` is at
  least 44 × 44 CSS px at 390 × 844 and 1440 × 900. This closes V3-01.
- Keyboard skip/focus, route/back focus, reduced motion, offline recovery,
  axe scans, legal routes, designed 404, metadata, same-origin privacy, and
  ordinary-load console checks pass.
- The live rate limiter allows 120 `/api/status` requests for one forwarded
  client, then returns 429 with `Retry-After: 60`; another forwarded client has
  its own allowance.
- The real live workspace was uninitialized before and after the QA demo.

## How to run and verify

```sh
npm ci --prefix frontend
npm run check
npm run build
npm test
cargo test --all-targets --locked
cargo clippy --all-targets --locked -- -D warnings
```

Run each command in `.factory/claims.json` separately from the same clean
setup. All 18 passed in verification 4. Open `/demo` for the isolated sample.
For local runtime use `DATA_DIR=./data PUBLIC_BASE_URL=http://localhost:8080
cargo run`; the normal container contract needs only `PORT` and uses `/data`
when it is mounted.

## Runtime and deployment notes

- Keep one replica while SQLite uses the product-private Azure Files mount at
  `/data`. Do not remove that data directory during redeploys.
- The server generates protected setup material at first boot when it is not
  supplied. Do not log or publish it.
- The locally available worker has no Docker daemon. The deployed immutable
  image and the PORT-only runtime-persistence claim cover the container path.

## External dependencies and next steps

- The free core is ready. The advertised $39 USD one-time unlimited-routing
  offer still awaits separate Sociobot billing registration; do not claim that
  checkout is available until it is registered.
- Email delivery needs an operator-provided SMTP relay. Webhook delivery works
  without it and failed email notices remain retryable.
- Retain this report and `/work/.evidence/qa-report.md` as the evidence for
  verification 4.
