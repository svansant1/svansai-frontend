import type { QuestionType } from "@/lib/ai/types";

export function getProviderPlan(questionType: QuestionType): string[] {
  switch (questionType) {
    case "coding":
      return ["anthropic", "openai", "gemini"];
    case "tech_support":
      return ["openai", "gemini", "anthropic"];
    case "learning":
      return ["gemini", "openai", "anthropic"];
    case "business":
      return ["openai", "gemini", "anthropic"];
    default:
      return ["gemini", "openai", "anthropic"];
  }
}