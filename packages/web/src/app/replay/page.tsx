import { Suspense } from "react";

import { ReplayView } from "@/features/replay/ReplayView";

export default function ReplayPage() {
  return (
    <Suspense>
      <ReplayView />
    </Suspense>
  );
}
