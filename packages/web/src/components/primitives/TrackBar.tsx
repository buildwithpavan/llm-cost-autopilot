import type { CSSProperties } from "react";

/**
 * Horizontal fill-in-track bar for factor contributions & score readouts.
 * `value` and `max` share the same unit (defaults to 0..1).
 */
export function TrackBar({
  value,
  max = 1,
  color,
  width = 130,
  height = 10,
  radius = 3,
  bg = "var(--bg-track)",
  style,
}: {
  value: number;
  max?: number;
  color: string;
  width?: number;
  height?: number;
  radius?: number;
  bg?: string;
  style?: CSSProperties;
}) {
  const pct = Math.max(0, Math.min(1, value / max));
  return (
    <span
      style={{
        display: "inline-block",
        position: "relative",
        width,
        height,
        background: bg,
        borderRadius: radius,
        overflow: "hidden",
        ...style,
      }}
    >
      <span
        style={{
          position: "absolute",
          inset: 0,
          width: `${pct * 100}%`,
          background: color,
          borderRadius: radius,
        }}
      />
    </span>
  );
}
