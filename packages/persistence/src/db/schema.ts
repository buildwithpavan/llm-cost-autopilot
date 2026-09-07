import type { ColumnType, Generated } from "kysely";
import { Kysely, PostgresDialect } from "kysely";
import pg from "pg";

const { Pool, types: pgTypes } = pg;

// Postgres NUMERIC is returned as string by node-postgres; keep it as string
// so Decimal arithmetic in @lca/core is used everywhere (Principle V).
pgTypes.setTypeParser(1700, (v) => v);

export interface PricingTablesRow {
  version_id: string;
  effective_from: ColumnType<Date, Date | string, Date | string>;
  is_active: boolean;
  created_at: Generated<Date>;
}

export interface PricingEntriesRow {
  version_id: string;
  provider_id: string;
  model_id: string;
  unit_input_usd_per_token: string;
  unit_output_usd_per_token: string;
  currency: string;
}

export interface TelemetryEventsRow {
  event_id: string;
  received_at: ColumnType<Date, Date | string, Date | string>;
  client_id: string;
  decision_source: "autopilot" | "client_override" | "operator_rule";
  shadowed_source: "client_override" | null;
  effective_provider_id: string;
  effective_model_id: string;
  attempts: unknown;
  aggregated_input_tokens: number;
  aggregated_output_tokens: number;
  total_latency_ms: number;
  terminal_error_class: string;
  estimated_cost_usd: string;
  actual_cost_usd: string | null;
  pricing_table_version_id: string;
  reconciled: boolean | null;
  routing_rationale: unknown;
}

export interface TelemetryRollupsRow {
  rollup_date: ColumnType<Date, Date | string, Date | string>;
  provider_id: string;
  model_id: string;
  request_count: number;
  terminal_error_counts: unknown;
  input_tokens_sum: string;
  output_tokens_sum: string;
  estimated_cost_sum_usd: string;
  actual_cost_sum_usd: string;
  latency_p50_ms: number;
  latency_p95_ms: number;
  latency_p99_ms: number;
  reconciled_rate: string;
  decision_source_counts: unknown;
  aggregated_at: Generated<Date>;
}

export interface OperatorRulesRow {
  rule_id: string;
  priority: number;
  match: unknown;
  pin: unknown;
  enabled: boolean;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface ApiKeysRow {
  key_id: string;
  hashed_secret: string;
  client_id: string;
  label: string;
  created_at: Generated<Date>;
  revoked_at: Date | null;
  last_used_at: Date | null;
}

export interface ProviderHealthStateRow {
  provider_id: string;
  healthy: boolean;
  last_probed_at: ColumnType<Date, Date | string, Date | string>;
  consecutive_failures: number;
  updated_at: Generated<Date>;
}

export interface Database {
  pricing_tables: PricingTablesRow;
  pricing_entries: PricingEntriesRow;
  telemetry_events: TelemetryEventsRow;
  telemetry_rollups: TelemetryRollupsRow;
  operator_rules: OperatorRulesRow;
  api_keys: ApiKeysRow;
  provider_health_state: ProviderHealthStateRow;
}

export function createPool(databaseUrl: string): pg.Pool {
  return new Pool({ connectionString: databaseUrl, max: 20, idleTimeoutMillis: 30_000 });
}

export function createDb(pool: pg.Pool): Kysely<Database> {
  return new Kysely<Database>({ dialect: new PostgresDialect({ pool }) });
}

export type Db = Kysely<Database>;
