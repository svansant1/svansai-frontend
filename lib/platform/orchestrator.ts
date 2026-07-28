import { generateChatResponse } from "@/lib/ai/chat-engine";
import type { AttachedFile } from "@/lib/ai/file-types";
import type { ChatMessage, ResponseMode } from "@/lib/ai/types";
import type { WritingProfile } from "@/lib/personalization/writing-profile";
import type { UserMemory } from "@/lib/personalization/structured-memory";
import { selectModules, type ModuleDecision } from "@/lib/platform/modules";
import {
  buildSvansMindPlan,
  formatSvansMindPlan,
  type SvansMindPlan,
} from "@/lib/platform/svans-mind";
import {
  createRequestId,
  createRuntimeTelemetry,
  logConversationAnalytics,
  type RuntimeTelemetry,
} from "@/lib/platform/telemetry";

export type PlatformModule =
  | "svans-ai"
  | "shield"
  | "debugger"
  | "sandbox"
  | "vos";
export type TaskRoute =
  | "conversation"
  | "learn"
  | "write"
  | "analyze"
  | "build"
  | "debug"
  | "protect";
export type PlatformCapability =
  | "conversation"
  | "teaching"
  | "writing"
  | "web_research"
  | "image_analysis"
  | "image_generation"
  | "image_editing"
  | "document_analysis"
  | "document_generation"
  | "code_assistance"
  | "code_editing"
  | "data_analysis"
  | "spreadsheet_generation"
  | "content_creation"
  | "local_workspace_access"
  | "database_access"
  | "email_calendar"
  | "api_calls"
  | "automation"
  | "self_improvement"
  | "permission_control";

export type OrchestrationResult = {
  text: string;
  requestId: string;
  route: TaskRoute;
  coordinator: "svans-ai";
  recommendedModules: PlatformModule[];
  moduleDecisions: ModuleDecision[];
  responseMode: ResponseMode;
  capabilities: PlatformCapability[];
  mind: SvansMindPlan;
  commandCenter: string[];
  analytics: {
    latencyMs: number;
    providerSelected?: string;
    providerPlan: string[];
    retryCount: number;
    qualityScore?: number;
    qualityReasons: string[];
    filesUsed: number;
    memoryUsed: number;
    researchUsed: boolean;
    liveSearchAttempted: boolean;
    liveSearchResults: number;
    liveSearchFailureReason?: string;
    fallbackUsed: boolean;
    failureReason?: string;
  };
};

function latestUserMessage(messages: ChatMessage[]): string {
  return (
    [...messages].reverse().find((message) => message.role === "user")
      ?.content ?? ""
  );
}

function chooseRoute(
  message: string,
  mode: ResponseMode,
  hasFile: boolean,
): TaskRoute {
  const normalized = message.toLowerCase();
  if (
    mode === "debug" ||
    /\b(error|bug|broken|stack trace|not working|debug)\b/.test(normalized)
  )
    return "debug";
  if (
    /\b(phishing|malware|unsafe|threat|bypass|unauthorized|security risk|scam|fraud|fake site|legit|legitimate|trustworthy)\b/.test(
      normalized,
    )
  )
    return "protect";
  if (
    mode === "build" ||
    /\b(build|implement|create an app|change the code|deploy)\b/.test(
      normalized,
    )
  )
    return "build";
  if (
    /\b(generate|create|make|draw|design|render|produce)\b.{0,80}\b(photo|image|picture|artwork|illustration|graphic|logo|wallpaper|poster)\b/.test(
      normalized,
    )
  )
    return "write";
  if (
    /\b(rewrite|refine|proofread|grammar|write|email|reply|discussion post)\b/.test(
      normalized,
    )
  )
    return "write";
  if (
    hasFile ||
    /\b(analyze|inspect|compare|screenshot|image|pdf)\b/.test(normalized)
  )
    return "analyze";
  if (
    mode === "guide" ||
    mode === "tutor" ||
    /\b(teach|learn|study|quiz|homework|explain)\b/.test(normalized)
  )
    return "learn";
  return "conversation";
}

