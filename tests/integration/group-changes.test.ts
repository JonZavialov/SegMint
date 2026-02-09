import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { loadChanges, resolveChangeIds, buildEmbeddingText } from "../../src/changes.js";
import { LocalEmbeddingProvider } from "../../src/embeddings.js";
import { clusterByThreshold } from "../../src/cluster.js";

function createTempRepo(): { dir: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), "segmint-group-"));
  const git = (args: string[]) =>
    execFileSync("git", args, { cwd: dir, encoding: "utf8" });

  git(["init"]);
  git(["config", "user.name", "Test"]);
  git(["config", "user.email", "test@test.com"]);
  git(["config", "core.autocrlf", "false"]);
  git(["config", "commit.gpgsign", "false"]);

  return {
    dir,
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
}

describe("group_changes full pipeline (local embeddings)", () => {
  let dir: string;
  let cleanup: () => void;

  beforeEach(() => {
    ({ dir, cleanup } = createTempRepo());

    // Create initial commit
    writeFileSync(join(dir, "auth.ts"), "export function login() {}");
    writeFileSync(join(dir, "routes.ts"), 'const router = {}; export default router;');
    writeFileSync(join(dir, "utils.ts"), "export const helper = 1;");
    execFileSync("git", ["add", "."], { cwd: dir });
    execFileSync("git", ["commit", "-m", "init"], { cwd: dir });

    // Make changes
    writeFileSync(join(dir, "auth.ts"), "export function login() { return true; }");
    writeFileSync(join(dir, "routes.ts"), 'const router = { get: null }; export default router;');
    writeFileSync(join(dir, "utils.ts"), "export const helper = 2;");
    execFileSync("git", ["add", "."], { cwd: dir });
  });

  afterEach(() => cleanup());

  it("loads changes, embeds, and clusters", async () => {
    const changes = loadChanges(dir);
    expect(changes.length).toBe(3);

    // Resolve all IDs
    const ids = changes.map((c) => c.id);
    const { changes: resolved, unknown } = resolveChangeIds(ids, dir);
    expect(unknown).toEqual([]);
    expect(resolved).toHaveLength(3);

    // Build embedding text
    const texts = resolved.map((c) => buildEmbeddingText(c));
    expect(texts.length).toBe(3);
    expect(texts[0]).toContain("file:");

    // Embed with local provider
    const provider = new LocalEmbeddingProvider();
    const embeddings = await provider.embed(texts);
    expect(embeddings).toHaveLength(3);
    expect(embeddings[0]).toHaveLength(32);

    // Cluster
    const clusters = clusterByThreshold(embeddings, 0.80);
    expect(clusters.length).toBeGreaterThanOrEqual(1);

    // Each index should appear exactly once
    const allIndices = clusters.flatMap((c) => c.indices).sort();
    expect(allIndices).toEqual([0, 1, 2]);
  });
});
