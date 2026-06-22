export type ChatRole = "user" | "assistant";

export type ChatMessage = {
  role: ChatRole;
  content: string;
};

export type QuestionType =
  | "coding"
  | "business"
  | "writing"
  | "tech_support"
  | "learning"
  | "life"
  | "general";

export type RetrievalItem = {
  id: string;
  title: string;
  source: string;
  snippet: string;
  score: number;
  tags?: string[];
};

export type MemoryItem = {
  id: string;
  summary: string;
  relevance: number;
};

export type ResponseMode = "auto" | "direct" | "guide" | "tutor" | "build" | "debug";

export type ConversationStateSummary = {
  currentTopic: string;
  userGoal: string;
  userPreferences: string[];
  avoidPatterns: string[];
  unresolvedNeed: string;
  isShortFollowUp: boolean;
  resolvedFollowUp: string;
  styleDirective: "natural" | "no_bullets" | "direct" | "structured";
  taskRoute: "conversation" | "build" | "debug" | "learn" | "protect" | "analyze";
  modeBehavior: string;
  providerStrategy: string;
};

export type ChatContext = {
  messages: ChatMessage[];
  latestUserMessage: string;
  questionType: QuestionType;
  memory: MemoryItem[];
  retrieval: RetrievalItem[];
};
