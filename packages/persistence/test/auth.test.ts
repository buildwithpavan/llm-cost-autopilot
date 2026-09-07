import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type pg from "pg";

import { createDb, createPool, type Db } from "../src/db/schema.js";
import { runMigrations } from "../src/db/migrate.js";
import {
  createApiKey,
  listApiKeyMetadata,
  revokeApiKey,
  verifyApiKey,
} from "../src/auth/keys.js";

const DATABASE_URL = process.env["DATABASE_URL"] ?? "postgres://lca:lca@localhost:5432/lca";

const testSuite = process.env["RUN_DB_TESTS"] === "1" ? describe : describe.skip;

testSuite("api-key store", () => {
  let pool: pg.Pool;
  let db: Db;

  beforeAll(async () => {
    await runMigrations(DATABASE_URL);
    pool = createPool(DATABASE_URL);
    db = createDb(pool);
    // Scope cleanup to this test's own labels to avoid stomping other test suites
    // that share the same database in parallel runs.
    await db
      .deleteFrom("api_keys")
      .where("client_id", "in", ["test-client", "verify-a", "revoked"])
      .execute();
  });

  afterAll(async () => {
    await db.destroy();
  });

  it("mints a key whose plaintext secret is only returned once and stores an argon2 hash", async () => {
    const { keyId, secret, metadata } = await createApiKey(db, {
      clientId: "test-client",
      label: "unit",
    });
    expect(keyId).toMatch(/^lca_/);
    expect(secret).toMatch(/^lca_/);
    expect(secret).not.toEqual(keyId);
    expect(metadata.clientId).toBe("test-client");
    expect(metadata.revokedAt).toBeNull();

    const row = await db
      .selectFrom("api_keys")
      .select(["hashed_secret"])
      .where("key_id", "=", keyId)
      .executeTakeFirstOrThrow();
    expect(row.hashed_secret.startsWith("$argon2id$")).toBe(true);
    expect(row.hashed_secret).not.toContain(secret);
  });

  it("verifies a valid key and rejects a wrong one", async () => {
    const { secret } = await createApiKey(db, { clientId: "verify-a", label: "unit" });
    const ok = await verifyApiKey(db, secret);
    expect(ok?.clientId).toBe("verify-a");

    const bad = await verifyApiKey(db, "lca_this_is_not_valid_abcdefghijklmnop");
    expect(bad).toBeNull();
  });

  it("rejects a revoked key", async () => {
    const { keyId, secret } = await createApiKey(db, { clientId: "revoked", label: "unit" });
    await revokeApiKey(db, keyId);
    const result = await verifyApiKey(db, secret);
    expect(result).toBeNull();
  });

  it("never returns hashed_secret in list metadata", async () => {
    const list = await listApiKeyMetadata(db);
    for (const item of list) {
      expect(Object.keys(item)).not.toContain("hashedSecret");
      expect(Object.keys(item)).not.toContain("hashed_secret");
    }
  });
});
