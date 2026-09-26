import { NextResponse } from "next/server";
import { assertOwner, readSession } from "@/src/lib/db";
import { backupDatabase } from "@/src/lib/backup";
import { readSessionId } from "@/src/lib/http";

export async function POST(req: Request) {
  const user = readSession(readSessionId(req));
  if (!user) return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  try {
    assertOwner(user);
  } catch {
    return NextResponse.json({ error: "Owner access is required." }, { status: 403 });
  }
  try {
    const file = backupDatabase();
    return NextResponse.json({
      ok: true,
      file,
      note: "Copy the file off this machine. A restore replaces the local database and does not touch media files.",
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Backup failed." },
      { status: 500 },
    );
  }
}
