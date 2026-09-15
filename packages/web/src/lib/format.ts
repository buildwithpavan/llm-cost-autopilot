/** Human-friendly number/currency formatting. Preserves raw values. */

const usdSmall = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 6,
  maximumFractionDigits: 6,
});
const usdLarge = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export function formatUsd(value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === "") return "—";
  const num = typeof value === "string" ? Number(value) : value;
  if (Number.isNaN(num)) return "—";
  return num >= 1 ? usdLarge.format(num) : usdSmall.format(num);
}

export function formatTokens(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  if (value >= 1000) {
    return `${(value / 1000).toFixed(1).replace(/\.0$/, "")}K`;
  }
  return value.toString();
}

export function formatInt(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  return value.toLocaleString("en-US");
}

export function abbreviateId(id: string, len = 8): string {
  if (!id) return "";
  return id.length <= len ? id : `${id.slice(0, len)}…`;
}

export function formatScore(value: number, digits = 4): string {
  return value.toFixed(digits);
}

export function formatScoreShort(value: number, digits = 3): string {
  const s = value.toFixed(digits);
  return s.startsWith("0") ? s.slice(1) : s;
}

export function formatMs(value: number | null | undefined): string {
  if (value === null || value === undefined) return "— ms";
  return `${value} ms`;
}

export function formatDelta(startedAt: string, at: string): string {
  const t0 = Date.parse(startedAt);
  const t1 = Date.parse(at);
  if (Number.isNaN(t0) || Number.isNaN(t1)) return "";
  const d = Math.max(0, Math.round(t1 - t0));
  return `${d} ms`;
}

/** 24h clock time, e.g. "14:32:08". */
export function formatClockTime(iso: string): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "—";
  return new Date(t).toLocaleTimeString("en-US", {
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

/** Compact relative time, e.g. "just now", "3s ago", "5m ago", "2h ago", "4d ago". */
export function formatRelativeTime(iso: string, now: number = Date.now()): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "—";
  const s = Math.floor(Math.max(0, now - t) / 1000);
  if (s < 1) return "just now";
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}
