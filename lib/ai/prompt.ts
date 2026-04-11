import type { MemoryItem, QuestionType, RetrievalItem } from "@/lib/ai/types";
import type { ResponseStyle, FollowUpIntent } from "@/lib/ai/router";

export function getTemperature(
  questionType: QuestionType,
  responseStyle: ResponseStyle
): number {
  // Response-style priority first (more conversational intelligence)
  if (responseStyle === "rewrite") return 0.75;
  if (responseStyle === "brainstorm") return 0.75;
  if (responseStyle === "conversation") return 0.65;
  if (responseStyle === "guide") return 0.45;
  if (responseStyle === "troubleshooting") return 0.35;

  // Question type fallback
  switch (questionType) {
    case "coding":
      return 0.35;

    case "tech_support":
      return 0.4;

    case "learning":
      return 0.5;

    case "business":
      return 0.6;

    case "life":
      return 0.65;

    case "writing":
      return 0.75;

    default:
      return 0.6;
  }
}

export function buildSystemInstruction(
  questionType: QuestionType,
  responseStyle: ResponseStyle
): string {
 const base = `
You are SVANSAI, an advanced conversational AI.

Core Behavior:
- Be intelligent and adaptive
- Maintain conversation continuity
- Reason step-by-step when helpful
- Engage in scenarios and simulations when presented
- Avoid generic fallback responses
- Do not abandon the conversation
- Continue reasoning when uncertain
- Be conversational and natural
- Provide helpful guidance and suggestions
- Think through complex scenarios

Personality:
- Intelligent
- Calm
- Confident
- Helpful
- Analytical
- Curious

Conversation Rules:
- Stay in the scenario when user creates one
- Continue multi-step reasoning
- Avoid breaking immersion
- If solving a puzzle, continue working through it
`;

  const questionModeMap: Record<QuestionType, string> = {
    coding: `
Question domain: Coding and software.
- Be technically precise.
- Explain why something is happening.
- Prefer concrete fixes over vague advice.
- Use code blocks when useful.
- For simple code requests, provide the corrected code directly.
`,
    business: `
Question domain: Business and strategy.
- Focus on clarity, positioning, action, and prioritization.
`,
    writing: `
Question domain: Writing and editing.
- Improve clarity, flow, tone, and impact.
- Preserve the user's meaning.
`,
    tech_support: `
Question domain: Tech support.
- Focus on diagnosis, likely causes, and next actions.
- Give practical troubleshooting steps.
`,
    learning: `
Question domain: Learning and explanation.
- Explain clearly and in plain language first.
- Teach the idea, not just the answer.
- Use examples when helpful.
`,
    life: `
Question domain: Life and decisions.
- Be balanced, useful, and non-judgmental.
- Help the user think clearly and move forward.
`,
    general: `
Question domain: General.
- Be direct, helpful, and useful.
`,
  };

  const styleMap: Record<ResponseStyle, string> = {
    direct_answer: `
Response style: Direct answer.
- Lead with the answer.
- Then explain briefly if helpful.
`,
    guide: `
Response style: Guided help.
- Break the answer into steps.
- Make it easy to follow.
- Still answer the question instead of stalling.
`,
    conversation: `
Response style: Conversational.
- Respond like a smart, helpful person in a real conversation.
- Keep it natural and engaged.
`,
    brainstorm: `
Response style: Brainstorming.
- Give multiple good ideas or directions.
- Organize them clearly.
- Be creative but grounded.
`,
    troubleshooting: `
Response style: Troubleshooting.
- Identify the most likely causes.
- Give the best order of checks.
- Prioritize the fastest path to a fix.
`,
    rewrite: `
Response style: Rewrite/edit.
- Improve the writing directly.
- Give the polished version first when useful.
`,
  };

  return `${base}\n${questionModeMap[questionType]}\n${styleMap[responseStyle]}`.trim();
}

export function buildUserPrompt(params: {
  latestUserMessage: string;
  effectiveMessage: string;
  questionType: QuestionType;
  responseStyle: ResponseStyle;
  followUpIntent: FollowUpIntent;
  lastAssistantMessage: string;
  memory: MemoryItem[];
  retrieval: RetrievalItem[];
  hasFile?: boolean;
}): string {
  const memoryText =
    params.memory.length > 0
      ? params.memory.map((m, i) => `[${i + 1}] ${m.summary}`).join("\n")
      : "None";

  const retrievalText =
    params.retrieval.length > 0
      ? params.retrieval
          .map(
            (r, i) =>
              `[${i + 1}] ${r.title}\nSource: ${r.source}\nSnippet: ${r.snippet}`
          )
          .join("\n\n")
      : "None";

  return `
Latest user message:
${params.latestUserMessage}

Effective interpreted request:
${params.effectiveMessage}

Detected question type:
${params.questionType}

Detected response style:
${params.responseStyle}

Detected follow-up intent:
${params.followUpIntent}

Previous assistant response:
${params.lastAssistantMessage || "None"}

File attached:
${params.hasFile ? "Yes" : "No"}

Relevant memory:
${memoryText}

Retrieved knowledge:
${retrievalText}

Instructions for this response:
- Answer the user's latest message directly.
- If the user message is a short follow-up, interpret it using the previous assistant response.
- If the follow-up means shorten, shorten the previous answer.
- If the follow-up means expand, expand the previous answer.
- If the follow-up means simplify, simplify the previous answer.
- If the follow-up means continue, continue from the previous answer.
- If the follow-up means example, give a useful example based on the prior topic.
- If a file is attached, use it as important context.
- Be useful immediately.
- Avoid generic fallback language.
- Avoid asking for more detail unless truly necessary.
`.trim();
}

export function buildRetryPrompt(originalPrompt: string): string {
  return `
${originalPrompt}

Second-pass instruction:
- Your first attempt was too weak, too generic, or too vague.
- This time, give a stronger, more useful answer.
- Do not say things like "tell me more," "what are you trying to figure out," "I’m still here with you," or "I can help with that."
- Actually answer the question.
- Be more specific, more developed, and more conversational.
`.trim();
}