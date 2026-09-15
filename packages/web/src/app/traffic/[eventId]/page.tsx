import { RequestDetailView } from "@/features/routing-explorer/RequestDetailView";

export default async function TrafficDetailPage({
  params,
}: {
  params: Promise<{ eventId: string }>;
}) {
  const { eventId } = await params;
  return <RequestDetailView eventId={eventId} />;
}
