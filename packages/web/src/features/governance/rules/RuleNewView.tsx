"use client";
import { useMemo } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";

import { AppShell } from "../../../components/shell/AppShell.js";
import { useHealth } from "../../../hooks/useHealth.js";
import { getEnvironment } from "../../../lib/env.js";
import type { OperatorRule } from "../../../types/index.js";
import { GovernanceTabs } from "../GovernanceTabs.js";
import { RuleEditor } from "./RuleEditor.js";
import styles from "./RuleDetail.module.css";

export function RuleNewView() {
  const env = useMemo(() => getEnvironment(), []);
  const health = useHealth();
  const router = useRouter();

  return (
    <AppShell
      connection="idle"
      envLabel={env.envLabel}
      healthy={health.status === "healthy"}
      version={env.appVersion}
      activeKey="Governance"
    >
      <div className={styles.page}>
        <GovernanceTabs />
        <Link href="/governance/rules" className={styles.back}>
          <ArrowLeft size={14} aria-hidden /> Rules
        </Link>
        <header className={styles.head}>
          <div>
            <div className={styles.kicker}>Governance</div>
            <h1 className={styles.title}>New operator rule</h1>
          </div>
        </header>
        <RuleEditor
          mode="create"
          onCancel={() => router.push("/governance/rules")}
          onSaved={(rule: OperatorRule) => router.push(`/governance/rules/${rule.ruleId}`)}
        />
      </div>
    </AppShell>
  );
}
