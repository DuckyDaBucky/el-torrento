import { Player } from "@/components/player";

export default async function WatchPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <Player id={id} />;
}
