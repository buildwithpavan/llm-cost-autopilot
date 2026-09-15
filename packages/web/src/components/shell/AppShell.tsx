"use client";
import type { ReactNode } from "react";
import { TopBar } from "./TopBar.js";
import { Sidebar } from "./Sidebar.js";
import type { StreamConnectionState } from "../../lib/sse/connect-stream.js";
import styles from "./AppShell.module.css";

const NAV_TOP_KEY = "Routing" as const;
const NAV_SIDE_KEY = "Routing";

export function AppShell({
  connection,
  envLabel,
  healthy,
  version,
  activeKey = NAV_SIDE_KEY,
  children,
}: {
  connection: StreamConnectionState;
  envLabel: string;
  healthy: boolean;
  version: string;
  activeKey?: string;
  children: ReactNode;
}) {
  return (
    <div className={styles.root}>
      <TopBar
        activeKey={NAV_TOP_KEY}
        connection={connection}
        envLabel={envLabel}
        userInitials="PK"
        userHandle="Pavan"
      />
      <div className={styles.body}>
        <Sidebar activeKey={activeKey} healthy={healthy} version={version} />
        <main className={styles.main}>{children}</main>
      </div>
    </div>
  );
}
