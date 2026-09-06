#!/bin/sh
set -eu

claim_data_dir=$(mktemp -d /tmp/service-notification-router-claims.XXXXXX)
cleanup() {
  rm -rf "$claim_data_dir"
}
trap cleanup EXIT INT TERM

cd "$(dirname "$0")/.."
DATA_DIR="$claim_data_dir" \
SETUP_PROOF="claim-test-bootstrap-proof-123456789" \
BILLING_API_BASE="http://127.0.0.1:4191" \
PORT=4179 \
BUILD_SHA="claim-test-build" \
cargo run --quiet
