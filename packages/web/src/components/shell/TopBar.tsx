import { BrandMark } from "./BrandMark.js";
import { LiveIndicator } from "./LiveIndicator.js";
import { EnvironmentIndicator } from "./EnvironmentIndicator.js";
import { UserMenu } from "./UserMenu.js";
import type { StreamConnectionState } from "../../lib/sse/connect-stream.js";
import styles from "./TopBar.module.css";

const NAV = [
  "Overview",
  "Requests",
  "Routing",
  "Models",
  "Governance",
  "Observability",
  "Cost",
  "Settings",
] as const;

export function TopBar({
  activeKey,
  connection,
  envLabel,
  userInitials,
  userHandle,
}: {
  activeKey: (typeof NAV)[number];
  connection: StreamConnectionState;
  envLabel: string;
  userInitials: string;
  userHandle: string;
}) {
  return (
    <header className={styles.bar}>
      <div className={styles.brand}>
        <BrandMark />
        <div className={styles.brandText}>
          <span className={styles.brandName}>LLM Cost Autopilot</span>
          <span className={styles.brandTag}>Route Smarter&nbsp; · &nbsp;Spend Less&nbsp; · &nbsp;Ship Faster</span>
        </div>
      </div>

      <nav className={styles.nav} aria-label="Primary">
        {NAV.map((item) => {
          const active = item === activeKey;
          return (
            <a
              key={item}
              href={`/${item.toLowerCase()}`}
              className={active ? `${styles.item} ${styles.itemActive}` : styles.item}
              aria-current={active ? "page" : undefined}
            >
              {item}
            </a>
          );
        })}
      </nav>

      <div className={styles.right}>
        <LiveIndicator state={connection} />
        <EnvironmentIndicator label={envLabel} />
        <UserMenu handle={userHandle} initials={userInitials} />
      </div>
    </header>
  );
}
