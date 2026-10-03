-- Phase 17 (performance): support unfiltered, time-ordered reads of
-- telemetry_events. The initial schema indexed (client_id, received_at DESC) and
-- (effective_provider_id, effective_model_id, received_at DESC), but the common
-- dashboard "recent requests" / replay-list read is `/v1/telemetry/events` with
-- NO client/provider/model filter: `WHERE received_at BETWEEN ... ORDER BY
-- received_at DESC, event_id DESC LIMIT n`. Without a received_at-leading index
-- that pattern falls back to a parallel seq scan + top-N sort of the whole
-- 30-day window (O(window) instead of O(limit)). This mirrors the
-- budget_decisions (decided_at DESC) index that already exists for the analogous
-- unfiltered audit read. Keys are append-time monotonic, so write overhead is a
-- right-edge B-tree insert.

BEGIN;

CREATE INDEX telemetry_events_received_at
  ON telemetry_events (received_at DESC, event_id DESC);

COMMIT;
