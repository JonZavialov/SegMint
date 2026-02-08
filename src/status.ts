/**
 * Repository status — Tier 1 read-only repo intelligence.
 *
 * Gathers structured repository state (HEAD, staged/unstaged/untracked files,
 * ahead/behind counts, merge/rebase state) from git CLI commands.
 */

import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { RepoStatus, HeadInfo, FileStatus } from "./models.js";

// 10 MB — consistent with git.ts
const MAX_BUFFER = 10 * 1024 * 1024;

const EXEC_OPTS_BASE = {
  encoding: "utf8" as const,
  maxBuffer: MAX_BUFFER,
  stdio: ["pipe", "pipe", "pipe"] as ["pipe", "pipe", "pipe"],
};

/**
 * Gather full repository status as a structured object.
 *
 * All fields are deterministic given the same repo state.
 *
 * @param cwd Working directory (defaults to process.cwd())
 * @throws Error with descriptive message if not a git repo or git not installed
 */
export function getRepoStatus(cwd?: string): RepoStatus {
  const dir = cwd ?? process.cwd();
  const opts = { ...EXEC_OPTS_BASE, cwd: dir };

  // Resolve repo root
  const rootPath = execGit(["rev-parse", "--show-toplevel"], opts).trim();

  // Resolve .git directory (needed for merge/rebase detection)
  const gitDir = execGit(["rev-parse", "--git-dir"], opts).trim();
  // git rev-parse --git-dir returns a relative path; resolve it
  const absGitDir = join(dir, gitDir);

  // HEAD info
  const head = resolveHead(opts);

  // Porcelain status
  const porcelainOutput = execGit(
    ["status", "--porcelain=v1", "-b", "--untracked-files=normal"],
    opts,
  );
  const { staged, unstaged, untracked, upstream, aheadBy, behindBy } =
    parsePorcelain(porcelainOutput);

  // Merge / rebase in progress
  const mergeInProgress = existsSync(join(absGitDir, "MERGE_HEAD"));
  const rebaseInProgress =
    existsSync(join(absGitDir, "rebase-apply")) ||
    existsSync(join(absGitDir, "rebase-merge"));

  const result: RepoStatus = {
    is_git_repo: true,
    root_path: rootPath,
    head,
    staged,
    unstaged,
    untracked,
    merge_in_progress: mergeInProgress,
    rebase_in_progress: rebaseInProgress,
  };

  if (upstream !== undefined) result.upstream = upstream;
  if (aheadBy !== undefined) result.ahead_by = aheadBy;
  if (behindBy !== undefined) result.behind_by = behindBy;

  return result;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Run a git command and return stdout. Throws on failure.
 */
function execGit(
  args: string[],
  opts: { encoding: "utf8"; cwd: string; maxBuffer: number; stdio: ["pipe", "pipe", "pipe"] },
): string {
  try {
    return execFileSync("git", args, opts);
  } catch (err) {
    throwGitError(err);
  }
}

/**
 * Resolve HEAD — branch name or detached SHA.
 */
function resolveHead(
  opts: { encoding: "utf8"; cwd: string; maxBuffer: number; stdio: ["pipe", "pipe", "pipe"] },
): HeadInfo {
  // Try symbolic ref first (works when on a branch)
  try {
    const branchName = execFileSync(
      "git",
      ["symbolic-ref", "--short", "HEAD"],
      opts,
    ).trim();
    // Also get the SHA for completeness
    const sha = execFileSync(
      "git",
      ["rev-parse", "HEAD"],
      opts,
    ).trim();
    return { type: "branch", name: branchName, sha };
  } catch {
    // Not on a branch — detached HEAD or fresh repo with no commits
  }

  // Detached HEAD — get the SHA directly
  try {
    const sha = execFileSync(
      "git",
      ["rev-parse", "HEAD"],
      opts,
    ).trim();
    return { type: "detached", sha };
  } catch {
    // Fresh repo with no commits at all — HEAD doesn't resolve
    return { type: "branch", name: undefined, sha: undefined };
  }
}

/**
 * Parse `git status --porcelain=v1 -b` output.
 *
 * First line is the branch header:
 *   ## main...origin/main [ahead 1, behind 2]
 *   ## HEAD (no branch)
 *   ## No commits yet on main
 *
 * Remaining lines are file entries:
 *   XY <path>
 * where X = staging area status, Y = working tree status.
 */
function parsePorcelain(output: string): {
  staged: FileStatus[];
  unstaged: FileStatus[];
  untracked: string[];
  upstream?: string;
  aheadBy?: number;
  behindBy?: number;
} {
  const lines = output.split("\n").filter((l) => l.length > 0);
  const staged: FileStatus[] = [];
  const unstaged: FileStatus[] = [];
  const untracked: string[] = [];

  let upstream: string | undefined;
  let aheadBy: number | undefined;
  let behindBy: number | undefined;

  for (const line of lines) {
    // Branch header line
    if (line.startsWith("## ")) {
      const parsed = parseBranchHeader(line);
      upstream = parsed.upstream;
      aheadBy = parsed.aheadBy;
      behindBy = parsed.behindBy;
      continue;
    }

    // File status lines: "XY <path>" or "XY <path> -> <renamed>"
    if (line.length < 4) continue;
    const x = line[0];
    const y = line[1];
    // path starts at index 3
    const pathPart = line.slice(3);
    // Handle renames: "old -> new"
    const arrowIdx = pathPart.indexOf(" -> ");
    const filePath = arrowIdx >= 0 ? pathPart.slice(arrowIdx + 4) : pathPart;

    // Untracked
    if (x === "?" && y === "?") {
      untracked.push(filePath);
      continue;
    }

    // Staging area (X column): anything other than " ", "?", "!" is a staged change
    if (x !== " " && x !== "?" && x !== "!") {
      staged.push({ path: filePath, status: statusCodeToLabel(x) });
    }

    // Working tree (Y column): anything other than " ", "?", "!" is an unstaged change
    if (y !== " " && y !== "?" && y !== "!") {
      unstaged.push({ path: filePath, status: statusCodeToLabel(y) });
    }
  }

  return { staged, unstaged, untracked, upstream, aheadBy, behindBy };
}

/**
 * Parse the `## branch...upstream [ahead N, behind M]` header.
 */
function parseBranchHeader(line: string): {
  upstream?: string;
  aheadBy?: number;
  behindBy?: number;
} {
  // Remove "## "
  const content = line.slice(3);

  // Patterns:
  //   main...origin/main
  //   main...origin/main [ahead 1]
  //   main...origin/main [behind 2]
  //   main...origin/main [ahead 1, behind 2]
  //   HEAD (no branch)
  //   No commits yet on main

  let upstream: string | undefined;
  let aheadBy: number | undefined;
  let behindBy: number | undefined;

  // Extract tracking info from "local...remote" pattern
  const trackMatch = content.match(/^.+\.\.\.(\S+)/);
  if (trackMatch) {
    upstream = trackMatch[1];
  }

  // Extract ahead/behind from bracket section
  const bracketMatch = content.match(/\[(.+)\]/);
  if (bracketMatch) {
    const info = bracketMatch[1];
    const aheadMatch = info.match(/ahead (\d+)/);
    if (aheadMatch) aheadBy = parseInt(aheadMatch[1], 10);
    const behindMatch = info.match(/behind (\d+)/);
    if (behindMatch) behindBy = parseInt(behindMatch[1], 10);
  }

  return { upstream, aheadBy, behindBy };
}

/**
 * Map single-letter porcelain status codes to human-readable labels.
 */
function statusCodeToLabel(code: string): string {
  switch (code) {
    case "M": return "modified";
    case "A": return "added";
    case "D": return "deleted";
    case "R": return "renamed";
    case "C": return "copied";
    case "U": return "unmerged";
    case "T": return "typechange";
    default: return code;
  }
}

/**
 * Inspect a git error and throw a descriptive message.
 * Mirrors the pattern in git.ts.
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
