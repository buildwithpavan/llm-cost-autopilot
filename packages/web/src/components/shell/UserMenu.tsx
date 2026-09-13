import { ChevronDown } from "lucide-react";

export function UserMenu({ handle, initials }: { handle: string; initials: string }) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 8,
        height: 32,
        paddingRight: 4,
      }}
    >
      <span
        aria-hidden
        style={{
          width: 32,
          height: 32,
          borderRadius: "50%",
          background: "linear-gradient(135deg, #2b3140 0%, #1c262e 100%)",
          border: "1px solid var(--border-default)",
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          fontFamily: "var(--font-sans)",
          fontSize: 11,
          fontWeight: 600,
          color: "var(--text-primary)",
        }}
      >
        {initials}
      </span>
      <span
        style={{
          fontFamily: "var(--font-sans)",
          fontSize: 11,
          color: "var(--text-secondary)",
          display: "inline-flex",
          alignItems: "center",
          gap: 4,
        }}
      >
        {handle}
        <ChevronDown size={12} strokeWidth={1.5} aria-hidden />
      </span>
    </span>
  );
}
