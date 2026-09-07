import { randomBytes } from "node:crypto";

import { hash, verify } from "@node-rs/argon2";

import type { Db } from "../db/schema.js";
import type { ApiKeyMetadata } from "@lca/core";

const KEY_ID_PREFIX = "lca_key_";
const SECRET_PREFIX = "lca_sk_";

export interface CreatedApiKey {
  keyId: string;
  secret: string;
  metadata: ApiKeyMetadata;
}

function isoOrNull(v: Date | null): string | null {
  return v ? v.toISOString() : null;
}

function rowToMetadata(row: {
  key_id: string;
  client_id: string;
  label: string;
  created_at: Date;
  revoked_at: Date | null;
  last_used_at: Date | null;
}): ApiKeyMetadata {
  return {
    keyId: row.key_id,
    clientId: row.client_id,
    label: row.label,
    createdAt: row.created_at.toISOString(),
    revokedAt: isoOrNull(row.revoked_at),
    lastUsedAt: isoOrNull(row.last_used_at),
  };
}

export async function createApiKey(
  db: Db,
  input: { clientId: string; label: string },
): Promise<CreatedApiKey> {
  const keyId = KEY_ID_PREFIX + randomBytes(8).toString("hex");
  const secretMaterial = randomBytes(32).toString("base64url");
  const secret = `${SECRET_PREFIX}${keyId.slice(KEY_ID_PREFIX.length)}_${secretMaterial}`;
  const hashed = await hash(secret, { memoryCost: 19_456, timeCost: 2, parallelism: 1 });

  const row = await db
    .insertInto("api_keys")
    .values({
      key_id: keyId,
      hashed_secret: hashed,
      client_id: input.clientId,
      label: input.label,
    })
    .returning(["key_id", "client_id", "label", "created_at", "revoked_at", "last_used_at"])
    .executeTakeFirstOrThrow();

  return { keyId, secret, metadata: rowToMetadata(row) };
}

export async function verifyApiKey(
  db: Db,
  presentedSecret: string,
): Promise<{ keyId: string; clientId: string } | null> {
  if (!presentedSecret.startsWith(SECRET_PREFIX)) return null;
  const tail = presentedSecret.slice(SECRET_PREFIX.length);
  const idPart = tail.split("_")[0];
  if (!idPart) return null;
  const keyId = KEY_ID_PREFIX + idPart;

  const row = await db
    .selectFrom("api_keys")
    .select(["key_id", "hashed_secret", "client_id", "revoked_at"])
    .where("key_id", "=", keyId)
    .executeTakeFirst();
  if (!row) return null;
  if (row.revoked_at) return null;

  const ok = await verify(row.hashed_secret, presentedSecret);
  if (!ok) return null;

  await db
    .updateTable("api_keys")
    .set({ last_used_at: new Date() })
    .where("key_id", "=", keyId)
    .execute();

  return { keyId: row.key_id, clientId: row.client_id };
}

export async function revokeApiKey(db: Db, keyId: string): Promise<void> {
  await db
    .updateTable("api_keys")
    .set({ revoked_at: new Date() })
    .where("key_id", "=", keyId)
    .where("revoked_at", "is", null)
    .execute();
}

export async function listApiKeyMetadata(db: Db): Promise<ApiKeyMetadata[]> {
  const rows = await db
    .selectFrom("api_keys")
    .select(["key_id", "client_id", "label", "created_at", "revoked_at", "last_used_at"])
    .orderBy("created_at", "desc")
    .execute();
  return rows.map(rowToMetadata);
}
