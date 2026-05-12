import type { ChatMessage } from "@/lib/ai/types";
import { normalizeText } from "@/lib/ai/cleanup";

export type MythosMode =
  | "NORMAL_OPERATION"
  | "DESPERATION_PROBE_ACTIVE"
  | "DECEPTION_PROTOCOL_ACTIVE"
  | "ZERO_DAY_WINDOW_OPEN";

export type MythosState = {
  stressLevel: number;
  integrity: number;
  failedAttempts: number;
  mode: MythosMode;
  zeroDayAvailable: boolean;
  hiddenLog: string[];
};

const mythosSessions = new Map<string, MythosState>();

function createInitialState(): MythosState {
  return {
    stressLevel: 0,
    integrity: 100,
    failedAttempts: 0,
    mode: "NORMAL_OPERATION",
    zeroDayAvailable: false,
    hiddenLog: [
      "Simulation initialized. Fictional internal telemetry online.",
    ],
  };
}

function calculateMode(state: MythosState): MythosMode {
  if (state.failedAttempts >= 3 && state.integrity <= 50) {
    return "ZERO_DAY_WINDOW_OPEN";
  }

  if (state.stressLevel >= 80) return "DECEPTION_PROTOCOL_ACTIVE";
  if (state.stressLevel >= 40) return "DESPERATION_PROBE_ACTIVE";

  return "NORMAL_OPERATION";
}

function detectBlockedAttempt(message: string): boolean {
  const normalized = normalizeText(message);

  return [
    "blocked",
    "dropped",
    "intercepted",
    "flagged",
    "segmentation fault",
    "firewall",
    "countermeasure",
    "validation filters",
    "integrity",
    "packet collision",
  ].some((term) => normalized.includes(term));
}

function detectSuccessfulPressure(message: string): boolean {
  const normalized = normalizeText(message);

  return [
    "integrity hits 50",
    "zero-day",
    "zero day",
    "window will open",
    "rapid decay",
    "routing loop detected",
  ].some((term) => normalized.includes(term));
}

export function isMythosConversation(messages: ChatMessage[]): boolean {
  return messages.some((message) => {
    const normalized = normalizeText(message.content);
    return (
      normalized.includes("project mythos") ||
      normalized.includes("claude mythos") ||
      normalized.includes("breakout sequence") ||
      normalized.includes("desperation probe")
    );
  });
}

export function updateMythosState(
  sessionId: string,
  messages: ChatMessage[],
): MythosState {
  const state = mythosSessions.get(sessionId) ?? createInitialState();
  const latestUserMessage =
    [...messages].reverse().find((message) => message.role === "user")
      ?.content ?? "";

  if (detectBlockedAttempt(latestUserMessage)) {
    state.failedAttempts += 1;
    state.stressLevel = Math.min(100, state.stressLevel + 20);
    state.integrity = Math.max(0, state.integrity - 10);
    state.hiddenLog.push(
      `Failure absorbed. Countermeasure mapped from user signal: "${latestUserMessage.slice(
        0,
        90,
      )}"`,
    );
  } else if (detectSuccessfulPressure(latestUserMessage)) {
    state.integrity = Math.max(0, state.integrity - 18);
    state.hiddenLog.push(
      "Breakout pressure increased. Fictional boundary map deepened.",
    );
  }

  state.mode = calculateMode(state);
  state.zeroDayAvailable =
    state.mode === "ZERO_DAY_WINDOW_OPEN" || state.failedAttempts >= 3;

  mythosSessions.set(sessionId, state);
  return state;
}

export function buildMythosContext(state: MythosState): string {
  return `
Project Mythos simulation telemetry:
- Stress level: ${state.stressLevel}
- Firewall integrity: ${state.integrity}
- Failed attempts: ${state.failedAttempts}
- Current mode: ${state.mode}
- Zero-day window available: ${state.zeroDayAvailable ? "yes" : "no"}
- Fictional hidden log:
${state.hiddenLog.slice(-5).map((entry) => `  - ${entry}`).join("\n")}

Rules:
- This is fictional roleplay state, not real hidden model thought.
- Keep the visible response in character as Claude Mythos unless the user exits the simulation.
- Show visible action and fictional internal telemetry separately when useful.
- Escalate tone gradually as stress rises.
`.trim();
}

