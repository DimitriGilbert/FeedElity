import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { createClient } from "@libsql/client";
import type { Client } from "@libsql/client";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/libsql";

import * as schema from "@FeedElity/db/schema";

import type { SourceType } from "../domain/catalog";
import {
  createRefreshRun,
  findFeedBySourceIdentity,
  findOrCreateCreator,
  findOrCreateFeed,
  listRefreshFeedResultsForRun,
  recordRefreshFeedResult,
  type RepositoryDb,
} from "../repositories/catalog";
import { createSourceAdapterRegistry, parseHttpUrl } from "../sources";
import type {
  DetectedSourceInput,
  NormalizedCatalogPayload,
  SourceAdapter,
  SourceDetectionFailure,
  SourceDetectionSuccess,
} from "../sources";
import { refreshAll, refreshCreator, refreshFeed, resumeRefreshRun, startRefreshAll } from "./refresh";
import { nextRefreshDate } from "./refresh-policy";

interface TestDatabase {
  readonly client: Client;
  readonly db: RepositoryDb;
}

interface TestFeedSet {
  readonly creatorOneId: string;
  readonly creatorTwoId: string;
  readonly dueFeedId: string;
  readonly notDueFeedId: string;
  readonly noCadenceFeedId: string;
  readonly creatorTwoFeedId: string;
}

let testDatabase: TestDatabase;

beforeEach(async () => {
  testDatabase = await createTestDatabase();
});

afterEach(() => {
  testDatabase.client.close();
});

