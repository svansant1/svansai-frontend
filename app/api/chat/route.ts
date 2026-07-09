import { NextResponse } from "next/server";
import { AttachedFile } from "@/lib/ai/file-types";
import type { ChatMessage, ResponseMode } from "@/lib/ai/types";
import { clientKey, consumeRateLimit, estimatedBase64Bytes, hasValidFileSignature } from "@/lib/api/request-guard";
import { verifyOwnerRequest, verifyUserRequest } from "@/lib/auth/server-owner";
import { loadWritingProfile } from "@/lib/personalization/writing-profile";
import { loadUserMemories } from "@/lib/personalization/structured-memory";
import { orchestrateChat } from "@/lib/platform/orchestrator";

const MAX_REQUEST_BYTES = 55 * 1024 * 1024;
const MAX_FILE_BYTES = 10 * 1024 * 1024;
const MAX_TOTAL_FILE_BYTES = 40 * 1024 * 1024;
const MAX_FILES = 10;
const MAX_MESSAGES = 250;
const MAX_MESSAGE_CHARS = 30_000;
const SUPPORTED_FILE_TYPES = new Set([
  "image/jpeg", "image/png", "image/gif", "image/webp", "application/pdf",
  "text/plain", "text/markdown", "text/javascript", "text/typescript", "text/html", "text/css", "text/csv", "text/tab-separated-values",
  "application/json", "application/x-python", "text/x-python", "text/x-java-source", "text/x-c", "text/x-cpp",
  "application/csv", "application/vnd.ms-excel", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
]);

export async function POST(req: Request) {
  try {
    if (!consumeRateLimit(clientKey(req))) {
      return NextResponse.json({ error: "Too many requests. Please wait a moment." }, { status: 429 });
    }

    const contentLength = Number(req.headers.get("content-length") || 0);
    if (contentLength > MAX_REQUEST_BYTES) {
      return NextResponse.json({ error: "Request is too large." }, { status: 413 });
    }

    const body = await req.json();

    const messages = Array.isArray(body?.messages)
      ? (body.messages as ChatMessage[]).slice(-MAX_MESSAGES)
      : [];

    const invalidMessage = messages.some(
      (message) =>
        !message ||
        (message.role !== "user" && message.role !== "assistant") ||
        typeof message.content !== "string" ||
        message.content.length > MAX_MESSAGE_CHARS,
    );
    if (invalidMessage) {
      return NextResponse.json({ error: "Invalid chat message." }, { status: 400 });
    }

    const rawFiles = Array.isArray(body?.files)
      ? body.files
      : body?.file
        ? [body.file]
        : [];
    if (rawFiles.length > MAX_FILES) {
      return NextResponse.json({ error: `A maximum of ${MAX_FILES} files is allowed.` }, { status: 400 });
    }
    const attachedFiles: AttachedFile[] = rawFiles
      .filter(
        (file: unknown): file is AttachedFile =>
          Boolean(file) &&
          typeof (file as AttachedFile).name === "string" &&
          typeof (file as AttachedFile).type === "string" &&
          typeof (file as AttachedFile).base64 === "string",
      )
      .map((file: AttachedFile) => ({ name: file.name.slice(0, 255), type: file.type, base64: file.base64 }));
    if (attachedFiles.length !== rawFiles.length) {
      return NextResponse.json({ error: "Invalid file attachment." }, { status: 400 });
    }
    if (attachedFiles.some((file) => !SUPPORTED_FILE_TYPES.has(file.type) || !hasValidFileSignature(file.type, file.base64))) {
      return NextResponse.json({ error: "A file type or file signature is invalid." }, { status: 400 });
    }
    const fileSizes = attachedFiles.map((file) => estimatedBase64Bytes(file.base64));
    if (fileSizes.some((size) => size > MAX_FILE_BYTES)) {
      return NextResponse.json({ error: "A file is too large." }, { status: 413 });
    }
    if (fileSizes.reduce((sum, size) => sum + size, 0) > MAX_TOTAL_FILE_BYTES) {
      return NextResponse.json({ error: "Combined files are too large." }, { status: 413 });
    }

    const sessionId: string | null =
      typeof body?.sessionId === "string" ? body.sessionId : null;

    const responseMode: ResponseMode =
      body?.responseMode === "direct" ||
      body?.responseMode === "guide" ||
      body?.responseMode === "tutor" ||
      body?.responseMode === "build" ||
      body?.responseMode === "debug" ||
      body?.responseMode === "auto"
        ? body.responseMode
        : "auto";

    const [ownerAuth, userAuth] = await Promise.all([
      verifyOwnerRequest(req),
      verifyUserRequest(req),
    ]);
    const [writingProfile, userMemories] = userAuth.authenticated
      ? await Promise.all([
          loadWritingProfile(userAuth.userId),
          loadUserMemories(userAuth.userId),
        ])
      : [null, []];
    const result = await orchestrateChat({
      messages,
      attachedFiles,
      sessionId,
      responseMode,
      isVerifiedOwner: ownerAuth.authorized,
      writingProfile,
      userMemories,
    });

    return NextResponse.json(
      { text: result.text, orchestration: result },
      { headers: { "Cache-Control": "no-store" } },
    );
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
