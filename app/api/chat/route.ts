import { NextResponse } from "next/server";
import { storeArtifact } from "@/lib/artifacts/storage";
import type { StoredArtifactReference } from "@/lib/jobs/types";
import { readBoundedObject, RequestBodyError } from "@/lib/api/bounded-json";
import { AttachedFile } from "@/lib/ai/file-types";
import type { ChatMessage, ResponseMode } from "@/lib/ai/types";
import {
  clientKey,
  consumeRateLimit,
  estimatedBase64Bytes,
  hasValidFileSignature,
  inferSupportedFileType,
} from "@/lib/api/request-guard";
import { verifyOwnerRequest, verifyUserRequest } from "@/lib/auth/server-owner";
import { loadWritingProfile } from "@/lib/personalization/writing-profile";
import { loadUserMemories } from "@/lib/personalization/structured-memory";
import { orchestrateChat } from "@/lib/platform/orchestrator";
import { createRequestId } from "@/lib/platform/telemetry";
import { normalizeChatRequest } from "@/lib/ai/request-context";
import { stripSecretMessages } from "@/lib/ai/secret-messages";
import { buildCyberRequest, assertCyberRequestCurrent } from "@/lib/platform/request-context";
import { OwnerAccessError, requireSameOrigin, revokeOwnerGrants, watchOwnerGrant, recordOwnerActivity } from "@/lib/auth/owner-session";
import { parseSVCommand, handleSVCommand } from "@/lib/ai/instruction-handler";
import { captureUserTurn } from "@/lib/context/capture";
import { buildContextView } from "@/lib/context/compaction";
import { storeContextArtifact } from "@/lib/artifacts/context-publication";

const MAX_REQUEST_BYTES = 120 * 1024 * 1024;
const MAX_FILE_BYTES = 25 * 1024 * 1024;
const MAX_TOTAL_FILE_BYTES = 80 * 1024 * 1024;
const MAX_FILES = 30;
const MAX_MESSAGES = 250;
const MAX_MESSAGE_CHARS = 30_000;
const SUPPORTED_FILE_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "application/pdf",
  "text/plain",
  "text/markdown",
  "text/javascript",
  "text/typescript",
  "text/html",
  "text/css",
  "text/csv",
  "text/tab-separated-values",
  "application/json",
  "application/x-python",
  "text/x-python",
  "text/x-java-source",
  "text/x-c",
  "text/x-cpp",
  "application/csv",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
]);

