import type { CSSProperties } from "react";

export function Toggle({
  on,
  onColor = "var(--success)",
  offColor = "var(--bg-track)",
  onChange,
  ariaLabel,
  style,
}: {
  on: boolean;
  onColor?: string;
  offColor?: string;
  onChange?: (next: boolean) => void;
  ariaLabel?: string;
  style?: CSSProperties;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={ariaLabel}
      onClick={() => onChange?.(!on)}
      style={{
        width: 34,
        height: 18,
        borderRadius: 9,
        background: on ? onColor : offColor,
        position: "relative",
        transition: "background var(--dur-2) var(--ease)",
        display: "inline-block",
        ...style,
      }}
    >
      <span
        style={{
          position: "absolute",
          top: 3,
          left: on ? 18 : 3,
          width: 12,
          height: 12,
          borderRadius: "50%",
          background: "#fff",
          transition: "left var(--dur-2) var(--ease)",
        }}
      />
    </button>
  );
}
