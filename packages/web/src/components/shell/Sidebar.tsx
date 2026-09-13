import type { ReactNode } from "react";
import styles from "./Sidebar.module.css";
import { SystemHealthCard } from "./SystemHealthCard.js";

type NavItem = { key: string; label: string; glyph: ReactNode };

const MAIN: NavItem[] = [
  { key: "Overview", label: "Overview", glyph: "⌂" },
  { key: "Requests", label: "Requests", glyph: "⇄" },
  { key: "Routing", label: "Routing", glyph: "≋" },
  { key: "Models", label: "Models", glyph: "◈" },
  { key: "Governance", label: "Governance", glyph: "◌" },
  { key: "Cost", label: "Cost", glyph: "◫" },
  { key: "Observability", label: "Observability", glyph: "◉" },
];

const TOOLS: NavItem[] = [
  { key: "Replay", label: "Replay", glyph: "⟳" },
  { key: "Comparisons", label: "Comparisons", glyph: "◫" },
  { key: "ModelCatalog", label: "Model Catalog", glyph: "▦" },
  { key: "Policies", label: "Policies", glyph: "◉" },
  { key: "Integrations", label: "Integrations", glyph: "◌" },
];

const SYSTEM: NavItem[] = [
  { key: "Settings", label: "Settings", glyph: "⚙" },
  { key: "Documentation", label: "Documentation", glyph: "▤" },
];

export function Sidebar({
  activeKey,
  healthy,
  version,
}: {
  activeKey: string;
  healthy: boolean;
  version: string;
}) {
  return (
    <aside className={styles.side} aria-label="Sections">
      <Section heading="MAIN" items={MAIN} activeKey={activeKey} />
      <Section heading="TOOLS" items={TOOLS} activeKey={activeKey} />
      <Section heading="SYSTEM" items={SYSTEM} activeKey={activeKey} />
      <div className={styles.spacer} />
      <SystemHealthCard healthy={healthy} version={version} />
    </aside>
  );
}

function Section({
  heading,
  items,
  activeKey,
}: {
  heading: string;
  items: NavItem[];
  activeKey: string;
}) {
  return (
    <div className={styles.section}>
      <div className={styles.sectionHeading}>{heading}</div>
      {items.map((item) => {
        const active = item.key === activeKey;
        return (
          <a
            key={item.key}
            href={`/${item.key.toLowerCase()}`}
            className={active ? `${styles.item} ${styles.itemActive}` : styles.item}
            aria-current={active ? "page" : undefined}
          >
            <span aria-hidden className={styles.glyph}>
              {item.glyph}
            </span>
            {item.label}
          </a>
        );
      })}
    </div>
  );
}
