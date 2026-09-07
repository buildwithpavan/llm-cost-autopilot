-- Initial schema for LLM Cost Autopilot.
-- Every table + constraint traces to /specs/001-llm-routing-mvp/data-model.md.

BEGIN;

CREATE TABLE pricing_tables (
  version_id      TEXT PRIMARY KEY,
  effective_from  TIMESTAMPTZ NOT NULL,
  is_active       BOOLEAN NOT NULL DEFAULT FALSE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX pricing_tables_one_active
  ON pricing_tables (is_active)
  WHERE is_active = TRUE;

CREATE TABLE pricing_entries (
  version_id                 TEXT NOT NULL REFERENCES pricing_tables(version_id) ON DELETE RESTRICT,
  provider_id                TEXT NOT NULL,
  model_id                   TEXT NOT NULL,
  unit_input_usd_per_token   NUMERIC(20, 10) NOT NULL,
  unit_output_usd_per_token  NUMERIC(20, 10) NOT NULL,
  currency                   TEXT NOT NULL DEFAULT 'USD',
  PRIMARY KEY (version_id, provider_id, model_id)
);

CREATE TABLE telemetry_events (
  event_id                    UUID NOT NULL,
  received_at                 TIMESTAMPTZ NOT NULL,
  client_id                   TEXT NOT NULL,
  decision_source             TEXT NOT NULL
    CHECK (decision_source IN ('autopilot','client_override','operator_rule')),
  shadowed_source             TEXT
    CHECK (shadowed_source IN ('client_override') OR shadowed_source IS NULL),
  effective_provider_id       TEXT NOT NULL,
  effective_model_id          TEXT NOT NULL,
  attempts                    JSONB NOT NULL,
  aggregated_input_tokens     INTEGER NOT NULL,
  aggregated_output_tokens    INTEGER NOT NULL,
  total_latency_ms            INTEGER NOT NULL,
  terminal_error_class        TEXT NOT NULL,
  estimated_cost_usd          NUMERIC(20, 6) NOT NULL,
  actual_cost_usd             NUMERIC(20, 6),
  pricing_table_version_id    TEXT NOT NULL REFERENCES pricing_tables(version_id),
  reconciled                  BOOLEAN,
  routing_rationale           JSONB NOT NULL,
  PRIMARY KEY (event_id, received_at)
) PARTITION BY RANGE (received_at);

-- Bootstrap partition covering 2026-09 so the API can boot in dev without a scheduler.
CREATE TABLE telemetry_events_2026_09 PARTITION OF telemetry_events
  FOR VALUES FROM ('2026-09-01') TO ('2026-10-01');
CREATE TABLE telemetry_events_2026_10 PARTITION OF telemetry_events
  FOR VALUES FROM ('2026-10-01') TO ('2026-11-01');

CREATE INDEX telemetry_events_client_time
  ON telemetry_events (client_id, received_at DESC);

CREATE INDEX telemetry_events_effective_model
  ON telemetry_events (effective_provider_id, effective_model_id, received_at DESC);

CREATE TABLE telemetry_rollups (
  rollup_date              DATE NOT NULL,
  provider_id              TEXT NOT NULL,
  model_id                 TEXT NOT NULL,
  request_count            INTEGER NOT NULL,
  terminal_error_counts    JSONB NOT NULL,
  input_tokens_sum         BIGINT NOT NULL,
  output_tokens_sum        BIGINT NOT NULL,
  estimated_cost_sum_usd   NUMERIC(20, 6) NOT NULL,
  actual_cost_sum_usd      NUMERIC(20, 6) NOT NULL,
  latency_p50_ms           INTEGER NOT NULL,
  latency_p95_ms           INTEGER NOT NULL,
  latency_p99_ms           INTEGER NOT NULL,
  reconciled_rate          NUMERIC(5, 4) NOT NULL,
  decision_source_counts   JSONB NOT NULL,
  aggregated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (rollup_date, provider_id, model_id)
);

CREATE TABLE operator_rules (
  rule_id     TEXT PRIMARY KEY,
  priority    INTEGER NOT NULL,
  match       JSONB NOT NULL,
  pin         JSONB NOT NULL,
  enabled     BOOLEAN NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX operator_rules_enabled_priority
  ON operator_rules (enabled, priority);

CREATE TABLE api_keys (
  key_id         TEXT PRIMARY KEY,
  hashed_secret  TEXT NOT NULL,
  client_id      TEXT NOT NULL,
  label          TEXT NOT NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  revoked_at     TIMESTAMPTZ,
  last_used_at   TIMESTAMPTZ
);

CREATE INDEX api_keys_client ON api_keys (client_id);

CREATE TABLE provider_health_state (
  provider_id            TEXT PRIMARY KEY,
  healthy                BOOLEAN NOT NULL,
  last_probed_at         TIMESTAMPTZ NOT NULL,
  consecutive_failures   INTEGER NOT NULL DEFAULT 0,
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMIT;