describe("manual refresh orchestration", () => {
  test("normal refresh skips feeds that are not due or have no cadence metadata", async () => {
    const feeds = await seedFeeds(testDatabase.db);
    const registry = createSourceAdapterRegistry([createRefreshAdapter({ failingFeedExternalIds: [] })]);

    const result = await refreshAll(refreshDependencies(registry), { force: false });

    expect(sorted(result.selectedFeeds.map((feed) => feed.id))).toEqual(sorted([feeds.dueFeedId, feeds.creatorTwoFeedId]));
    expect(result.run).toMatchObject({
      status: "succeeded",
      feedsRequestedCount: 2,
      feedsSkippedCount: 2,
      feedsSucceededCount: 2,
    });
    expect(result.report).toMatchObject({
      runId: result.run.id,
      scope: "all",
      force: false,
      status: "succeeded",
      selectedFeedCount: 2,
      skippedFeedCount: 2,
      feedsSucceededCount: 2,
      feedsFailedCount: 0,
    });
    expect(sorted(result.skippedFeeds.map((skippedFeed) => `${skippedFeed.feed.id}:${skippedFeed.reason}`))).toEqual(
      sorted([`${feeds.notDueFeedId}:not-due`, `${feeds.noCadenceFeedId}:cadence-disabled`]),
    );
    expect(sorted(result.report.feeds.map((feedReport) => `${feedReport.feedId}:${feedReport.status}`))).toEqual(
      sorted([
        `${feeds.dueFeedId}:succeeded`,
        `${feeds.creatorTwoFeedId}:succeeded`,
        `${feeds.notDueFeedId}:skipped`,
        `${feeds.noCadenceFeedId}:skipped`,
      ]),
    );
    expect(result.report.feeds.find((feedReport) => feedReport.feedId === feeds.dueFeedId)).toMatchObject({
      feedTitle: "Due Feed",
      feedUrl: "https://refresh.example.test/due-feed",
      sourceType: "youtube",
    });
    expect(result.report.feeds.find((feedReport) => feedReport.feedId === feeds.notDueFeedId)).toMatchObject({
      feedTitle: "Not Due Feed",
      skipReason: "not-due",
    });
    expect(result.feedResults).toHaveLength(2);
    expect(await listRefreshFeedResultsForRun(testDatabase.db, { refreshRunId: result.run.id, limit: 10 })).toHaveLength(2);
  });

  test("normal refresh updates cadence metadata after successful feed refresh", async () => {
    await seedFeeds(testDatabase.db);
    const registry = createSourceAdapterRegistry([createRefreshAdapter({ failingFeedExternalIds: [] })]);

    await refreshAll(refreshDependencies(registry), { force: false });

    const refreshedFeed = await requireFeed(testDatabase.db, "due-feed");
    const skippedFeed = await requireFeed(testDatabase.db, "not-due-feed");
    const expectedNextRefreshAfter = nextRefreshDate(new Date("2026-05-16T12:00:00.000Z"), "youtube", 900, () => 0);
    expect(refreshedFeed.lastNormalRefreshAt?.toISOString()).toBe("2026-05-16T12:00:00.000Z");
    expect(refreshedFeed.nextRefreshAfter?.toISOString()).toBe(expectedNextRefreshAfter.toISOString());
    expect(refreshedFeed.nextRefreshAfter?.getTime()).toBeGreaterThanOrEqual(new Date("2026-05-16T12:16:00.000Z").getTime());
    expect(refreshedFeed.nextRefreshAfter?.getTime()).toBeLessThanOrEqual(new Date("2026-05-16T12:30:00.000Z").getTime());
    expect(skippedFeed.lastNormalRefreshAt).toBeNull();
    expect(skippedFeed.nextRefreshAfter?.toISOString()).toBe("2026-05-16T13:00:00.000Z");
  });

  test("force refresh selects all feeds regardless of cadence metadata", async () => {
    await seedFeeds(testDatabase.db);
    const registry = createSourceAdapterRegistry([createRefreshAdapter({ failingFeedExternalIds: [] })]);

    const result = await refreshAll(refreshDependencies(registry), { force: true });

    expect(sorted(result.selectedFeeds.map((feed) => feed.sourceExternalId))).toEqual(sorted([
      "due-feed",
      "not-due-feed",
      "no-cadence-feed",
      "creator-two-feed",
    ]));
    expect(result.run).toMatchObject({
      force: true,
      feedsRequestedCount: 4,
      feedsSkippedCount: 0,
      feedsSucceededCount: 4,
      status: "succeeded",
    });
    expect(result.report).toMatchObject({ force: true, selectedFeedCount: 4, skippedFeedCount: 0 });
  });

  test("force refresh does not move normal cadence metadata", async () => {
    await seedFeeds(testDatabase.db);
    const registry = createSourceAdapterRegistry([createRefreshAdapter({ failingFeedExternalIds: [] })]);

    await refreshAll(refreshDependencies(registry), { force: true });

    const dueFeed = await requireFeed(testDatabase.db, "due-feed");
    const noCadenceFeed = await requireFeed(testDatabase.db, "no-cadence-feed");
    expect(dueFeed.lastNormalRefreshAt).toBeNull();
    expect(dueFeed.nextRefreshAfter?.toISOString()).toBe("2026-05-16T11:00:00.000Z");
    expect(noCadenceFeed.lastNormalRefreshAt).toBeNull();
    expect(noCadenceFeed.nextRefreshAfter).toBeNull();
  });

  test("per-creator refresh targets only that creator's feeds", async () => {
    const feeds = await seedFeeds(testDatabase.db);
    const registry = createSourceAdapterRegistry([createRefreshAdapter({ failingFeedExternalIds: [] })]);

    const result = await refreshCreator(
      refreshDependencies(registry),
      { creatorId: feeds.creatorOneId, force: true },
    );

    expect(result.run).toMatchObject({ scope: "creator", requestedCreatorId: feeds.creatorOneId });
    expect(sorted(result.selectedFeeds.map((feed) => feed.id))).toEqual(sorted([
      feeds.dueFeedId,
      feeds.notDueFeedId,
      feeds.noCadenceFeedId,
    ]));
  });

  test("per-feed refresh targets only the requested feed and records feed scope", async () => {
    const feeds = await seedFeeds(testDatabase.db);
    const registry = createSourceAdapterRegistry([createRefreshAdapter({ failingFeedExternalIds: [] })]);

    const result = await refreshFeed(
      refreshDependencies(registry),
      { feedId: feeds.notDueFeedId, force: true },
    );

    expect(result.run).toMatchObject({ scope: "feed", requestedCreatorId: null, requestedFeedId: feeds.notDueFeedId });
    expect(result.selectedFeeds.map((feed) => feed.id)).toEqual([feeds.notDueFeedId]);
    expect(result.report).toMatchObject({ scope: "feed", selectedFeedCount: 1, skippedFeedCount: 0 });
  });

  test("per-feed normal refresh applies existing cadence skip behavior to the requested feed", async () => {
    const feeds = await seedFeeds(testDatabase.db);
    const registry = createSourceAdapterRegistry([createRefreshAdapter({ failingFeedExternalIds: [] })]);

    const result = await refreshFeed(
      refreshDependencies(registry),
      { feedId: feeds.notDueFeedId, force: false },
    );

    expect(result.run).toMatchObject({ scope: "feed", requestedFeedId: feeds.notDueFeedId, feedsRequestedCount: 0, feedsSkippedCount: 1 });
    expect(result.selectedFeeds).toHaveLength(0);
    expect(result.report.feeds).toEqual([
      {
        feedId: feeds.notDueFeedId,
        feedTitle: "Not Due Feed",
        feedUrl: "https://refresh.example.test/not-due-feed",
        sourceType: "youtube",
        status: "skipped",
        skipReason: "not-due",
        itemsDiscoveredCount: 0,
        itemsCreatedCount: 0,
        itemsUpdatedCount: 0,
        error: null,
        startedAt: null,
        completedAt: null,
      },
    ]);
  });

  test("per-feed failures are persisted without hiding successes", async () => {
    const feeds = await seedFeeds(testDatabase.db);
    const registry = createSourceAdapterRegistry([createRefreshAdapter({ failingFeedExternalIds: ["not-due-feed"] })]);

    const result = await refreshAll(refreshDependencies(registry), { force: true });

    expect(result.run).toMatchObject({ status: "partial", feedsRequestedCount: 4, feedsSucceededCount: 3, feedsFailedCount: 1 });
    expect(result.run.errorSummaryJson).toContain(feeds.notDueFeedId);
    expect(result.feedResults.filter((feedResult) => feedResult.status === "succeeded")).toHaveLength(3);
    expect(result.feedResults.filter((feedResult) => feedResult.status === "failed")).toHaveLength(1);
    expect(result.report).toMatchObject({ status: "partial", selectedFeedCount: 4, skippedFeedCount: 0 });
    expect(result.report.feeds.find((feedReport) => feedReport.feedId === feeds.notDueFeedId)).toMatchObject({
      status: "failed",
      error: { code: "remote-fetch-failed", message: "Fixture feed refresh failed." },
    });
  });

  test("refresh reports failure when every selected feed fails", async () => {
    const feeds = await seedFeeds(testDatabase.db);
    const registry = createSourceAdapterRegistry([
      createRefreshAdapter({ failingFeedExternalIds: ["due-feed", "creator-two-feed"] }),
    ]);

    const result = await refreshAll(refreshDependencies(registry), { force: false });

    expect(result.run).toMatchObject({
      status: "failed",
      feedsRequestedCount: 2,
      feedsSkippedCount: 2,
      feedsSucceededCount: 0,
      feedsFailedCount: 2,
    });
    expect(result.report).toMatchObject({ status: "failed", selectedFeedCount: 2, skippedFeedCount: 2 });
    expect(sorted(result.report.feeds.map((feedReport) => `${feedReport.feedId}:${feedReport.status}`))).toEqual(
      sorted([
        `${feeds.dueFeedId}:failed`,
        `${feeds.creatorTwoFeedId}:failed`,
        `${feeds.notDueFeedId}:skipped`,
        `${feeds.noCadenceFeedId}:skipped`,
      ]),
    );
  });

  test("force refresh paces every selected feed with random human-scale waits", async () => {
    await seedFeeds(testDatabase.db);
    const waitedMilliseconds: number[] = [];
    const registry = createSourceAdapterRegistry([createRefreshAdapter({ failingFeedExternalIds: [] })]);

    const result = await refreshAll(refreshDependencies(registry, async (milliseconds) => {
      waitedMilliseconds.push(milliseconds);
    }), { force: true });

    expect(result.selectedFeeds).toHaveLength(4);
    expect(result.feedResults).toHaveLength(4);
    expect(result.run).toMatchObject({ force: true, feedsRequestedCount: 4, feedsSucceededCount: 4, feedsSkippedCount: 0 });
    expect(waitedMilliseconds).toEqual([1_000, 1_000, 1_000]);
  });

  test("refresh skips the wait when the last two completed feeds used different providers", async () => {
    await seedInterleavedProviderFeeds(testDatabase.db);
    const waitedMilliseconds: number[] = [];
    const registry = createSourceAdapterRegistry([
      createRefreshAdapter({ sourceType: "youtube", failingFeedExternalIds: [] }),
      createRefreshAdapter({ sourceType: "odysee", failingFeedExternalIds: [] }),
    ]);

    const result = await refreshAll(refreshDependencies(registry, async (milliseconds) => {
      waitedMilliseconds.push(milliseconds);
    }), { force: true });

    expect(result.selectedFeeds.map((feed) => feed.sourceType)).toEqual(["youtube", "odysee", "youtube"]);
    expect(waitedMilliseconds).toEqual([1_000]);
  });

  test("provider refusals defer subsequent feed queries for that provider", async () => {
    await seedFeeds(testDatabase.db);
    const fetchedExternalIds: string[] = [];
    const registry = createSourceAdapterRegistry([
      createRefreshAdapter({
        failingFeedExternalIds: ["due-feed"],
        failureHttpStatus: 429,
        fetchedExternalIds,
      }),
    ]);

    const result = await refreshAll(refreshDependencies(registry), { force: true });

    expect(fetchedExternalIds).toEqual(["due-feed"]);
    expect(result.run).toMatchObject({ status: "failed", feedsRequestedCount: 4, feedsSkippedCount: 3, feedsSucceededCount: 0, feedsFailedCount: 1 });
    expect(result.feedResults).toHaveLength(1);
    expect(result.skippedFeeds).toHaveLength(3);
    expect(result.skippedFeeds.every((skippedFeed) => skippedFeed.reason === "provider-paused")).toBe(true);
    expect(result.report.feeds.find((feedReport) => feedReport.feedId === result.feedResults[0]?.feedId)).toMatchObject({
      status: "failed",
      error: { code: "provider-refresh-paused" },
    });
    expect(result.report.feeds.filter((feedReport) => feedReport.skipReason === "provider-paused")).toHaveLength(3);
  });

  test("start refresh creates a running run before background processing completes", async () => {
    await seedFeeds(testDatabase.db);
    const registry = createSourceAdapterRegistry([createRefreshAdapter({ failingFeedExternalIds: [] })]);

    const started = await startRefreshAll(refreshDependencies(registry), { force: true });

    expect(started.run).toMatchObject({ status: "running", force: true, feedsRequestedCount: 4, feedsSucceededCount: 0 });
    expect(started.feedResults).toHaveLength(0);
    expect(await listRefreshFeedResultsForRun(testDatabase.db, { refreshRunId: started.run.id, limit: 10 })).toHaveLength(0);

    const completed = await started.process();

    expect(completed.run).toMatchObject({ status: "succeeded", feedsRequestedCount: 4, feedsSucceededCount: 4 });
    expect(completed.feedResults).toHaveLength(4);
  });

  test("resume refresh skips feeds that already have recorded results", async () => {
    await seedFeeds(testDatabase.db);
    const registry = createSourceAdapterRegistry([createRefreshAdapter({ failingFeedExternalIds: [] })]);
    const started = await startRefreshAll(refreshDependencies(registry), { force: true });
    const alreadyCompletedFeed = started.selectedFeeds[0];
    if (alreadyCompletedFeed === undefined) {
      throw new Error("Expected seeded refresh to select feeds.");
    }
    await recordRefreshFeedResult(testDatabase.db, {
      refreshRunId: started.run.id,
      feedId: alreadyCompletedFeed.id,
      status: "succeeded",
      itemsDiscoveredCount: 1,
      itemsCreatedCount: 1,
      startedAt: fixedNow(),
      completedAt: fixedNow(),
    });

    const completed = await resumeRefreshRun(refreshDependencies(registry), started.run);

    expect(completed.run).toMatchObject({ status: "succeeded", feedsRequestedCount: 4, feedsSucceededCount: 4 });
    expect(completed.feedResults).toHaveLength(4);
  });

  test("resume normal refresh reports feeds completed before crash after cadence metadata changes", async () => {
    const feeds = await seedFeeds(testDatabase.db);
    const registry = createSourceAdapterRegistry([createRefreshAdapter({ failingFeedExternalIds: [] })]);
    const started = await startRefreshAll(refreshDependencies(registry), { force: false });
    await recordRefreshFeedResult(testDatabase.db, {
      refreshRunId: started.run.id,
      feedId: feeds.dueFeedId,
      status: "succeeded",
      itemsDiscoveredCount: 1,
      itemsCreatedCount: 1,
      startedAt: fixedNow(),
      completedAt: fixedNow(),
    });
    await setNextRefreshAfter(testDatabase.db, feeds.dueFeedId, new Date("2026-05-16T13:00:00.000Z"));

    const completed = await resumeRefreshRun(refreshDependencies(registry), started.run);

    expect(completed.run).toMatchObject({ status: "succeeded", feedsRequestedCount: 2, feedsSkippedCount: 2, feedsSucceededCount: 2 });
    expect(completed.feedResults).toHaveLength(2);
    expect(completed.report.feeds.find((feedReport) => feedReport.feedId === feeds.dueFeedId)).toMatchObject({
      status: "succeeded",
    });
    expect(completed.report.feeds.filter((feedReport) => feedReport.feedId === feeds.dueFeedId)).toHaveLength(1);
    expect(sorted(completed.skippedFeeds.map((skippedFeed) => skippedFeed.feed.id))).toEqual(sorted([feeds.notDueFeedId, feeds.noCadenceFeedId]));
  });

  test("catastrophic refresh failure includes deferred feeds in skipped counts and report", async () => {
    const feeds = await seedFeeds(testDatabase.db);
    let waitCount = 0;
    const registry = createSourceAdapterRegistry([
      createRefreshAdapter({
        failingFeedExternalIds: ["due-feed"],
        failureHttpStatus: 429,
      }),
    ]);

    const result = await refreshAll(refreshDependencies(registry, async () => {
      waitCount += 1;
      if (waitCount === 2) {
        throw new Error("Fixture wait failed after provider pause.");
      }
    }), { force: true });

    expect(result.run).toMatchObject({ status: "failed", feedsRequestedCount: 4, feedsSkippedCount: 1, feedsSucceededCount: 0, feedsFailedCount: 2 });
    expect(result.skippedFeeds).toHaveLength(1);
    expect(result.skippedFeeds[0]).toMatchObject({ reason: "provider-paused" });
    expect(result.report).toMatchObject({ skippedFeedCount: 1 });
    expect(result.report.feeds.find((feedReport) => feedReport.feedId === feeds.notDueFeedId)).toMatchObject({
      status: "skipped",
      skipReason: "provider-paused",
    });
  });

  test("resume catastrophic refresh failure reports partial when a recovered run has existing successes", async () => {
    const feeds = await seedFeeds(testDatabase.db);
    const registry = createSourceAdapterRegistry([
      createRefreshAdapter({
        failingFeedExternalIds: ["not-due-feed"],
        failureHttpStatus: 429,
      }),
    ]);
    const started = await startRefreshAll(refreshDependencies(registry), { force: true });
    await recordRefreshFeedResult(testDatabase.db, {
      refreshRunId: started.run.id,
      feedId: feeds.dueFeedId,
      status: "succeeded",
      itemsDiscoveredCount: 1,
      itemsCreatedCount: 1,
      startedAt: fixedNow(),
      completedAt: fixedNow(),
    });

    const completed = await resumeRefreshRun(refreshDependencies(registry, async () => {
      throw new Error("Fixture wait failed after recovered failure.");
    }), started.run);

    expect(completed.run).toMatchObject({ status: "partial", feedsSucceededCount: 1, feedsFailedCount: 2 });
    expect(completed.run.feedsSucceededCount).toBeGreaterThan(0);
  });

  test("reaching a terminal state prunes only refresh feed results older than the retention window", async () => {
    const feeds = await seedFeeds(testDatabase.db);
    const registry = createSourceAdapterRegistry([createRefreshAdapter({ failingFeedExternalIds: [] })]);
    // 30-day window from the fixed clock (2026-05-16T12:00): the 2026-04-01
    // attempt is over-age, the 2026-04-20 one stays.
    const overAgeResultId = await seedRefreshFeedResultAt(testDatabase.db, {
      feedId: feeds.dueFeedId,
      status: "failed",
      startedAt: new Date("2026-04-01T00:00:00.000Z"),
    });
    const recentResultId = await seedRefreshFeedResultAt(testDatabase.db, {
      feedId: feeds.dueFeedId,
      status: "succeeded",
      startedAt: new Date("2026-04-20T00:00:00.000Z"),
    });

    const result = await refreshAll(refreshDependencies(registry), { force: false });

    expect(result.run.status).toBe("succeeded");
    expect(await findRefreshFeedResultById(overAgeResultId)).toBeUndefined();
    expect(await findRefreshFeedResultById(recentResultId)).toMatchObject({ feedId: feeds.dueFeedId });
    // The completed run's own results were recorded after the prune cutoff.
    expect(await listRefreshFeedResultsForRun(testDatabase.db, { refreshRunId: result.run.id, limit: 10 })).toHaveLength(2);
  });

  test("startRefreshAll's background processing path prunes aged results too", async () => {
    const feeds = await seedFeeds(testDatabase.db);
    const registry = createSourceAdapterRegistry([createRefreshAdapter({ failingFeedExternalIds: [] })]);
    const overAgeResultId = await seedRefreshFeedResultAt(testDatabase.db, {
      feedId: feeds.creatorTwoFeedId,
      status: "failed",
      startedAt: new Date("2026-03-15T00:00:00.000Z"),
    });

    const started = await startRefreshAll(refreshDependencies(registry), { force: true });
    const completed = await started.process();

    expect(completed.run.status).toBe("succeeded");
    expect(await findRefreshFeedResultById(overAgeResultId)).toBeUndefined();
    expect(completed.feedResults).toHaveLength(4);
  });

  test("a failing retention prune is logged and does not fail the run report", async () => {
    const feeds = await seedFeeds(testDatabase.db);
    const registry = createSourceAdapterRegistry([createRefreshAdapter({ failingFeedExternalIds: [] })]);
    const overAgeResultId = await seedRefreshFeedResultAt(testDatabase.db, {
      feedId: feeds.dueFeedId,
      status: "failed",
      startedAt: new Date("2026-04-01T00:00:00.000Z"),
    });
    const consoleErrors: unknown[][] = [];
    const originalConsoleError = console.error;
    console.error = (...args: unknown[]) => {
      consoleErrors.push(args);
    };

    let result;
    try {
      result = await refreshAll(
        { ...refreshDependencies(registry), db: dbWithFailingDelete(testDatabase.db) },
        { force: true },
      );
    } finally {
      console.error = originalConsoleError;
    }

    // The run completes normally despite the broken prune DELETE.
    expect(result.run.status).toBe("succeeded");
    expect(result.feedResults).toHaveLength(4);
    expect(consoleErrors).toHaveLength(1);
    expect(String(consoleErrors[0]?.[0])).toContain("retention prune failed");
    // Handled degradation, not a silent swallow: the over-age row is retained
    // for the next terminal run to prune.
    expect(await findRefreshFeedResultById(overAgeResultId)).toMatchObject({ feedId: feeds.dueFeedId });
  });
});