export async function POST(req: Request) {
  let disposeWatch = () => {};
  const requestId =
    req.headers.get("x-svansai-request-id") || createRequestId();
  try {
    if (!consumeRateLimit(clientKey(req))) {
      return NextResponse.json(
        { error: "Too many requests. Please wait a moment." },
        { status: 429 },
      );
    }

    const contentLength = Number(req.headers.get("content-length") || 0);
    if (contentLength > MAX_REQUEST_BYTES) {
      return NextResponse.json(
        { error: "Request is too large." },
        { status: 413 },
      );
    }

    const body = await readBoundedObject(req, MAX_REQUEST_BYTES);

    const suppliedMessages = Array.isArray(body?.messages)
      ? (body.messages as ChatMessage[])
      : [];
    const messages = stripSecretMessages(suppliedMessages);
    if (suppliedMessages.length && !messages.includes(suppliedMessages[suppliedMessages.length - 1])) {
      return NextResponse.json({ error: "Use the secure owner form; passwords cannot be submitted through chat." }, { status: 400 });
    }
    const controlText = [...messages].reverse().find(m => m.role === "user")?.content;
    const control = typeof controlText === "string" ? controlText.trim().toLowerCase() : "";
    if (control === "sv lock" || control === "sv unlock") {
      requireSameOrigin(req);
      const owner = await verifyOwnerRequest(req);
      if (!owner.authorized) throw new OwnerAccessError("Sign in as the verified owner.");
      if (control === "sv lock") await revokeOwnerGrants(owner.userId);
      return NextResponse.json({ text: control === "sv lock" ? "Owner access is locked." : "Use the secure owner-unlock form. Do not send your password in chat.", ownerControl: control === "sv lock" ? "locked" : "unlock_form" }, { headers: { "Cache-Control": "no-store" } });
    }
    if (/^sv\s+/.test(control)) {
      requireSameOrigin(req);
      const owner = await verifyOwnerRequest(req);
      if (!owner.authorized) throw new OwnerAccessError("Verified owner required.");
      const grant = await recordOwnerActivity(req, owner.userId);
      if (!grant) throw new OwnerAccessError("Owner controls are locked. Use the secure unlock form.");
      const command = parseSVCommand(String(controlText), "owner-control");
      const text = command ? await handleSVCommand(command, "owner-control", grant) : "Unknown owner control. No model or command was invoked.";
      return NextResponse.json({ text }, { headers: { "Cache-Control": "no-store" } });
    }
    if (messages.length > MAX_MESSAGES) {
      return NextResponse.json({ error: "This request exceeds the chat context limit. Start a new chat with a continuation summary. Your saved conversation has not been shortened." }, { status: 413 });
    }

    if (
      messages.some(
        (message) =>
          !message ||
          (message.role !== "user" && message.role !== "assistant"),
      )
    ) {
      return NextResponse.json(
        { error: "Every message must use the user or assistant role." },
        { status: 400 },
      );
    }
    if (messages.some((message) => typeof message.content !== "string")) {
      return NextResponse.json(
        { error: "Every message must contain text content." },
        { status: 400 },
      );
    }
    if (messages.some((message) => message.content.length > MAX_MESSAGE_CHARS)) {
      return NextResponse.json(
        {
          error: `One message is too long. Keep each pasted message under ${MAX_MESSAGE_CHARS.toLocaleString()} characters, split it into smaller parts, or attach it as a file.`,
        },
        { status: 400 },
      );
    }
    if (!messages.some((message) => message.role === "user")) {
      return NextResponse.json(
        { error: "At least one user message is required." },
        { status: 400 },
      );
    }
    const normalizedRequest = normalizeChatRequest(messages, body?.context);

    const rawFiles = Array.isArray(body?.files)
      ? body.files
      : body?.file
        ? [body.file]
        : [];
    if (rawFiles.length > MAX_FILES) {
      return NextResponse.json(
        { error: `A maximum of ${MAX_FILES} files is allowed.` },
        { status: 400 },
      );
    }
    const attachedFiles: AttachedFile[] = rawFiles
      .filter(
        (file: unknown): file is AttachedFile =>
          Boolean(file) &&
          typeof (file as AttachedFile).name === "string" &&
          typeof (file as AttachedFile).type === "string" &&
          typeof (file as AttachedFile).base64 === "string",
      )
      .map((file: AttachedFile) => ({
        name: file.name.slice(0, 255),
        type: inferSupportedFileType(file.name, file.type),
        base64: file.base64,
      }));
    if (attachedFiles.length !== rawFiles.length) {
      return NextResponse.json(
        { error: "Invalid file attachment." },
        { status: 400 },
      );
    }
    if (
      attachedFiles.some(
        (file) =>
          !SUPPORTED_FILE_TYPES.has(file.type) ||
          !hasValidFileSignature(file.type, file.base64),
      )
    ) {
      return NextResponse.json(
        { error: "A file type or file signature is invalid." },
        { status: 400 },
      );
    }
    const fileSizes = attachedFiles.map((file) =>
      estimatedBase64Bytes(file.base64),
    );
    if (fileSizes.some((size) => size > MAX_FILE_BYTES)) {
      return NextResponse.json(
        { error: "A file is too large." },
        { status: 413 },
      );
    }
    if (fileSizes.reduce((sum, size) => sum + size, 0) > MAX_TOTAL_FILE_BYTES) {
      return NextResponse.json(
        { error: "Combined files are too large." },
        { status: 413 },
      );
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
    let trustedContext;
    if (body.cyberMode === true) {
      requireSameOrigin(req);
      if (!ownerAuth.authorized) throw new OwnerAccessError("Cyber Lab requires the verified owner account.");
      trustedContext = await buildCyberRequest(req, { userId: ownerAuth.userId, requestId,
        projectId: typeof body.projectId === "string" ? body.projectId : "",
        conversationId: typeof body.conversationId === "string" ? body.conversationId : "" });
      const latest = [...messages].reverse().find(m => m.role === "user");
      if (latest) trustedContext.context = buildContextView(await captureUserTurn(trustedContext.scope, latest));
      trustedContext.expectedContextRevision = trustedContext.context.revision;
      const currentContext = trustedContext;
      const watch = watchOwnerGrant(currentContext.ownerGrant, req.signal, () => assertCyberRequestCurrent(currentContext));
      trustedContext.signal = watch.signal;
      disposeWatch = watch.dispose;
    }
    const [writingProfile, userMemories] = userAuth.authenticated
      ? await Promise.all([
          loadWritingProfile(userAuth.userId),
          loadUserMemories(userAuth.userId),
        ])
      : [null, []];
    const result = await orchestrateChat({
      messages: normalizedRequest.messages,
      attachedFiles,
      sessionId,
      responseMode,
      isVerifiedOwner: ownerAuth.authorized,
      writingProfile,
      userMemories,
      userId: userAuth.authenticated ? userAuth.userId : null,
      requestId,
      trustedContext,
      signal: trustedContext?.signal ?? req.signal,
    });

    const { artifact, ...orchestration } = result;
    if (trustedContext) await assertCyberRequestCurrent(trustedContext);
    let artifactReference: StoredArtifactReference | undefined;
    const publicArtifact = artifact ? (({ sourceContent: _source, ...file }) => file)(artifact) : undefined;
    let responseText = result.text;
    if (artifact && userAuth.authenticated && process.env.SVANSAI_ARTIFACT_STORAGE_ENABLED === "1") {
      try { artifactReference = trustedContext ? await storeContextArtifact(trustedContext, artifact) : await storeArtifact(userAuth.userId, artifact); }
      catch {
        responseText += "\n\nThe download is available in this chat, but private version storage could not be confirmed. Check the version library before retrying.";
      }
    }

    if (trustedContext) await assertCyberRequestCurrent(trustedContext);
    return NextResponse.json(
      {
        text: responseText,
        ...(artifactReference ? { artifactReference } : publicArtifact ? { artifact: publicArtifact } : {}),
        orchestration,
      },
      {
        headers: {
          "Cache-Control": "no-store",
          "x-svansai-request-id": result.requestId,
        },
      },
    );
  } catch (error) {
    if (error instanceof OwnerAccessError) return NextResponse.json({ error: error.message }, { status: error.status, headers: { "Cache-Control": "no-store" } });
    if (error instanceof RequestBodyError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error("CHAT_ROUTE_ERROR:", requestId, error);
    return NextResponse.json(
      {
        text: "Something went wrong while generating that response. Please send it again.",
      },
      { status: 500, headers: { "x-svansai-request-id": requestId } },
    );
  } finally { disposeWatch(); }
}
