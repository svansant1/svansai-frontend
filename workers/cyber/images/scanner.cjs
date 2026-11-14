// Fixed diagnostic: no user-supplied URLs, command strings, or credentials.
const { setTimeout: delay } = require("node:timers/promises");
async function main() {
  let ready = false;
  // Wait briefly for this run's synthetic fixture, never for an external service.
  for (let attempt = 0; attempt < 20; attempt++) {
    try { const r = await fetch("http://127.0.0.1:8080/weak", { signal: AbortSignal.timeout(500), redirect: "error" }); await r.arrayBuffer(); ready = r.ok; }
    catch {}
    if (ready) break;
    await delay(200);
  }
  if (!ready) throw new Error("Isolated fixture unavailable.");
  const results = [];
  // Compare the same fixed header contract across weak and hardened fixture routes.
  for (const path of ["/weak", "/hardened"]) {
    const r = await fetch("http://127.0.0.1:8080" + path, { method: "HEAD", signal: AbortSignal.timeout(2000), redirect: "error" });
    const headers = {};
    for (const name of ["content-security-policy", "x-content-type-options", "referrer-policy"]) headers[name] = r.headers.get(name);
    results.push({ path, status: r.status, headers, missing: Object.keys(headers).filter(name => !headers[name]) });
  }
  process.stdout.write(JSON.stringify({ observation: "tool_observation", target: "synthetic fixture only", results }) + "\n");
  if (results[1].missing.length) process.exitCode = 1;
}
void main().catch(() => { process.stderr.write("Fixture diagnostic could not complete.\n"); process.exitCode = 2; });
