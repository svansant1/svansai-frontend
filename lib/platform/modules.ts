import type { AttachedFile } from "@/lib/ai/file-types";
import type { ChatMessage, ResponseMode } from "@/lib/ai/types";
import type {
  PlatformCapability,
  PlatformModule,
  TaskRoute,
} from "@/lib/platform/orchestrator";

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

function decision(
  module: PlatformModule,
  score: number,
  reason: string,
): ModuleDecision {
  return { module, score, reason };
}

export const PLATFORM_MODULES: PlatformModuleDefinition[] = [
  {
    name: "svans-ai",
    capabilities: [
      "conversation",
      "teaching",
      "writing",
      "web_research",
      "image_analysis",
      "image_generation",
      "image_editing",
      "document_analysis",
      "document_generation",
      "code_assistance",
      "code_editing",
      "data_analysis",
      "spreadsheet_generation",
      "content_creation",
      "database_access",
      "email_calendar",
      "api_calls",
      "automation",
      "self_improvement",
      "permission_control",
    ],
    canHandle: () =>
      decision(
        "svans-ai",
        1,
        "SVANS-AI coordinates intent, conversation state, tools, memory, and response style.",
      ),
  },
  {
    name: "shield",
    capabilities: ["conversation", "permission_control"],
    canHandle: (context) =>
      context.route === "protect"
        ? decision(
            "shield",
            0.95,
            "Shield should review safety, abuse, privacy, or cybersecurity risk.",
          )
        : decision(
            "shield",
            0.1,
            "Shield is available as a background safety layer.",
          ),
  },
  {
    name: "debugger",
    capabilities: ["code_assistance", "code_editing"],
    canHandle: (context) =>
      context.route === "debug" ||
      /\b(error|bug|broken|stack trace|connection refused|debug)\b/i.test(
        context.latestMessage,
      )
        ? decision(
            "debugger",
            0.9,
            "Debugger should diagnose the symptom, cause, fix, and verification.",
          )
        : decision(
            "debugger",
            0.05,
            "Debugger is not primary for this request.",
          ),
  },
  {
    name: "sandbox",
    capabilities: ["code_assistance", "code_editing", "content_creation"],
    canHandle: (context) =>
      context.route === "build" ||
      /\b(test|experiment|simulate|sandbox|prototype|build)\b/i.test(
        context.latestMessage,
      )
        ? decision(
            "sandbox",
            0.82,
            "Sandbox should support isolated implementation or experiment planning.",
          )
        : decision("sandbox", 0.05, "Sandbox is not primary for this request."),
  },
  {
    name: "vos",
    capabilities: [
      "local_workspace_access",
      "document_analysis",
      "image_analysis",
      "data_analysis",
      "permission_control",
    ],
    canHandle: (context) =>
      context.capabilities.includes("local_workspace_access") ||
      context.attachedFiles.some((file) => /[\\/]/.test(file.name))
        ? decision(
            "vos",
            0.88,
            "VOS should broker local workspace, folder, and permission-scoped file access.",
          )
        : decision("vos", 0.05, "VOS is not primary for this request."),
  },
];

export function selectModules(context: ModuleContext): ModuleDecision[] {
  return PLATFORM_MODULES.map((module) => module.canHandle(context))
    .filter((item) => item.score >= 0.5 || item.module === "svans-ai")
    .sort((a, b) => b.score - a.score);
}
