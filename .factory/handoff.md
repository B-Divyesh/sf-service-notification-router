# Handoff — Service Notification Router repair

## Release-blocking fixes

- `/privacy`, `/terms`, and `/ack/<token>` are now explicit Axum document
  routes. Each serves the SPA index with HTTP `200`, instead of the previous
  static fallback that returned the index body with a `404` status.
- The container build embeds a full immutable Git commit SHA in the Rust
  binary. It accepts an explicit `BUILD_SHA`, normalizes it to a commit, or
  derives it from the build-context checkout; an invalid or absent identity
  fails the image build instead of exposing `build: "unknown"` from `/health`.
- Regressions cover all three public client-route status responses and the
  exact compile-time build identity returned by `/health`.

## Run and verify

```sh
npm ci --prefix frontend
npm test
npm run check
npm run build
BUILD_SHA=$(git rev-parse HEAD) cargo build --release --locked
BUILD_SHA=$(git rev-parse HEAD) cargo test --all-targets --locked

docker build --build-arg BUILD_SHA=$(git rev-parse HEAD) -t service-notification-router .
docker run --rm -p 8080:8080 -v router-data:/data service-notification-router
curl http://localhost:8080/health
```

The health response must contain the same full SHA supplied to the build.
The fixed container deployment path may omit the argument because the
Dockerfile derives the same SHA from its checked-out source context.

## Verification performed 2026-08-27

- Fresh `npm ci --prefix frontend`: passed with 0 audit vulnerabilities.
- `npm test`: passed (2 Vitest tests and 6 Rust unit/integration tests).
- `npm run check`, `npm run build`, and locked optimized Rust build: passed.
- `BUILD_SHA=868eda19eb2a78da7d728cc77b515a189b1b1eda cargo test --all-targets --locked`:
  passed; the identity regression asserts the exact compile-time value.
- Release-server route test: `/privacy`, `/terms`, and a newly generated real
  `/ack/<token>` each returned HTTP `200`.
- Chromium desktop and 390×844 mobile test of all three routes: no console or
  page errors; one `h1`, `main`, title, and `lang=en`; no mobile overflow; axe
  reported 0 serious or critical violations (CSP bypass was used only to inject
  the local axe audit script).
- Persistence smoke: after setup, recipient/rule creation, and a routed test
  booking, a server restart preserved `initialized: true` and accepted login.
- Release binary health check with the SHA above returned that exact full value.

## Deployment and operations

The fixed deployment uses `/opt/fleet/lib/deploy-container.sh` and the
multi-stage non-root Alpine image. It retains no Git metadata in the runtime
image. Mount persistent `/data`, back up both `router.db` and `router.key`,
set `PUBLIC_BASE_URL` to the public HTTPS origin, and configure SMTP only when
email delivery is needed.

No known product or QA gaps remain from the verifier report.
