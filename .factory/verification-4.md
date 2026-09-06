# Verification 4 — Route booking notices

Verified 2026-09-06 against the live product at
<https://service-notification-router.sociobot.in>.

## Verdict: PASS

**PASS.** There are **0 findings** at every severity and **0 untested public
claims**. The earlier mobile touch-target finding is fixed in the deployed
implementation.

- Implementation candidate reviewed:
  `122604d8c1a63d7f5082b791b46ea96e492a5d4a`
- Documentation commit reviewed:
  `a92cc9efd0b18b063bb9dc6a6373232a61f13e32`
- Live `/health` build:
  `a92cc9efd0b18b063bb9dc6a6373232a61f13e32`
- Candidate comparison: `122604d8..a92cc9e` changes only
  `.factory/handoff.md`; it contains no product-code change.
- Live parity: clean-build JavaScript
  `ebecfab94c3c96d20c0fabea641a98f1227d958695ea5b689b65f77446702a92`
  and CSS
  `0f97c22bfc6a7a864bf762f3290f8fe22e0d5930c71b6509becc7156a495abdc`
  exactly match the deployed assets.

No real workspace was initialized or changed. Its status was
`{"initialized":false}` before and after the live demo check.

## First screen and sample

Fresh browser contexts at desktop 1440 × 900 and phone 390 × 844 both showed,
before scrolling:

- job: **Route each booking to its coordinator**;
- audience: micro-clinics, studios, and multi-service offices; and
- first action: **Try it with sample data**.

The phone action measured 358 × 46 CSS px at y=459.78, wholly within the
844-px viewport. The desktop action measured 211.61 × 46 CSS px.

One click opened `/demo`, titled **Demo — Service Notification Router**. It
showed the persistent **Demo — sample data, nothing is saved** label and all
three realistic outcomes: Dental cleaning, Prenatal consultation, and New
patient assessment. Reset restored all three. Start for real deleted the demo
workspace, removed its session key, returned to `/`, and left the real status
uninitialized. The only API requests in that flow were:

```
GET /api/status
POST /api/demo
POST /api/demo/<workspace>/reset
DELETE /api/demo/<workspace>
```

## Fresh checkout and claims

The checkout began clean at `a92cc9e`. `npm ci --prefix frontend` installed 60
packages and reported zero vulnerabilities. These commands passed:

| Command | Result |
| --- | --- |
| `npm run check` | PASS |
| `npm run build` | PASS; created `frontend/dist/` |
| `npm test` | PASS; 2 Vitest, 10 Rust, and 21 Playwright tests |
| `cargo test --all-targets --locked` | PASS; 10 tests |
| `cargo clippy --all-targets --locked -- -D warnings` | PASS |

Every command declared in `.factory/claims.json` was invoked independently
from that clean setup and passed: `job-and-audience`, `demo-sample`,
`demo-isolation`, `setup-protection`, `signed-intake`, `routing-rules`,
`delivery-ack`, `delivery-retry`, `encrypted-retention`, `free-allowance`,
`free-paid-limits`, `request-limits`, `offline-recovery`, `privacy-network`,
`license-recheck`, `health-build`, `scope-boundaries`, and
`runtime-persistence`.

This is 18 of 18 declared claims. The landing page and README were also
cross-checked; no unlisted claim-like public promise was found.

## Live browser, accessibility, and routes

- `/opt/fleet/lib/verify-url.sh` passed: HTTP 200, title, `lang=en`, one
  `h1`, `main`, image alt text, labelled buttons, and no ordinary-load console
  errors.
- Fresh Playwright axe scans on `/`, `/demo`, `/privacy`, and `/terms` found
  zero violations, including zero serious and zero critical violations.
- Every visible link and button on those four routes measured at least 44 × 44
  CSS px at both 390 × 844 and 1440 × 900. In particular, the formerly failing
  privacy-policy link is 185.86 × 44 px and the footer Terms control is 44 × 44
  px on phone. This closes V3-01.
- Keyboard checks passed: Tab reaches the visible skip link; Enter moves focus
  to `main`; Privacy navigation focuses its `h1`; browser Back focuses the
  landing `h1`.
- Reduced-motion mode gives `.hero-art` a computed `transform: none`.
- A warmed service worker served an offline reload with **The router is
  offline** and **Try again**.
- `/privacy`, `/terms`, `/demo`, `/login`, `/setup`, and all discovered
  same-origin public links returned HTTP 200. `/definitely-missing` returned
  the expected HTTP 404 with title **Page not found — Service Notification
  Router** and `h1` **This route does not exist**; that deliberate 404 is not a
  defect.
- Route titles are correct: landing **Service Notification Router — Route
  booking notices**, plus the distinct Demo, Privacy, and Terms titles.
- Landing and demo used no third-party scripts, trackers, or CDN fonts. The
  live response includes restrictive CSP, `nosniff`, same-origin referrer
  policy, frame denial, and permissions policy. Robots, sitemap, canonical,
  Open Graph, Twitter, and Apple-touch metadata are present.

## Backend checks

- The live protected real workspace remained uninitialized. The independently
  passing setup-protection claim proves a wrong setup proof receives 403 and
  cannot take it over.
- Normal, invalid, boundary, and recovery paths are covered by the passing
  signed intake, routing priority, acknowledgment, delivery-retry,
  encryption/purge, free-limit, license, and restart-persistence claims.
  The restart claim starts with only `PORT`, validates generated protected
  setup material, then proves SQLite state survives a restart. Demo isolation
  separately proves the sample does not use the real SQLite workspace.
- Live health returned HTTP 200 with the deployed documentation SHA above.
- With forwarded client `198.51.100.212`, requests 1 through 120 to
  `/api/status` returned 200; request 121 returned 429 and `Retry-After: 60`.
  A new forwarded client, `198.51.100.213`, immediately returned 200.

## Earlier findings

| Earlier item | Current disposition |
| --- | --- |
| V3-01, undersized privacy and Terms links | Closed. All visible controls meet 44 × 44 px on phone and desktop. |
| F01 public setup takeover | Closed. Setup proof claim passes; live real workspace was not initialized. |
| F02 demo and F03 claim contract | Closed. Isolated sample/reset/exit works and all 18 claims pass independently. |
| F04 acknowledgment origin | Closed by the acknowledgment and PORT-only runtime claims. |
| F05 limiter/forwarded IP | Closed by the live 120/121 check and independent-client check. |
| F06 first screen, F07 routes/focus, F08 404, F09 keyboard | Closed by fresh desktop and phone browser evidence above. |
| F10 structure, F12 metadata, F13 plain copy | Closed by the live landing, metadata, and checked copy audit. |
| F11 Docker portability and F14 startup log | Closed by the unchanged candidate's recorded build and passing PORT-only runtime-persistence claim. Docker is unavailable locally, but this is not a declared command failure. |
| Earlier route/unknown-build verification findings | Closed: public paths work and live health identifies the deployed source commit. |

## Known external dependencies

Billing registration remains pending for the advertised one-time offer, so
checkout is not represented as available. Email delivery requires an
operator-supplied SMTP relay; webhook delivery works without it. Neither item
is a defect in the verified free routing flow.
