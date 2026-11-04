import type { ChatMessage } from "@/lib/ai/types";
import type { CyberAccessContext } from "@/lib/ai/cyber-mode";

function normalize(text: string): string {
  return text.toLowerCase().replace(/\s+/g, " ").trim();
}

function lastIpv4(text: string): string | null {
  const matches = text.match(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g) ?? [];
  for (let i = matches.length - 1; i >= 0; i--) {
    const parts = matches[i].split(".").map(Number);
    if (parts.length === 4 && parts.every((part) => part >= 0 && part <= 255)) {
      return matches[i];
    }
  }
  return null;
}

function recentUserText(messages: ChatMessage[], count = 32): string[] {
  return messages
    .filter((message) => message.role === "user")
    .slice(-count)
    .map((message) => message.content.trim())
    .filter(Boolean);
}

function lastMatching(
  messages: ChatMessage[],
  pattern: RegExp,
): string | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const content = messages[i]?.content ?? "";
    if (pattern.test(content)) return content;
  }
  return null;
}

export function buildCyberContinuityContext(
  messages: ChatMessage[],
  cyberAccess: CyberAccessContext,
): string {
  if (!cyberAccess.active) return "";

  const userTexts = recentUserText(messages);
  const joined = normalize(userTexts.join(" "));

  const ownerDevice = /\b(my|my own|i own)\b/.test(joined) &&
    /\b(laptop|computer|pc|desktop|vm|device|machine|network)\b/.test(joined);

  const targetMessage =
    [...userTexts]
      .reverse()
      .find((value) => /\b(laptop|target|device|machine)\b/i.test(value) && lastIpv4(value)) ??
    [...userTexts].reverse().find((value) => lastIpv4(value));
  const targetIp = targetMessage ? lastIpv4(targetMessage) : null;

  const desktopOnly =
    /\b(only my desktop|only the desktop|from my desktop|using only my desktop|everything from my desktop|dont want to touch the laptop|don t want to touch the laptop|without touching the laptop)\b/.test(joined);
  const kali = /\bkali\b/.test(joined);
  const targetLikelyWindows =
    /\b(netstat\s+-ano|ipconfig|powershell|remote desktop|rdp|windows defender|cmd\.exe|task manager)\b/.test(
      joined,
    );
  const targetLikelyLinux =
    !targetLikelyWindows &&
    /\b(systemctl|hostname\s+-I|openssh-server|apt\s+install|\/bin\/bash|linux)\b/.test(
      joined,
    );
  const avoidRemote =
    /\b(dont want to remote|don t want to remote|without remote access|not remote|dont want rdp|don t want rdp)\b/.test(joined);
  const portDriven =
    /\b(open port|through a port|go in through a port|find a port|identify an open port)\b/.test(joined);

  const completed: string[] = [];
  if (/\bnmap\b/.test(joined)) completed.push("Nmap has already been used.");
  if (/\bping\b/.test(joined)) completed.push("Ping/connectivity testing has already been attempted.");
  if (/\bnetstat\s+-ano\b/.test(joined)) completed.push("netstat -ano has already been run or discussed.");
  if (/\bssh\b/.test(joined)) completed.push("SSH has already been attempted or discussed.");

  const nmapEvidence = lastMatching(
    messages,
    /PORT\s+STATE\s+SERVICE|\b(?:open|filtered|closed)\s+(?:ssh|http|https|rdp|microsoft-ds)\b/i,
  );
  const netstatEvidence = lastMatching(
    messages,
    /\bnetstat\b.*\b(?:LISTENING|ESTABLISHED|PID|local address|foreign address)\b/i,
  );

  const constraints = [
    ownerDevice ? "The user has identified the target as their own device." : "",
    targetIp ? `Current target IP: ${targetIp}.` : "",
    desktopOnly ? "Work from the desktop side only unless the user explicitly changes that constraint." : "",
    kali ? "The user wants Kali Linux as the working environment." : "",
    targetLikelyWindows ? "The target device appears to be Windows; do not give Linux target-side commands unless new evidence changes that." : "",
    targetLikelyLinux ? "The target device appears to be Linux." : "",
    avoidRemote ? "The user does not want RDP/ordinary remote-control setup as the primary path." : "",
    portDriven ? "The user wants to learn by enumerating an exposed network service/port and progressing from evidence." : "",
  ].filter(Boolean);

  const evidence: string[] = [];
  if (nmapEvidence) {
    evidence.push(`Recent Nmap evidence:\n${nmapEvidence.slice(0, 1200)}`);
  }
  if (netstatEvidence) {
    evidence.push(`Recent netstat evidence:\n${netstatEvidence.slice(0, 800)}`);
  }

  return `
CYBER LAB CONTINUITY STATE
${constraints.length ? constraints.map((item) => `- ${item}`).join("\n") : "- No durable target constraints detected yet."}
${completed.length ? `\nCompleted/attempted steps:\n${completed.map((item) => `- ${item}`).join("\n")}` : ""}
${evidence.length ? `\nEvidence already in the conversation:\n${evidence.join("\n\n")}` : ""}

Response progression rules:
- Preserve the current target, device ownership, tool choice, and user constraints across follow-ups.
- Do not tell the user to repeat a step already completed unless the evidence specifically requires a different scan or option.
- When the user supplies command output, interpret that output first and choose the next command from the evidence.
- Give one primary next action first. Include the exact machine/environment where the command should run.
- After a command, state what result to look for and what the next branch is for each likely result.
- If the user asks "laptop or desktop?", answer that choice in the first sentence before explaining.
- Reuse the latest confirmed target IP instead of inventing an example address or reverting to an older address.
- Keep scanner-side and target-side addresses separate. A Kali `ip a` result is the scanner's address, not automatically the target laptop's address.
- Match target-side commands and payloads to the target operating system. Do not give `/bin/bash` or Linux service commands for a Windows target.
- Distinguish LISTENING ports from ESTABLISHED outbound/client connections. High ephemeral ports in ESTABLISHED state are not automatically remotely accessible services.
- Do not end with generic filler such as "let me know if you need anything else" when a concrete next step is available.
`.trim();
}
