/** Never reuse the old password-in-chat protocol, even when restoring legacy history. */
export function stripSecretMessages<T extends { role?: unknown; content?: unknown; isPassword?: boolean }>(messages: T[]): T[] {
  let awaitingLegacySecret = false;
  const clean: T[] = [];
  for (const message of messages) {
    if (!message || typeof message !== "object") continue;
    if (message.role === "assistant" && typeof message.content === "string" && /enter owner password\s*:/i.test(message.content)) {
      awaitingLegacySecret = true;
      continue;
    }
    if (message.role === "user" && awaitingLegacySecret) {
      awaitingLegacySecret = false;
      continue;
    }
    if (message.isPassword) continue;
    clean.push(message);
  }
  return clean;
}
