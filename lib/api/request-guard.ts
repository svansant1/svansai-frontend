const buckets = new Map<string, { count: number; resetAt: number }>();

export function clientKey(req: Request): string {
  const forwarded = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || req.headers.get("x-real-ip") || "unknown";
}

export function consumeRateLimit(key: string, limit = 30, windowMs = 60_000): boolean {
  const now = Date.now();
  const current = buckets.get(key);

  if (!current || current.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }

  if (current.count >= limit) return false;
  current.count += 1;
  return true;
}

export function estimatedBase64Bytes(value: string): number {
  const padding = value.endsWith("==") ? 2 : value.endsWith("=") ? 1 : 0;
  return Math.max(0, Math.floor((value.length * 3) / 4) - padding);
}

export function hasValidFileSignature(type: string, base64: string): boolean {
  if (
    type.startsWith("text/") ||
    type === "application/json" ||
    type === "application/x-python" ||
    type === "application/csv" ||
    type === "application/vnd.ms-excel"
  ) return true;
  if (type === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet") {
    const bytes = Buffer.from(base64.slice(0, 64), "base64");
    return bytes[0] === 0x50 && bytes[1] === 0x4b;
  }
  const bytes = Buffer.from(base64.slice(0, 64), "base64");
  if (type === "application/pdf") return bytes.subarray(0, 5).toString("ascii") === "%PDF-";
  if (type === "image/png") return bytes.subarray(0, 8).toString("hex") === "89504e470d0a1a0a";
  if (type === "image/jpeg") return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (type === "image/gif") return bytes.subarray(0, 4).toString("ascii") === "GIF8";
  if (type === "image/webp") return bytes.subarray(0, 4).toString("ascii") === "RIFF" && bytes.subarray(8, 12).toString("ascii") === "WEBP";
  return false;
}
