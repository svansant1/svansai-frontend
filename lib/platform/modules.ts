import type { AttachedFile } from "@/lib/ai/file-types";
import type { ChatMessage, ResponseMode } from "@/lib/ai/types";
import type { PlatformCapability, PlatformModule, TaskRoute } from "@/lib/platform/orchestrator";

export type ModuleContext = {
  latestMessage: string;
  messages: ChatMessage[];
  attachedFiles: AttachedFile[];
  responseMode: ResponseMode;
  route: TaskRoute;
  capabilities: PlatformCapability[];
};

export type ModuleDecision = {
  module: PlatformModule;
  score: number;
  reason: string;
};

export interface PlatformModuleDefinition {
  name: PlatformModule;
  capabilities: PlatformCapability[];
  canHandle(context: ModuleContext): ModuleDecision;
}

function decision(module: PlatformModule, score: number, reason: string): ModuleDecision {
  return { module, score, reason };
}

export const PLATFORM_MODULES: PlatformModuleDefinition[] = [
  {
    name: "svans-ai",
    capabilities: ["conversation", "teaching", "writing", "web_research", "image_analysis", "document_analysis", "code_assistance", "data_analysis", "content_creation"],
    canHandle: () => decision("svans-ai", 1, "SVANS-AI coordinates the conversation and response style."),
  },
  {
    name: "shield",
    capabilities: ["conversation"],
    canHandle: (context) =>
      context.route === "protect"
        ? decision("shield", 0.95, "Shield should review safety, abuse, privacy, or cybersecurity risk.")
        : decision("shield", 0.1, "Shield is available as a background safety layer."),
  },
  {
    name: "debugger",
    capabilities: ["code_assistance"],
    canHandle: (context) =>
      context.route === "debug" || /\b(error|bug|broken|stack trace|connection refused|debug)\b/i.test(context.latestMessage)
        ? decision("debugger", 0.9, "Debugger should diagnose the symptom, cause, fix, and verification.")
        : decision("debugger", 0.05, "Debugger is not primary for this request."),
  },
  {
    name: "sandbox",
    capabilities: ["code_assistance", "content_creation"],
    canHandle: (context) =>
      context.route === "build" || /\b(test|experiment|simulate|sandbox|prototype|build)\b/i.test(context.latestMessage)
        ? decision("sandbox", 0.82, "Sandbox should support isolated implementation or experiment planning.")
        : decision("sandbox", 0.05, "Sandbox is not primary for this request."),
  },
];

export function selectModules(context: ModuleContext): ModuleDecision[] {
  return PLATFORM_MODULES
    .map((module) => module.canHandle(context))
    .filter((item) => item.score >= 0.5 || item.module === "svans-ai")
    .sort((a, b) => b.score - a.score);
}
