# Review 2 — Route booking notices

Reviewed 2026-09-06 against
<https://service-notification-router.sociobot.in>.

## Verdict: PASS

**PASS.** There are **0 findings** at every severity and **0 untested public
claims**. The deployed product completes the booking-notice routing job, and
the earlier mobile touch-target defect remains closed.

- Implementation candidate reviewed:
  `122604d8c1a63d7f5082b791b46ea96e492a5d4a`
- Documentation baseline reviewed:
  `10ebb30d0f28e2a23ecccb7bde620fd5996b3ff8`
- Live `/health` build:
  `a92cc9efd0b18b063bb9dc6a6373232a61f13e32`
- The diff from the implementation candidate to the documentation baseline
  contains only `.factory/handoff.md` and `.factory/verification-4.md`.
  There is no later product-code change.
- A clean build's JavaScript SHA-256 is
  `ebecfab94c3c96d20c0fabea641a98f1227d958695ea5b689b65f77446702a92`;
  its CSS SHA-256 is
  `0f97c22bfc6a7a864bf762f3290f8fe22e0d5930c71b6509becc7156a495abdc`.
  Both exactly match the deployed assets.

The repository report `.factory/verification-4.md` was read in full. The
separately named `factory-evidence/service-notification-router-verify-4/qa-report.md`
file was not mounted in this disposable workspace. This review does not rely
on that missing copy: all declared claims and the required live paths were
run again.

No real workspace was initialized or changed. Live `GET /api/status` returned
`{"initialized":false}` before and after the demo flow.

## First screen and sample

Fresh Chromium contexts at 390 × 844 and 1440 × 900 showed, before scrolling:

- job: **Route each booking to its coordinator**;
- audience: micro-clinics, studios, and multi-service offices; and
- first action: **Try it with sample data**.

The phone action measured 358 × 46 CSS px at y=459.78, wholly within the
844-px viewport. The desktop action measured 211.61 × 46 CSS px at y=516.28,
wholly within the 900-px viewport. Neither initial load logged a console error.

One click opened `/demo`, titled **Demo — Service Notification Router**. The
screen showed the persistent **Demo — sample data, nothing is saved** label and
three realistic results: Dental cleaning, Prenatal consultation, and New
patient assessment. **Reset demo** restored all three. **Start for real**
deleted the demo workspace, cleared the
`demo:service-notification-router:workspace` session key, returned to `/`, and
left the real workspace uninitialized.

The complete API set observed during that path was:

```text
GET /api/status
POST /api/demo
POST /api/demo/<workspace>/reset
DELETE /api/demo/<workspace>
```

All requests stayed on the product origin. The demo never called a real
workspace write endpoint.

## Clean checkout and declared claims

The checkout was clean before installation. `npm ci --prefix frontend`
installed 60 packages and reported zero vulnerabilities.

| Command | Result |
| --- | --- |
| `npm run check` | PASS |
| `npm run build` | PASS; created `frontend/dist/` |
| `npm test` | PASS; 2 Vitest, 10 Rust, and 21 Playwright tests |
| `cargo test --all-targets --locked` | PASS; 10 tests |
| `cargo clippy --all-targets --locked -- -D warnings` | PASS |

Every command in `.factory/claims.json` was then invoked separately with its
declared `@claim:` selector. All 18 passed:

| Claim | Result |
| --- | --- |
| `job-and-audience` | PASS |
| `demo-sample` | PASS |
| `demo-isolation` | PASS |
| `setup-protection` | PASS |
| `signed-intake` | PASS |
| `routing-rules` | PASS |
| `delivery-ack` | PASS |
| `delivery-retry` | PASS |
| `encrypted-retention` | PASS |
| `free-allowance` | PASS |
| `free-paid-limits` | PASS |
| `request-limits` | PASS |
| `offline-recovery` | PASS |
| `privacy-network` | PASS |
| `license-recheck` | PASS |
| `health-build` | PASS |
| `scope-boundaries` | PASS |
| `runtime-persistence` | PASS |

The landing page, legal pages, demo, settings-facing claims, README, and
`.factory/copy-audit.md` were cross-checked against the registry. No missing,
false, incomplete, unlisted, or untested public claim was found. The brief
calls for deterministic service/provider routing; an AI step would not improve
that core job. No brief-implied import, export, or sync gap was found.

## Live routes, accessibility, privacy, and recovery

- `/opt/fleet/lib/verify-url.sh` passed with HTTP 200, `lang=en`, one `h1`, a
  `main`, image alt text, labelled buttons, and no ordinary-load console error.
- Fresh Playwright axe scans on `/`, `/demo`, `/privacy`, and `/terms` at both
  390 × 844 and 1440 × 900 found zero violations.
- Every visible link, button, input, select, textarea, and button-role control
  on those routes measured at least 44 × 44 CSS px at both sizes. On phone,
  **Read the privacy policy →** measured 185.86 × 44 px and the footer
  **Terms** link measured 44 × 44 px. This directly closes V3-01.
