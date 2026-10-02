-- Budget Controls / Spend Guardrails — Phase 5: durable budget decision audit.
-- A budget-blocked request is NOT a provider execution and cannot be stored in
-- the execution-shaped telemetry_events table, so warned/blocked budget
-- decisions are persisted here. Records are written best-effort at decision time
-- (same eventual-consistency posture as telemetry; no transactional coupling).

BEGIN;

CREATE TABLE budget_decisions (
  event_id                    TEXT PRIMARY KEY,
  decided_at                  TIMESTAMPTZ NOT NULL,
  client_id                   TEXT NOT NULL,
  decision                    TEXT NOT NULL CHECK (decision IN ('warned','blocked')),
  request_estimated_cost_usd  NUMERIC(20, 6) NOT NULL,
  applicable_budget_ids       JSONB NOT NULL,
  blocked_budget_ids          JSONB NOT NULL,
  evaluations                 JSONB NOT NULL,
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX budget_decisions_client_time ON budget_decisions (client_id, decided_at DESC);
CREATE INDEX budget_decisions_time ON budget_decisions (decided_at DESC);

COMMIT;
