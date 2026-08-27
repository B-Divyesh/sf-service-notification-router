CREATE TABLE IF NOT EXISTS settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  business_name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  webhook_secret TEXT NOT NULL,
  retention_hours INTEGER NOT NULL DEFAULT 72 CHECK (retention_hours BETWEEN 1 AND 720),
  licensed INTEGER NOT NULL DEFAULT 0,
  license_token_enc TEXT,
  license_checked_at TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS recipients (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  channel TEXT NOT NULL CHECK (channel IN ('email', 'webhook')),
  destination TEXT NOT NULL,
  consent_confirmed INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS rules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  match_field TEXT NOT NULL CHECK (match_field IN ('service', 'provider')),
  match_value TEXT NOT NULL,
  recipient_id INTEGER NOT NULL REFERENCES recipients(id) ON DELETE CASCADE,
  priority INTEGER NOT NULL DEFAULT 100,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS bookings (
  id TEXT PRIMARY KEY,
  external_id TEXT NOT NULL UNIQUE,
  service TEXT NOT NULL,
  provider TEXT,
  starts_at TEXT,
  encrypted_payload TEXT NOT NULL,
  received_at TEXT NOT NULL,
  purged_at TEXT
);

CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  booking_id TEXT NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  recipient_id INTEGER REFERENCES recipients(id) ON DELETE SET NULL,
  rule_id INTEGER REFERENCES rules(id) ON DELETE SET NULL,
  ack_token TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL CHECK (status IN ('queued', 'delivered', 'failed', 'acknowledged')),
  attempt_count INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TEXT,
  last_attempt_at TEXT,
  response_code INTEGER,
  error TEXT,
  acknowledged_at TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_notifications_retry ON notifications(status, next_attempt_at);
CREATE INDEX IF NOT EXISTS idx_bookings_received ON bookings(received_at);

