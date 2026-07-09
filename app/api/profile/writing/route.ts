import { NextResponse } from "next/server";
import { verifyUserRequest } from "@/lib/auth/server-owner";
import { deleteWritingProfile, loadWritingProfile, saveWritingProfile } from "@/lib/personalization/writing-profile";

export async function GET(req: Request) {
  const auth = await verifyUserRequest(req);
  if (!auth.authenticated) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const profile = await loadWritingProfile(auth.userId);
  return NextResponse.json({ profile });
}

export async function PUT(req: Request) {
  const auth = await verifyUserRequest(req);
  if (!auth.authenticated) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const input = await req.json();
    const profile = await saveWritingProfile(auth.userId, input ?? {});
    return NextResponse.json({ profile });
  } catch {
    return NextResponse.json({ error: "Unable to save writing profile." }, { status: 400 });
  }
}

export async function DELETE(req: Request) {
  const auth = await verifyUserRequest(req);
  if (!auth.authenticated) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  await deleteWritingProfile(auth.userId);
  return NextResponse.json({ ok: true });
}