function modulesForRoute(route: TaskRoute): PlatformModule[] {
  if (route === "protect") return ["svans-ai", "shield"];
  if (route === "debug") return ["svans-ai", "debugger"];
  if (route === "build") return ["svans-ai", "sandbox"];
  if (route === "analyze") return ["svans-ai", "vos"];
  return ["svans-ai"];
}

function capabilitiesForRequest(
  message: string,
  files: AttachedFile[],
): PlatformCapability[] {
  const normalized = message.toLowerCase();
  const looksLikeQuizBlock =
    /\b(group of answer choices|answer choices|flag question|question\s+\d+|quiz|exam|test question)\b/i.test(
      message,
    );
  const capabilities = new Set<PlatformCapability>(["conversation"]);
  if (/\b(teach|learn|study|quiz|homework|explain|guide)\b/.test(normalized))
    capabilities.add("teaching");
  if (
    /\b(write|rewrite|refine|proofread|email|reply|essay|discussion)\b/.test(
      normalized,
    )
  )
    capabilities.add("writing");
  if (
    /\b(latest|current|today|news|research|sources|look up|lookup|search|browse|internet|online|website|site|webpage|web page|url|domain|scam|fraud|legit|legitimate|trustworthy|reputation|reviews|complaints|bbb)\b/.test(
      normalized,
    ) ||
    /\b(?:https?:\/\/)?(?:www\.)?[a-z0-9-]+(?:\.[a-z]{2,})(?:\/[^\s]*)?\b/i.test(
      message,
    )
  )
    capabilities.add("web_research");
  if (files.some((file) => file.type.startsWith("image/")))
    capabilities.add("image_analysis");
  if (
    /\b(generate|create|make|draw|design|render|produce)\b.{0,80}\b(photo|image|picture|artwork|illustration|graphic|logo|wallpaper|poster)\b/.test(
      normalized,
    )
  )
    capabilities.add("image_generation");
  if (
    files.some((file) => file.type.startsWith("image/")) &&
    /\b(edit|change|modify|cross|remove|add|replace)\b/.test(normalized)
  )
    capabilities.add("image_editing");
  if (
    files.some(
      (file) =>
        file.type === "application/pdf" ||
        file.type.startsWith("text/") ||
        file.type === "application/json",
    )
  )
    capabilities.add("document_analysis");
  if (
    files.some(
      (file) =>
        file.type === "text/csv" ||
        file.type === "text/tab-separated-values" ||
        file.type === "application/csv" ||
        file.type === "application/vnd.ms-excel" ||
        file.type ===
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" ||
        /\.(csv|tsv|xlsx)$/i.test(file.name),
    )
  )
    capabilities.add("data_analysis");
  if (
    /\b(code|function|class|api|typescript|javascript|python|compile|program)\b/.test(
      normalized,
    )
  )
    capabilities.add("code_assistance");
  if (
    /\b(change the code|edit code|modify file|patch|commit)\b/.test(normalized)
  )
    capabilities.add("code_editing");
  if (/\b(data|csv|table|statistics|analyze numbers|chart)\b/.test(normalized))
    capabilities.add("data_analysis");
  if (/\b(spreadsheet|excel|xlsx|csv|table)\b/.test(normalized))
    capabilities.add("spreadsheet_generation");
  if (/\b(document|docx|pdf|report|worksheet)\b/.test(normalized))
    capabilities.add("document_generation");
  if (/\b(create|draft|generate|design|build)\b/.test(normalized))
    capabilities.add("content_creation");
  if (
    /\b(generate|create|make|draw|design|render|produce)\b.{0,80}\b(photo|image|picture|artwork|illustration|graphic|logo|wallpaper|poster)\b/.test(
      normalized,
    )
  )
    capabilities.add("content_creation");
  if (
    /\b(c drive|local folder|workspace|folder access|folder-based|vos|vos bridge|filesystem|file system)\b/.test(
      normalized,
    )
  )
    capabilities.add("local_workspace_access");
  if (/\b(database|supabase|sql|table|schema)\b/.test(normalized))
    capabilities.add("database_access");
  if (
    /\b(email|gmail|outlook|calendar|meeting|schedule invite|appointment)\b/.test(
      normalized,
    )
  )
    capabilities.add("email_calendar");
  if (/\b(api|endpoint|webhook|external call)\b/.test(normalized))
    capabilities.add("api_calls");
  if (
    /\b(automation|background job|schedule|monitor|reminder)\b/.test(normalized)
  )
    capabilities.add("automation");
  if (
    /\b(improve|self-improve|self improvement|failure|fallback|generic response|regression)\b/.test(
      normalized,
    )
  )
    capabilities.add("self_improvement");
  if (
    !looksLikeQuizBlock &&
    /\b(permission|access|owner approval|audit|full access)\b/.test(normalized)
  )
    capabilities.add("permission_control");
  return [...capabilities];
}

