import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { readSession } from "@/src/lib/db";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const jar = await cookies();
  const sessionId = jar.get("et_session")?.value;
  const user = readSession(sessionId);
  if (!user || user.role !== "owner" || user.status !== "active") {
    redirect("/sign-in");
  }
  return <>{children}</>;
}
