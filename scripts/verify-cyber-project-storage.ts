import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { createProject, listProjects } from "../lib/projects/store";
import { ownerDatabase } from "../lib/auth/owner-session";

// Explicit live acceptance only. Not part of the offline *.test.ts suite.
// Creates one uniquely named project, verifies it through the real store, then removes only that fixture.
async function main() {
  const args = process.argv.slice(2);
  const arg = (key: string) => args[args.indexOf(key) + 1];
  const projectRef = arg("--project-ref"), userId = arg("--user-id");
  assert.ok(args.includes("--confirm-live"), "Live verification requires --confirm-live");
  assert.match(projectRef || "", /^[a-z0-9]{20}$/);
  assert.match(userId || "", /^[a-f0-9-]{36}$/i);
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  assert.equal(new URL(url).hostname, `${projectRef}.supabase.co`, "Wrong database target");
  const db = ownerDatabase();
  const owner = await db.auth.admin.getUserById(userId);
  assert.ok(!owner.error && owner.data.user?.id === userId, "Verification account is unavailable");
  const name = "__svans_project_verification__" + randomUUID();
  let createdId: string | undefined;
  try {
    const created = await createProject(userId, name); createdId = created.id;
    assert.ok((await listProjects(userId)).some(p => p.id === created.id && p.name === name));
    assert.ok(!(await listProjects(randomUUID())).some(p => p.id === created.id));
    const anonymous = createClient(url, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, { auth: { persistSession: false, autoRefreshToken: false } });
    const denied = await anonymous.from("sv_projects").select("id").eq("id", created.id);
    assert.ok(denied.error, "Direct anonymous project access must be denied");
    console.log("PASS: Real project create/list, account filtering and anonymous access denial.");
  } finally {
    // Exact generated name + account prevents cleanup from touching any real project.
    const deleted = await db.from("sv_projects").delete().eq("user_id", userId).eq("name", name);
    assert.ok(!deleted.error, "Verification fixture cleanup failed");
    if (createdId) assert.ok(!(await listProjects(userId)).some(p => p.id === createdId));
    console.log("PASS: Temporary project removed; no project fixtures retained.");
  }
}
main().catch(error => { console.error(error instanceof Error ? error.message : "Verification failed"); process.exitCode = 1; });
