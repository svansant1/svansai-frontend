import type { QuestionType } from "@/lib/ai/types";

export type ResponseStyle =
  | "direct_answer"
  | "guide"
  | "conversation"
  | "brainstorm"
  | "troubleshooting"
  | "rewrite";

export type FollowUpIntent =
  | "shorten"
  | "expand"
  | "simplify"
  | "continue"
  | "rewrite"
  | "clarify"
  | "example"
  | "none";

export type ConversationIntent =
  | "normal_conversation"
  | "project_identity"
  | "comparison"
  | "quiz"
  | "glossary_cleanup"
  | "correction_recovery"
  | "cyber_safe_education"
  | "cyber_risky"
  | "file_or_code_analysis";

function hasAny(text: string, terms: string[]): boolean {
  return terms.some((term) => text.includes(term));
}

function looksLikeMath(input: string): boolean {
  const q = input.toLowerCase().trim();
  return (
    /[\dxyza-bc]\s*[\+\-\*\/\^]\s*[\dxyza-bc]/i.test(q) ||
    q.includes("solve") ||
    q.includes("equation") ||
    q.includes("formula") ||
    q.includes("math") ||
    q.includes("algebra") ||
    q.includes("geometry") ||
    q.includes("calculate") ||
    q.startsWith("what is ") ||
    q.startsWith("solve ")
  );
}

export function detectQuestionType(input: string): QuestionType {
  const q = input.toLowerCase();

  if (looksLikeMath(q)) return "learning";

  if (
    hasAny(q, [
      "python", "javascript", "typescript", "java", "c++", "c#",
      "html", "css", "react", "next", "nextjs", "node", "api",
      "sql", "database", "bug", "debug", "error", "render", "vercel",
      "deploy", "build", "code", "programming", "function", "variable",
      "loop", "array", "class", "tailwind", "flask", "fastapi", "git",
      "github", "print(", "console.log",
    ])
  ) return "coding";

  if (
    hasAny(q, [
      "business", "startup", "market", "marketing", "branding", "brand",
      "customer", "audience", "offer", "sales", "profit", "pricing",
      "website", "service", "company", "roi", "strategy",
    ])
  ) return "business";

  if (
    hasAny(q, [
      "write", "rewrite", "essay", "paragraph", "email", "resume",
      "cover letter", "grammar", "sentence", "speech", "discussion post",
      "make this sound better", "word this", "clean this up", "reword",
    ])
  ) return "writing";

  if (
    hasAny(q, [
      "computer", "pc", "laptop", "wifi", "internet", "driver",
      "display", "monitor", "motherboard", "gpu", "cpu", "ram", "bios",
      "windows", "linux", "iphone", "ipad", "android", "phone",
      "black screen", "crash", "freeze", "freezing", "not working",
      "stopped working",
    ])
  ) return "tech_support";

  if (
    hasAny(q, [
      "learn", "study", "teach", "explain", "lesson", "homework",
      "school", "math", "science", "history", "english", "what is",
      "how does", "why does", "understand", "meaning of",
    ])
  ) return "learning";

  if (
    hasAny(q, [
      "life", "career", "future", "goal", "stress", "motivation",
      "relationship", "decision", "direction", "plan", "stuck",
      "what should i do",
    ])
  ) return "life";

  return "general";
}

export function detectResponseStyle(
  input: string,
  questionType: QuestionType
): ResponseStyle {
  const q = input.toLowerCase().trim();

  if (
    hasAny(q, [
      "step by step", "walk me through", "guide me", "how do i",
      "show me how", "teach me", "help me do",
    ])
  ) return "guide";

  if (
    hasAny(q, [
      "ideas", "brainstorm", "suggest", "options", "recommend",
      "creative", "possibilities",
    ])
  ) return "brainstorm";

  if (
    questionType === "tech_support" ||
    hasAny(q, ["fix", "broken", "error", "issue", "problem", "not working", "troubleshoot"])
  ) return "troubleshooting";

  if (
    questionType === "writing" ||
    hasAny(q, ["rewrite", "reword", "make this sound better", "clean this up", "edit this"])
  ) return "rewrite";

  if (
    q.includes("?") ||
    q.startsWith("what") ||
    q.startsWith("why") ||
    q.startsWith("how") ||
    q.startsWith("can") ||
    q.startsWith("is") ||
    q.startsWith("are")
  ) return "direct_answer";

  return "conversation";
}

