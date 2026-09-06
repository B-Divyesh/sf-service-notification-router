# Review 1 — Service Notification Router

## Verdict: FAIL

Reviewed on 2026-09-06. There are **14 findings**: 5 P1, 6 P2, and 3 P3. There are **37 public claims without the required declared claim tests**. PASS requires zero findings and zero untested claims.

- Live URL: <https://service-notification-router.sociobot.in>
- Implementation candidate: `5988cdb59c71d70c0c7c9b1d37ce90fc2ef890c5`
- Documentation commit reviewed: `7104598628309cbd7d1735d6270d3637253d9d90`
- Live `/health`: `5988cdb59c71d70c0c7c9b1d37ce90fc2ef890c5`
- Candidate parity: the clean build's JS and CSS SHA-256 values exactly matched the live files. There are no product-code changes between the implementation candidate and documentation commit.

No live data was changed. Live checks used document/API GET requests only. Setup, routing, delivery, boundary, and restart tests used isolated temporary local data and an operator-controlled local webhook receiver.

## Findings

### F01 — P1 — The public deployment can be claimed by its first visitor

Live `GET /api/status` returns `{"initialized":false}` and the first action is **Set up your router**. The unauthenticated setup endpoint is therefore still open on the public product URL. Any visitor can create the sole administrator, receive the intake secret, and take ownership before the intended operator does. I did not call live setup because that would change real product data.

Require a fleet-provided bootstrap proof, an operator identity, or another one-time setup control that is not available to an arbitrary visitor.

### F02 — P1 — There is no isolated one-click demo

`/demo` returns HTTP 404 and renders the landing page. `/?demo=1` returns 200 but ignores demo mode. Neither path contains realistic sample data, the persistent **Demo — sample data, nothing is saved** label, **Reset demo**, or **Start for real**. The first screen has no **Try it with sample data** action. `.factory/demo.md` is also missing.

This prevented the required live sample, populated-output, reset, and real-data-isolation checks. The local product can produce a populated delivery board, but only after administrator setup and writes to a real workspace; that is not a demo sandbox.

### F03 — P1 — Public claims have no claim registry or claim tests

`.factory/claims.json` is missing. There are no `@claim:<id>` tests. The only frontend tests cover HTML escaping and invalid-date formatting. Therefore no public claim has the required clean-demo command, fixture, or observable assertion.

The 37 untested claims are:

1. routing by service;
2. routing by provider;
3. coordinators see only assigned bookings;
4. each delivery can be acknowledged;
5. retained details expire automatically;
6. intake requests are signed;
7. booking payloads are encrypted;
8. there is no per-task fee;
9. intake accepts normalized JSON;
10. HMAC verification rejects altered notices;
11. exact rules are evaluated by priority;
12. failed notices retry automatically;
13. SMTP email delivery works;
14. JSON webhook delivery works;
15. an administrator can retry a delivery;
16. every notice gets an acknowledgment link;
17. payload encryption is AES-256-GCM;
18. the encryption key is stored separately;
19. administrator passwords use Argon2;
20. sessions last seven days;
21. three recipients are free;
22. three rules are free;
23. $39 is a one-time unlimited-routing purchase;
24. an offline shell works;
25. the layout works on mobile;
26. the product supports keyboard focus;
27. reduced motion is respected;
28. privacy and terms pages are available;
29. outgoing webhooks contain the documented fields and signature;
30. health reports the immutable build SHA;
31. booking data stays on the operator's server and not in a Param Factory analytics account;
32. matched notices go only to the configured destination;
33. license verification sends only the license token to Sociobot;
34. there are no analytics, advertising trackers, CDN scripts, or third-party fonts;
35. the maintainer cannot access an installation;
36. refunded, expired, wrong-product, and revoked licenses stop paid access; and
37. data access, purging, and accessibility are never paywalled.

Independent spot checks passed several of these assertions, but that does not replace the required declared, repeatable claim tests.

### F04 — P1 — Default deployment creates unusable acknowledgment URLs

The mandatory runtime contract says the fleet supplies only `PORT`. The server defaults `PUBLIC_BASE_URL` to `http://localhost:8080`, and the Docker image does not override it. A normal fleet start therefore puts localhost URLs into notices, which recipients cannot open. The README's manual Docker command supplies the variable, but the factory deployment contract does not.

