export const STARTER_QUOTES = [
  "Small steps still count when they are aimed in the right direction.",
  "Learn the pattern, not just the answer.",
  "A clear mind beats a rushed answer every time.",
  "Build it calmly. Test it honestly. Improve it one layer at a time.",
  "Progress gets easier when the next step is visible.",
  "The best systems are built by noticing what breaks, then making the next version wiser.",
  "Fast answers are good. Reliable answers are better. SVANS-AI should aim for both.",
  "Every strong project starts with one clear next step.",
  "Think it through, test it safely, and let the result teach you.",
  "Your future self benefits from the structure you build today.",
];

export const STARTER_QUOTE_CURRENT_KEY = "svansai-starter-quote-current";
export const STARTER_QUOTE_PREVIOUS_KEY = "svansai-starter-quote-previous";
export const STARTER_QUOTE_MODE_KEY = "svansai-starter-quote-mode";
export const STARTER_QUOTE_LEGACY_OFF_KEY = "SVANS-AI-show-starter-quote";

export type StarterQuoteMode = "show" | "ask" | "off";

export function quoteAt(index: number) {
  return STARTER_QUOTES[
    Math.max(0, Math.min(index, STARTER_QUOTES.length - 1))
  ];
}

export function randomQuoteIndex(excludeIndex?: number) {
  if (STARTER_QUOTES.length <= 1) return 0;

  let next = Math.floor(Math.random() * STARTER_QUOTES.length);
  if (excludeIndex !== undefined) {
    while (next === excludeIndex) {
      next = Math.floor(Math.random() * STARTER_QUOTES.length);
    }
  }

  return next;
}

export function storedQuoteIndex(key: string): number | null {
  if (typeof window === "undefined") return null;
  const value = Number(localStorage.getItem(key));
  return Number.isInteger(value) && value >= 0 && value < STARTER_QUOTES.length
    ? value
    : null;
}

export function getStarterQuoteMode(): StarterQuoteMode {
  if (typeof window === "undefined") return "ask";
  const value = localStorage.getItem(STARTER_QUOTE_MODE_KEY);
  if (value === "show" || value === "ask" || value === "off") return value;
  return localStorage.getItem(STARTER_QUOTE_LEGACY_OFF_KEY) === "false"
    ? "off"
    : "ask";
}

export function initializeStarterQuoteIndex() {
  if (typeof window === "undefined") return 0;

  const current = storedQuoteIndex(STARTER_QUOTE_CURRENT_KEY);
  const next = randomQuoteIndex(current ?? undefined);

  if (current !== null) {
    localStorage.setItem(STARTER_QUOTE_PREVIOUS_KEY, String(current));
  }
  localStorage.setItem(STARTER_QUOTE_CURRENT_KEY, String(next));

  return next;
}
