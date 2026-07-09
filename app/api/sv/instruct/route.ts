import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { verifyOwnerRequest } from "@/lib/auth/server-owner";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function POST(req: Request) {
  try {
    const { instruction } = (await req.json()) as {
      instruction: string;
    };

    const auth = await verifyOwnerRequest(req);
    if (!auth.authorized) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    if (!instruction?.trim() || instruction.length > 4000) {
      return NextResponse.json({ error: "Invalid instruction" }, { status: 400 });
    }

    await supabase.from("sv_instructions").insert({
      instruction,
    });

    return NextResponse.json({ ok: true, message: "Instruction saved." });
  } catch (error) {
    console.error("INSTRUCT_ROUTE_ERROR:", error);
    return NextResponse.json({ error: "Instruction failed" }, { status: 500 });
  }
}
