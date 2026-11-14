/** Portable snapshot names, never host filesystem paths. No secret/config folders. */
export function snapshotPath(value: unknown): string {
  if (typeof value !== "string" || value.length > 180 || !value || value !== value.trim() ||
      !/^[A-Za-z0-9_.@/ -]+$/.test(value) || value.startsWith("/") || value.includes("\\")) {
    throw new Error("Use a relative, portable snapshot filename.");
  }
  const parts = value.split("/");
  if (parts.some((part) => !part || part === "." || part === ".." || part.endsWith(".") || part.endsWith(" ") ||
      /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(part) ||
      /^(\.git|\.ssh|\.aws|\.azure|\.kube|node_modules|__pycache__|\.venv)$/i.test(part) ||
      /^\.env(?:\.|$)/i.test(part) || /^(\.npmrc|\.pypirc|credentials|id_rsa|id_ed25519)$/i.test(part))) {
    throw new Error("Snapshot path contains a traversal, reserved, dependency, or sensitive location.");
  }
  if (/\.(pem|key|p12|pfx|keystore)$/i.test(value)) throw new Error("Do not include private-key files.");
  return value;
}

export function containsLikelySecret(text: string): boolean {
  return /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|\bAKIA[0-9A-Z]{16}\b|\bgh[pousr]_[A-Za-z0-9]{30,}|\bsk-(?:proj-)?[A-Za-z0-9_-]{32,}/.test(text);
}

/** Heuristic screen only; this is not a claim that all secrets were found. */
export function validateSnapshotText(value: unknown): string {
  if (typeof value !== "string" || value.includes("\0") ||
      /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(value)) {
    throw new Error("Snapshots must contain valid UTF-8 text.");
  }
  if (containsLikelySecret(value)) throw new Error("A likely credential was detected; redact it before submission.");
  return value;
}
