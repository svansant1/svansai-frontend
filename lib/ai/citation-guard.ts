export function enforceLiveCitations(response: string, effectiveMessage: string): string {
  if (!effectiveMessage.includes("LIVE WEB RESULTS:")) return response;
  if (/Live search was attempted but no reliable current information could be verified/i.test(effectiveMessage)) {
    return response;
  }

  const sourceMatches = [...effectiveMessage.matchAll(/Result\s+(\d+)\s+Title:[\s\S]*?URL:\s+(https?:\/\/\S+)/g)];
  if (!sourceMatches.length) return response;

  const hasCitation = /\[\d+\]/.test(response);
  const hasSourcesList = /(^|\n)\s*Sources\s*:|(^|\n)\s*Source\s*:/i.test(response);
  if (hasCitation && hasSourcesList) return response;

  const sources = sourceMatches
    .slice(0, 5)
    .map((match) => `[${match[1]}] ${match[2]}`)
    .join("\n");

  const note = hasCitation
    ? `Sources:\n${sources}`
    : `Note: live/current details should be verified against the sources below.\n\nSources:\n${sources}`;

  return `${response.trim()}\n\n${note}`.trim();
}
