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

  if (looksLikeMath(q)) {
    return "learning";
  }

  if (
    hasAny(q, [
      "python",
      "javascript",
      "typescript",
      "java",
      "c++",
      "c#",
      "html",
      "css",
      "react",
      "next",
      "nextjs",
      "node",
      "api",
      "sql",
      "database",
      "bug",
      "debug",
      "error",
      "render",
      "vercel",
      "deploy",
      "build",
      "code",
      "programming",
      "function",
      "variable",
      "loop",
      "array",
      "class",
      "tailwind",
      "flask",
      "fastapi",
      "git",
      "github",
      "print(",
      "console.log",
    ])
  ) {
    return "coding";
  }

  if (
    hasAny(q, [
      "business",
      "startup",
      "market",
      "marketing",
      "branding",
      "brand",
      "customer",
      "audience",
      "offer",
      "sales",
      "profit",
      "pricing",
      "website",
      "service",
      "company",
      "roi",
      "strategy",
    ])
  ) {
    return "business";
  }

  if (
    hasAny(q, [
      "write",
      "rewrite",
      "essay",
      "paragraph",
      "email",
      "resume",
      "cover letter",
      "grammar",
      "sentence",
      "speech",
      "discussion post",
      "make this sound better",
      "word this",
      "clean this up",
      "reword",
    ])
  ) {
    return "writing";
  }

  if (
    hasAny(q, [
      "computer",
      "pc",
      "laptop",
      "wifi",
      "internet",
      "driver",
      "display",
      "monitor",
      "motherboard",
      "gpu",
      "cpu",
      "ram",
      "bios",
      "windows",
      "linux",
      "iphone",
      "ipad",
      "android",
      "phone",
      "black screen",
      "crash",
      "freeze",
      "freezing",
      "not working",
      "stopped working",
    ])
  ) {
    return "tech_support";
  }

  if (
    hasAny(q, [
      "learn",
      "study",
      "teach",
      "explain",
      "lesson",
      "homework",
      "school",
      "math",
      "science",
      "history",
      "english",
      "what is",
      "how does",
      "why does",
      "understand",
      "meaning of",
    ])
  ) {
    return "learning";
  }

  if (
    hasAny(q, [
      "life",
      "career",
      "future",
      "goal",
      "stress",
      "motivation",
      "relationship",
      "decision",
      "direction",
      "plan",
      "stuck",
      "what should i do",
    ])
  ) {
    return "life";
  }

  return "general";
}

export function detectResponseStyle(
  input: string,
  questionType: QuestionType
): ResponseStyle {
  const q = input.toLowerCase().trim();

  if (
    hasAny(q, [
      "step by step",
      "walk me through",
      "guide me",
      "how do i",
      "show me how",
      "teach me",
      "help me do",
    ])
  ) {
    return "guide";
  }

  if (
    hasAny(q, [
      "ideas",
      "brainstorm",
      "suggest",
      "options",
      "recommend",
      "creative",
      "possibilities",
    ])
  ) {
    return "brainstorm";
  }

  if (
    questionType === "tech_support" ||
    hasAny(q, [
      "fix",
      "broken",
      "error",
      "issue",
      "problem",
      "not working",
      "troubleshoot",
    ])
  ) {
    return "troubleshooting";
  }

  if (
    questionType === "writing" ||
    hasAny(q, [
      "rewrite",
      "reword",
      "make this sound better",
      "clean this up",
      "edit this",
    ])
  ) {
    return "rewrite";
  }

  if (
    q.includes("?") ||
    q.startsWith("what") ||
    q.startsWith("why") ||
    q.startsWith("how") ||
    q.startsWith("can") ||
    q.startsWith("is") ||
    q.startsWith("are")
  ) {
    return "direct_answer";
  }

  return "conversation";
}

export function detectFollowUpIntent(input: string): FollowUpIntent {
  const q = input.toLowerCase().trim();

  if (
    [
      "a little",
      "shorter",
      "make it shorter",
      "smaller",
      "less",
      "cut it down",
      "shorten it",
    ].includes(q)
  ) {
    return "shorten";
  }

  if (
    [
      "more",
      "more detail",
      "expand",
      "go deeper",
      "add more",
      "more on that",
    ].includes(q)
  ) {
    return "expand";
  }

  if (
    [
      "simpler",
      "make it simpler",
      "simplify",
      "dumb it down",
      "easier",
    ].includes(q)
  ) {
    return "simplify";
  }

  if (["continue", "keep going", "go on", "next"].includes(q)) {
    return "continue";
  }

  if (
    [
      "rewrite it",
      "rewrite that",
      "reword it",
      "clean that up",
      "say it better",
    ].includes(q)
  ) {
    return "rewrite";
  }

  if (
    [
      "explain that",
      "clarify",
      "what do you mean",
      "break that down",
    ].includes(q)
  ) {
    return "clarify";
  }

  if (
    [
      "give me an example",
      "example",
      "show me an example",
      "code example",
      "another example",
    ].includes(q)
  ) {
    return "example";
  }

  return "none";
}

export function isContextDependentFollowUp(input: string): boolean {
  const q = input.toLowerCase().trim();

  const explicitFollowUps = [
    "a little",
    "more",
    "shorter",
    "simpler",
    "continue",
    "rewrite it",
    "rewrite that",
    "explain that",
    "clarify",
    "example",
    "give me an example",
    "another example",
    "make it smaller",
    "make it longer",
    "go deeper",
    "break that down",
  ];

  return explicitFollowUps.includes(q);
}