export async function orchestrateChat(params: {
  messages: ChatMessage[];
  attachedFiles?: AttachedFile[];
  sessionId?: string | null;
  responseMode: ResponseMode;
  isVerifiedOwner: boolean;
  writingProfile?: WritingProfile | null;
  userMemories?: UserMemory[];
  userId?: string | null;
  requestId?: string;
}): Promise<OrchestrationResult> {
  const startedAt = Date.now();
  const requestId = params.requestId ?? createRequestId();
  const runtimeTelemetry: RuntimeTelemetry = createRuntimeTelemetry(requestId);
  const latestMessage = latestUserMessage(params.messages);
  const files = params.attachedFiles ?? [];
  const route = chooseRoute(
    latestMessage,
    params.responseMode,
    Boolean(params.attachedFiles?.length),
  );
  const capabilities = capabilitiesForRequest(latestMessage, files);
  const mind = buildSvansMindPlan({
    messages: params.messages,
    latestMessage,
    attachedFiles: files,
    responseMode: params.responseMode,
    userMemories: params.userMemories ?? [],
  });
  const moduleDecisions = selectModules({
    latestMessage,
    messages: params.messages,
    attachedFiles: files,
    responseMode: params.responseMode,
    route,
    capabilities,
  });
  const recommendedModules = moduleDecisions.map((item) => item.module);
  const text = await generateChatResponse(
    params.messages,
    params.attachedFiles,
    params.sessionId,
    params.responseMode,
    params.isVerifiedOwner,
    params.writingProfile,
    params.userMemories,
    runtimeTelemetry,
    formatSvansMindPlan(mind),
  );
  const latencyMs = Date.now() - startedAt;
  const analytics = {
    latencyMs,
    providerSelected: runtimeTelemetry.providerSelected,
    providerPlan: runtimeTelemetry.providerPlan,
    retryCount: runtimeTelemetry.retryCount,
    qualityScore: runtimeTelemetry.qualityScore,
    qualityReasons: runtimeTelemetry.qualityReasons,
    filesUsed: files.length,
    memoryUsed: params.userMemories?.length ?? 0,
    researchUsed:
      capabilities.includes("web_research") ||
      runtimeTelemetry.liveSearchAttempted,
    liveSearchAttempted: runtimeTelemetry.liveSearchAttempted,
    liveSearchResults: runtimeTelemetry.liveSearchResults,
    liveSearchFailureReason: runtimeTelemetry.liveSearchFailureReason,
    fallbackUsed: runtimeTelemetry.fallbackUsed,
    failureReason: runtimeTelemetry.providerFailures[0]?.reason,
  };

  void logConversationAnalytics({
    requestId,
    sessionId: params.sessionId ?? null,
    userId: params.userId ?? null,
    route,
    modules: recommendedModules,
    moduleReasons: moduleDecisions.map(
      (item) => `${item.module}: ${item.reason}`,
    ),
    capabilities,
    responseMode: params.responseMode,
    providerSelected: analytics.providerSelected,
    providerPlan: analytics.providerPlan,
    latencyMs,
    retryCount: analytics.retryCount,
    qualityScore: analytics.qualityScore,
    qualityReasons: analytics.qualityReasons,
    filesUsed: analytics.filesUsed,
    memoryUsed: analytics.memoryUsed,
    researchUsed: analytics.researchUsed,
    fallbackUsed: analytics.fallbackUsed,
    failureReason: analytics.failureReason,
  });

  return {
    text,
    requestId,
    route,
    coordinator: "svans-ai",
    recommendedModules,
    moduleDecisions,
    responseMode: params.responseMode,
    capabilities,
    mind,
    commandCenter: mind.commandCenter,
    analytics,
  };
}
