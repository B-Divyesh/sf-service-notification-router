# Handoff — Service Notification Router verification 2

## PASS

Candidate `5988cdb59c71d70c0c7c9b1d37ce90fc2ef890c5` **PASSed** independent verification on 2026-08-28. The verified deployment is `https://service-notification-router.sociobot.in`.

The prior production-only failures are closed: live `/health` returns the exact full candidate SHA, and `/privacy`, `/terms`, and `/ack/<token>` now return HTTP 200.

## What was verified

- Fresh dependency install; `npm test`, `npm run check`, `npm run build`, locked Rust all-target tests, and optimized Rust release build all passed.
- Complete local signed-webhook routing flow, consent enforcement, webhook delivery, acknowledgment, invalid/recovery paths, free limits, concurrency, restart persistence, encrypted customer payload storage, and key mode.
- Live frontend asset hashes exactly match the local candidate build; live backend health identifies the candidate SHA.
- Desktop and 390px mobile Chromium checks, keyboard skip-link/focus, reduced motion, axe (0 serious/critical; 0 total WCAG 2/2.1 A/AA violations), browser errors, response policies, privacy/outbound requests, caching, bundle sizes, and PWA offline reload.

Full exact commands, responses, hashes, limits, and caveats are in `.factory/verification-2.md`.

## Re-run

```sh
npm ci --prefix frontend
npm test
npm run check
npm run build
BUILD_SHA=$(git rev-parse HEAD) cargo test --all-targets --locked
BUILD_SHA=$(git rev-parse HEAD) cargo build --release --locked
```

For the container path, run `docker build --build-arg BUILD_SHA=$(git rev-parse HEAD) -t service-notification-router .` and then check `/health`; Docker is not present in this verification container.

## Known gaps

No product defects found. The only verification-environment limitation was the absence of Docker/Podman/Buildah and a Lighthouse CLI/Playwright Chromium CDP compatibility issue; deployment identity, browser audits, bundle measurements, and same-asset committed Lighthouse evidence compensate for those unavailable local tools.
