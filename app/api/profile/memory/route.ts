import { NextResponse } from "next/server";
import { verifyUserRequest } from "@/lib/auth/server-owner";
import {
  addUserMemory,
  deleteUserMemory,
  loadUserMemories,
  type MemoryCategory,
} from "@/lib/personalization/structured-memory";

const CATEGORIES = new Set<MemoryCategory>([
  "writing_preference",
  "learning_progress",
  "personal_preference",
  "project_context",
]);

export async function GET(req: Request) {
  const auth = await verifyUserRequest(req);
  if (!auth.authenticated) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return NextResponse.json({ memories: await loadUserMemories(auth.userId) });
}

export async function POST(req: Request) {
  const auth = await verifyUserRequest(req);
  if (!auth.authenticated) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const body = await req.json();
    if (!CATEGORIES.has(body?.category) || typeof body?.summary !== "string") throw new Error();
    await addUserMemory(auth.userId, { category: body.category, summary: body.summary });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Invalid memory." }, { status: 400 });
  }
}

export async function DELETE(req: Request) {
  const auth = await verifyUserRequest(req);
  if (!auth.authenticated) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const id = new URL(req.url).searchParams.get("id") ?? undefined;
  await deleteUserMemory(auth.userId, id);
  return NextResponse.json({ ok: true });
}
