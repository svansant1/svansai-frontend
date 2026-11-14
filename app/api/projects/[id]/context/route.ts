import { NextResponse } from "next/server";
import { verifyUserRequest } from "@/lib/auth/server-owner";
import { OwnerAccessError, requireSameOrigin, ownerDatabase } from "@/lib/auth/owner-session";
import { readBoundedObject, RequestBodyError } from "@/lib/api/bounded-json";
import { appendContextEvents, deleteContext, loadContext } from "@/lib/context/store";
import { parseUserEvent } from "@/lib/context/provenance";
import { assertContextScope } from "@/lib/projects/permissions";
type Route = { params: Promise<{ id: string }> };
async function scope(req: Request, route: Route) {
  const auth = await verifyUserRequest(req);
  if (!auth.authenticated) throw new OwnerAccessError("Sign in to access investigation context.", 401);
  return { userId: auth.userId, projectId: (await route.params).id, conversationId: new URL(req.url).searchParams.get("conversationId") || "" };
}
function fail(error: unknown) {
  return NextResponse.json({ error: error instanceof Error ? error.message : "Context request failed." },
    { status: error instanceof OwnerAccessError || error instanceof RequestBodyError ? error.status : 400, headers: { "Cache-Control": "no-store" } });
}
export async function GET(req: Request, route: Route) {
  try {
    const current = await scope(req, route);
    if (new URL(req.url).searchParams.has("export")) {
      await assertContextScope(current);
      const baseline = await loadContext(current);
      // Paginated export includes superseded evidence; the provider view remains separately bounded.
      const events: unknown[] = [];
      let bytes = 0;
      for (let offset = 0; ; offset += 500) {
        const { data, error } = await ownerDatabase().from("sv_context_events").select("event").eq("project_id", current.projectId).eq("conversation_id", current.conversationId).lte("sequence", baseline.revision).order("sequence").range(offset, offset + 499);
        if (error) throw new OwnerAccessError("Evidence export failed.", 503);
        events.push(...(data || []).map(row => row.event));
        bytes += Buffer.byteLength(JSON.stringify(data || []), "utf8");
        if (bytes > 8 * 1024 * 1024) throw new OwnerAccessError("Evidence export exceeds the current 8 MB limit.", 413);
        if (events.length > 10_000) throw new OwnerAccessError("Export exceeds the current 10,000-event limit. Narrow the investigation before exporting.", 413);
        if (!data || data.length < 500) break;
      }
      if ((await loadContext(current)).revision !== baseline.revision) throw new OwnerAccessError("Evidence changed during export. Retry to obtain a consistent snapshot.", 409);
      return NextResponse.json({ scope: current, revision: baseline.revision, events }, { headers: { "Cache-Control": "no-store", "Content-Disposition": 'attachment; filename="investigation-evidence.json"' } });
    }
    return NextResponse.json(await loadContext(current), { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return fail(error); }
}
export async function POST(req: Request, route: Route) {
  try {
    requireSameOrigin(req);
    const current = await scope(req, route), body = await readBoundedObject(req, 256 * 1024);
    if (!Array.isArray(body.events)) throw new OwnerAccessError("Evidence events required.", 400);
    return NextResponse.json(await appendContextEvents(current, Number(body.revision), body.events.map(parseUserEvent)), { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return fail(error); }
}
export async function DELETE(req: Request, route: Route) {
  try {
    requireSameOrigin(req);
    await deleteContext(await scope(req, route));
    return NextResponse.json({ deleted: true, artifactsDeleted: false });
  } catch (error) { return fail(error); }
}
