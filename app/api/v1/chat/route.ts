import { NextResponse } from "next/server";
import type { AttachedFile } from "@/lib/ai/file-types";
import type { ChatMessage, ResponseMode } from "@/lib/ai/types";
import {
  clientKey,
  consumeRateLimit,
  estimatedBase64Bytes,
  hasValidFileSignature,
} from "@/lib/api/request-guard";
import { orchestrateChat } from "@/lib/platform/orchestrator";
import { createRequestId } from "@/lib/platform/telemetry";

const MAX_REQUEST_BYTES = 55 * 1024 * 1024;
const MAX_FILE_BYTES = 10 * 1024 * 1024;
const MAX_TOTAL_FILE_BYTES = 40 * 1024 * 1024;
const MAX_FILES = 10;
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
]);

function configuredApiKeys() {
  return [
    process.env.SVANSAI_API_KEY?.trim(),
    process.env.SVANSAI_INTERNAL_API_KEY?.trim(),
  ].filter((key): key is string => Boolean(key));
}

function getRequestApiKey(req: Request) {
  const auth = req.headers.get("authorization")?.trim() ?? "";
  const bearer = auth.toLowerCase().startsWith("bearer ")
    ? auth.slice(7).trim()
    : "";
  return (
    req.headers.get("x-svansai-api-key")?.trim() ||
    req.headers.get("x-api-key")?.trim() ||
    bearer
  );
}

function isAuthorizedApiRequest(req: Request) {
  const validKeys = configuredApiKeys();
  if (!validKeys.length) return { ok: false, reason: "misconfigured" as const };

  const key = getRequestApiKey(req);
  if (!key) return { ok: false, reason: "missing_key" as const };

  return validKeys.includes(key)
    ? { ok: true as const }
    : { ok: false, reason: "invalid_key" as const };
}

