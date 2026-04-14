import type { QuestionType } from "@/lib/ai/types";

export type ProviderName = "gemini" | "openai" | "anthropic";

export function getProviderPlan(questionType: QuestionType): ProviderName[] {
  switch (questionType) {
    case "coding":
      return ["gemini", "anthropic", "openai"];
    case "tech_support":
      return ["gemini", "openai", "anthropic"];
    case "business":
      return ["gemini", "openai", "anthropic"];
    case "writing":
      return ["gemini", "openai", "anthropic"];
    case "learning":
      return ["gemini", "openai", "anthropic"];
    case "life":
      return ["gemini", "openai", "anthropic"];
    default:
      return ["gemini", "openai", "anthropic"];
  }
}
