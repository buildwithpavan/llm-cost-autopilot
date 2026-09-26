import type { ApiKeyMetadata } from "../../types/index.js";

export type KeyStatus = "active" | "revoked";

/** A key is revoked iff revokedAt is populated (soft-revoke; revoked keys stay in the list). */
export function keyStatus(key: Pick<ApiKeyMetadata, "revokedAt">): KeyStatus {
  return key.revokedAt ? "revoked" : "active";
}

export function isActive(key: Pick<ApiKeyMetadata, "revokedAt">): boolean {
  return keyStatus(key) === "active";
}
