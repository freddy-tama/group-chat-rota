import { WeekBoard } from "@/components/week/WeekBoard";

export const metadata = { title: "This week's rota · Group Chat Rota" };

export default async function WeekPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <WeekBoard weekId={id} />;
}
