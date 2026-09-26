import { RuleDetailView } from "@/features/governance/rules/RuleDetailView";

export default async function GovernanceRuleDetailPage({
  params,
}: {
  params: Promise<{ ruleId: string }>;
}) {
  const { ruleId } = await params;
  return <RuleDetailView ruleId={ruleId} />;
}
