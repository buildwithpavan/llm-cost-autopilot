"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

import styles from "./GovernanceTabs.module.css";

const TABS = [
  { href: "/governance/keys", label: "API Keys" },
  { href: "/governance/rules", label: "Operator Rules" },
] as const;

/** Minimal sub-navigation between the two Governance surfaces. */
export function GovernanceTabs() {
  const pathname = usePathname();
  return (
    <nav className={styles.tabs} aria-label="Governance sections">
      {TABS.map((tab) => {
        const active = pathname === tab.href || pathname.startsWith(`${tab.href}/`);
        return (
          <Link
            key={tab.href}
            href={tab.href}
            className={active ? `${styles.tab} ${styles.active}` : styles.tab}
            aria-current={active ? "page" : undefined}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
