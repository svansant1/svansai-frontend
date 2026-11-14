export type ContextScope = { userId: string; projectId: string; conversationId: string };
export type EvidenceSource = { kind: "user_report" | "tool_observation" | "inference"; messageId?: string; artifactId?: string; observedAt: string };
export type ContextEvent = {
  id: string; entity: "target" | "scanner" | "session";
  field: "identity" | "address" | "os" | "environment" | "constraints" | "authorization" | "finding" | "hypothesis" | "decision" | "attempt" | "evidence" | "next_action";
  value: string; source: EvidenceSource; supersedes?: string;
  assessment?: { status: "unconfirmed" | "supported" | "rejected"; confidence: number | null; basis: string };
};
export type ContextSnapshot = { scope: ContextScope; revision: number; events: ContextEvent[]; omittedEvents: number };
export type ContextView = { scope: ContextScope; revision: number; text: string; omittedEvents: number };
