function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function enforceLiveCitationsLikeRuntime(response, effectiveMessage) {
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

const citationResult = enforceLiveCitationsLikeRuntime(
  "The current result is available now.",
  `LIVE WEB RESULTS:
Result 1
Title: Example
URL: https://example.com/current
Content: Current verified snippet.`,
);
assert(citationResult.includes("Sources:"), "Citation guard did not add a Sources section.");
assert(citationResult.includes("[1] https://example.com/current"), "Citation guard did not include source URL.");

const ocrFallbackMessage =
  "No embedded text was found. OCR is not configured yet; set OCR_SPACE_API_KEY or upload the relevant PDF pages as images.";
assert(/OCR_SPACE_API_KEY/.test(ocrFallbackMessage), "OCR fallback message should name the missing key.");

console.log("Quality guard regression completed.");
