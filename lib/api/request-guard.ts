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

export function inferSupportedFileType(name: string, type = ""): string {
  const normalizedType = type.trim().toLowerCase();
  const lowerName = name.toLowerCase();
  const extension = lowerName.match(/\.([a-z0-9]+)$/)?.[1] ?? "";

  if (
    normalizedType === "image/svg+xml" ||
    normalizedType === "application/xml" ||
    normalizedType === "text/xml" ||
    normalizedType === "application/x-yaml" ||
    normalizedType === "text/yaml" ||
    normalizedType === "application/yaml" ||
    normalizedType === "application/x-sh" ||
    normalizedType === "application/x-shellscript"
  ) {
    return "text/plain";
  }

  if (normalizedType && normalizedType !== "application/octet-stream") {
    return normalizedType;
  }

  if (/\.(md|markdown)$/i.test(lowerName)) return "text/markdown";
  if (/\.(csv)$/i.test(lowerName)) return "text/csv";
  if (/\.(tsv)$/i.test(lowerName)) return "text/tab-separated-values";
  if (/\.(json)$/i.test(lowerName)) return "application/json";
  if (/\.(html|htm)$/i.test(lowerName)) return "text/html";
  if (/\.(css)$/i.test(lowerName)) return "text/css";
  if (/\.(js|jsx|mjs|cjs)$/i.test(lowerName)) return "text/javascript";
  if (/\.(ts|tsx)$/i.test(lowerName)) return "text/typescript";
  if (/\.(py)$/i.test(lowerName)) return "text/x-python";
  if (/\.(java)$/i.test(lowerName)) return "text/x-java-source";
  if (/\.(c|h)$/i.test(lowerName)) return "text/x-c";
  if (/\.(cpp|cc|cxx|hpp|hh|hxx)$/i.test(lowerName)) return "text/x-cpp";
  if (extension === "pdf") return "application/pdf";
  if (extension === "png") return "image/png";
  if (extension === "jpg" || extension === "jpeg") return "image/jpeg";
  if (extension === "gif") return "image/gif";
  if (extension === "webp") return "image/webp";
  if (extension === "xlsx") {
    return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  }
  if (extension === "xls") return "application/vnd.ms-excel";
  if (extension === "docx") {
    return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  }

  if (
    /\.(txt|text|log|sql|xml|svg|yml|yaml|toml|ini|conf|config|env|properties|lock|sh|bash|zsh|ps1|psm1|psd1|bat|cmd|dockerfile|gradle|php|rb|rs|go|swift|kt|kts|vue|svelte|astro|scss|sass|less)$/i.test(
      lowerName,
    ) ||
    /(^|[\\/])(dockerfile|makefile|gemfile|rakefile|procfile|license|readme|changelog|package-lock\.json|pnpm-lock\.yaml|yarn\.lock)$/i.test(
      lowerName,
    ) ||
    /(^|[\\/])\.(gitignore|dockerignore|env\.example|env|npmrc|nvmrc|prettierrc|eslintrc|editorconfig|babelrc|swcrc)$/i.test(
      lowerName,
    )
  ) {
    return "text/plain";
  }

  return normalizedType;
}

export function hasValidFileSignature(type: string, base64: string): boolean {
  if (
    type.startsWith("text/") ||
    type === "application/json" ||
    type === "application/x-python" ||
    type === "application/csv" ||
    type === "application/vnd.ms-excel"
  ) return true;
  if (
    type === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" ||
    type === "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  ) {
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
