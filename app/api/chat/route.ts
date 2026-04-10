import { NextResponse } from "next/server";
import { generateChatResponse } from "@/lib/ai/chat-engine";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const rawMessages = Array.isArray(body?.messages) ? body.messages : [];

    const text = await generateChatResponse(rawMessages);

    return NextResponse.json({ text });
  } catch (error) {
    console.error("CHAT_ROUTE_ERROR:", error);

    return NextResponse.json(
      {
        text: "Something went wrong while generating that response. Please send it again.",
      },
      { status: 500 }
    );
  }
}