import { describe, expect, test } from "bun:test";

import { contentCrossSourceKey, creatorNameKey } from "./catalog";

/**
 * Parity contract shared with contentCrossSourceKey() in
 * packages/db/src/cross-source-key.ts. packages/db must not import packages/api,
 * so both packages pin the exact same cases with literal expectations (the
 * mirror+parity-table convention used for creatorNameKey). If either
 * implementation drifts from this table, one of the two parity tests fails.
 */
interface CrossSourceKeyParityCase {
  readonly nameKey: string;
  readonly title: string;
  readonly expected: string | null;
}

const crossSourceKeyParityCases: readonly CrossSourceKeyParityCase[] = [
  { nameKey: "scottmanley", title: "Launch of Artemis II!", expected: "scottmanley:launchofartemisii" },
  { nameKey: "creatorone", title: "Creator One First Video", expected: "creatorone:creatoronefirstvideo" },
  { nameKey: "scottmanley", title: "Q&A: Your questions, answered", expected: "scottmanley:qayourquestionsanswered" },
  { nameKey: "halfasinteresting", title: "Why Trains Can't Go Faster…", expected: "halfasinteresting:whytrainscantgofaster" },
  { nameKey: "créateur", title: "Épisode nº 12 : l'été", expected: "créateur:épisodenº12lété" },
  { nameKey: "cjkcreator", title: "第2話：始まりの靴", expected: "cjkcreator:第2話始まりの靴" },
  { nameKey: "numbers", title: "2026-08-29", expected: "numbers:20260829" },
  { nameKey: "scottmanley", title: "!!! 🚀🚀 !!!", expected: null },
  { nameKey: "scottmanley", title: "", expected: null },
];

describe("contentCrossSourceKey", () => {
  test("agrees with the shared parity case table", () => {
    for (const parityCase of crossSourceKeyParityCases) {
      expect(contentCrossSourceKey(parityCase.nameKey, parityCase.title)).toBe(parityCase.expected);
    }
  });

  test("pairs creator name keys with normalized titles into mirror keys", () => {
    expect(contentCrossSourceKey(creatorNameKey("@ScottManley:5"), "Launch of Artemis II!")).toBe(
      "scottmanley:launchofartemisii",
    );
  });
});
