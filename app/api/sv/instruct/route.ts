import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function POST(req: Request) {
  try {
    const { instruction, userId } = (await req.json()) as {
      instruction: string;
      userId: string;
    };

    if (userId !== process.env.OWNER_USER_ID) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
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