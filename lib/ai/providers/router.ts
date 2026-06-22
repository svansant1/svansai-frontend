import type { QuestionType } from "@/lib/ai/types";

export type ProviderName = "openai" | "anthropic" | "gemini";

export function getProviderPlan(_questionType: QuestionType): ProviderName[] {
  return ["openai", "anthropic", "gemini"];
}
