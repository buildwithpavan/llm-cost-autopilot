export interface RedactionRule {
  readonly kind: "secret" | "pii";
  readonly pattern: RegExp;
}

// Order matters: longer/stricter patterns first so shorter ones don't shadow them.
export const RULES: readonly RedactionRule[] = [
  // OpenAI-style secret keys (sk-, sk-proj-, etc.)
  { kind: "secret", pattern: /\bsk-[A-Za-z0-9_-]{16,}\b/g },
  // Anthropic-style secret keys (sk-ant-)
  { kind: "secret", pattern: /\bsk-ant-[A-Za-z0-9_-]{16,}\b/g },
  // Generic "Bearer <token>" — JWT-shaped payloads or opaque tokens
  { kind: "secret", pattern: /\bBearer\s+[A-Za-z0-9._~+/=-]{16,}\b/g },
  // Query-string / form key=value carriers
  { kind: "secret", pattern: /\b(?:api[_-]?key|api[_-]?secret|access[_-]?token|auth[_-]?token)\s*=\s*[A-Za-z0-9._~+/=-]{12,}/gi },
  // Email addresses
  { kind: "pii", pattern: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g },
  // Credit-card-shaped digit runs (13-19 digits allowing spaces or dashes)
  { kind: "pii", pattern: /\b(?:\d[ -]?){12,18}\d\b/g },
  // Phone numbers (loose): 10-15 digits with common separators
  { kind: "pii", pattern: /(?<!\d)(?:\+?\d{1,3}[ -])?(?:\(\d{3}\)|\d{3})[ -]\d{3}[ -]\d{4}(?!\d)/g },
];

export const MAX_LENGTH = 512;
export const TRUNCATION_SUFFIX = "…[truncated]";
