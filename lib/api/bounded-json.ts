export class RequestBodyError extends Error {
  constructor(message: string, public readonly status: number) { super(message); this.name = "RequestBodyError"; }
}
/** A missing or false Content-Length header must not bypass request size limits. */
export async function readBoundedJson(request: Request, maximumBytes: number): Promise<unknown> {
  if (!request.body) throw new RequestBodyError("Request body is required.", 400);
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  let timedOut = false;
  const deadline = setTimeout(() => { timedOut = true; void reader.cancel().catch(() => undefined); }, 30_000);
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (timedOut) throw new RequestBodyError("Request upload took too long.", 408);
      if (done) break;
      size += value.byteLength;
      if (size > maximumBytes) { await reader.cancel(); throw new RequestBodyError("Request body exceeds the size limit.", 413); }
      chunks.push(value);
    }
  } finally { clearTimeout(deadline); reader.releaseLock(); }
  try { return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks))); }
  catch { throw new RequestBodyError("Request body must contain valid UTF-8 JSON.", 400); }
}

export async function readBoundedObject(request: Request, maximumBytes: number): Promise<Record<string, unknown>> {
  const value = await readBoundedJson(request, maximumBytes);
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new RequestBodyError("Expected a JSON object.", 400);
  return value as Record<string, unknown>;
}
