# Service Notification Router

Service Notification Router sends an existing booking notice to one responsible
coordinator. It is for micro-clinics, studios, and multi-service offices that do
not want every coordinator to receive every booking.

The free router supports three recipients and three rules. The planned paid
offer is $39 USD once for unlimited recipients and rules. Checkout registration
is currently pending; the free core remains available.

Try the isolated sample at
<https://service-notification-router.sociobot.in/demo>. The sample uses an
expiring in-memory workspace and never opens or changes the real SQLite data.

## What it does

- Accepts normalized booking JSON after HMAC-SHA256 verification.
- Matches exact service or provider values in priority order.
- Sends signed JSON to a configured webhook.
- Keeps email unavailable until the operator supplies an SMTP relay.
- Adds a public HTTPS acknowledgment link to each matched notice.
- Records delivery attempts and lets an administrator retry failures.
- Encrypts private booking fields and lets an administrator purge expired payloads.

These public behaviors are mapped to outcome tests in
[`.factory/claims.json`](.factory/claims.json). The product does not create
booking pages, scrape WhatsApp, send marketing messages, or manage staff.

## Run locally

Install Node 22+, npm 10+, and the current stable Rust toolchain. From a clean
checkout:

```sh
npm ci --prefix frontend
npm run build
DATA_DIR=./data PUBLIC_BASE_URL=http://localhost:8080 cargo run
```

Open <http://localhost:8080>. On first boot, the server creates
`data/router.setup-code` with mode `0600`. Enter that private value on `/setup`.
`SETUP_PROOF` may supply it for automated local environments.

The container starts with only `PORT` supplied. It uses `/data` when that mount
exists and otherwise uses `./data`. Its default public acknowledgment origin is
`https://service-notification-router.sociobot.in`; local and alternate hosts
should set `PUBLIC_BASE_URL`.

## Configure delivery

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `8080` | HTTP port |
| `DATA_DIR` | `/data` when present, otherwise `./data` | SQLite, encryption key, setup code |
| `PUBLIC_BASE_URL` | Product HTTPS origin | Public acknowledgment links |
| `SETUP_PROOF` | Generated on first boot | Optional private first-run override |
| `SMTP_HOST` | unset | SMTP relay for email recipients |
| `SMTP_PORT` | `587` | STARTTLS SMTP port |
| `SMTP_USERNAME` | unset | Optional SMTP login |
| `SMTP_PASSWORD` | unset | Optional SMTP password |
| `SMTP_FROM` | unset | Sender mailbox |
| `BILLING_API_BASE` | Sociobot production API | License verification endpoint |
| `RUST_LOG` | service defaults | Structured log filter |

After setup, Settings shows the intake secret once. Sign the exact JSON bytes
and send the digest in `X-Router-Signature`.

```json
{
  "external_id": "apt_1048",
  "service": "Dental cleaning",
  "provider": "Dr. Rivera",
  "starts_at": "2026-09-08T09:30:00Z",
  "customer_name": "A. Patient",
  "customer_email": "patient@example.com",
  "metadata": { "source": "scheduler" }
}
```

Only add recipients who consented to operational notices. Configure an SMTP
relay before using email. No provider credential ships with this repository.

## Test and build

```sh
npm test
npm run check
npm run build
```

`npm test` runs Vitest, Rust tests, and browser claim checks. Each command in
`.factory/claims.json` can also run one public claim from the same clean setup.
The browser suite uses Playwright 1.58.2 and its preinstalled Chromium.

Build and run the production container:

```sh
docker build -t service-notification-router .
docker run --rm -p 8080:8080 -v router-data:/data service-notification-router
```

Factory builds supply `BUILD_SHA`; local builds use `dev`. `GET /health` returns
that compiled identity. Every non-health request has a bounded allowance keyed
by the first valid `X-Forwarded-For` address and returns `Retry-After` with 429.

Production must keep `/data` on durable storage with one replica. Back up
`router.db`, `router.key`, and `router.setup-code` together. The project uses the
MIT License. See [`LICENSE`](LICENSE), [privacy](https://service-notification-router.sociobot.in/privacy),
and [terms](https://service-notification-router.sociobot.in/terms).
