import type { ContextEvent, ContextView } from "./types";

export type CyberStepStatus = "proposed" | "completed" | "failed" | "blocked" | "rejected";
export type CyberEvidenceWatermark = { observedAt: string | null; ids: string[] };
export type CyberProgress = {
  version: 1; type: "cyber_step"; stepId: string; action: string; machine: string; environment: string;
  reason: string; status: CyberStepStatus; result: string | null; evidenceIds: string[];
  evidenceWatermark: CyberEvidenceWatermark;
};
export type SavedCyberProgress = CyberProgress & { eventId: string };

/** A duplicate guard, not a command interpreter or execution authority. */
export function cyberStepKey(step: Pick<CyberProgress, "action" | "machine" | "environment">): string {
  const spaces = (s: string) => s.trim().replace(/\s+/g, " ");
  let action = spaces(step.action);
  // PowerShell cmdlet names are case-insensitive. Arguments/quoted values are left intact.
  if (/\b(?:powershell|pwsh)\b/i.test(step.environment)) action = action.replace(/^[a-z][a-z0-9-]*(?=\s|$)/i, command => command.toLowerCase());
  return JSON.stringify([action, spaces(step.machine).toLowerCase(), spaces(step.environment).toLowerCase()]);
}

export function cyberEvidenceWatermark(view: ContextView, previous?: CyberEvidenceWatermark): CyberEvidenceWatermark {
  const evidence = (view.events ?? []).filter(e => e.source.kind !== "inference");
  const dates = evidence.map(e => Date.parse(e.source.observedAt)).filter(Number.isFinite);
  if (previous?.observedAt) dates.push(Date.parse(previous.observedAt));
  return { observedAt: dates.length ? new Date(Math.max(...dates)).toISOString() : null,
    ids: [...new Set([...evidence.sort((a, b) => Date.parse(b.source.observedAt) - Date.parse(a.source.observedAt)).map(e => e.id), ...(previous?.ids ?? [])])].slice(0, 256) };
}

/** "New" means not already available at the last proposal/outcome, not merely uncited. */
export function isNewCyberEvidence(event: ContextEvent, step: CyberProgress): boolean {
  const time = Date.parse(event.source.observedAt);
  return event.source.kind !== "inference" && !step.evidenceIds.includes(event.id) && !step.evidenceWatermark.ids.includes(event.id) &&
    Number.isFinite(time) && (step.evidenceWatermark.observedAt === null || time >= Date.parse(step.evidenceWatermark.observedAt));
}

export function readCyberProgress(view: ContextView): SavedCyberProgress[] {
  const events = view.events ?? [];
  const superseded = new Set(events.map(e => e.supersedes).filter(Boolean));
  const result: SavedCyberProgress[] = [];
  for (const event of events) {
    // Client context writes always become user_report; arbitrary pasted JSON is not this ledger.
    if (superseded.has(event.id) || event.source.kind !== "inference" || event.entity !== "session" || event.field !== "next_action") continue;
    try {
      const p = JSON.parse(event.value) as CyberProgress;
      if (p.version !== 1 || p.type !== "cyber_step" || !["proposed", "completed", "failed", "blocked", "rejected"].includes(p.status)) continue;
      if (![p.stepId, p.action, p.machine, p.environment, p.reason].every(s => typeof s === "string" && s.length > 0 && s.length <= 2000)) continue;
      if (p.result !== null && (typeof p.result !== "string" || p.result.length > 1200)) continue;
      if (!Array.isArray(p.evidenceIds) || p.evidenceIds.length > 64 || !p.evidenceIds.every(s => typeof s === "string" && s.length <= 100)) continue;
      if (!p.evidenceWatermark || !Array.isArray(p.evidenceWatermark.ids) || p.evidenceWatermark.ids.length > 256 ||
        !p.evidenceWatermark.ids.every(s => typeof s === "string" && s.length <= 100) ||
        (p.evidenceWatermark.observedAt !== null && !Number.isFinite(Date.parse(p.evidenceWatermark.observedAt)))) continue;
      result.push({ ...p, eventId: event.id });
    } catch { /* Legacy/free-text next actions remain evidence, not structured step records. */ }
  }
  return result;
}
