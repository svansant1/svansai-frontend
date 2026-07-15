import { createClient } from "@supabase/supabase-js";
import type { ProviderName } from "@/lib/ai/providers/router";
import type { ResponseCritique } from "@/lib/ai/response-critic";
import type {
  PlatformCapability,
  PlatformModule,
  TaskRoute,
} from "@/lib/platform/orchestrator";
import { SVANSAI_PROMPT_VERSION } from "@/lib/platform/feature-flags";

export type RuntimeTelemetry = {
  requestId: string;
  providerPlan: ProviderName[];
  providerSelected?: ProviderName | "local";
  retryCount: number;
  providerFailures: Array<{ provider: ProviderName; reason: string }>;
  qualityScore?: number;
  qualityReasons: string[];
  fallbackUsed: boolean;
  liveSearchAttempted: boolean;
  liveSearchResults: number;
  liveSearchFailureReason?: string;
};

export type ConversationAnalyticsEvent = {
  requestId: string;
  sessionId: string | null;
  userId?: string | null;
  route: TaskRoute;
  modules: PlatformModule[];
  moduleReasons: string[];
  capabilities: PlatformCapability[];
  responseMode: string;
  providerSelected?: string;
  providerPlan: string[];
  latencyMs: number;
  retryCount: number;
  qualityScore?: number;
  qualityReasons: string[];
  filesUsed: number;
  memoryUsed: number;
  researchUsed: boolean;
  fallbackUsed: boolean;
  failureReason?: string;
};

export function createRequestId(): string {
  return `sv_${Date.now().toString(36)}_${crypto.randomUUID().slice(0, 8)}`;
}

export function createRuntimeTelemetry(
  requestId = createRequestId(),
): RuntimeTelemetry {
  return {
    requestId,
    providerPlan: [],
    retryCount: 0,
    providerFailures: [],
    qualityReasons: [],
    fallbackUsed: false,
    liveSearchAttempted: false,
    liveSearchResults: 0,
  };
}

export function applyCritique(
  telemetry: RuntimeTelemetry,
  critique: ResponseCritique,
) {
  telemetry.qualityScore = critique.score;
  telemetry.qualityReasons = critique.reasons;
}

function serverClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export async function logConversationAnalytics(
  event: ConversationAnalyticsEvent,
): Promise<void> {
  const supabase = serverClient();
  if (!supabase) return;

  try {
    await supabase.from("conversation_analytics").insert({
      request_id: event.requestId,
      session_id: event.sessionId,
      user_id: event.userId ?? null,
      route: event.route,
      modules: event.modules,
      module_reasons: event.moduleReasons,
      capabilities: event.capabilities,
      response_mode: event.responseMode,
      provider_selected: event.providerSelected ?? null,
      provider_plan: event.providerPlan,
      latency_ms: event.latencyMs,
      retry_count: event.retryCount,
      quality_score: event.qualityScore ?? null,
      quality_reasons: event.qualityReasons,
      files_used: event.filesUsed,
      memory_used: event.memoryUsed,
      research_used: event.researchUsed,
      fallback_used: event.fallbackUsed,
      failure_reason: event.failureReason ?? null,
      prompt_version: SVANSAI_PROMPT_VERSION,
      created_at: new Date().toISOString(),
    });
  } catch (error) {
    console.error("[SVANS-AI] Analytics logging failed:", error);
  }
}
