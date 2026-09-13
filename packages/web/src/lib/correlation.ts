/** Deterministic UUIDv4-shaped correlation identifier for outbound API calls. */
export function correlationId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  const rand = (n: number): string =>
    Math.floor(Math.random() * 16 ** n)
      .toString(16)
      .padStart(n, "0");
  return `${rand(8)}-${rand(4)}-4${rand(3)}-a${rand(3)}-${rand(12)}`;
}