function corsHeaders(req: Request) {
  const allowed = (process.env.SVANSAI_CORS_ORIGINS ?? "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
  const origin = req.headers.get("origin") ?? "";
  const allowOrigin =
    allowed.includes("*") || (origin && allowed.includes(origin))
      ? origin || "*"
      : allowed.length === 0
        ? "*"
        : "";

  return {
    ...(allowOrigin ? { "Access-Control-Allow-Origin": allowOrigin } : {}),
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers":
      "Content-Type, Authorization, x-svansai-api-key, x-api-key, x-svansai-request-id",
    "Access-Control-Max-Age": "86400",
    "Cache-Control": "no-store",
  };
}

function json(req: Request, body: unknown, init?: ResponseInit) {
  return NextResponse.json(body, {
    ...init,
    headers: {
      ...corsHeaders(req),
      ...(init?.headers ?? {}),
    },
  });
}

function parseResponseMode(value: unknown): ResponseMode {
  return value === "direct" ||
    value === "guide" ||
    value === "tutor" ||
    value === "build" ||
    value === "debug" ||
    value === "auto"
    ? value
    : "auto";
}

export function OPTIONS(req: Request) {
  return new Response(null, {
    status: 204,
    headers: corsHeaders(req),
  });
}

export async function POST(req: Request) {
  const requestId =
    req.headers.get("x-svansai-request-id") || createRequestId();

  try {
    const auth = isAuthorizedApiRequest(req);
    if (!auth.ok) {
      return json(
        req,
        {
          error:
            auth.reason === "misconfigured"
              ? "SVANS-AI API is not configured. Set SVANSAI_API_KEY."
              : "Unauthorized SVANS-AI API request.",
          requestId,
        },
        {
          status: auth.reason === "misconfigured" ? 503 : 401,
          headers:
            auth.reason === "misconfigured"
              ? { "x-svansai-request-id": requestId }
              : {
                  "WWW-Authenticate": 'Bearer realm="SVANS-AI API"',
                  "x-svansai-request-id": requestId,
                },
        },
      );
    }

    const apiKey = getRequestApiKey(req);
    const rateKey = `${clientKey(req)}:${apiKey.slice(0, 12)}`;
    if (!consumeRateLimit(rateKey, 60, 60_000)) {
      return json(
        req,
        {
          error: "Too many SVANS-AI API requests. Please wait a moment.",
          requestId,
        },
        { status: 429, headers: { "x-svansai-request-id": requestId } },
      );
    }

    const contentLength = Number(req.headers.get("content-length") || 0);
    if (contentLength > MAX_REQUEST_BYTES) {
      return json(
        req,
        { error: "Request is too large.", requestId },
        { status: 413, headers: { "x-svansai-request-id": requestId } },
      );
    }

    const body = await req.json();
    const messages = Array.isArray(body?.messages)
      ? (body.messages as ChatMessage[]).slice(-MAX_MESSAGES)
      : [];

    if (!messages.length) {
      return json(
        req,
        { error: "messages is required.", requestId },
        { status: 400, headers: { "x-svansai-request-id": requestId } },
      );
    }

    const invalidMessage = messages.some(
      (message) =>
        !message ||
        (message.role !== "user" && message.role !== "assistant") ||
        typeof message.content !== "string" ||
        message.content.length > MAX_MESSAGE_CHARS,
    );
    if (invalidMessage) {
      return json(
        req,
        { error: "Invalid chat message.", requestId },
        { status: 400, headers: { "x-svansai-request-id": requestId } },
      );
    }

    const rawFiles = Array.isArray(body?.files)
      ? body.files
      : body?.file
        ? [body.file]
        : [];
    if (rawFiles.length > MAX_FILES) {
      return json(
        req,
        { error: `A maximum of ${MAX_FILES} files is allowed.`, requestId },
        { status: 400, headers: { "x-svansai-request-id": requestId } },
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
        type: file.type,
        base64: file.base64,
      }));

    if (attachedFiles.length !== rawFiles.length) {
      return json(
        req,
        { error: "Invalid file attachment.", requestId },
        { status: 400, headers: { "x-svansai-request-id": requestId } },
      );
    }

    if (
      attachedFiles.some(
        (file) =>
          !SUPPORTED_FILE_TYPES.has(file.type) ||
          !hasValidFileSignature(file.type, file.base64),
      )
    ) {
      return json(
        req,
        { error: "A file type or file signature is invalid.", requestId },
        { status: 400, headers: { "x-svansai-request-id": requestId } },
      );
    }

    const fileSizes = attachedFiles.map((file) =>
      estimatedBase64Bytes(file.base64),
    );
    if (fileSizes.some((size) => size > MAX_FILE_BYTES)) {
      return json(
        req,
        { error: "A file is too large.", requestId },
        { status: 413, headers: { "x-svansai-request-id": requestId } },
      );
    }

    if (fileSizes.reduce((sum, size) => sum + size, 0) > MAX_TOTAL_FILE_BYTES) {
      return json(
        req,
        { error: "Combined files are too large.", requestId },
        { status: 413, headers: { "x-svansai-request-id": requestId } },
      );
    }

    const result = await orchestrateChat({
      messages,
      attachedFiles,
      sessionId:
        typeof body?.sessionId === "string"
          ? body.sessionId
          : `svansai-api:${requestId}`,
      responseMode: parseResponseMode(body?.responseMode),
      isVerifiedOwner: false,
      writingProfile: null,
      userMemories: [],
      userId: typeof body?.userId === "string" ? body.userId : null,
      requestId,
    });

    return json(
      req,
      {
        id: requestId,
        object: "svansai.chat.completion",
        model: "svans-ai",
        text: result.text,
        response: {
          role: "assistant",
          content: result.text,
        },
        route: result.route,
        coordinator: result.coordinator,
        orchestration: result,
      },
      { headers: { "x-svansai-request-id": requestId } },
    );
  } catch (error) {
    console.error("SVANSAI_V1_CHAT_ROUTE_ERROR:", requestId, error);
    return json(
      req,
      {
        error:
          "Something went wrong while generating the SVANS-AI API response.",
        requestId,
      },
      { status: 500, headers: { "x-svansai-request-id": requestId } },
    );
  }
}
