export interface LiveSearchResult {
  title: string;
  url: string;
  content: string;
}

type TavilyResult = {
  title?: string;
  url?: string;
  content?: string;
};

type TavilyResponse = {
  results?: TavilyResult[];
};

/**
 * Searches the live web through Tavily.
 * This should only be called for current/live/recent questions.
 */
export async function searchLiveWeb(
  query: string,
): Promise<LiveSearchResult[]> {
  const apiKey = process.env.TAVILY_API_KEY;

  if (!apiKey) {
    console.warn("[SVANSAI] TAVILY_API_KEY is not configured.");
    return [];
  }

  try {
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
        include_answer: false,
        include_raw_content: false,
      }),
    });

    if (!response.ok) {
      console.error("[SVANSAI] Tavily search failed:", response.status);
      return [];
    }

    const data = (await response.json()) as TavilyResponse;

    return (data.results ?? []).map((result) => ({
      title: result.title ?? "Untitled",
      url: result.url ?? "",
      content: result.content ?? "",
    }));
  } catch (error) {
    console.error("[SVANSAI] Live search error:", error);
    return [];
  }
}