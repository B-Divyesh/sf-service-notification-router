# Independent verification 2 — PASS

Verified 2026-08-28 against candidate `5988cdb59c71d70c0c7c9b1d37ce90fc2ef890c5` and production `https://service-notification-router.sociobot.in`.

## Verdict

**PASS.** The previous release blockers are resolved in both the candidate and the live deployment. No release-blocking defects were found.

## Clean build and automated checks

- Checkout began clean at the exact candidate SHA.
- `npm ci --prefix frontend` completed with 0 reported audit vulnerabilities.
- `npm test`: PASS — 2 Vitest tests and 6 Rust unit/integration tests.
- `npm run check`: PASS — TypeScript check and `cargo check`.
- `npm run build`: PASS — Vite produced `frontend/dist`.
- `BUILD_SHA=5988cdb59c71d70c0c7c9b1d37ce90fc2ef890c5 cargo test --all-targets --locked`: PASS.
- `BUILD_SHA=5988cdb59c71d70c0c7c9b1d37ce90fc2ef890c5 cargo build --release --locked`: PASS.
- Docker, Podman, and Buildah are not installed in this verifier, so the multi-stage image could not be built locally. This is not a deployment identity gap: the deployed health endpoint proves the exact candidate SHA.

## End-to-end backend evidence

On a fresh temporary data directory, using the optimized release binary:

- First-run setup returned `201`; consented webhook recipient and exact service rule each returned `201`.
- A real normalized `Dental cleaning` booking signed with HMAC-SHA256 returned `202`, was delivered to an operator-controlled webhook (`attempt_count: 1`, `status: delivered`), and its outgoing JSON contained the normalized booking, recipient, `booking.routed`, and a real acknowledgment URL.
- `GET /api/ack/<token>` and `POST /api/ack/<token>` each returned `200`; the notice became `acknowledged` with a timestamp.
- Duplicate signed intake returned `200` with `duplicate: true`; altered HMAC returned `401`; a correctly signed blank service returned `400`; a recipient without consent and a rule with an invalid match field returned `400`.
- The fourth free recipient and fourth free rule each returned `402 paid unlock required`.
- 100/100 concurrent local `/health` requests completed at concurrency 25.
- After process restart on the same data directory, `/api/status` returned `initialized: true` and login succeeded (`200`).
- Raw SQLite bytes did not contain the tested customer name or email; the separate encryption key was mode `0600`.

## Deployment parity, routes, privacy, and policies

- Live `GET /health` returned exactly `{"build":"5988cdb59c71d70c0c7c9b1d37ce90fc2ef890c5","status":"ok"}`.
- Fresh local production assets exactly match live SHA-256 values: `index-CiD4Ob0V.js` `b5e32bb4…68b19b7` and `index-DM4Ow59I.css` `03c5df87…7adbce`.
- Live `/`, `/privacy`, `/terms`, and `/ack/not-a-real-token` each returned HTTP `200` HTML. This closes the previous public-route/acknowledgment response-status blocker.
- Live HTML revalidates (`no-cache`), API and health use `no-store`, hashed JS/CSS use one-year `immutable`, other assets use one week, and the service worker uses `no-cache`.
- HTTPS is enforced by HTTP-to-HTTPS `301`. Responses include CSP, `nosniff`, `Referrer-Policy: same-origin`, and `X-Frame-Options: DENY`; no permissive CORS header was returned to an untrusted origin.
- Ordinary browser landing requests were same-origin only: no analytics, tracker, CDN font, or third-party script request. The source declares only operator-configured delivery endpoints and the Sociobot license endpoint.

## Browser, accessibility, PWA, and performance evidence

- Fresh Chromium checks at 1440×900 and 390×844: HTTP `200`, one `h1`, a `main`, `lang=en`, title, no horizontal overflow, no console/page errors, and the first Tab reaches the visible 3 px “Skip to main content” focus link.
- Fresh axe WCAG 2 A/AA and 2.1 AA audit reported **0 violations**, including 0 serious and 0 critical, at desktop and 390px.
- With reduced motion, the hero computed transform was `none`; normal motion retained the intended static tilt. No looping/flash behavior was observed.
- Service worker registered (`/sw.js`). After warming it, an offline mobile reload returned `200` from cache and rendered the documented offline/retry state. The sole `ERR_INTERNET_DISCONNECTED` console entry was expected for that deliberate offline request.
- Production sizes: JS 32,185 bytes (10,160 gzip), CSS 12,084 bytes (3,600 gzip), mobile hero 54,006 bytes, desktop hero 118,414 bytes — all within the specified budgets. The committed mobile Lighthouse evidence for these exact frontend asset hashes records Performance 100, Accessibility 100, Best Practices 100, SEO 100; LCP 1.504 s, CLS 0, TBT 0.

## Defects

None found at P0, P1, P2, or P3 severity.

## Note

An attempt to re-run the Lighthouse CLI in this container was blocked by its Chrome-launcher/CDP compatibility with the preinstalled Playwright Chromium; the browser, axe, bundle, and cached same-asset Lighthouse evidence above were used instead. Product code was not modified during verification.
