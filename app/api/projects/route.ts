import { NextResponse } from "next/server";
import { verifyUserRequest } from "@/lib/auth/server-owner";
import { readBoundedObject, RequestBodyError } from "@/lib/api/bounded-json";
import { OwnerAccessError, requireSameOrigin } from "@/lib/auth/owner-session";
import { createProject, listProjects } from "@/lib/projects/store";
export async function GET(req: Request) {
  try {
    const auth = await verifyUserRequest(req);
    if (!auth.authenticated) return NextResponse.json({ error: "Sign in to access projects." }, { status: 401 });
    return NextResponse.json({ projects: await listProjects(auth.userId) }, { headers: { "Cache-Control": "no-store" } });
  } catch { return NextResponse.json({ error: "Project storage is unavailable." }, { status: 503 }); }
}
export async function POST(req: Request) {
  try {
    requireSameOrigin(req);
    const auth = await verifyUserRequest(req);
    if (!auth.authenticated) return NextResponse.json({ error: "Sign in to create a project." }, { status: 401 });
    const body = await readBoundedObject(req, 4096);
    if (typeof body.name !== "string") throw new OwnerAccessError("Project name is required.", 400);
    return NextResponse.json({ project: await createProject(auth.userId, body.name) }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof OwnerAccessError || error instanceof RequestBodyError ? error.message : "Project could not be created." }, { status: error instanceof OwnerAccessError || error instanceof RequestBodyError ? error.status : 503 });
  }
}
