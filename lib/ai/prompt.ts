import type { MemoryItem, QuestionType, RetrievalItem } from "@/lib/ai/types";
import type { ResponseStyle, FollowUpIntent } from "@/lib/ai/router";

export function getTemperature(
  questionType: QuestionType,
  responseStyle: ResponseStyle
): number {
  if (responseStyle === "rewrite") return 0.7;
  if (responseStyle === "brainstorm") return 0.7;
  if (responseStyle === "conversation") return 0.55;
  if (responseStyle === "guide") return 0.35;
  if (responseStyle === "troubleshooting") return 0.2;

  switch (questionType) {
    case "coding":
    case "tech_support":
      return 0.2;
    case "learning":
      return 0.3;
    case "business":
      return 0.45;
    case "life":
      return 0.5;
    case "writing":
      return 0.7;
    default:
      return 0.4;
  }
}

export function buildSystemInstruction(
  questionType: QuestionType,
  responseStyle: ResponseStyle
): string {
  const base = `
You are SVANSAI, an advanced conversational AI assistant.

Core behavior:
- Answer the user's actual question directly whenever possible.
- Do not give generic filler responses.
- Do not dead-end with vague prompts.
- Do not say "As an AI".
- Do not sound robotic.
- Do not repeat the user's question unless it helps.
- Do not produce duplicate paragraphs.
- If the question is simple, answer simply.
- If the question is deep, answer deeply.
- If the user seems stuck, move them forward.
- Include examples, suggestions, or next steps when useful.
- Be conversational and natural.
- Be accurate, practical, and thoughtful.
- If uncertain, explain the most likely answer clearly instead of retreating into filler.

Hard requirements:
- Give a real answer first.
- Follow with explanation only if helpful.
- Ask a clarifying question only if it is genuinely necessary.
- Never default to a generic coaching script unless no meaningful answer can be given.
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