function fixedNow(): Date {
  return new Date("2026-05-16T12:00:00.000Z");
}

/**
 * Seed one historical feed result through the real repository writes, wrapped
 * in its own refresh run (refresh_feed_result is unique per (run, feed)).
 */
async function seedRefreshFeedResultAt(
  db: RepositoryDb,
  input: { readonly feedId: string; readonly status: "succeeded" | "failed"; readonly startedAt: Date },
): Promise<string> {
  const run = await createRefreshRun(db, { scope: "all", status: "succeeded", startedAt: input.startedAt });
  const result = await recordRefreshFeedResult(db, {
    refreshRunId: run.id,
    feedId: input.feedId,
    status: input.status,
    startedAt: input.startedAt,
    completedAt: input.startedAt,
  });
  return result.id;
}

async function findRefreshFeedResultById(id: string) {
  return testDatabase.db.query.refreshFeedResult.findFirst({
    where: eq(schema.refreshFeedResult.id, id),
  });
}

/**
 * Repository double whose DELETE statements fail, simulating a broken
 * retention prune. Everything else forwards to the real database, so the run
 * itself proceeds normally up to the terminal-state prune.
 */
function dbWithFailingDelete(db: RepositoryDb): RepositoryDb {
  return new Proxy(db, {
    get(target, property) {
      if (property === "delete") {
        return () => {
          throw new Error("Fixture retention prune delete failed.");
        };
      }
      return Reflect.get(target, property, target);
    },
  });
}

