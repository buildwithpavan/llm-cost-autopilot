import { describe, expect, it } from "vitest";
import type { ApiKeyMetadata } from "../src/types";
import { keyStatus, isActive } from "../src/features/governance/keys-presenters";

function meta(over: Partial<ApiKeyMetadata>): ApiKeyMetadata {
  return {
    keyId: "key_1",
    clientId: "acme",
    label: "prod",
    createdAt: "2026-09-08T00:00:00.000Z",
    revokedAt: null,
    lastUsedAt: null,
    ...over,
  };
}

describe("keyStatus", () => {
  it("treats a key with null revokedAt as active", () => {
    expect(keyStatus(meta({ revokedAt: null }))).toBe("active");
    expect(isActive(meta({ revokedAt: null }))).toBe(true);
  });

  it("treats a key with a revokedAt timestamp as revoked", () => {
    const m = meta({ revokedAt: "2026-09-09T00:00:00.000Z" });
    expect(keyStatus(m)).toBe("revoked");
    expect(isActive(m)).toBe(false);
  });
});

describe("API key list metadata", () => {
  it("never carries a plaintext secret or hashed secret", () => {
    const rows: ApiKeyMetadata[] = [
      meta({ keyId: "a" }),
      meta({ keyId: "b", revokedAt: "2026-09-09T00:00:00.000Z" }),
    ];
    for (const row of rows) {
      const keys = Object.keys(row);
      expect(keys).not.toContain("secret");
      expect(keys).not.toContain("hashedSecret");
      expect(keys).not.toContain("secretHash");
    }
  });
});