- The first Tab focused the visible skip link. Enter focused `main`. After a
  settled route change, Privacy focused its `h1`; browser Back focused the
  landing `h1`. Focus rings remain visible.
- With reduced motion enabled, `.hero-art` computed to `transform: none`.
- After warming the service worker, an offline phone reload returned the cached
  shell with **The router is offline** and **Try again**.
- `/`, `/demo`, `/privacy`, `/terms`, `/login`, `/setup`, `robots.txt`, and
  `sitemap.xml` returned 200. Every same-origin link discovered on the four
  public pages returned 200.
- `/definitely-missing` deliberately returned HTTP 404 with title **Page not
  found — Service Notification Router** and `h1` **This route does not exist**.
  That designed 404 is expected, not a defect.
- Route titles are distinct and correct. Canonical, description, Open Graph,
  Twitter card, social image, Apple-touch icon, robots, and sitemap metadata
  are present.
- Landing and demo requests were same-origin only. No analytics, tracker, CDN
  script, or third-party font request occurred.
- Responses include a restrictive CSP, `nosniff`, same-origin referrer policy,
  frame denial, and permissions policy.

Fresh live Lighthouse results were Performance 100, Accessibility 100, Best
Practices 100, and SEO 100. LCP was 1.201 s, CLS was 0, and total blocking time
was 12.5 ms. The built JavaScript is 39,104 bytes raw and 10,986 bytes gzip;
CSS is 14,202 bytes raw and 4,046 bytes gzip. The phone hero is 54,006 bytes.
All required budgets pass.

## Backend paths and boundaries

- The live protected workspace stayed uninitialized. The setup-protection
  claim proves an incorrect private setup proof receives 403 and cannot claim
  an empty router.
- The demo-isolation test proves sample state uses an in-memory workspace and
  does not read or write the real SQLite workspace.
- Normal routing passed through exact service and provider rules to one
  selected recipient. Signed intake, public HTTPS acknowledgment, and retry
  outcomes passed.
- Invalid and changed signatures, invalid setup proof, invalid booking input,
  unavailable delivery, and invalid license verdicts have tested outcomes.
- Boundary tests passed for the fourth free recipient and fourth free rule.
  Encryption-at-rest inspection and expired-payload purge passed.
- Recovery passed for failed-delivery retry, offline shell reload, and a full
  process restart. The runtime-persistence claim starts with only `PORT`,
  creates protected configuration, and preserves SQLite state across restart.
- Live `/health` returned HTTP 200 with the build identity listed above.
- For forwarded client `198.51.100.240`, requests 1 through 120 to
  `/api/status` returned 200. Request 121 returned 429 with
  `Retry-After: 60`. A fresh forwarded client immediately returned 200.

These checks cover the product's single real workspace, its isolated demo
workspace, restart persistence, local SQLite storage, request boundaries, and
normal, invalid, limit, and recovery paths. No other product, database,
deployment, setting, or secret was accessed.

## Earlier finding disposition

| Earlier item | Current disposition |
| --- | --- |
| F01 public setup takeover | Closed. A wrong setup proof is rejected, and live remains uninitialized. |
| F02 missing isolated demo | Closed. The one-click sample, label, reset, exit, namespace, and unchanged real status passed. |
| F03 missing claim contract | Closed. All 18 declared commands passed separately; no unlisted claim was found. |
| F04 localhost acknowledgment origin | Closed. The HTTPS acknowledgment and PORT-only runtime claims pass. |
| F05 limiter scope and forwarded IP | Closed. Live 120/121 enforcement, `Retry-After`, and independent-client allowance passed. |
| F06 incomplete phone first screen | Closed. Job, audience, and action are visible before scrolling. |
| F07 routes, titles, focus, announcements | Closed. Real paths, titles, settled route focus, and Back focus passed. |
| F08 broken 404 page | Closed. Unknown routes return the intentional designed 404. |
| F09 keyboard and touch affordances | Closed. Skip/focus checks pass and all measured targets meet 44 × 44 px. |
| F10 incomplete landing structure | Closed. First screen, preview, three steps, privacy/non-goals, price, and footer are present. |
| F11 Docker portability | Closed by the unchanged built deployment and PORT-only runtime claim. No local Docker daemon was required by a declared command. |
| F12 missing discovery metadata | Closed. Required metadata, social image, icons, robots, and sitemap are live. |
| F13 missing plain-words audit | Closed. The audit exists, copy is direct, and no unregistered claim was found. |
| F14 missing startup configuration log | Closed by the PORT-only runtime-persistence claim and startup assertions. |
| V3-01 undersized Privacy and Terms links | Closed. They measure 185.86 × 44 px and 44 × 44 px on phone; no visible control fails at either size. |
| Earlier public-route and unknown-build findings | Closed. Routes work and `/health` identifies the deployed source build. |

## Known external dependencies

Billing registration remains pending for the stated $39 USD one-time offer, so
the product does not claim checkout is available. Email delivery requires an
operator-supplied SMTP relay; webhook delivery and the free routing flow work
without it. These disclosed dependencies are not defects.

## Findings

None at P0, P1, P2, or P3.