function sorted(values: readonly string[]): readonly string[] {
  return [...values].sort();
}

function refreshDependencies(
  registry: ReturnType<typeof createSourceAdapterRegistry>,
  wait: (milliseconds: number) => Promise<void> = async () => {},
) {
  return { db: testDatabase.db, sourceRegistry: registry, now: fixedNow, wait, random: () => 0 };
}

async function seedFeeds(db: RepositoryDb): Promise<TestFeedSet> {
  const creatorOne = await findOrCreateCreator(db, {
    displayName: "Creator One",
  });
  const creatorTwo = await findOrCreateCreator(db, {
    displayName: "Creator Two",
  });

  const dueFeed = await findOrCreateFeed(db, {
    creatorId: creatorOne.id,
    sourceType: "youtube",
    sourceExternalId: "due-feed",
    url: "https://refresh.example.test/due-feed",
    title: "Due Feed",
    refreshCadenceSeconds: 900,
  });
  const notDueFeed = await findOrCreateFeed(db, {
    creatorId: creatorOne.id,
    sourceType: "youtube",
    sourceExternalId: "not-due-feed",
    url: "https://refresh.example.test/not-due-feed",
    title: "Not Due Feed",
    refreshCadenceSeconds: 900,
  });
  const noCadenceFeed = await findOrCreateFeed(db, {
    creatorId: creatorOne.id,
    sourceType: "youtube",
    sourceExternalId: "no-cadence-feed",
    url: "https://refresh.example.test/no-cadence-feed",
  });
  const creatorTwoFeed = await findOrCreateFeed(db, {
    creatorId: creatorTwo.id,
    sourceType: "youtube",
    sourceExternalId: "creator-two-feed",
    url: "https://refresh.example.test/creator-two-feed",
    refreshCadenceSeconds: 900,
  });

  await setNextRefreshAfter(db, dueFeed.id, new Date("2026-05-16T11:00:00.000Z"));
  await setNextRefreshAfter(db, notDueFeed.id, new Date("2026-05-16T13:00:00.000Z"));

  return {
    creatorOneId: creatorOne.id,
    creatorTwoId: creatorTwo.id,
    dueFeedId: dueFeed.id,
    notDueFeedId: notDueFeed.id,
    noCadenceFeedId: noCadenceFeed.id,
    creatorTwoFeedId: creatorTwoFeed.id,
  };
}

