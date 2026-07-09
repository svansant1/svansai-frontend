import { createClient } from "@supabase/supabase-js";

type ReadinessStatus = "ok" | "warning" | "missing";

export type ReadinessCheck = {
  name: string;
  status: ReadinessStatus;
  detail: string;
};

export type ReadinessReport = {
  ok: boolean;
  generatedAt: string;
  checks: ReadinessCheck[];
};

const REQUIRED_ENV = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "OWNER_USER_ID",
  "OPENAI_API_KEY",
  "ANTHROPIC_API_KEY",
  "GEMINI_API_KEY",
];

const OPTIONAL_ENV = [
  "TAVILY_API_KEY",
  "OCR_SPACE_API_KEY",
  "SV_OWNER_PASSWORD",
  "GITHUB_TOKEN",
  "GITHUB_OWNER",
  "GITHUB_REPO",
  "SVANSAI_INTERNAL_API_KEY",
  "SVANSAI_CORS_ORIGINS",
];

function envCheck(name: string, required: boolean): ReadinessCheck {
  const value = process.env[name];
  if (value?.trim()) {
    return { name, status: "ok", detail: "Configured." };
  }

  return {
    name,
    status: required ? "missing" : "warning",
    detail: required ? "Required for production." : "Optional feature is disabled until configured.",
  };
}

async function checkSupabaseTable(table: string): Promise<ReadinessCheck> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    return {
      name: `supabase:${table}`,
      status: "missing",
      detail: "Supabase URL/service key missing, so table readiness could not be checked.",
    };
  }

  try {
    const supabase = createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { error } = await supabase.from(table).select("*", { count: "exact", head: true });

    if (error) {
      return {
        name: `supabase:${table}`,
        status: "missing",
        detail: `Table check failed. Run the personalization migration if this is a new deployment. (${error.message})`,
      };
    }

    return {
      name: `supabase:${table}`,
      status: "ok",
      detail: "Table is reachable.",
    };
  } catch (error) {
    return {
      name: `supabase:${table}`,
      status: "missing",
      detail: error instanceof Error ? error.message : "Unknown Supabase readiness error.",
    };
  }
}

export async function buildReadinessReport(): Promise<ReadinessReport> {
  const checks: ReadinessCheck[] = [
    ...REQUIRED_ENV.map((name) => envCheck(name, true)),
    ...OPTIONAL_ENV.map((name) => envCheck(name, false)),
    await checkSupabaseTable("writing_profiles"),
    await checkSupabaseTable("user_memories"),
  ];

  return {
    ok: checks.every((check) => check.status !== "missing"),
    generatedAt: new Date().toISOString(),
    checks,
  };
}
