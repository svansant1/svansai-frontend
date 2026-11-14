import type { ContextEvent } from "./types";
export const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
export function redactEvidence(text: string): string {
  return text.replace(/\b(authorization\s*:\s*(?:bearer|basic)\s+)\S+/gi, "$1[REDACTED]")
    .replace(/\b(password|passwd|api[_-]?key|access[_-]?token|refresh[_-]?token|secret)\s*[:=]\s*(?:"[^"]*"|'[^']*'|[^\s,;]+)/gi, "$1=[REDACTED]")
    .replace(/-----BEGIN [^-]*PRIVATE KEY-----[\s\S]*?-----END [^-]*PRIVATE KEY-----/g, "[PRIVATE KEY REDACTED]")
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, "[TOKEN REDACTED]");
}
/** Preserve JSON syntax when redacting a generated document specification. */
export function redactStructuredContent(text: string): string {
  if (/^\s*[\[{]/.test(text)) {
    try {
      const visit = (value: unknown, depth = 0): unknown => {
        if (depth > 40) throw new Error("Structured content is too deeply nested.");
        if (typeof value === "string") return redactEvidence(value);
        if (Array.isArray(value)) return value.map(v => visit(v, depth + 1));
        if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, v]) =>
          [key, /^(password|passwd|api[_-]?key|access[_-]?token|refresh[_-]?token|secret)$/i.test(key) ? "[REDACTED]" : visit(v, depth + 1)]));
        return value;
      };
      return JSON.stringify(visit(JSON.parse(text)));
    } catch { /* Non-JSON text uses ordinary best-effort redaction. */ }
  }
  return redactEvidence(text);
}
/** Client evidence is a user report, never authenticated tool output. */
export function parseUserEvent(value: unknown): ContextEvent {
  if (!value || typeof value !== "object") throw new Error("Expected evidence.");
  const event = value as Partial<ContextEvent>;
  if (!UUID.test(event.id || "") || !["target", "scanner", "session"].includes(event.entity || "") ||
    !["identity", "address", "os", "environment", "constraints", "authorization", "finding", "hypothesis", "decision", "attempt", "evidence", "next_action"].includes(event.field || "") ||
    typeof event.value !== "string" || !event.value.trim() || event.value.length > 12_000 ||
    (event.supersedes !== undefined && !UUID.test(event.supersedes))) throw new Error("Invalid evidence fields.");
  let assessment: ContextEvent["assessment"];
  if (event.assessment !== undefined) {
    const a = event.assessment;
    if (!a || !["unconfirmed", "supported", "rejected"].includes(a.status) ||
      (a.confidence !== null && (typeof a.confidence !== "number" || !Number.isFinite(a.confidence) || a.confidence < 0 || a.confidence > 1)) ||
      typeof a.basis !== "string" || !a.basis.trim() || a.basis.length > 1000) throw new Error("An assessment needs a valid status, optional 0–1 confidence, and evidence basis.");
    assessment = { status: a.status, confidence: a.confidence, basis: redactEvidence(a.basis.trim()) };
  }
  return { id: event.id!, entity: event.entity!, field: event.field!, value: redactEvidence(event.value.trim()),
    source: { kind: "user_report", observedAt: new Date().toISOString() }, ...(event.supersedes ? { supersedes: event.supersedes } : {}), ...(assessment ? { assessment } : {}) };
}
