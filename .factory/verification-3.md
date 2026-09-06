# Verification 3 — Route booking notices

Verified 2026-09-06 against the live product at
<https://service-notification-router.sociobot.in>.

## Verdict: FAIL

There is **1 P2 finding** and **0 untested public claims**. The product cannot
receive a PASS until every interactive mobile target meets the required 44 × 44
CSS-pixel minimum.

- Implementation candidate reviewed: `a2b64606a338c80a0dd371586fa8942b427da024`
- Documentation commit reviewed: `2bbb596d4bd2cc8aedf204835d1484ca92ebd861`
- Live `/health` build: `2bbb596d4bd2cc8aedf204835d1484ca92ebd861`
- Candidate comparison: the implementation-to-documentation diff changes only
  `.factory/handoff.md`. A clean build from the documentation commit had the
  exact same hashes as live: JavaScript `ebecfab94c3c96d20c0fabea641a98f1227d958695ea5b689b65f77446702a92`
  and CSS `e58ce12c89f5a420506d24b23f6b24b296978aa4e023509a0f82dea400a90d8a`.

No live real workspace was changed. Demo workspaces were explicitly deleted on
exit; the real status was `{"initialized":false}` before and after.

## Finding

### V3-01 — P2 — Some live mobile links still miss the 44 × 44 touch target minimum

At a fresh 390 × 844 phone viewport, the visible landing-page link **Read the
privacy policy →** measures 185.86 × 17 CSS px. The footer **Terms** link
measures 38.13 × 44 CSS px. Both are below the required 44 × 44 target size.
This is a real accessibility baseline failure even though axe reports no
serious or critical violation; axe does not make these small link boxes pass
the product contract.

Add enough visible/pointer padding or make these links block-level controls
without changing their label or keyboard behavior, then re-run the phone
audit.

## First-screen and demo checks

Fresh desktop (1440 × 900) and phone (390 × 844) contexts loaded the landing
page without ordinary-load console or page errors. Before scrolling, each
showed:

- job: **Route each booking to its coordinator**;
- audience: micro-clinics, studios, and multi-service offices; and
- first action: **Try it with sample data** (its phone bottom edge was 505.78
  px, inside the 844-px viewport).

Using that one-click action opened `/demo`, titled **Demo — Service Notification
Router**, with all three realistic outcomes: Dental cleaning, Prenatal
consultation, and New patient assessment. The persistent **Demo — sample data,
nothing is saved** label was present. Reset restored all three outcomes.
Start for real returned to `/`, removed the `demo:service-notification-router:workspace`
session key, and used only these demo endpoints:

```
POST /api/demo
POST /api/demo/<workspace>/reset
DELETE /api/demo/<workspace>
```

## Claims and clean-checkout commands

A fresh clone began at `2bbb596d4bd2cc8aedf204835d1484ca92ebd861` with a
clean worktree. `npm ci --prefix frontend` installed 60 packages and reported
zero vulnerabilities.

| Command | Result |
| --- | --- |
| `npm run check` | PASS |
| `npm run build` | PASS; `frontend/dist/` produced |
| `npm test` | PASS; 2 Vitest, 10 Rust, and 21 Playwright tests |
| `cargo test --all-targets --locked` | PASS; 10 tests |
| `cargo clippy --all-targets --locked -- -D warnings` | PASS |
| every command declared in `.factory/claims.json` | PASS individually; 18 of 18 |

Each declared claim command was run independently from that clone with its
listed `@claim:` selector: `job-and-audience`, `demo-sample`, `demo-isolation`,
`setup-protection`, `signed-intake`, `routing-rules`, `delivery-ack`,
`delivery-retry`, `encrypted-retention`, `free-allowance`, `free-paid-limits`,
`request-limits`, `offline-recovery`, `privacy-network`, `license-recheck`,
`health-build`, `scope-boundaries`, and `runtime-persistence`. There are no
missing or untested declared public claims, and no unlisted claim-like landing
or README statement was found.

The documented Docker command could not be run locally because no Docker client
or daemon is installed in this worker. This is not a public claim command; the
unchanged Dockerfile is covered by the earlier recorded ACR build and the live
container is serving the reviewed assets and health response.

## Live functional, safety, and accessibility evidence

