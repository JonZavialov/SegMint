import type { Change, Hunk } from "./models.js";

export const MAX_PATH_ENTRIES = 200;
export const MAX_CHANGE_ENTRIES = 200;
export const MAX_HUNKS_PER_CHANGE = 200;
export const MAX_DIFF_LINES_PER_HUNK = 200;
export const MAX_BLAME_LINES = 200;

export interface TruncationInfo {
  truncated: boolean;
  omitted_count: number;
}

export function truncateArray<T>(values: T[], max: number): { items: T[] } & TruncationInfo {
  if (values.length <= max) {
    return { items: values, truncated: false, omitted_count: 0 };
  }

  return {
    items: values.slice(0, max),
    truncated: true,
    omitted_count: values.length - max,
  };
}

export function capChanges(changes: Change[]): { changes: Change[] } & TruncationInfo {
  const limitedChanges = truncateArray(changes, MAX_CHANGE_ENTRIES);

  let omitted = limitedChanges.omitted_count;

  const cappedChanges = limitedChanges.items.map((change) => {
    const limitedHunks = truncateArray(change.hunks, MAX_HUNKS_PER_CHANGE);
    omitted += limitedHunks.omitted_count;

    const cappedHunks: Hunk[] = limitedHunks.items.map((hunk) => {
      const limitedLines = truncateArray(hunk.lines, MAX_DIFF_LINES_PER_HUNK);
      omitted += limitedLines.omitted_count;
      return { ...hunk, lines: limitedLines.items };
    });

    return { ...change, hunks: cappedHunks };
  });

  return {
    changes: cappedChanges,
    truncated: omitted > 0,
    omitted_count: omitted,
  };
}