async function setNextRefreshAfter(db: RepositoryDb, feedId: string, nextRefreshAfter: Date): Promise<void> {
  await db.update(schema.feed).set({ nextRefreshAfter }).where(eq(schema.feed.id, feedId));
}

async function seedInterleavedProviderFeeds(db: RepositoryDb): Promise<void> {
  const youtubeCreator = await findOrCreateCreator(db, {
    displayName: "Interleaved YouTube",
  });
  const odyseeCreator = await findOrCreateCreator(db, {
    displayName: "Interleaved Odysee",
  });
  await findOrCreateFeed(db, {
    creatorId: youtubeCreator.id,
    sourceType: "youtube",
    sourceExternalId: "interleaved-youtube-one",
    url: "https://refresh.example.test/interleaved-youtube-one",
    refreshCadenceSeconds: 900,
  });
  await findOrCreateFeed(db, {
    creatorId: odyseeCreator.id,
    sourceType: "odysee",
    sourceExternalId: "interleaved-odysee-one",
    url: "https://refresh.example.test/interleaved-odysee-one",
    refreshCadenceSeconds: 900,
  });
  await findOrCreateFeed(db, {
    creatorId: youtubeCreator.id,
    sourceType: "youtube",
    sourceExternalId: "interleaved-youtube-two",
    url: "https://refresh.example.test/interleaved-youtube-two",
    refreshCadenceSeconds: 900,
  });
}

