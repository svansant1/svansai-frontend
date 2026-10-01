import type { AttachedFile } from "@/lib/ai/file-types";
import { generateWithAnthropic } from "@/lib/ai/providers/anthropic";
import { generateWithGemini } from "@/lib/ai/providers/gemini";
import { generateWithOpenAI } from "@/lib/ai/providers/openai";
import type { ProviderName } from "@/lib/ai/providers/router";

export type ProviderRequest = {
  prompt: string;
  systemInstruction: string;
  temperature: number;
  model?: string;
  maxOutputTokens?: number;
  rejectTruncated?: boolean;
  attachedFiles?: AttachedFile[];
};

const DEFAULT_TIMEOUT_MS = 25_000;
const SHORT_COOLDOWN_MS = 30_000;
const LONG_COOLDOWN_MS = 5 * 60_000;

const providerCooldowns = new Map<ProviderName, number>();

/**
 * Returns how long a provider remains in cooldown.
 *
 * A return value of zero means the provider is currently eligible.
 */
export function providerCooldownRemaining(
  provider: ProviderName,
): number {
  return Math.max(
    0,
    (providerCooldowns.get(provider) ?? 0) - Date.now(),
  );
}

/**
 * Places a failed provider into a temporary cooldown.
 *
 * Failures that are unlikely to recover immediately receive a longer
 * cooldown so subsequent requests do not repeatedly hit the same
 * unavailable provider.
 */
export function markProviderFailure(
  provider: ProviderName,
  error: unknown,
): void {
  const message =
    error instanceof Error ? error.message : String(error);

  const longCooldown =
    /\b(credit|quota|billing|rate limit|429|402)\b/i.test(message);

  providerCooldowns.set(
    provider,
    Date.now() +
      (longCooldown ? LONG_COOLDOWN_MS : SHORT_COOLDOWN_MS),
  );
}

/**
 * Clears failure state after a successful provider response.
 */
export function markProviderHealthy(
  provider: ProviderName,
): void {
  providerCooldowns.delete(provider);
}

/**
 * Executes a single provider request.
 *
 * Provider ordering, fallback policy, response validation, and retries
 * intentionally remain outside this function.
 */
export async function callProvider(
  provider: ProviderName,
  request: ProviderRequest,
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<string | null> {
  const providerCall = async (): Promise<string | null> => {
    switch (provider) {
      case "openai":
        return generateWithOpenAI(request);

      case "anthropic":
        return generateWithAnthropic(request);

      case "gemini":
        return generateWithGemini(request);

      default: {
        const exhaustiveCheck: never = provider;

        throw new Error(
          `Unsupported provider: ${String(exhaustiveCheck)}`,
        );
      }
    }
  };

  let timeout: ReturnType<typeof setTimeout> | undefined;

  try {
    return await Promise.race([
      providerCall(),

      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => {
          reject(
            new Error(
              `${provider} request timed out after ${timeoutMs}ms`,
            ),
          );
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timeout) {
      clearTimeout(timeout);
    }
  }
}

/**
 * Clears process-local provider health state.
 *
 * Intended for deterministic unit tests.
 */
export function resetProviderCooldowns(): void {
  providerCooldowns.clear();
}