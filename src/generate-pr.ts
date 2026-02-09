/**
 * PR draft generation from real commit SHAs.
 *
 * Downstream consumer of the semantic substrate. Accepts committed SHAs
 * (hex format only, no symbolic refs) and composes a PullRequestDraft
 * with structured metadata from git show.
 */

import { execGit } from "./exec-git.js";
import type { CommitPlan, PullRequestDraft } from "./models.js";
import { parseNameStatus } from "./show.js";

/** Hex SHA pattern: 4+ hex characters. */
const SHA_PATTERN = /^[0-9a-f]{4,}$/i;

interface CommitMetadata {
  sha: string;
  short_sha: string;
  subject: string;
  body: string;
}

/**
 * Generate a PR draft from real commit SHAs.
 *
 * Each SHA is resolved via git show. Invalid format or unknown SHAs
 * produce descriptive errors. The resulting draft includes a markdown
 * description with summary bullets, commit list, and files changed.
 */
export function generatePr(
  commitShas: string[],
  cwd?: string,
): PullRequestDraft {
  if (commitShas.length === 0) {
    throw new Error("At least one commit SHA is required");
  }

  // Validate SHA format
  for (const sha of commitShas) {
    if (!SHA_PATTERN.test(sha)) {
      throw new Error(`Invalid commit SHA format: ${sha}`);
    }
  }

  const metadatas: CommitMetadata[] = [];
  const allFiles = new Set<string>();

  for (const sha of commitShas) {
    // Get commit metadata
    let metaRaw: string;
    try {
      metaRaw = execGit(
        ["show", "-s", "--pretty=format:%H%x00%h%x00%s%x00%b", sha],
        cwd,
      );
    } catch {
      throw new Error(`Unknown commit SHA: ${sha}`);
    }

    const parts = metaRaw.split("\0");
    const metadata: CommitMetadata = {
      sha: parts[0] ?? sha,
      short_sha: parts[1] ?? sha.slice(0, 7),
      subject: parts[2] ?? "",
      body: parts.slice(3).join("\0").trim(),
    };
    metadatas.push(metadata);

    // Get files changed
    const filesRaw = execGit(
      ["show", "--name-status", "--pretty=format:", sha],
      cwd,
    );
    const files = parseNameStatus(filesRaw.trim());
    for (const f of files) {
      allFiles.add(f.path);
    }
  }

  // Build title
  const title =
    metadatas.length === 1
      ? metadatas[0].subject
      : `${metadatas[0].subject} (+${metadatas.length - 1} more)`;

  // Build description
  const summaryBullets = metadatas.map((m) => `- ${m.subject}`).join("\n");
  const commitList = metadatas
    .map((m) => `- \`${m.short_sha}\` ${m.subject}`)
    .join("\n");
  const sortedFiles = [...allFiles].sort();
  const fileList = sortedFiles.map((f) => `- ${f}`).join("\n");

  const description = [
    "## Summary",
    summaryBullets,
    "",
    "## Commits",
    commitList,
    "",
    "## Files changed",
    fileList,
  ].join("\n");

  // Build commits array
  const commits: CommitPlan[] = metadatas.map((m) => ({
    id: m.sha,
    title: m.subject,
    description: m.body,
    change_group_ids: [],
  }));

  return { title, description, commits };
}
