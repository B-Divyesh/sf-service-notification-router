# Service Notification Router

Service Notification Router is a narrow, self-hosted handoff tool for a clinic,
studio, or multi-service office. It receives an already-created booking as a
signed normalized webhook, matches its service or provider to one responsible
recipient, delivers by email or webhook, and records a minimal acknowledgment.
Encrypted payloads are purged after the configured interval.

It deliberately does not create bookings, scrape WhatsApp, send marketing
messages, or manage a workforce. The live product is intended for
<https://service-notification-router.sociobot.in>.

## Product behavior

- HMAC-SHA256 verification on the public booking intake
- Priority-ordered exact service/provider routing
- Email through the operator's SMTP relay or JSON to an operator-controlled webhook
- Automatic delivery retries with an admin retry action
- Per-notice acknowledgment links
- AES-256-GCM encrypted booking payloads with a separate on-disk key
- First-run admin setup, Argon2 password hashing, seven-day local sessions
- Three recipients and three rules free; $39 one-time Sociobot license for unlimited routing
- Offline shell, mobile layout, keyboard focus, reduced-motion treatment, privacy and terms pages

## Run locally

Requirements: Node 22+, npm 10+, Rust 1.98+.

```sh
npm install --prefix frontend
npm run build
DATA_DIR=./data PUBLIC_BASE_URL=http://localhost:8080 cargo run
```

Open <http://localhost:8080> and complete first-run setup. The Rust server serves
`frontend/dist` and the API on the same origin.

For frontend-only iteration, run `npm run dev`; Vite uses its normal development
port, so API calls require the Rust service or a local proxy.

## Configure delivery

All server configuration uses environment variables:

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `8080` | HTTP port |
| `DATA_DIR` | `./data` | SQLite database and separate encryption key |
| `PUBLIC_BASE_URL` | `http://localhost:8080` | Absolute base for acknowledgment links |
| `SMTP_HOST` | unset | SMTP relay; required for email recipients |
| `SMTP_PORT` | `587` | STARTTLS SMTP port |
| `SMTP_USERNAME` | unset | Optional SMTP login |
| `SMTP_PASSWORD` | unset | Optional SMTP password |
| `SMTP_FROM` | unset | Required sender mailbox, e.g. `Bookings <bookings@example.com>` |
| `BILLING_API_BASE` | Sociobot production API | Override with pilot API on staging |
| `RUST_LOG` | service defaults | Structured log filter |

After setup, Settings shows the intake secret once. Sign the exact JSON request
bytes with HMAC-SHA256 and send the lowercase or uppercase hex digest as
`X-Router-Signature: sha256=<digest>` to `POST /api/bookings`.

```json
{
  "external_id": "apt_1048",
  "service": "Dental cleaning",
  "provider": "Dr. Rivera",
  "starts_at": "2026-08-28T09:30:00Z",
  "customer_name": "A. Patient",
  "customer_email": "patient@example.com",
  "metadata": { "source": "scheduler" }
}
```

Recipient webhooks receive `booking.routed`, the normalized booking, recipient
name, and acknowledgment URL. The outgoing body is signed with the same router
secret in `X-Router-Signature`. Only add email or messaging gateway recipients
who consent to operational notices.

## Test and build

```sh
npm test       # Vitest plus Rust unit/integration tests
npm run check  # TypeScript plus cargo check
npm run build  # reproducible Vite output in frontend/dist
```

The Rust integration test covers setup, recipient/rule creation, signature
verification, encrypted ingest, route matching, failed-provider handling, and
acknowledgment. Build and run the production container with:

```sh
docker build --build-arg BUILD_SHA=$(git rev-parse --short HEAD) -t service-notification-router .
docker run --rm -p 8080:8080 -v router-data:/data \
  -e PUBLIC_BASE_URL=http://localhost:8080 service-notification-router
```

Production deployments must use HTTPS, persistent storage, an SMTP relay when
email is enabled, and a protected backup of both `router.db` and `router.key`.
The project is MIT licensed; see [LICENSE](LICENSE). Visual decisions and asset
provenance are in [.factory/design.md](.factory/design.md).
