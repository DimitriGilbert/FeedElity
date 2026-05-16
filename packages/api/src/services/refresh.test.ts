import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { createClient } from "@libsql/client";
import type { Client } from "@libsql/client";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/libsql";

import * as schema from "@FeedElity/db/schema";

import type { SourceType } from "../domain/catalog";
import {
  findFeedBySourceIdentity,
  findOrCreateCreator,
  findOrCreateFeed,
  listRefreshFeedResultsForRun,
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
import { refreshAll, refreshCreator } from "./refresh";

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

    const result = await refreshAll({ db: testDatabase.db, sourceRegistry: registry, now: fixedNow }, { force: false });

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
    expect(result.feedResults).toHaveLength(2);
    expect(await listRefreshFeedResultsForRun(testDatabase.db, result.run.id)).toHaveLength(2);
  });

  test("normal refresh updates cadence metadata after successful feed refresh", async () => {
    await seedFeeds(testDatabase.db);
    const registry = createSourceAdapterRegistry([createRefreshAdapter({ failingFeedExternalIds: [] })]);

    await refreshAll({ db: testDatabase.db, sourceRegistry: registry, now: fixedNow }, { force: false });

    const refreshedFeed = await requireFeed(testDatabase.db, "due-feed");
    const skippedFeed = await requireFeed(testDatabase.db, "not-due-feed");
    expect(refreshedFeed.lastNormalRefreshAt?.toISOString()).toBe("2026-05-16T12:00:00.000Z");
    expect(refreshedFeed.nextRefreshAfter?.toISOString()).toBe("2026-05-16T12:15:00.000Z");
    expect(skippedFeed.lastNormalRefreshAt).toBeNull();
    expect(skippedFeed.nextRefreshAfter?.toISOString()).toBe("2026-05-16T13:00:00.000Z");
  });

  test("force refresh selects all feeds regardless of cadence metadata", async () => {
    await seedFeeds(testDatabase.db);
    const registry = createSourceAdapterRegistry([createRefreshAdapter({ failingFeedExternalIds: [] })]);

    const result = await refreshAll({ db: testDatabase.db, sourceRegistry: registry, now: fixedNow }, { force: true });

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

    await refreshAll({ db: testDatabase.db, sourceRegistry: registry, now: fixedNow }, { force: true });

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
      { db: testDatabase.db, sourceRegistry: registry, now: fixedNow },
      { creatorId: feeds.creatorOneId, force: true },
    );

    expect(result.run).toMatchObject({ scope: "creator", requestedCreatorId: feeds.creatorOneId });
    expect(sorted(result.selectedFeeds.map((feed) => feed.id))).toEqual(sorted([
      feeds.dueFeedId,
      feeds.notDueFeedId,
      feeds.noCadenceFeedId,
    ]));
  });

  test("per-feed failures are persisted without hiding successes", async () => {
    const feeds = await seedFeeds(testDatabase.db);
    const registry = createSourceAdapterRegistry([createRefreshAdapter({ failingFeedExternalIds: ["not-due-feed"] })]);

    const result = await refreshAll({ db: testDatabase.db, sourceRegistry: registry, now: fixedNow }, { force: true });

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

    const result = await refreshAll({ db: testDatabase.db, sourceRegistry: registry, now: fixedNow }, { force: false });

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
});

function fixedNow(): Date {
  return new Date("2026-05-16T12:00:00.000Z");
}

function sorted(values: readonly string[]): readonly string[] {
  return [...values].sort();
}

async function seedFeeds(db: RepositoryDb): Promise<TestFeedSet> {
  const creatorOne = await findOrCreateCreator(db, {
    sourceType: "youtube",
    sourceExternalId: "creator-one",
    displayName: "Creator One",
  });
  const creatorTwo = await findOrCreateCreator(db, {
    sourceType: "youtube",
    sourceExternalId: "creator-two",
    displayName: "Creator Two",
  });

  const dueFeed = await findOrCreateFeed(db, {
    creatorId: creatorOne.id,
    sourceType: "youtube",
    sourceExternalId: "due-feed",
    url: "https://refresh.example.test/due-feed",
    refreshCadenceSeconds: 900,
  });
  const notDueFeed = await findOrCreateFeed(db, {
    creatorId: creatorOne.id,
    sourceType: "youtube",
    sourceExternalId: "not-due-feed",
    url: "https://refresh.example.test/not-due-feed",
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

async function requireFeed(db: RepositoryDb, sourceExternalId: string) {
  const feed = await findFeedBySourceIdentity(db, { sourceType: "youtube", sourceExternalId });
  if (feed === null) {
    throw new Error(`Expected feed ${sourceExternalId} to exist.`);
  }
  return feed;
}

interface RefreshAdapterConfig {
  readonly failingFeedExternalIds: readonly string[];
}

function createRefreshAdapter(config: RefreshAdapterConfig): SourceAdapter {
  return {
    sourceType: "youtube",
    detect(input) {
      const urlResult = parseHttpUrl(input);
      if (!urlResult.ok || urlResult.value.hostname !== "refresh.example.test") {
        return unsupported(input);
      }
      return detected({
        sourceType: "youtube",
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
      if (config.failingFeedExternalIds.includes(input.sourceExternalId)) {
        return {
          ok: false,
          error: {
            code: "remote-fetch-failed",
            message: "Fixture feed refresh failed.",
            sourceType: input.sourceType,
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
      sourceType,
      sourceExternalId: creatorExternalId,
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
    source_type TEXT NOT NULL,
    source_external_id TEXT NOT NULL,
    display_name TEXT NOT NULL,
    description TEXT,
    image_url TEXT,
    canonical_url TEXT,
    metadata_json TEXT,
    created_at INTEGER NOT NULL DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)),
    updated_at INTEGER NOT NULL DEFAULT (cast(unixepoch('subsecond') * 1000 as integer))
  )`,
  "CREATE UNIQUE INDEX creator_source_identity_uidx ON creator (source_type, source_external_id)",
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
