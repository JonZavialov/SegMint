# Changelog

## v0.1.0 — 2025-02-09

### All 10 MCP tools are now real (no mock data)

**Tier 1 Read-Only Substrate:**
- `repo_status` — structured repo state
- `list_changes` — uncommitted changes as Change[]
- `log` — commit history with filtering
- `show_commit` — full commit details
- `diff_between_refs` — structured diff between refs
- `blame` — line-level attribution

**Semantic Layer:**
- `group_changes` — intent-based clustering via embeddings (now with content-derived stable IDs)

**Downstream Consumers:**
- `propose_commits` — deterministic commit planning from ChangeGroups (heuristic titles)
- `apply_commit` — real git staging + commit with safety guardrails (confirm, dry_run, expected_head_sha, allow_staged)
- `generate_pr` — PR draft generation from real commit SHAs

### Architecture

- Content-derived stable IDs for groups (`group-<hash>`) and commits (`commit-<hash>`)
- Shared `embedAndCluster()` pipeline — single source of truth for group computation
- `computeGroups()` for stateless recomputation across tools
- Removed all mock data (`src/mock-data.ts` deleted)

### Safety

- `apply_commit` defaults to `dry_run: true`, requires `confirm: true`
- Optimistic concurrency via `expected_head_sha`
- Fails on staged changes outside commit scope (unless `allow_staged: true`)
- Fails during merge/rebase conflicts
- Uses `git commit -m <title> -m <description>` for cross-platform safety

### Testing

- 267 tests across 19 test files
- 95%+ coverage enforcement (statements, branches, functions, lines)
- All tests run offline with `SEGMINT_EMBEDDING_PROVIDER=local`