Derive the public origin safely from the request/forwarded host or ship the product's own HTTPS origin as a non-secret default.

### F05 — P1 — Rate limiting is incomplete and ignores the forwarded client IP

Only `/api/login`, `/api/setup`, and `/api/bookings` are limited. Every other server endpoint bypasses the limiter. Against live production, 160 requests to `/api/status` with one `X-Forwarded-For` value returned 160 HTTP 200 responses and zero 429 responses.

The limiter keys on the socket peer, not the first `X-Forwarded-For` hop. Locally, 21 login attempts alternating between two forwarded client IPs returned 429 on request 21 with `Retry-After: 60`; neither individual client had reached 20. Behind ingress this can combine unrelated users and let one user block others.

Apply a bounded limiter to every server endpoint except health, key it from the validated first forwarded hop, and keep `Retry-After` on 429.

### F06 — P2 — The phone first screen does not state the audience and action before scrolling

At 390×844 the illustration is placed first and the primary action is below the initial viewport. The 24-word intro exceeds the 22-word limit and never names the intended micro-clinic, studio, or multi-service office. The headline **Every booking, to the right person** describes an outcome but does not name the routing job as required.

### F07 — P2 — Routes do not have real app URLs, titles, focus, or announcements

All routes keep the title **Service Notification Router**, including `/privacy`, `/terms`, settings, recipients, rules, tests, and the dashboard. That title neither names the job nor follows the required route-title formats. App pages use `#/dashboard`, `#/rules`, and similar hash locations instead of real URLs. After navigation, focus falls back to the body instead of the new `h1`; the empty toast region does not announce the route heading. Back/forward therefore lacks the required focus restoration.

### F08 — P2 — The expected HTTP 404 has a broken page body

`/404` and `/definitely-missing` correctly return HTTP 404. The status itself is expected and is not the defect. The browser body is the normal landing page, with **Every booking, to the right person** and setup actions. It does not identify the missing page or provide the required designed way back.

### F09 — P2 — Some keyboard and touch affordances miss the accessibility baseline

The first Tab reaches a visible skip link with a 3 px outline on desktop, and axe found no WCAG 2/2.1 A/AA violations. However activating the skip link scrolls without moving focus to `main`, and route changes leave focus on the body. On phone, the footer Privacy, Terms, and Source links measure about 22 px high; the visible desktop header Privacy link is about 25 px high. These are below the required 44 px touch target.

### F10 — P2 — The landing-page structure is incomplete

After the first screen the landing page contains only three how-it-works columns. It has no live product preview, no plain privacy/non-goals section, and no exact paid-tier section. The header has no Demo link. The footer omits **Built by Param Factory** and a version/build identifier.

### F11 — P2 — The Dockerfile violates the required portable build contract

The Rust builder is pinned to `rust:1.98-alpine` instead of `rust:1-alpine`, `ARG BUILD_SHA` has no `=dev` default, and the build intentionally fails without a 40-character SHA. That contradicts the mandatory rule that local `docker build .` must work with a default build identity.

After installing the documented container prerequisite, the review attempted the documented image build with a valid SHA. This worker cannot execute Docker builds because its host denies the daemon's `unshare` operation, so the container run remains untested. The Rust release build and PORT-only binary start did pass.

### F12 — P3 — Discovery and social metadata are missing

`robots.txt` and `sitemap.xml` return 404. The document has no canonical URL, Open Graph metadata, Twitter card metadata, 1200×630 social image, or apple-touch icon. The page title is only the product name rather than **Product name — what it does**.

### F13 — P3 — The required copy audit is missing and public headings use metaphor

`.factory/copy-audit.md` is missing. The live copy includes **Private by assignment**, **Routing room**, **Verify at the door**, and **Privacy, kept close**, which are mood/metaphor labels rather than section names in plain words. The landing intro is also over the sentence limit.

### F14 — P3 — Startup does not report generated versus supplied configuration

A PORT-only start succeeds, creates SQLite plus a mode-0600 key, and serves health. Its only startup record is `router listening`; it does not state which configuration was generated or supplied as required. No secret value should be logged when this is added.

