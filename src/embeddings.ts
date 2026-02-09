/**
 * Pluggable embedding provider interface and implementations.
 *
 * Provides the vector representation layer for semantic clustering.
 * The EmbeddingProvider interface decouples the substrate from any
 * specific embedding API.
 */

import { createHash } from "node:crypto";

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
 * Local deterministic embedding provider using SHA-256 hashing.
 *
 * Produces 32-dimensional vectors from text using cryptographic hashing.
 * Each byte of the SHA-256 digest is mapped to [-1, 1]. Fully offline,
 * deterministic, and requires no API keys.
 *
 * Intended for testing and development — not for production semantic similarity.
 */
export class LocalEmbeddingProvider implements EmbeddingProvider {
  async embed(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];

    return texts.map((text) => {
      const hash = createHash("sha256").update(text).digest();
      const vec: number[] = new Array(32);
      for (let i = 0; i < 32; i++) {
        vec[i] = (hash[i] / 127.5) - 1;
      }
      return vec;
    });
  }
}

/**
 * Resolve the configured embedding provider.
 *
 * When SEGMINT_EMBEDDING_PROVIDER=local, returns a LocalEmbeddingProvider
 * (no API key needed). Otherwise falls back to OpenAI.
 *
 * @throws Error if using OpenAI and OPENAI_API_KEY is not set (caught by tool
 * handler and returned as a structured MCP error).
 */
export function getEmbeddingProvider(): EmbeddingProvider {
  if (process.env.SEGMINT_EMBEDDING_PROVIDER === "local") {
    return new LocalEmbeddingProvider();
  }

  const key = process.env.OPENAI_API_KEY;
  if (!key) {
    throw new Error(
      "OPENAI_API_KEY environment variable is not set. " +
        "Set it to use group_changes: export OPENAI_API_KEY=sk-...",
    );
  }
  return new OpenAIEmbeddingProvider(key);
}
