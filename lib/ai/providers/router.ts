import type { QuestionType } from "@/lib/ai/types";

export type ProviderName = "openai" | "anthropic";

export function getProviderPlan(_questionType: QuestionType): ProviderName[] {
  return ["openai", "anthropic"];
}