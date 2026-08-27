# Independent verification — FAIL

Verified 2026-08-27 against candidate `ede437eb1c8073493aacf93e81ea8f0f49832b8b` and live URL `https://service-notification-router.sociobot.in`.

## Release blockers

1. **P1 — public client routes return HTTP 404.** Both the local release server and the live deployment return `404 Not Found` for `/privacy`, `/terms`, and `/ack/<token>`. The response body is the SPA index, so a browser can render the client route, but the HTTP status remains 404. This makes the mandated legal URLs and public acknowledgment links response failures; the latter also produces a browser console resource error. Reproduced locally with a generated real acknowledgment URL and live with `curl` on all three paths. The cause is the static fallback preserving the `ServeDir` 404 status.
2. **P1 — deployed backend identity is unverifiable.** Live `GET /health` returns `{"build":"unknown","status":"ok"}` rather than candidate SHA `ede437e` (or a full SHA). The browser assets are provably the candidate build, but the backend cannot be confirmed as the candidate, failing the backend health/build-identity acceptance check.

Do not release this candidate until both are corrected and reverified.

## Successful checks

- Clean checkout was at the requested SHA with no pre-existing changes.
- Fresh `npm ci --prefix frontend`: completed; 0 npm audit vulnerabilities.
- `npm test`: PASS — 2 Vitest tests and 4 Rust unit/integration tests.
- `npm run check`: PASS — TypeScript check and `cargo check`.
- `npm run build`: PASS — Vite production output in `frontend/dist`.
- `cargo build --release --locked`: PASS. Docker/Podman/Buildah are unavailable in this verifier, so the multi-stage container itself could not be executed.
- Full local release-server flow on a fresh data directory: setup with 1-hour retention; consented webhook recipient; priority service rule; HMAC-signed normalized booking; signed `booking.routed` webhook received; API acknowledgment; delivery board showed received/delivered/acknowledged. A browser opened the generated acknowledgement URL and rendered the handoff UI, but its document response was 404 (blocker above).
- Boundary/recovery paths: duplicate intake `200`; unmatched booking `202`/`unmatched`; altered HMAC `401`; blank service with valid HMAC `400`; recipient without consent `400`; 4th free recipient and rule each `402`; 20 failed login attempts `401`, 21st `429` with `Retry-After: 60`.
- Persistence/security: after restart, status remained initialized and login succeeded; password, customer name, email, and JSON metadata were absent from raw SQLite bytes; the encryption key was mode `0600`. Service name is intentionally indexed plaintext.
- Concurrency smoke: 100/100 concurrent local `/health` requests completed successfully at concurrency 25.
- Live candidate parity: built `index-CiD4Ob0V.js` and `index-DM4Ow59I.css` had exact SHA-256 matches to live assets (`b5e32bb4…68b19b7` and `03c5df87…7adbce`). Backend parity remains unprovable because of `build: unknown`.
- Browser QA (Playwright) at desktop 1440px and 390×844: normal load had no console/page errors, one h1/main/lang/title, no horizontal overflow, and first Tab focused the 3px-outline skip link. WCAG 2 A/AA/2.1 AA axe audit: 0 violations at both sizes. A context loaded with reduced motion had `prefers-reduced-motion` true and `.hero-art` computed `transform: none`. One expected `ERR_INTERNET_DISCONNECTED` console message occurred during the offline test only.
- PWA: service worker registered; an offline reload of cached shell showed the documented router-offline recovery state.
- Privacy/outbound: ordinary live landing-page requests stayed same-origin (no analytics, CDN fonts, or tracker); the only declared third-party endpoint is the Sociobot license path. CSP, `X-Content-Type-Options`, `X-Frame-Options`, and `Referrer-Policy` were present; HTML revalidates, API/health is `no-store`, hashed JS/CSS is one-year immutable.
- Budgets: initial JS 32,185 bytes (10,160 gzip), CSS 12,084 bytes (3,600 gzip), mobile hero 54,006 bytes, desktop hero 118,414 bytes — all within stated budgets. Two live Lighthouse mobile runs produced 89 and 100 performance (LCP 1.371/1.380 s, CLS 0, TBT 456/45 ms) and 100 accessibility/best-practices/SEO; the score variation is recorded rather than treated as a separate defect.

## Required recheck

After a fix, verify that the three public routes return HTTP 200, test a newly generated link through browser acknowledgment, and deploy with `BUILD_SHA=ede437eb1c8073493aacf93e81ea8f0f49832b8b` (or equivalent immutable identity) so `/health` proves the running backend. Re-run container build in an environment with Docker/BuildKit.
