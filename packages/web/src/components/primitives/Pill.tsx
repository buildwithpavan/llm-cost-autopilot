import type { CSSProperties, ReactNode } from "react";

/** Small semantic pill with an optional colored dot. */
export function Pill({
  label,
  color,
  bg,
  border,
  dot,
  className,
  style,
}: {
  label: ReactNode;
  color?: string;
  bg?: string;
  border?: string;
  dot?: string | false;
  className?: string;
  style?: CSSProperties;
}) {
  const s: CSSProperties = {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    padding: "6px 10px",
    borderRadius: "var(--r-tab)",
    fontFamily: "var(--font-sans)",
    fontSize: 11,
    lineHeight: 1,
    fontWeight: 600,
    color: color ?? "var(--text-primary)",
    background: bg ?? "transparent",
    border: border ? `1px solid ${border}` : "1px solid transparent",
    ...style,
  };
  return (
    <span className={className} style={s}>
      {dot ? (
        <span
          aria-hidden
          style={{
            width: 6,
            height: 6,
            borderRadius: "50%",
            background: dot,
          }}
        />
      ) : null}
      {label}
    </span>
  );
}
