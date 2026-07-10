import { createClient } from "@supabase/supabase-js";

export type OwnerAuthResult =
  | { authorized: true; userId: string }
  | { authorized: false; reason: "missing_token" | "invalid_token" | "not_owner" | "misconfigured" };

export type UserAuthResult =
  | { authenticated: true; userId: string }
  | { authenticated: false; reason: "missing_token" | "invalid_token" | "misconfigured" };

function bearerToken(req: Request): string | null {
  const header = req.headers.get("authorization")?.trim() ?? "";
  if (!header.toLowerCase().startsWith("bearer ")) return null;
  return header.slice(7).trim() || null;
}

export async function verifyOwnerRequest(req: Request): Promise<OwnerAuthResult> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const ownerId = process.env.OWNER_USER_ID?.trim();
  const ownerEmail = process.env.OWNER_EMAIL?.trim().toLowerCase();
  const token = bearerToken(req);

  if (!url || !serviceKey || (!ownerId && !ownerEmail)) {
    return { authorized: false, reason: "misconfigured" };
  }

  if (!token) return { authorized: false, reason: "missing_token" };

  const supabase = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await supabase.auth.getUser(token);

  if (error || !data.user) return { authorized: false, reason: "invalid_token" };
  const emailMatches = ownerEmail && data.user.email?.toLowerCase() === ownerEmail;
  const idMatches = ownerId && data.user.id === ownerId;
  if (!idMatches && !emailMatches) return { authorized: false, reason: "not_owner" };

  return { authorized: true, userId: data.user.id };
}

export async function verifyUserRequest(req: Request): Promise<UserAuthResult> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const token = bearerToken(req);

  if (!url || !serviceKey) return { authenticated: false, reason: "misconfigured" };
  if (!token) return { authenticated: false, reason: "missing_token" };

  const supabase = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data.user) return { authenticated: false, reason: "invalid_token" };

  return { authenticated: true, userId: data.user.id };
}
