import { NextResponse } from "next/server";
import { generateChatResponse, type AttachedFile } from "@/lib/ai/chat-engine";
import type { ChatMessage } from "@/lib/ai/types";

export async function POST(req: Request) {
  try {
    const body = await req.json();

    const messages = Array.isArray(body?.messages)
      ? (body.messages as ChatMessage[])
      : [];

    const attachedFile: AttachedFile | undefined =
      body?.file &&
      typeof body.file.name === "string" &&
      typeof body.file.type === "string" &&
      typeof body.file.base64 === "string"
        ? {
            name: body.file.name,
            type: body.file.type,
            base64: body.file.base64,
          }
        : undefined;

    const userEmail: string | null =
      typeof body?.userEmail === "string" ? body.userEmail : null;

    console.log("CHAT ROUTE DEBUG → userEmail:", userEmail);

    const text = await generateChatResponse(messages, attachedFile, userEmail);

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