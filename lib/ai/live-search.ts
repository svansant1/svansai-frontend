export interface LiveSearchResult {
  title: string;
  url: string;
  content: string;
  sourceNumber: number;
}

export type LiveSearchStatus = {
  attempted: boolean;
  resultCount: number;
  failureReason?: string;
};

type TavilyResult = {
  title?: string;
  url?: string;
  content?: string;
  score?: number;
};

type TavilyResponse = {
  results?: TavilyResult[];
};

function extractSearchDomain(query: string): string | null {
  const match = query.match(
    /\b(?:https?:\/\/)?(?:www\.)?([a-z0-9-]+(?:\.[a-z]{2,})(?:\.[a-z]{2,})?)(?:\/[^\s]*)?\b/i,
  );

  if (!match?.[1]) return null;

  return match[1].toLowerCase();
}

/**
 * Searches the live web through Tavily.
 * This should be called for current/live/recent questions and website/domain lookups.
 */
export async function searchLiveWeb(
  query: string,
): Promise<{ results: LiveSearchResult[]; status: LiveSearchStatus }> {
  const apiKey = process.env.TAVILY_API_KEY;

  if (!apiKey) {
    console.warn("[SVANSAI] TAVILY_API_KEY is not configured.");
    return {
      results: [],
      status: {
        attempted: false,
        resultCount: 0,
        failureReason: "TAVILY_API_KEY is not configured.",
      },
    };
  }

  try {
    const domain = extractSearchDomain(query);

    console.log("[SVANSAI] Tavily live search request:", {
      domain,
      hasApiKey: Boolean(apiKey),
    });

    const response = await fetch("https://api.tavily.com/search", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        query,
        search_depth: "advanced",
        max_results: 5,
        ...(domain ? { include_domains: [domain] } : {}),
        include_answer: false,
        include_raw_content: false,
      }),
    });

    if (!response.ok) {
      console.error("[SVANSAI] Tavily search failed:", response.status);
      return {
        results: [],
        status: {
          attempted: true,
          resultCount: 0,
          failureReason: `Tavily search failed with status ${response.status}.`,
        },
      };
    }

    const data = (await response.json()) as TavilyResponse;

    const seen = new Set<string>();
    const results = (data.results ?? [])
      .filter((result) => {
        if (!result.url || !/^https?:\/\//i.test(result.url)) return false;
        if (seen.has(result.url)) return false;
        seen.add(result.url);
        return true;
      })
      .slice(0, 5)
      .map((result, index) => ({
        title: (result.title ?? "Untitled").slice(0, 180),
        url: result.url ?? "",
        content: (result.content ?? "")
          .replace(/\s+/g, " ")
          .trim()
          .slice(0, 900),
        sourceNumber: index + 1,
      }));

    console.log("[SVANSAI] Tavily live search results:", {
      count: results.length,
      domain,
    });

    return {
      results,
      status: {
        attempted: true,
        resultCount: results.length,
        failureReason:
          results.length === 0
            ? "Tavily returned no usable results."
            : undefined,
      },
    };
  } catch (error) {
    console.error("[SVANSAI] Live search error:", error);
    return {
      results: [],
      status: {
        attempted: true,
        resultCount: 0,
        failureReason:
          error instanceof Error ? error.message : "Unknown live search error.",
      },
    };
  }
}
