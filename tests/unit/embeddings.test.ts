import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  LocalEmbeddingProvider,
  OpenAIEmbeddingProvider,
  getEmbeddingProvider,
} from "../../src/embeddings.js";

describe("LocalEmbeddingProvider", () => {
  const provider = new LocalEmbeddingProvider();

  it("returns empty for empty input", async () => {
    expect(await provider.embed([])).toEqual([]);
  });

  it("returns 32-dimensional vectors", async () => {
    const result = await provider.embed(["hello"]);
    expect(result).toHaveLength(1);
    expect(result[0]).toHaveLength(32);
  });

  it("is deterministic", async () => {
    const a = await provider.embed(["test"]);
    const b = await provider.embed(["test"]);
    expect(a).toEqual(b);
  });

  it("produces different vectors for different inputs", async () => {
    const result = await provider.embed(["alpha", "beta"]);
    expect(result[0]).not.toEqual(result[1]);
  });

  it("produces values in [-1, 1]", async () => {
    const result = await provider.embed(["test string"]);
    for (const val of result[0]) {
      expect(val).toBeGreaterThanOrEqual(-1);
      expect(val).toBeLessThanOrEqual(1);
    }
  });
});

describe("OpenAIEmbeddingProvider", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("returns empty for empty input without calling fetch", async () => {
    globalThis.fetch = vi.fn();
    const provider = new OpenAIEmbeddingProvider("test-key");
    const result = await provider.embed([]);
    expect(result).toEqual([]);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("maps response items by index", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        data: [
          { index: 1, embedding: [0.2, 0.3] },
          { index: 0, embedding: [0.1, 0.4] },
        ],
      }),
    });
    const provider = new OpenAIEmbeddingProvider("test-key");
    const result = await provider.embed(["a", "b"]);
    expect(result[0]).toEqual([0.1, 0.4]);
    expect(result[1]).toEqual([0.2, 0.3]);
  });

  it("throws on HTTP error", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      text: async () => "Unauthorized",
    });
    const provider = new OpenAIEmbeddingProvider("bad-key");
    await expect(provider.embed(["test"])).rejects.toThrow(
      "OpenAI embeddings API error (401): Unauthorized"
    );
  });

  it("sends correct request to the API", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        data: [{ index: 0, embedding: [0.1] }],
      }),
    });
    const provider = new OpenAIEmbeddingProvider(
      "sk-test",
      "text-embedding-3-small",
      "https://custom.api.com"
    );
    await provider.embed(["hello"]);
    expect(globalThis.fetch).toHaveBeenCalledWith(
      "https://custom.api.com/v1/embeddings",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "Bearer sk-test",
        }),
      })
    );
  });
});

describe("getEmbeddingProvider", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    delete process.env.SEGMINT_EMBEDDING_PROVIDER;
    delete process.env.OPENAI_API_KEY;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("returns LocalEmbeddingProvider when env=local", () => {
    process.env.SEGMINT_EMBEDDING_PROVIDER = "local";
    const provider = getEmbeddingProvider();
    expect(provider).toBeInstanceOf(LocalEmbeddingProvider);
  });

  it("throws when no OPENAI_API_KEY and not local", () => {
    expect(() => getEmbeddingProvider()).toThrow("OPENAI_API_KEY");
  });

  it("returns OpenAIEmbeddingProvider when key is set", () => {
    process.env.OPENAI_API_KEY = "sk-test";
    const provider = getEmbeddingProvider();
    expect(provider).toBeInstanceOf(OpenAIEmbeddingProvider);
  });
});