- `/opt/fleet/lib/verify-url.sh https://service-notification-router.sociobot.in /work/.evidence`
  passed: HTTP 200, title, `lang=en`, one `h1`, `main`, no missing image alt
  text, no unlabeled buttons, and no ordinary-load console errors.
- Axe with Playwright on `/`, `/demo`, `/privacy`, and `/terms` found zero
  serious or critical violations. This does not supersede V3-01.
- Keyboard checks passed: the first Tab reaches the visible skip link, activating
  it focuses `main`, and navigation to Privacy plus browser Back both focus the
  new route's `h1`.
- A reduced-motion context computed `transform: none` for `.hero-art`.
- A warmed service worker served an offline reload with **The router is offline**
  and **Try again**. The only console error in that intentionally offline test
  was the expected `ERR_INTERNET_DISCONNECTED` request failure.
- Route titles rendered as **Privacy — Service Notification Router**, **Terms —
  Service Notification Router**, and **Demo — Service Notification Router**.
  Internal landing links returned 200. `/404` and `/definitely-missing`
  deliberately returned HTTP 404 with a designed page, title, `main`, and `h1`;
  those expected 404 statuses are not defects.
- `robots.txt`, `sitemap.xml`, canonical, description, Open Graph, Twitter, and
  Apple-touch metadata are live. The root response sends CSP, `nosniff`,
  same-origin referrer policy, frame denial, and a restrictive permissions policy.
- Landing and demo had no third-party scripts, fonts, or tracker requests.

## Backend evidence

- A live protected empty workspace returned `{"initialized":false}`. The
  clean-server `setup-protection` claim confirmed an invalid proof returns 403
  and leaves it unclaimed.
- Normal, invalid, boundary, and recovery flows are exercised by the independent
  signed-intake, routing, delivery acknowledgment, retry, encryption/purge,
  free-limit, license, and restart-persistence claim commands. They all passed.
- Live request allowances were independently checked with forwarded client
  `198.51.100.83`: requests 1–120 to `/api/status` returned 200; request 121
  returned 429 with `Retry-After: 60`; a separate forwarded client returned 200.
- Live `/health` returned HTTP 200 with the reviewed documentation build SHA.
  The restart-persistence claim passed with only `PORT`, generated protected
  setup material, a preserved SQLite workspace, and a restarted process.

## Earlier finding disposition

| Earlier item | Current disposition |
| --- | --- |
| F01 public setup takeover | Closed. Invalid setup proof is rejected by the dedicated claim; live remains uninitialized. |
| F02 missing demo | Closed. Fresh one-click sample, persistent label, reset, exit, API isolation, and unchanged real state were independently checked. |
| F03 absent claim contract | Closed. All 18 declared claims passed independently from a clean clone. |
| F04 localhost acknowledgments | Closed by the passing acknowledgment outcome and PORT-only runtime claim. |
| F05 limiter scope/forwarded IP | Closed. Live 120/121 allowance, 429/Retry-After, and an independent second client passed. |
| F06 first phone screen | Closed. Job, audience, and first action were visible before scrolling. |
| F07 routes, titles, focus | Closed. Real paths, rendered titles, route focus, and Back focus passed. |
| F08 broken 404 body | Closed. The intentional HTTP 404 now has its own designed page. |
| F09 keyboard and touch | **Not fully closed.** Skip and route focus are fixed, but V3-01 shows two remaining undersized mobile links. |
| F10 landing structure | Closed. The live landing has first screen, populated preview, three steps, privacy/non-goals, price, and footer. |
| F11 Docker portability | Closed in the unchanged candidate according to the recorded ACR build; local container execution remains unavailable because Docker is absent. |
| F12 metadata/discovery | Closed. Required metadata, social image, icons, robots, and sitemap are live. |
| F13 copy audit/plain words | Closed. `.factory/copy-audit.md` has no over-limit or banned-word row; the first screen is plain and specific. |
| F14 startup configuration log | Closed by the passing PORT-only runtime-persistence claim. |
| Verification 1 public routes and unknown health build | Closed. Public routes return 200, designed unknown routes deliberately return 404, and health identifies the deployed source commit. |

## Next step

Fix V3-01, deploy the resulting implementation, and repeat the live 390 × 844
touch-target audit. Until then the unambiguous verdict remains **FAIL**.