## What passed

- Fresh desktop and phone loads: HTTP 200, `lang=en`, one `h1`, `main`, no horizontal overflow, no console/page errors, and same-origin requests only.
- Live and local axe checks: zero WCAG 2/2.1 A/AA violations on the landing page and exercised app pages.
- Reduced motion: the hero transform is removed; no looping or flashing motion was found.
- Offline: after warming the service worker, an offline reload served the shell and showed the router-offline recovery state.
- Internal Privacy and Terms links returned 200. The external source link returned 200.
- Current mobile Lighthouse: Performance 100, Accessibility 100, Best Practices 100, SEO 100; LCP 1.316 s, CLS 0, TBT 52 ms.
- Bundles remain within budget: JS 32.19 KB raw/10.16 KB gzip, CSS 12.08 KB raw/3.60 KB gzip, desktop hero 118.4 KB, mobile hero 54.0 KB.
- Live health identifies the exact implementation candidate. Fresh local JS/CSS hashes match live.
- Isolated backend checks passed normal and error paths: setup 201, duplicate setup 409, unauthenticated config 401, bad login 401, consent rejection 400, three free recipients/rules accepted, fourth rejected 402, invalid rule 400, retention 0/721 rejected and 720 accepted, invalid signature 401, matched booking 202, duplicate 200, unmatched 202, random acknowledgment 404.
- A local webhook received the realistic booking and the intake response reported `delivered`. The populated mobile dashboard showed the booking, coordinator, channel, failure state for an intentionally unconfigured SMTP recipient, and retry action.
- Restarting with the same temporary data retained initialization. The test customer name and email were absent from raw SQLite bytes. The encryption key was mode 0600.
- Single-workspace access checks returned 401 for admin data without a session and 404 for a random acknowledgment token. A separate demo tenant does not exist (F02).

## Clean-checkout commands

The clean worktree started at documentation commit `7104598628309cbd7d1735d6270d3637253d9d90`; effective product code is candidate `5988cdb59c71d70c0c7c9b1d37ce90fc2ef890c5`.

| Command | Result |
| --- | --- |
| `npm install --prefix frontend` | PASS; 0 vulnerabilities |
| `npm test` | PASS; 2 Vitest and 6 Rust tests |
| `npm run check` | PASS |
| `npm run build` | PASS; `frontend/dist/` produced |
| `BUILD_SHA=<doc SHA> cargo test --all-targets --locked` | PASS; 6 tests |
| `BUILD_SHA=<doc SHA> cargo build --release --locked` | PASS |
| release binary with only `PORT` supplied | PASS; health returned the compiled SHA |
| documented `docker build --build-arg BUILD_SHA=<doc SHA> ...` | UNTESTED; worker kernel denied Docker `unshare` after Docker installation |
| claim commands from `.factory/claims.json` | FAIL; file and commands are missing |

`/opt/fleet/lib/verify-url.sh` passed after its required evidence-directory argument was supplied. The live browser audit, screenshots, local populated-state audit, and Lighthouse JSON are under `/work/.evidence/`.

## Earlier verification disposition

| Earlier item | Current disposition |
| --- | --- |
| `/privacy`, `/terms`, and `/ack/<token>` returned 404 | Closed: all known client routes return HTTP 200. A deliberate unknown route still returns 404, but its page design is defective (F08). |
| Live health returned `unknown` | Closed: live health returns the full implementation SHA. |
| Docker was unavailable | Rechecked after installing Docker; the worker kernel still blocks image construction with `unshare: operation not permitted`. Product-side Docker contract defects remain in F11. |
| Lighthouse could not launch against bundled Chromium | Closed: setting `CHROME_PATH` produced a fresh successful audit. |
| Prior report stated no P0–P3 defects | Superseded by this stricter review. Demo, claims, runtime, route, copy, metadata, and accessibility contracts were not covered by that conclusion. |

## Required next steps

Fix F01–F14, add the demo and claim suites, deploy a new candidate, and repeat the review from fresh browser contexts and a clean checkout. Do not treat the passing build and backend checks as a product PASS.