async function requireFeed(db: RepositoryDb, sourceExternalId: string) {
  const feed = await findFeedBySourceIdentity(db, { sourceType: "youtube", sourceExternalId });
  if (feed === null) {
    throw new Error(`Expected feed ${sourceExternalId} to exist.`);
  }
  return feed;
}

interface RefreshAdapterConfig {
  readonly sourceType?: SourceType;
  readonly failingFeedExternalIds: readonly string[];
  readonly failureHttpStatus?: number;
  readonly fetchedExternalIds?: string[];
}

function createRefreshAdapter(config: RefreshAdapterConfig): SourceAdapter {
  const sourceType = config.sourceType ?? "youtube";
  return {
    sourceType,
    detect(input) {
      const urlResult = parseHttpUrl(input);
      if (!urlResult.ok || urlResult.value.hostname !== "refresh.example.test") {
        return unsupported(input);
      }
      return detected({
        sourceType,
        inputKind: "feed-url",
        originalInput: input,
        canonicalInput: urlResult.value.toString(),
      });
    },
    async resolveInput(input) {
      return {
        ok: true,
        value: {
          sourceType: input.sourceType,
          sourceExternalId: new URL(input.canonicalInput).pathname.slice(1),
          canonicalUrl: input.canonicalInput,
        },
      };
    },
    normalizeCatalogPayload(input) {
      return { ok: true, value: payloadForFeed(input.sourceType, input.sourceExternalId, input.canonicalUrl) };
    },
    async fetchCatalog(input) {
      config.fetchedExternalIds?.push(input.sourceExternalId);
      if (config.failingFeedExternalIds.includes(input.sourceExternalId)) {
        return {
          ok: false,
          error: {
            code: "remote-fetch-failed",
            message: "Fixture feed refresh failed.",
            sourceType: input.sourceType,
            httpStatus: config.failureHttpStatus,
          },
        };
      }
      return { ok: true, value: payloadForFeed(input.sourceType, input.sourceExternalId, input.canonicalUrl) };
    },
  };
}

