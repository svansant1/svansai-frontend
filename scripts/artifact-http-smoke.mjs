import assert from "node:assert/strict";
import net from "node:net";
import path from "node:path";
import { spawn } from "node:child_process";
import JSZip from "jszip";
const root = process.cwd();
const port = await new Promise((resolve) => {
  const server = net.createServer();
  server.listen(0, "127.0.0.1", () => {
    const port = server.address().port;
    server.close(() => resolve(port));
  });
});
const env = {
  ...process.env,
  OPENAI_API_KEY: "",
  ANTHROPIC_API_KEY: "",
  GEMINI_API_KEY: "",
  SUPABASE_SERVICE_ROLE_KEY: "offline-smoke-not-a-real-key",
  TAVILY_API_KEY: "",
  SVANSAI_API_KEY: "offline-smoke-api-key",
  SVANSAI_INTERNAL_API_KEY: "",
};
const child = spawn(
  process.execPath,
  [
    "--import",
    "data:text/javascript," + encodeURIComponent("const original=globalThis.fetch;globalThis.fetch=(input,init)=>{const u=new URL(typeof input==='string'?input:input instanceof URL?input.href:input.url);return ['127.0.0.1','localhost','[::1]'].includes(u.hostname)?original(input,init):Promise.resolve(new Response('{}',{status:503}));};"),
    path.join(root, "node_modules/next/dist/bin/next"),
    "start",
    "--hostname",
    "127.0.0.1",
    "--port",
    String(port),
  ],
  { cwd: root, env, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] },
);
let logs = "";
child.stdout.on("data", (chunk) => (logs += chunk));
child.stderr.on("data", (chunk) => (logs += chunk));
const base = "http://127.0.0.1:" + port;
try {
  let ready = false;
  // Wait for this isolated local process, never a live deployment.
  for (let attempt = 0; attempt < 80; attempt++) {
    try {
      ready = (await fetch(base)).ok;
    } catch {}
    if (ready) break;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  assert.ok(ready, "Local server failed to start.");
  const denied = await fetch(base + "/api/v1/chat", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ messages: [{ role: "user", content: "Create an Excel budget" }] }),
  });
  assert.equal(denied.status, 401, "The API must still require its access key.");
  // Supplied content exercises each real chat route exporter without paid inference.
  for (const endpoint of ["/api/chat", "/api/v1/chat"]) {
  for (const [format, label, content, entry] of [
    [
      "docx",
      "Word document",
      "# Review\n\nThe router is working.",
      "word/document.xml",
    ],
    [
      "pptx",
      "PowerPoint",
      "Overview\n- First item\n- Second item",
      "ppt/presentation.xml",
    ],
    ["xlsx", "Excel workbook", "Name,Count\nRouters,2", "xl/workbook.xml"],
  ]) {
    const response = await fetch(base + endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(endpoint === "/api/v1/chat" ? { "x-svansai-api-key": "offline-smoke-api-key" } : {}),
      },
      body: JSON.stringify({
        messages: [
          {
            role: "user",
            content: `Create a ${label} titled "Smoke"\nContent:\n${content}`,
          },
        ],
        responseMode: "auto",
      }),
    });
    const body = await response.json();
    assert.equal(response.status, 200, JSON.stringify(body));
    assert.equal(body.artifact?.format, format, JSON.stringify(body));
    assert.equal(
      body.orchestration?.artifact,
      undefined,
      "Binary should not duplicate into metadata.",
    );
    const zip = await JSZip.loadAsync(
      Buffer.from(body.artifact.base64, "base64"),
    );
    assert.ok(zip.file(entry), format + " is not a native Office package");
  }
  }
  console.log(
    "PASS: /api/chat and authenticated /api/v1/chat return valid DOCX, PPTX and XLSX downloads; missing API credentials are rejected. No model calls.",
  );
} catch (error) {
  console.error(logs);
  throw error;
} finally {
  const done = new Promise((resolve) => child.once("exit", resolve));
  if (child.exitCode === null) {
    child.kill();
    await done;
  }
}
