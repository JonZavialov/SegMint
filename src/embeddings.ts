/**
 * Pluggable embedding provider interface and default OpenAI implementation.
 */

/**
 * An embedding provider maps an array of text strings to an array of
 * float vectors. The output array must be the same length as the input,
 * with output[i] corresponding to input[i].
 */
export interface EmbeddingProvider {
  embed(texts: string[]): Promise<number[][]>;
}

/**
 * OpenAI embeddings via the /v1/embeddings endpoint.
 *
 * Uses the global `fetch` available in Node 20+.
 * Maps response objects back to input order using the returned `index` field.
 */
export class OpenAIEmbeddingProvider implements EmbeddingProvider {
  private readonly apiKey: string;
  private readonly model: string;
  private readonly baseUrl: string;

  constructor(
    apiKey: string,
    model = "text-embedding-3-small",
    baseUrl = "https://api.openai.com",
  ) {
    this.apiKey = apiKey;
    this.model = model;
    this.baseUrl = baseUrl;
  }

  async embed(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];

    const response = await fetch(`${this.baseUrl}/v1/embeddings`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        input: texts,
      }),
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(
        `OpenAI embeddings API error (${response.status}): ${body}`,
      );
    }

    const json = (await response.json()) as {
      data: Array<{ index: number; embedding: number[] }>;
    };

    // Map outputs to inputs using the returned index field
    const result: number[][] = new Array<number[]>(texts.length);
    for (const item of json.data) {
      result[item.index] = item.embedding;
    }

    return result;
  }
}

/**
 * Resolve the configured embedding provider.
 *
 * @throws Error if OPENAI_API_KEY is not set (caught by tool handler
 * and returned as a structured MCP error).
 */
export function getEmbeddingProvider(): EmbeddingProvider {
  const key = process.env.OPENAI_API_KEY;
  if (!key) {
    throw new Error(
      "OPENAI_API_KEY environment variable is not set. " +
        "Set it to use group_changes: export OPENAI_API_KEY=sk-...",
    );
  }
  return new OpenAIEmbeddingProvider(key);
}
