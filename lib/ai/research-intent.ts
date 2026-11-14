/** Scan banners and terminal evidence are data, not instructions to research a URL. */
export function classifyResearchIntent(input: { instruction: string; evidence?: string }): { requested: boolean; query: string | null } {
  // Only an explicit opening instruction may trigger research. Subsequent pasted
  // terminal/quoted lines cannot promote themselves to a web-search request.
  const opening = input.instruction.split("```")[0].split("\n").find(line => line.trim())?.trim() || "";
  const explicit = /^(?:please\s+)?(?:search(?: the web)?|browse|look up|find (?:current|latest)|verify (?:online|against current)|research)\b/i.test(opening) ? opening : "";
  if (!explicit) return { requested: false, query: null };
  return { requested: true, query: explicit.trim().slice(0, 500) };
}
export function isTerminalEvidence(message: string): boolean {
  return /\b(?:Starting Nmap|Nmap scan report|PORT\s+STATE\s+SERVICE|netstat\s+-ano|Local Address\s+Foreign Address|LISTENING|ESTABLISHED)\b/i.test(message);
}
