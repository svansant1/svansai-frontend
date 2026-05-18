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

export type ResponseMode = "auto" | "direct" | "guide" | "tutor";

export type ChatContext = {
  messages: ChatMessage[];
  latestUserMessage: string;
  questionType: QuestionType;
  memory: MemoryItem[];
  retrieval: RetrievalItem[];
};