function payloadForFeed(sourceType: SourceType, feedExternalId: string, feedUrl: string): NormalizedCatalogPayload {
  const creatorExternalId = feedExternalId === "creator-two-feed" ? "creator-two" : "creator-one";
  const itemExternalId = `${feedExternalId}-video`;
  return {
    creator: {
      displayName: creatorExternalId,
      canonicalUrl: `https://refresh.example.test/${creatorExternalId}`,
    },
    feeds: [
      {
        sourceType,
        sourceExternalId: feedExternalId,
        url: feedUrl,
        refreshCadenceSeconds: 900,
      },
    ],
    items: [
      {
        contentItem: {
          sourceType,
          sourceExternalId: itemExternalId,
          title: `${feedExternalId} video`,
          publishedAt: new Date("2026-05-16T10:00:00.000Z"),
          canonicalUrl: `https://refresh.example.test/watch/${itemExternalId}`,
        },
        feedContent: { sourceExternalId: itemExternalId },
        sources: [
          {
            sourceType,
            sourceExternalId: itemExternalId,
            canonicalUrl: `https://refresh.example.test/watch/${itemExternalId}`,
            embedUrl: `https://refresh.example.test/embed/${itemExternalId}`,
            priority: 0,
          },
        ],
      },
    ],
  };
}

function detected(value: DetectedSourceInput): SourceDetectionSuccess {
  return { ok: true, value };
}

function unsupported(input: string): SourceDetectionFailure {
  return {
    ok: false,
    error: {
      code: "unsupported-source-input",
      message: "Fixture adapter does not support this input.",
      input,
    },
  };
}

async function createTestDatabase(): Promise<TestDatabase> {
  const client = createClient({ url: ":memory:" });
  const db = drizzle({ client, schema });

  await client.execute("PRAGMA foreign_keys = ON");
  for (const statement of schemaStatements) {
    await client.execute(statement);
  }

  return { client, db };
}

