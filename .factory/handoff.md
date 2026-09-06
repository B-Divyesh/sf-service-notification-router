# Handoff — Route booking notices

## Status

Repair 3 is complete. The mobile touch-target finding V3-01 is closed in
implementation `122604d8c1a63d7f5082b791b46ea96e492a5d4a`, deployed on 6
September 2026.

- Live URL: <https://service-notification-router.sociobot.in>
- Live health build: `122604d8c1a63d7f5082b791b46ea96e492a5d4a`
- Image: `sociobotregistry.azurecr.io/sf-service-notification-router@sha256:22053367556968e4a9063443d1d318852e64786a42d7199acc603dc3bbf47fe7`
- Active revision: `sf-service-notification-router--0000011`
- Runtime: one replica with the existing product-private Azure Files share at
  `/data`; deployment preserved the existing environment, secrets, probes, and
  volume mount.

## What changed

- Made every link a real 44 × 44 px minimum control. This fixes the landing
  **Read the privacy policy →** target, the footer **Terms** target, and other
  public text links that shared the same underlying style.
- Made the consent checkbox a 44 × 44 px control as well.
- Extended the browser regression from footer height alone to every visible
  link and button on `/`, `/demo`, `/privacy`, and `/terms` at 390 × 844.
- Separated the bounded public-document/asset allowance (600/minute) from the
  unchanged API read allowance (120/minute). Repeated ordinary page loads can
  no longer consume a router API user's allowance; API 120/121 and
  `Retry-After` behavior remains tested.

## Verification

From the documented clean setup, `npm ci --prefix frontend` installed 60
packages with zero reported vulnerabilities. The following passed:

| Command | Result |
| --- | --- |
| `npm run check` | PASS |
| `npm run build` | PASS; `frontend/dist/` produced |
| `npm test` | PASS; 2 Vitest, 10 Rust, 21 Playwright tests |
| `cargo test --all-targets --locked` | PASS; 10 tests |
| `cargo clippy --all-targets --locked -- -D warnings` | PASS |
| each command in `.factory/claims.json` | PASS; all 18 run independently |

The live `verify-url.sh` check passed: HTTP 200, title, `lang=en`, one `h1`,
`main`, image alt text, labeled buttons, and no ordinary-load console errors.
Fresh live axe scans on `/`, `/demo`, `/privacy`, and `/terms` had zero serious
or critical findings.

Fresh desktop (1440 × 900) and phone (390 × 844) pages both show, before
scrolling:

- job: **Route each booking to its coordinator**;
- audience: micro-clinics, studios, and multi-service offices; and
- first action: **Try it with sample data**. Its phone bottom edge is 505.78
  px, within the 844 px viewport.

At 390 × 844 the repaired live targets measure:

| Control | CSS px |
| --- | ---: |
| Read the privacy policy → | 185.86 × 44 |
| Footer Terms | 44 × 44 |
| every other visible link or button on the four public routes | at least 44 × 44 |

The live demo opened three realistic outcomes (Dental cleaning, Prenatal
consultation, and New patient assessment), kept **Demo — sample data, nothing
is saved** visible, and reset them. Exiting sent only demo API calls, removed
the demo session key, and left the real status `{"initialized":false}` before
and after.

Live keyboard checks confirm the phone skip link focuses `main`; desktop
Privacy and browser Back focus the new route heading. Reduced motion computes
`transform: none` for `.hero-art`. A warmed service worker serves the offline
retry screen. The designed unknown route still returns deliberate HTTP 404.
The live forwarded-client check returned 200 for requests 1–120 to
`/api/status`, 429 plus `Retry-After: 60` for request 121, and 200 for an
independent forwarded client.

## Earlier findings

V3-01 is closed by the live measurements above. The earlier F01–F14 and the
first verification's route/health findings remain closed: setup proof, demo
isolation, declared claims, acknowledgment origin, forwarded-IP rate limits,
phone first screen, real routes/focus, designed 404, landing structure,
portable Dockerfile, metadata, copy audit, and startup configuration all
continue to pass the full suite and the relevant live checks.

## Operating notes and known external dependencies

- The free core remains fully usable. The advertised $39 USD one-time offer
  for unlimited recipients and routing rules still awaits separate billing
  registration. Its exact public metadata is at
  `/work/.evidence/billing-offer.json`; no checkout is claimed as available.
- Email delivery needs an operator-supplied SMTP relay. Webhook delivery works
  without one; failed email notices remain retryable.
- Keep the deployment at one replica while the SQLite data directory is on
  Azure Files. Do not remove `/data` during redeploys.
- The local worker has no Docker daemon. The committed Dockerfile instead had
  a successful ACR build for the deployed immutable image above.
- `.factory/catalog-description.txt` is a verb-first 86-byte description and
  has been copied to `/work/.evidence/catalog-description.txt`.
