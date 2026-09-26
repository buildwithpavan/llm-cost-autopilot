import { redirect } from "next/navigation";

export default function GovernancePage() {
  // Governance currently surfaces API Keys only.
  redirect("/governance/keys");
}