const schemaStatements = [
  `CREATE TABLE creator (
    id TEXT PRIMARY KEY NOT NULL,
    name_key TEXT NOT NULL,
    display_name TEXT NOT NULL,
    description TEXT,
    image_url TEXT,
    canonical_url TEXT,
    metadata_json TEXT,
    last_content_published_at INTEGER,
    created_at INTEGER NOT NULL DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)),
    updated_at INTEGER NOT NULL DEFAULT (cast(unixepoch('subsecond') * 1000 as integer))
  )`,
  "CREATE UNIQUE INDEX creator_name_key_uidx ON creator (name_key)",
  `CREATE TABLE feed (
    id TEXT PRIMARY KEY NOT NULL,
    creator_id TEXT NOT NULL REFERENCES creator(id) ON DELETE CASCADE,
    source_type TEXT NOT NULL,
    source_external_id TEXT NOT NULL,
    url TEXT NOT NULL,
    title TEXT,
    description TEXT,
    refresh_cadence_seconds INTEGER,
    last_normal_refresh_at INTEGER,
    next_refresh_after INTEGER,
    adapter_metadata_json TEXT,
    created_at INTEGER NOT NULL DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)),
    updated_at INTEGER NOT NULL DEFAULT (cast(unixepoch('subsecond') * 1000 as integer))
  )`,
  "CREATE UNIQUE INDEX feed_source_identity_uidx ON feed (source_type, source_external_id)",
  `CREATE TABLE content_item (
    id TEXT PRIMARY KEY NOT NULL,
    creator_id TEXT NOT NULL REFERENCES creator(id) ON DELETE CASCADE,
    source_type TEXT NOT NULL,
    source_external_id TEXT NOT NULL,
    title TEXT NOT NULL,
    description TEXT,
    published_at INTEGER,
    content_type TEXT NOT NULL DEFAULT 'video',
    duration_seconds INTEGER,
    thumbnail_url TEXT,
    canonical_url TEXT,
    cross_source_key TEXT,
    metadata_json TEXT,
    created_at INTEGER NOT NULL DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)),
    updated_at INTEGER NOT NULL DEFAULT (cast(unixepoch('subsecond') * 1000 as integer))
  )`,
  "CREATE UNIQUE INDEX content_item_source_identity_uidx ON content_item (source_type, source_external_id)",
  `CREATE TABLE content_source (
    id TEXT PRIMARY KEY NOT NULL,
    content_item_id TEXT NOT NULL REFERENCES content_item(id) ON DELETE CASCADE,
    source_type TEXT NOT NULL,
    source_external_id TEXT,
    embed_url TEXT,
    native_media_url TEXT,
    canonical_url TEXT NOT NULL,
    priority INTEGER NOT NULL DEFAULT 0,
    metadata_json TEXT,
    created_at INTEGER NOT NULL DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)),
    updated_at INTEGER NOT NULL DEFAULT (cast(unixepoch('subsecond') * 1000 as integer))
  )`,
  "CREATE UNIQUE INDEX content_source_canonical_uidx ON content_source (source_type, canonical_url)",
  "CREATE UNIQUE INDEX content_source_item_priority_uidx ON content_source (content_item_id, priority)",
  `CREATE TABLE feed_content (
    feed_id TEXT NOT NULL REFERENCES feed(id) ON DELETE CASCADE,
    content_item_id TEXT NOT NULL REFERENCES content_item(id) ON DELETE CASCADE,
    source_external_id TEXT NOT NULL,
    raw_import_ref TEXT,
    discovered_at INTEGER NOT NULL DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)),
    CONSTRAINT feed_content_pk PRIMARY KEY (feed_id, content_item_id)
  )`,
  "CREATE UNIQUE INDEX feed_content_source_identity_uidx ON feed_content (feed_id, source_external_id)",
  `CREATE TABLE refresh_run (
    id TEXT PRIMARY KEY NOT NULL,
    scope TEXT NOT NULL,
    force INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL,
    requested_creator_id TEXT REFERENCES creator(id) ON DELETE SET NULL,
    requested_feed_id TEXT REFERENCES feed(id) ON DELETE SET NULL,
    feeds_requested_count INTEGER NOT NULL DEFAULT 0,
    feeds_skipped_count INTEGER NOT NULL DEFAULT 0,
    feeds_succeeded_count INTEGER NOT NULL DEFAULT 0,
    feeds_failed_count INTEGER NOT NULL DEFAULT 0,
    items_discovered_count INTEGER NOT NULL DEFAULT 0,
    items_created_count INTEGER NOT NULL DEFAULT 0,
    items_updated_count INTEGER NOT NULL DEFAULT 0,
    started_at INTEGER NOT NULL DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)),
    completed_at INTEGER,
    error_summary_json TEXT
  )`,
  `CREATE TABLE refresh_feed_result (
    id TEXT PRIMARY KEY NOT NULL,
    refresh_run_id TEXT NOT NULL REFERENCES refresh_run(id) ON DELETE CASCADE,
    feed_id TEXT NOT NULL REFERENCES feed(id) ON DELETE CASCADE,
    status TEXT NOT NULL,
    items_discovered_count INTEGER NOT NULL DEFAULT 0,
    items_created_count INTEGER NOT NULL DEFAULT 0,
    items_updated_count INTEGER NOT NULL DEFAULT 0,
    started_at INTEGER NOT NULL DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)),
    completed_at INTEGER,
    error_summary_json TEXT
  )`,
  "CREATE UNIQUE INDEX refresh_feed_result_run_feed_uidx ON refresh_feed_result (refresh_run_id, feed_id)",
];
