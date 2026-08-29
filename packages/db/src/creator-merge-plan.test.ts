import { describe, expect, test } from "bun:test";

import { buildMergePlan, creatorNameKey, summarizePlan } from "./creator-merge-plan";

interface RowOverrides {
  id?: string;
  displayName?: string;
  createdAt?: number;
  contentCount?: number;
  subscriptionCount?: number;
}

function row(overrides: RowOverrides = {}): import("./creator-merge-plan").CreatorRow {
  return {
    id: overrides.id ?? "id",
    sourceType: "youtube",
    sourceExternalId: "ext",
    displayName: overrides.displayName ?? "Name",
    createdAt: overrides.createdAt ?? 1000,
    contentCount: overrides.contentCount ?? 0,
    subscriptionCount: overrides.subscriptionCount ?? 0,
  };
}

describe("creatorNameKey", () => {
  test("strips leading @, trailing claim revision, whitespace, and lowercases", () => {
    expect(creatorNameKey("@ScottManley")).toBe("scottmanley");
    expect(creatorNameKey("@ScottManley:5")).toBe("scottmanley");
    expect(creatorNameKey("Scott Manley")).toBe("scottmanley");
    expect(creatorNameKey("  GreatScott! ")).toBe("greatscott!");
    expect(creatorNameKey("@docteuralwest:0")).toBe("docteuralwest");
    expect(creatorNameKey("Half as Interesting")).toBe("halfasinteresting");
  });
});

describe("buildMergePlan", () => {
  test("collapses a cross-source mirror onto the member with the most content", () => {
    const plan = buildMergePlan([
      row({ id: "yt", displayName: "Scott Manley", contentCount: 481, subscriptionCount: 1 }),
      row({ id: "od-bare", displayName: "@ScottManley", contentCount: 0 }),
      row({ id: "od-rev", displayName: "@ScottManley:5", contentCount: 0 }),
    ]);

    expect(plan.groups).toHaveLength(1);
    const group = plan.groups[0];
    expect(group?.canonical.id).toBe("yt");
    expect(group?.mergedAwayIds).toEqual(["od-bare", "od-rev"]);
  });

  test("ties break by subscription count then earliest created_at", () => {
    const plan = buildMergePlan([
      row({ id: "a", displayName: "Same", contentCount: 5, subscriptionCount: 0, createdAt: 2000 }),
      row({ id: "b", displayName: "@same", contentCount: 5, subscriptionCount: 1, createdAt: 1000 }),
    ]);
    expect(plan.groups[0]?.canonical.id).toBe("b");
  });

  test("singletons produce no merge action", () => {
    const plan = buildMergePlan([
      row({ id: "only", displayName: "Unique Channel", contentCount: 10 }),
    ]);
    expect(plan.groups).toHaveLength(0);
    expect(summarizePlan(plan)).toEqual({ groups: 0, creatorsMergedAway: 0 });
  });

  test("summary counts groups and merged-away creators", () => {
    const plan = buildMergePlan([
      row({ id: "a1", displayName: "Alpha" }),
      row({ id: "a2", displayName: "@alpha" }),
      row({ id: "b1", displayName: "Beta" }),
      row({ id: "b2", displayName: "Beta " }),
      row({ id: "b3", displayName: "@beta:9" }),
      row({ id: "solo", displayName: "Solo" }),
    ]);
    expect(summarizePlan(plan)).toEqual({ groups: 2, creatorsMergedAway: 3 });
  });
});
