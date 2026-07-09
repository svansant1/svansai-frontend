import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { verifyOwnerRequest } from "@/lib/auth/server-owner";
import { FEATURE_FLAGS, SVANSAI_PROMPT_VERSION } from "@/lib/platform/feature-flags";

function serverClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

export async function GET(req: Request) {
  const auth = await verifyOwnerRequest(req);
  if (!auth.authorized) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = serverClient();
  if (!supabase) {
    return NextResponse.json({ error: "Analytics storage is not configured." }, { status: 503 });
  }

  const limit = Math.min(Number(new URL(req.url).searchParams.get("limit") ?? 50), 200);
  const { data, error } = await supabase
    .from("conversation_analytics")
    .select("request_id,session_id,route,modules,capabilities,response_mode,provider_selected,provider_plan,latency_ms,retry_count,quality_score,files_used,memory_used,research_used,fallback_used,failure_reason,created_at")
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) {
    return NextResponse.json({ error: "Unable to read analytics." }, { status: 500 });
  }

  const rows = data ?? [];
  const averageLatencyMs = rows.length
    ? Math.round(rows.reduce((sum, row) => sum + Number(row.latency_ms ?? 0), 0) / rows.length)
    : 0;
  const fallbackRate = rows.length
    ? rows.filter((row) => row.fallback_used).length / rows.length
    : 0;
  const averageQuality = rows.filter((row) => row.quality_score != null).length
    ? Number(
        (
          rows
            .filter((row) => row.quality_score != null)
            .reduce((sum, row) => sum + Number(row.quality_score), 0) /
          rows.filter((row) => row.quality_score != null).length
        ).toFixed(3),
      )
    : null;

  return NextResponse.json({
    promptVersion: SVANSAI_PROMPT_VERSION,
    featureFlags: FEATURE_FLAGS,
    summary: {
      count: rows.length,
      averageLatencyMs,
      fallbackRate,
      averageQuality,
    },
    events: rows,
  });
}
