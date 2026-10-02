-- Budget Controls / Spend Guardrails — Phase 1 foundation.
-- Operator-configured spend budgets (global or per-client attribution).
-- Enforcement is added in a later phase; this migration only persists config.

BEGIN;

CREATE TABLE spend_budgets (
  budget_id    TEXT PRIMARY KEY,
  scope        TEXT NOT NULL CHECK (scope IN ('global','client')),
  client_id    TEXT,
  period       TEXT NOT NULL CHECK (period IN ('daily','rolling_30d')),
  limit_usd    NUMERIC(20, 6) NOT NULL CHECK (limit_usd > 0),
  action       TEXT NOT NULL CHECK (action IN ('block','warn')),
  enabled      BOOLEAN NOT NULL DEFAULT TRUE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- Global budgets have no client; client budgets require a non-empty client_id.
  CONSTRAINT spend_budgets_scope_client CHECK (
    (scope = 'global' AND client_id IS NULL) OR
    (scope = 'client' AND client_id IS NOT NULL AND length(client_id) > 0)
  )
);

-- Supports the applicable-budget lookup: enabled budgets by scope/client.
CREATE INDEX spend_budgets_enabled_scope_client
  ON spend_budgets (enabled, scope, client_id);

COMMIT;
