# Handoff — Service Notification Router repair 2

## Status

Repair complete on 6 September 2026. All F01–F14 findings from
`.factory/review-1.md` are closed in implementation
`a2b64606a338c80a0dd371586fa8942b427da024`. The same commit contains the
verified README, design, demo, copy-audit, claims, and catalog documentation.
The final handoff commit is report-only and was not rebuilt or redeployed.

Live URL: <https://service-notification-router.sociobot.in>

- Live health build: `a2b64606a338c80a0dd371586fa8942b427da024`
- Image: `sociobotregistry.azurecr.io/sf-service-notification-router@sha256:d4323e3fc2fe028bad2e29721ccd6e98910da5f8adbb2a465d885bcbc033d9e9`
- Revision: `sf-service-notification-router--0000009`
- State: private durable share mounted at `/data`, one active replica
- Current workspace: deliberately uninitialized and protected by the private
  generated setup code

## What changed

- Protected first setup with a generated CSPRNG proof stored on the private data
  mount. The setup API uses a constant-time check and never returns the proof.
- Added an in-memory, 24-hour demo workspace with three realistic booking
  outcomes, a persistent sample label, reset, and explicit teardown.
- Added 18 declared public claims and one outcome test per claim. The old 37
  unchecked statements were either consolidated into those observable outcomes
  or removed when they exposed unsupported implementation details.
- Made every non-health endpoint rate limited by the first valid forwarded IP.
  Read, write, intake, and authentication classes all return `429` with
  `Retry-After` when exhausted.
- Changed the default public acknowledgment origin from localhost to the product
  HTTPS origin.
- Rebuilt the public UI around the researched job: route existing booking notices
  to one responsible coordinator. Added real routes, route titles, focus and live
  announcements, responsive first actions, touch targets, sample preview,
  privacy/non-goals, pricing, legal pages, and a designed 404.
- Added canonical/Open Graph/Twitter metadata, original social and touch assets,
  `robots.txt`, `sitemap.xml`, a manifest, security headers, and an offline retry
  state.
- Updated the portable multi-stage Dockerfile to use `rust:1-alpine`, a default
  `BUILD_SHA=dev`, a non-root runtime, and a build-identity health response.
- Added structured startup reporting of generated versus supplied configuration
  without secret values.
- Adapted SQLite to the fleet's Azure Files behavior. The runtime uses one pool
  connection and SQLite's single-process VFS, migrates synchronously, and stores
  state in `/data/router.storage.sqlite3`. It chooses any non-empty earlier
  database first. This requires the enforced one-process, one-replica deployment.

## Earlier finding disposition

| Finding | Result and evidence |
| --- | --- |
| F01 public setup takeover | Closed. A false proof returns 403 live; status remains uninitialized. |
| F02 missing demo | Closed. `/demo` creates three sample outcomes, resets them, keeps the sample label visible, deletes on exit, and leaves real state unchanged. |
| F03 missing claim contract | Closed. `.factory/claims.json` has 18 claims; all 18 commands pass independently from a clean clone. |
| F04 localhost acknowledgments | Closed. PORT-only startup defaults to the product HTTPS origin; the acknowledgment outcome test opens the generated URL. |
| F05 incomplete rate limiting | Closed. Live requests 1–120 returned 200, request 121 returned 429 with `Retry-After: 60`, and another forwarded client returned 200. |
| F06 phone first screen | Closed. At 390×844 the job, named audience, and sample action are visible; the action bottom is 506 px. |
| F07 routing, titles, focus | Closed. Real history URLs, route-specific titles, back/forward handling, heading focus, and polite announcements are implemented and exercised. |
| F08 broken 404 | Closed. An unknown route intentionally returns HTTP 404 with its own title, heading, navigation, and footer. |
| F09 keyboard and touch | Closed. Skip activation focuses `main`; route changes focus `h1`; interactive targets are at least 44 px and have visible focus. |
| F10 incomplete landing structure | Closed. The page contains the standard first screen, real preview, three-step explanation, privacy/non-goals, exact offer, and full footer. |
| F11 Docker contract | Closed. The exact Dockerfile built in ACR and runs non-root with the required Rust tag, build-arg default, port, health check, and durable path. |
| F12 missing metadata | Closed. Discovery files, route metadata, social image, SVG icon, and Apple touch icon are live. |
| F13 copy audit and metaphors | Closed. Public headings use plain task language; `.factory/copy-audit.md` has no over-limit or banned-word rows. |
| F14 startup config log | Closed. Startup names supplied/generated/persisted sources without logging values. |

## Verification

From a fresh clone at the implementation SHA:

| Command | Result |
| --- | --- |
| `npm ci --prefix frontend` | PASS; 60 packages, 0 vulnerabilities |
| `npm run check` | PASS |
| `npm run build` | PASS; `frontend/dist/` produced |
| `npm test` | PASS; 2 Vitest, 10 Rust, 21 Playwright tests |
| every command in `.factory/claims.json` | PASS; 18 of 18 run separately |
| `cargo test --all-targets --locked` | PASS; 10 tests |
| `cargo clippy --all-targets --locked -- -D warnings` | PASS |
| ACR build of the root Dockerfile | PASS; immutable digest recorded above |

Live verification:

- `/opt/fleet/lib/verify-url.sh`: 200, one `h1`, `lang=en`, `main`, no missing
  alt text, unlabeled buttons, or ordinary-load console errors.
- Fresh 1440×900 and 390×844 contexts: sample entry, three populated outcomes,
  persistent label, reset, exit, and unchanged real status all passed.
- Axe on `/`, `/demo`, `/privacy`, and `/terms`: zero serious or critical
  violations.
- All discovered internal links returned 200. The deliberate unknown URL
  returned the expected designed 404.
- Reduced-motion context: no hero animation or transform.
- Lighthouse mobile: Performance 100, Accessibility 100, Best Practices 100,
  SEO 100; LCP 1.350 s, CLS 0, TBT 27 ms.
- Initial transfer: 11.09 KB JavaScript and 4.10 KB CSS. The mobile hero is
  53 KB and desktop hero is 116 KB.
- Restart: the sole revision restarted successfully, reopened the 65,536-byte
  database, reused its generated key and setup proof, and returned status 200.
- Load smoke: 100 concurrent live health requests returned 100 HTTP 200
  responses in 786 ms.

Evidence is under `/work/.evidence/live-final/`, with the catalog description at
`/work/.evidence/catalog-description.txt` and paid-offer metadata at
`/work/.evidence/billing-offer.json`.

## Known external dependencies and operating notes

- New checkout is not registered yet. The $39 USD one-time unlimited-recipient
  and unlimited-rule offer remains in product copy and terms. The free allowance
  is fully usable. Billing metadata is ready for the separate registration
  operator; no provider credential or fake checkout is included.
- Email delivery requires an operator-provided SMTP relay. Without it, email
  notices remain failed/retryable with a clear setup notice. Webhook delivery is
  complete.
- Azure Files does not preserve POSIX `0600` modes. Local files are restricted to
  `0600`; production relies on the product-private share and mount boundary.
- Docker was unavailable in the worker shell, so a local Docker daemon run was
  not possible. The factory ACR built the same Dockerfile and the resulting image
  passed the live container and restart checks.
- Do not increase the replica limit above one while SQLite uses the private
  Azure Files mount.
