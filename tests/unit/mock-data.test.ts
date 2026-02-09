import { describe, it, expect } from "vitest";
import {
  MOCK_CHANGES,
  MOCK_CHANGE_GROUPS,
  MOCK_COMMIT_PLANS,
  MOCK_PR_DRAFT,
} from "../../src/mock-data.js";

describe("mock data contract", () => {
  it("has expected change IDs", () => {
    const ids = MOCK_CHANGES.map((c) => c.id);
    expect(ids).toEqual(["change-1", "change-2"]);
  });

  it("has expected group IDs", () => {
    const ids = MOCK_CHANGE_GROUPS.map((g) => g.id);
    expect(ids).toEqual(["group-1", "group-2"]);
  });

  it("has expected commit plan IDs", () => {
    const ids = MOCK_COMMIT_PLANS.map((c) => c.id);
    expect(ids).toEqual(["commit-1", "commit-2"]);
  });

  it("commit plans reference valid group IDs", () => {
    const groupIds = new Set(MOCK_CHANGE_GROUPS.map((g) => g.id));
    for (const plan of MOCK_COMMIT_PLANS) {
      for (const gid of plan.change_group_ids) {
        expect(groupIds.has(gid)).toBe(true);
      }
    }
  });

  it("PR draft references valid commit IDs", () => {
    const commitIds = new Set(MOCK_COMMIT_PLANS.map((c) => c.id));
    for (const commit of MOCK_PR_DRAFT.commits) {
      expect(commitIds.has(commit.id)).toBe(true);
    }
  });

  it("PR draft has title and description", () => {
    expect(MOCK_PR_DRAFT.title.length).toBeGreaterThan(0);
    expect(MOCK_PR_DRAFT.description.length).toBeGreaterThan(0);
  });
});
