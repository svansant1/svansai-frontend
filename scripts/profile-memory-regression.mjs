import { createClient } from "@supabase/supabase-js";

const baseUrl = process.env.SVANSAI_TEST_URL || "http://localhost:3000";
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const email = process.env.SVANSAI_TEST_EMAIL;
const password = process.env.SVANSAI_TEST_PASSWORD;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

if (!url || !anonKey || !email || !password) {
  console.log("Skipping authenticated profile/memory regression. Set NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, SVANSAI_TEST_EMAIL, and SVANSAI_TEST_PASSWORD to run it.");
  process.exit(0);
}

const supabase = createClient(url, anonKey);
const { data, error } = await supabase.auth.signInWithPassword({ email, password });
if (error || !data.session?.access_token) {
  throw new Error(`Unable to sign in test user: ${error?.message ?? "no session"}`);
}

const token = data.session.access_token;
const headers = {
  "Content-Type": "application/json",
  Authorization: `Bearer ${token}`,
  "x-forwarded-for": process.env.SVANSAI_TEST_CLIENT_IP || "127.0.0.204",
};

const profileResponse = await fetch(`${baseUrl}/api/profile/writing`, {
  method: "PUT",
  headers,
  body: JSON.stringify({
    preserveVoice: true,
    correctEnglish: true,
    preserveIntentionalSlang: true,
    defaultContext: "professional",
    toneNotes: "Warm, direct, clear, and polished.",
    samples: {
      professional: [
        "I appreciate the opportunity to review this and would like to keep the message clear, respectful, and easy to respond to.",
      ],
    },
  }),
});
assert(profileResponse.ok, `Writing profile save failed with HTTP ${profileResponse.status}`);

const profileRead = await fetch(`${baseUrl}/api/profile/writing`, { headers });
assert(profileRead.ok, `Writing profile read failed with HTTP ${profileRead.status}`);
const profileData = await profileRead.json();
assert(profileData.profile?.defaultContext === "professional", "Writing profile did not persist.");

const memoryResponse = await fetch(`${baseUrl}/api/profile/memory`, {
  method: "POST",
  headers,
  body: JSON.stringify({
    category: "project_context",
    summary: "Regression test memory for SVANS-AI profile persistence.",
  }),
});
assert(memoryResponse.ok, `Memory save failed with HTTP ${memoryResponse.status}`);

const memoryRead = await fetch(`${baseUrl}/api/profile/memory`, { headers });
assert(memoryRead.ok, `Memory read failed with HTTP ${memoryRead.status}`);
const memoryData = await memoryRead.json();
assert(
  Array.isArray(memoryData.memories) &&
    memoryData.memories.some((memory) => memory.summary.includes("Regression test memory")),
  "Memory did not persist.",
);

console.log("Authenticated profile/memory regression completed.");
