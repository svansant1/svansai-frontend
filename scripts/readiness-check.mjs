const baseUrl = process.env.SVANSAI_TEST_URL || "http://localhost:3000";

const response = await fetch(`${baseUrl}/api/system/readiness`, {
  headers: { "x-forwarded-for": process.env.SVANSAI_TEST_CLIENT_IP || "127.0.0.203" },
});
const report = await response.json();

console.log(`SVANS-AI readiness: ${report.ok ? "OK" : "NEEDS ATTENTION"}`);
console.log(`Generated: ${report.generatedAt}`);

for (const check of report.checks ?? []) {
  const mark = check.status === "ok" ? "✓" : check.status === "warning" ? "!" : "✗";
  console.log(`${mark} ${check.name}: ${check.detail}`);
}

if (!report.ok) process.exitCode = 1;