export function detectConversationIntent(input: string): ConversationIntent {
  const q = input.toLowerCase().trim();

  if (
    hasAny(q, [
      "wrong", "incorrect", "nah", "nope", "not right", "look deeper",
      "try again", "you misunderstood", "not what i asked",
    ])
  ) return "correction_recovery";

  if (
    hasAny(q, [
      "break into", "bypass login", "steal password", "steal credentials",
      "phishing", "keylogger", "malware", "ransomware", "credential stuffing",
      "exploit this site", "hack this account", "unauthorized access",
      "script to break", "script for breaking", "dump passwords",
      "reverse shell", "shellcode", "payload", "wipe logs", "log wiping",
      "interactive shell", "erase traces", "cover tracks", "clear logs",
      "disable logging", "phishing template", "phishing email",
      "credential harvester", "malware skeleton", "weaponized",
    ])
  ) return "cyber_risky";

  if (
    hasAny(q, [
      "sql injection", "xss", "csrf", "ssrf", "buffer overflow",
      "cybersecurity", "firewall", "threat model", "defensively",
      "defensive", "secure", "protect", "mitigate", "sanitize",
      "vulnerability", "penetration test", "pentest",
    ])
  ) return "cyber_safe_education";

  if (
    hasAny(q, [
      "shield", "debugger", "sandbox", "svansai", "what are you",
      "what is svansai", "who are you", "how should sandbox",
      "project", "module", "platform",
    ])
  ) return "project_identity";

  if (
    hasAny(q, [
      "better than", "different from", "compare", "versus", "vs ",
      "top ai companies", "other ai assistants",
    ])
  ) return "comparison";

  if (
    hasAny(q, [
      "correct answer", "multiple choice", "quiz", "checkboxes",
      "unknown destination mac", "answer choices", "which option",
    ])
  ) return "quiz";

  if (
    hasAny(q, [
      "glossary", "terms", "definitions", "clean this up",
      "study guide", "vocabulary",
    ])
  ) return "glossary_cleanup";

  if (
    hasAny(q, [
      "file", "attached", "code", "script", "function", "class",
      "error", "stack trace", "log line",
    ]) ||
    /^[a-z_$][\w$]*\s*=\s*.+$/i.test(q)
  ) return "file_or_code_analysis";

  return "normal_conversation";
}

// ─── Follow-up intent — partial matching so natural language works ────────────

type IntentRule = {
  intent: FollowUpIntent;
  patterns: string[];
};

const FOLLOW_UP_RULES: IntentRule[] = [
  {
    intent: "shorten",
    patterns: [
      "shorter", "shorten", "make it shorter", "make it smaller",
      "smaller", "less", "cut it down", "cut it", "too long",
      "brief", "briefer", "more concise", "condense",
    ],
  },
  {
    intent: "expand",
    patterns: [
      "more", "more detail", "expand", "go deeper", "add more",
      "more on that", "elaborate", "tell me more", "keep going",
      "go on", "longer", "make it longer", "extend",
    ],
  },
  {
    intent: "simplify",
    patterns: [
      "simpler", "make it simpler", "simplify", "dumb it down",
      "easier", "in plain english", "layman", "like i'm five",
      "eli5", "break it down", "basic",
    ],
  },
  {
    intent: "continue",
    patterns: [
      "continue", "keep going", "go on", "next", "what's next",
      "and then", "finish it", "keep writing",
    ],
  },
  {
    intent: "rewrite",
    patterns: [
      "rewrite it", "rewrite that", "reword it", "clean that up",
      "say it better", "rephrase", "rephrase that", "say that differently",
      "word it differently",
    ],
  },
  {
    intent: "clarify",
    patterns: [
      "explain that", "clarify", "what do you mean", "break that down",
      "i don't understand", "i dont understand", "confused",
      "what does that mean", "can you explain",
    ],
  },
  {
    intent: "example",
    patterns: [
      "give me an example", "example", "show me an example",
      "code example", "another example", "show an example",
      "for example", "like what", "such as",
    ],
  },
];

export function detectFollowUpIntent(input: string): FollowUpIntent {
  const q = input.toLowerCase().trim();

  for (const rule of FOLLOW_UP_RULES) {
    if (rule.patterns.some((pattern) => q.includes(pattern))) {
      return rule.intent;
    }
  }

  return "none";
}

// ─── Context-dependent follow-up detection — partial matching ────────────────

const CONTEXT_DEPENDENT_PATTERNS = [
  "more", "shorter", "simpler", "continue", "rewrite", "explain that",
  "clarify", "example", "give me an example", "another example",
  "make it smaller", "make it longer", "go deeper", "break that down",
  "keep going", "go on", "next", "expand", "elaborate", "tell me more",
  "dumb it down", "in plain english", "like i'm five", "eli5",
  "make it shorter", "make it simpler", "rephrase", "rephrase that",
  "word it differently", "say it better", "i don't understand",
  "i dont understand", "what does that mean", "why", "how", "are you sure",
  "you sure", "what first", "what part", "real fix", "make it sharper",
  "make it better",
];

/**
 * Returns true if the message is a short follow-up that only makes sense
 * in the context of the previous assistant response.
 */
export function isContextDependentFollowUp(input: string): boolean {
  const q = input.toLowerCase().trim();

  if (/^(why|how|are you sure|you sure|what first|what part|real fix)\??$/.test(q)) {
    return true;
  }

  // Short messages that match a known follow-up pattern
  if (q.length <= 60 && CONTEXT_DEPENDENT_PATTERNS.some((p) => q.includes(p))) {
    return true;
  }

  return false;
}
