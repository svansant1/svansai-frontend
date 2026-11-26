import assert from "node:assert/strict";
import net from "node:net";
import path from "node:path";
import { spawn } from "node:child_process";
import JSZip from "jszip";
import { PDFDocument } from "pdf-lib";
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
  SVANSAI_APP_ORIGINS: `http://127.0.0.1:${port},https://svansai.com`,
  SVANSAI_JOBS_ENABLED: "0",
  SVANSAI_ARTIFACT_STORAGE_ENABLED: "0",
  SVANSAI_LABS_ENABLED: "0",
  SVANSAI_ADMIN_CYBER_MODE_ENABLED: "0",
  SVANSAI_CYBER_EXECUTION_ENABLED: "0",
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
  const owner = await fetch(base + "/api/system/owner-access");
  assert.equal(owner.status, 200);
  const status = await owner.json();
  assert.equal(status.owner, false);
  assert.equal(status.unlocked, false);
  assert.equal(owner.headers.get("cache-control"), "no-store");
  // A public origin must reach sign-in despite the local server's internal URL.
  for (const [origin, expected] of [["https://svansai.com", 401], ["https://untrusted.example", 403], ["null", 403], [undefined, 403]]) {
    const response = await fetch(base + "/api/projects", {
      method: "POST", headers: { "content-type": "application/json", ...(origin ? { origin } : {}) }, body: "{}",
    });
    assert.equal(response.status, expected, "Project origin boundary: " + origin);
    if (expected === 401) assert.deepEqual(await response.json(), { error: "Sign in to create a project." });
  }
  for (const origin of [base, "https://untrusted.example"]) {
    const response = await fetch(base + "/api/system/owner-access", {
      method: "POST", headers: { "content-type": "application/json", origin },
      body: JSON.stringify({ action: "unlock", password: "not-a-real-password" }),
    });
    assert.equal(response.status, 403, "Anonymous and cross-origin unlocks must fail closed.");
    assert.equal(response.headers.get("set-cookie"), null);
  }
  for (const [endpoint, expected] of [["/api/projects", 401], ["/api/cyber/runs", 403], ["/api/artifacts/00000000-0000-4000-8000-000000000000", 401]]) {
    const response = await fetch(base + endpoint);
    assert.equal(response.status, expected, endpoint + " must reject anonymous access.");
  }
  for (const endpoint of ["/api/chat", "/api/v1/chat"]) {
    const response = await fetch(base + endpoint, {
      method: "POST", headers: { "content-type": "application/json", origin: base,
        ...(endpoint === "/api/v1/chat" ? { "x-svansai-api-key": "offline-smoke-api-key" } : {}) },
      body: JSON.stringify({ cyberMode: true, messages: [{ role: "user", content: "Review my authorized lab findings." }] }),
    });
    assert.equal(response.status, 403, endpoint + " must not accept a forged Cyber Lab flag.");
  }
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
    ["xlsx", "interactive Excel workbook. Do not create a static reference table.", JSON.stringify({version:1,title:"Formula smoke",sheets:[{name:"Inputs",cells:[{address:"A1",value:3,style:"input"}],validations:[{range:"A1",type:"whole",minimum:0,maximum:10}]},{name:"Summary",cells:[{address:"A1",formula:"Inputs!A1*2",style:"output"}]}]}), "xl/worksheets/sheet2.xml"],
    ["docx", "Word document", JSON.stringify({version:1,kind:"docx",pageNumbers:true,blocks:[{type:"table",columns:["Item","Value"],rows:[["Native table","Yes"]]}]}), "word/footer1.xml"],
    ["pptx", "PowerPoint", JSON.stringify({version:1,kind:"pptx",slides:[{title:"Native slide",bullets:["Editable content"],notes:"Speaker note"}]}), "ppt/notesSlides/notesSlide1.xml"],
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
  for (const [format, label, content] of [
    ["pdf", "PDF document", "Local PDF export works."],
    ["csv", "CSV file", "Name,Count\nRouters,2"],
    ["txt", "text file", "Local text export works."],
    ["md", "Markdown file", "# Local export\n\nMarkdown content."],
  ]) {
    const response = await fetch(base + endpoint, {
      method: "POST", headers: { "content-type": "application/json",
        ...(endpoint === "/api/v1/chat" ? { "x-svansai-api-key": "offline-smoke-api-key" } : {}) },
      body: JSON.stringify({ messages: [{ role: "user", content: `Create a ${label} titled "Smoke"\nContent:\n${content}` }] }),
    });
    const body = await response.json();
    assert.equal(response.status, 200, JSON.stringify(body));
    assert.equal(body.artifact?.format, format, JSON.stringify(body));
    assert.equal(body.orchestration?.artifact, undefined);
    const bytes = Buffer.from(body.artifact.base64, "base64");
    if (format === "pdf") assert.equal((await PDFDocument.load(bytes)).getPageCount(), 1);
    else if (format === "csv") assert.equal(bytes.toString("utf8").replace(/\r\n/g, "\n").trim(), '"Name","Count"\n"Routers","2"');
    else assert.equal(bytes.toString("utf8").replace(/\r\n/g, "\n").trim(), content);
  }
  }
  console.log(
    "PASS: Both chat routes return native DOCX/PPTX/XLSX/PDF and CSV/TXT/MD downloads (20 exports). API keys, owner controls, private resources and forged Cyber Lab flags enforce access checks. External fetches blocked; no paid model calls.",
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
