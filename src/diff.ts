/**
 * Ref-to-ref diff — Tier 1 read-only repo intelligence.
 *
 * Computes a structured diff between any two git refs (branches, commits, tags)
 * with optional path filtering. Reuses the existing parseDiff pipeline from
 * git.ts to produce Change/Hunk objects.
 */

import { execFileSync } from "node:child_process";
import type { Change } from "./models.js";
import { parseDiff } from "./git.js";

// 10 MB — consistent with git.ts, status.ts, history.ts, show.ts
const MAX_BUFFER = 10 * 1024 * 1024;

const EXEC_OPTS_BASE = {
  encoding: "utf8" as const,
  maxBuffer: MAX_BUFFER,
  stdio: ["pipe", "pipe", "pipe"] as ["pipe", "pipe", "pipe"],
};

export interface DiffBetweenRefsArgs {
  base: string;
  head: string;
  path?: string;
  unified?: number;
}

/**
 * Compute structured diff between two refs.
 *
 * @throws Error with descriptive message if refs are invalid, not a git repo, etc.
 */
export function getDiffBetweenRefs(args: DiffBetweenRefsArgs): Change[] {
  const dir = process.cwd();
  const opts = { ...EXEC_OPTS_BASE, cwd: dir };

  // Clamp unified context lines to 0..20, default 3
  let unified = args.unified ?? 3;
  if (unified < 0) unified = 0;
  if (unified > 20) unified = 20;

  const argv: string[] = [
    "diff",
    args.base,
    args.head,
    "--no-color",
    `--unified=${unified}`,
  ];

  if (args.path !== undefined) {
    argv.push("--", args.path);
  }

  let raw: string;
  try {
    raw = execFileSync("git", argv, opts);
  } catch (err) {
    throwGitError(err);
  }

  const parsed = parseDiff(raw);

  // Sort by file_path for deterministic IDs (scoped to this output)
  const sorted = parsed.sort((a, b) => a.file_path.localeCompare(b.file_path));

  return sorted.map((entry, idx) => ({
    id: `change-${idx + 1}`,
    file_path: entry.file_path,
    hunks: entry.hunks,
  }));
}

/**
 * Inspect a git error and throw a descriptive message.
 * Mirrors the pattern in git.ts, status.ts, history.ts, show.ts.
 */
function throwGitError(err: unknown): never {
  if (!(err instanceof Error)) throw err;

  const stderr = "stderr" in err ? String((err as { stderr: unknown }).stderr).trim() : "";
  const msg = stderr || err.message || "";

  if (msg.includes("not a git repository")) {
    throw new Error("Not a git repository");
  }

  if ("code" in err && (err as NodeJS.ErrnoException).code === "ENOENT") {
    throw new Error("git command not found. Please install git.");
  }

  throw new Error(msg || "Unknown git error");
}
