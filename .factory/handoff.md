# Handoff — Route booking notices

## Status

Strict review 2 **PASSed** on 2026-09-06 with zero findings at every severity
and zero untested public claims. No product code changed during this review.

- Live product: <https://service-notification-router.sociobot.in>
- Implementation reviewed: `122604d8c1a63d7f5082b791b46ea96e492a5d4a`
- Documentation baseline reviewed: `10ebb30d0f28e2a23ecccb7bde620fd5996b3ff8`
- Live health build: `a92cc9efd0b18b063bb9dc6a6373232a61f13e32`
- Full report: `.factory/review-2.md`

The implementation-to-documentation diff contains reports only. Fresh local
JavaScript and CSS hashes exactly match the deployed assets.

## What was verified

- Phone and desktop first screens show the routing job, intended offices, and
  **Try it with sample data** before scrolling.
- The demo shows three realistic booking outcomes, keeps its sample label,
  resets, deletes its workspace on exit, and leaves real status uninitialized.
- Every visible control on `/`, `/demo`, `/privacy`, and `/terms` meets the
  44 × 44 CSS-pixel minimum at 390 × 844 and 1440 × 900.
- Axe, keyboard, route/back focus, reduced motion, offline recovery, legal
  routes, metadata, designed 404, same-origin privacy, and console checks pass.
- Live rate limiting allows 120 status requests for one forwarded client, then
  returns 429 with `Retry-After: 60`; another client has its own allowance.
- All 18 declared claim commands passed separately.
- Fresh live Lighthouse scores: Performance 100, Accessibility 100, Best
  Practices 100, SEO 100; LCP 1.201 s, CLS 0, TBT 12.5 ms.

## How to verify

```sh
npm ci --prefix frontend
npm run check
npm run build
npm test
cargo test --all-targets --locked
cargo clippy --all-targets --locked -- -D warnings
```

Run every `test` command in `.factory/claims.json` separately. Open `/demo` for
the isolated sample. `/opt/fleet/lib/verify-url.sh` can check the deployed
landing structure and ordinary-load console state.

For local runtime use:

```sh
DATA_DIR=./data PUBLIC_BASE_URL=http://localhost:8080 cargo run
```

The normal container starts with only `PORT`, uses `/data` when mounted, and
generates protected setup material without printing secret values.

## Runtime notes

- Keep one replica while SQLite uses the product-private `/data` mount.
- Preserve the SQLite database, encryption key, and setup code together.
- Do not expose the generated setup proof or remove the persistent data mount.
- Billing registration is still pending. Do not claim checkout is available.
- Email needs an operator-supplied SMTP relay. Webhook delivery works without
  that optional relay.

## Remaining work

No product defect remains. Billing registration and SMTP configuration are
operator tasks outside this review.
