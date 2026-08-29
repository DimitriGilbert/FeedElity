import { describe, expect, test } from "bun:test";

import { contentCrossSourceKey } from "./cross-source-key";

/**
 * Parity contract shared with contentCrossSourceKey() in
 * packages/api/src/domain/catalog.ts. packages/db must not import packages/api,
 * so both packages pin the exact same cases with literal expectations (the
 * mirror+parity-table convention used for creatorNameKey in
 * creator-merge-plan.ts). If either implementation drifts from this table, one
 * of the two parity tests fails.
 */
export interface CrossSourceKeyParityCase {
  readonly nameKey: string;
  readonly title: string;
  readonly expected: string | null;
}

export const crossSourceKeyParityCases: readonly CrossSourceKeyParityCase[] = [
  { nameKey: "scottmanley", title: "Launch of Artemis II!", expected: "scottmanley:launchofartemisii" },
  { nameKey: "creatorone", title: "Creator One First Video", expected: "creatorone:creatoronefirstvideo" },
  { nameKey: "scottmanley", title: "Q&A: Your questions, answered", expected: "scottmanley:qayourquestionsanswered" },
  { nameKey: "halfasinteresting", title: "Why Trains Can't Go Faster…", expected: "halfasinteresting:whytrainscantgofaster" },
  { nameKey: "créateur", title: "Épisode nº 12 : l'été", expected: "créateur:épisodenº12lété" },
  // NFC vs NFD accent forms must produce the SAME key: without NFC the
  // combining acute (U+0301, not a letter or number) would be stripped and the
  // decomposed title would derive a different key than its precomposed twin.
  { nameKey: "cafeowner", title: "Café Racer Stories", expected: "cafeowner:caféracerstories" },
  { nameKey: "cafeowner", title: "Cafe\u0301 Racer Stories", expected: "cafeowner:caféracerstories" },
  { nameKey: "cjkcreator", title: "第2話：始まりの靴", expected: "cjkcreator:第2話始まりの靴" },
  // CJK ideographs survive the strip, and the decomposed accent inside the
  // mixed-script title composes to the same key as its precomposed form.
  { nameKey: "cjkcreator", title: "日本語 Café 動画", expected: "cjkcreator:日本語café動画" },
  { nameKey: "cjkcreator", title: "日本語 Cafe\u0301 動画", expected: "cjkcreator:日本語café動画" },
  { nameKey: "numbers", title: "2026-08-29", expected: "numbers:20260829" },
  { nameKey: "scottmanley", title: "!!! 🚀🚀 !!!", expected: null },
  { nameKey: "scottmanley", title: "", expected: null },
];

describe("contentCrossSourceKey (db mirror of the domain implementation)", () => {
  test("agrees with the shared parity case table", () => {
    for (const parityCase of crossSourceKeyParityCases) {
      expect(contentCrossSourceKey(parityCase.nameKey, parityCase.title)).toBe(parityCase.expected);
    }
  });
});
