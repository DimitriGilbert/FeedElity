import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { createClient } from "@libsql/client";
import type { Client } from "@libsql/client";
import { call } from "@orpc/server";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/libsql";

import * as schema from "@FeedElity/db/schema";

import type { Context } from "../context";
import type { RepositoryDb } from "../repositories/catalog";
import {
  findOrCreateContentItem,
  findOrCreateContentSource,
  findOrCreateCreator,
  findOrCreateFeed,
  createRefreshRun,
  linkFeedContent,
  recordRefreshFeedResult,
} from "../repositories/catalog";
import { findOrCreateContentStatus, findOrCreateSubscription } from "../repositories/overlays";
import { createSourceAdapterRegistry } from "../sources";
import { appRouter } from "./index";

interface TestDatabase {
  readonly client: Client;
  readonly db: RepositoryDb;
}

let testDatabase: TestDatabase;

beforeEach(async () => {
  testDatabase = await createTestDatabase();
});

afterEach(() => {
  testDatabase.client.close();
});

describe("catalog browsing router", () => {
  test("anonymous callers can list creators and bounded content items with filters", async () => {
    const firstCreator = await findOrCreateCreator(testDatabase.db, {
      displayName: "Alpha Creator",
    });
    const secondCreator = await findOrCreateCreator(testDatabase.db, {
      displayName: "Beta Creator",
    });
    await findOrCreateContentItem(testDatabase.db, {
      creatorId: firstCreator.id,
      sourceType: "youtube",
      sourceExternalId: "alpha-video-older",
      title: "Alpha older update",
      publishedAt: new Date("2026-01-01T00:00:00.000Z"),
    });
    const newerItem = await findOrCreateContentItem(testDatabase.db, {
      creatorId: firstCreator.id,
      sourceType: "youtube",
      sourceExternalId: "alpha-video-newer",
      title: "Alpha Newer Update",
      publishedAt: new Date("2026-01-03T00:00:00.000Z"),
    });
    await findOrCreateContentItem(testDatabase.db, {
      creatorId: secondCreator.id,
      sourceType: "odysee",
      sourceExternalId: "beta-video",
      title: "Beta update",
      publishedAt: new Date("2026-01-04T00:00:00.000Z"),
    });

    const creators = await call(appRouter.catalog.creators, { search: "alpha", limit: 10 }, {
      context: anonymousContext(testDatabase.db),
    });
    const contentItems = await call(
      appRouter.catalog.contentItems,
      { search: "update", creatorId: firstCreator.id, sourceType: "youtube", limit: 1 },
      { context: anonymousContext(testDatabase.db) },
    );

    expect(creators).toHaveLength(1);
    expect(creators[0]).toMatchObject({ id: firstCreator.id, displayName: "Alpha Creator" });
    expect(contentItems).toHaveLength(1);
    expect(contentItems[0]).toMatchObject({ id: newerItem.id, title: "Alpha Newer Update" });
    expect(contentItems[0]?.creator).toMatchObject({ id: firstCreator.id, displayName: "Alpha Creator" });
  });

  test("anonymous callers can filter catalog content by selected feed", async () => {
    const creator = await findOrCreateCreator(testDatabase.db, {
      displayName: "Feed Filter Creator",
    });
    const selectedFeed = await findOrCreateFeed(testDatabase.db, {
      creatorId: creator.id,
      sourceType: "youtube",
      sourceExternalId: "feed-filter-selected",
      url: "https://youtube.example.test/selected.xml",
    });
    const otherFeed = await findOrCreateFeed(testDatabase.db, {
      creatorId: creator.id,
      sourceType: "youtube",
      sourceExternalId: "feed-filter-other",
      url: "https://youtube.example.test/other.xml",
    });
    const selectedFeedItem = await findOrCreateContentItem(testDatabase.db, {
      creatorId: creator.id,
      sourceType: "youtube",
      sourceExternalId: "feed-filter-selected-video",
      title: "Selected feed video",
      publishedAt: new Date("2026-02-02T00:00:00.000Z"),
    });
    const otherFeedItem = await findOrCreateContentItem(testDatabase.db, {
      creatorId: creator.id,
      sourceType: "youtube",
      sourceExternalId: "feed-filter-other-video",
      title: "Other feed video",
      publishedAt: new Date("2026-02-03T00:00:00.000Z"),
    });
    await linkFeedContent(testDatabase.db, {
      feedId: selectedFeed.id,
      contentItemId: selectedFeedItem.id,
      sourceExternalId: "feed-filter-selected-video",
    });
    await linkFeedContent(testDatabase.db, {
      feedId: otherFeed.id,
      contentItemId: otherFeedItem.id,
      sourceExternalId: "feed-filter-other-video",
    });

    const contentItems = await call(
      appRouter.catalog.contentItems,
      { creatorId: creator.id, feedId: selectedFeed.id, limit: 10 },
      { context: anonymousContext(testDatabase.db) },
    );

    expect(contentItems.map((contentItem) => contentItem.id)).toEqual([selectedFeedItem.id]);
  });

  test("anonymous catalog browsing supports bounded offset pagination with stable ordering", async () => {
    const betaCreator = await findOrCreateCreator(testDatabase.db, {
      displayName: "Beta Pagination",
    });
    const alphaCreator = await findOrCreateCreator(testDatabase.db, {
      displayName: "Alpha Pagination",
    });
    const alphaFirstFeed = await findOrCreateFeed(testDatabase.db, {
      creatorId: alphaCreator.id,
      sourceType: "youtube",
      sourceExternalId: "pagination-alpha-feed-1",
      url: "https://youtube.example.test/alpha/1.xml",
    });
    const alphaSecondFeed = await findOrCreateFeed(testDatabase.db, {
      creatorId: alphaCreator.id,
      sourceType: "youtube",
      sourceExternalId: "pagination-alpha-feed-2",
      url: "https://youtube.example.test/alpha/2.xml",
    });
    await testDatabase.db
      .update(schema.feed)
      .set({ createdAt: new Date("2026-03-01T00:00:00.000Z") })
      .where(eq(schema.feed.id, alphaFirstFeed.id));
    await testDatabase.db
      .update(schema.feed)
      .set({ createdAt: new Date("2026-03-02T00:00:00.000Z") })
      .where(eq(schema.feed.id, alphaSecondFeed.id));
    const newestItem = await findOrCreateContentItem(testDatabase.db, {
      creatorId: alphaCreator.id,
      sourceType: "youtube",
      sourceExternalId: "pagination-video-newest",
      title: "Newest pagination video",
      publishedAt: new Date("2026-03-03T00:00:00.000Z"),
    });
    const middleItem = await findOrCreateContentItem(testDatabase.db, {
      creatorId: alphaCreator.id,
      sourceType: "youtube",
      sourceExternalId: "pagination-video-middle",
      title: "Middle pagination video",
      publishedAt: new Date("2026-03-02T00:00:00.000Z"),
    });
    const oldestItem = await findOrCreateContentItem(testDatabase.db, {
      creatorId: betaCreator.id,
      sourceType: "youtube",
      sourceExternalId: "pagination-video-oldest",
      title: "Oldest pagination video",
      publishedAt: new Date("2026-03-01T00:00:00.000Z"),
    });

    const secondCreatorPage = await call(
      appRouter.catalog.creators,
      { limit: 1, offset: 1 },
      { context: anonymousContext(testDatabase.db) },
    );
    const secondFeedPage = await call(
      appRouter.catalog.feeds,
      { creatorId: alphaCreator.id, limit: 1, offset: 1 },
      { context: anonymousContext(testDatabase.db) },
    );
    const secondContentPage = await call(
      appRouter.catalog.contentItems,
      { limit: 2, offset: 1 },
      { context: anonymousContext(testDatabase.db) },
    );

    expect(secondCreatorPage.map((creator) => creator.id)).toEqual([betaCreator.id]);
    expect(secondFeedPage.map((feed) => feed.id)).toEqual([alphaSecondFeed.id]);
    expect(secondContentPage.map((contentItem) => contentItem.id)).toEqual([middleItem.id, oldestItem.id]);
    expect(newestItem.id).not.toBe(middleItem.id);
    expect(alphaFirstFeed.id).not.toBe(alphaSecondFeed.id);
  });

  test("authenticated subscribed content paginates across subscribed creators with stable ordering", async () => {
    await insertUser(testDatabase.db, "library-user", "library-user@example.test");
    const firstCreator = await findOrCreateCreator(testDatabase.db, {
      displayName: "Subscribed Pagination First",
    });
    const secondCreator = await findOrCreateCreator(testDatabase.db, {
      displayName: "Subscribed Pagination Second",
    });
    const firstFeed = await findOrCreateFeed(testDatabase.db, {
      creatorId: firstCreator.id,
      sourceType: "youtube",
      sourceExternalId: "subscribed-pagination-feed",
      url: "https://youtube.example.test/subscribed-pagination.xml",
    });
    const newestItem = await findOrCreateContentItem(testDatabase.db, {
      creatorId: firstCreator.id,
      sourceType: "youtube",
      sourceExternalId: "subscribed-pagination-newest",
      title: "Newest subscribed page item",
      publishedAt: new Date("2026-04-04T00:00:00.000Z"),
    });
    const middleItem = await findOrCreateContentItem(testDatabase.db, {
      creatorId: secondCreator.id,
      sourceType: "peertube",
      sourceExternalId: "subscribed-pagination-middle",
      title: "Middle subscribed page item",
      publishedAt: new Date("2026-04-03T00:00:00.000Z"),
    });
    const oldestItem = await findOrCreateContentItem(testDatabase.db, {
      creatorId: firstCreator.id,
      sourceType: "youtube",
      sourceExternalId: "subscribed-pagination-oldest",
      title: "Oldest subscribed page item",
      publishedAt: new Date("2026-04-02T00:00:00.000Z"),
    });
    await findOrCreateContentSource(testDatabase.db, {
      contentItemId: middleItem.id,
      sourceType: "peertube",
      canonicalUrl: "https://peertube.example.test/w/middle",
      priority: 0,
    });
    await findOrCreateContentSource(testDatabase.db, {
      contentItemId: middleItem.id,
      sourceType: "youtube",
      canonicalUrl: "https://youtube.example.test/watch?v=middle-mirror",
      priority: 1,
    });
    await linkFeedContent(testDatabase.db, {
      feedId: firstFeed.id,
      contentItemId: newestItem.id,
      sourceExternalId: "subscribed-pagination-newest",
    });
    await linkFeedContent(testDatabase.db, {
      feedId: firstFeed.id,
      contentItemId: oldestItem.id,
      sourceExternalId: "subscribed-pagination-oldest",
    });
    await findOrCreateSubscription(testDatabase.db, { userId: "library-user", creatorId: firstCreator.id });
    await findOrCreateSubscription(testDatabase.db, { userId: "library-user", creatorId: secondCreator.id });

    const secondPage = await call(
      appRouter.overlays.subscribedContentItems,
      { limit: 2, offset: 1 },
      { context: authenticatedContext(testDatabase.db, "library-user") },
    );
    const feedPage = await call(
      appRouter.overlays.subscribedContentItems,
      { feedId: firstFeed.id, limit: 10, offset: 0 },
      { context: authenticatedContext(testDatabase.db, "library-user") },
    );

    expect(secondPage.map((contentItem) => contentItem.id)).toEqual([middleItem.id, oldestItem.id]);
    expect(secondPage[0]?.sourceCount).toBe(2);
    expect(feedPage.map((contentItem) => contentItem.id)).toEqual([newestItem.id, oldestItem.id]);
  });

  test("authenticated subscribed content excludes unsubscribed creators", async () => {
    await insertUser(testDatabase.db, "scoped-user", "scoped-user@example.test");
    const subscribedCreator = await findOrCreateCreator(testDatabase.db, {
      displayName: "Subscribed Scope Included",
    });
    const unsubscribedCreator = await findOrCreateCreator(testDatabase.db, {
      displayName: "Subscribed Scope Excluded",
    });
    const includedItem = await findOrCreateContentItem(testDatabase.db, {
      creatorId: subscribedCreator.id,
      sourceType: "youtube",
      sourceExternalId: "subscribed-scope-included-video",
      title: "Included subscribed video",
      publishedAt: new Date("2026-04-05T00:00:00.000Z"),
    });
    const excludedItem = await findOrCreateContentItem(testDatabase.db, {
      creatorId: unsubscribedCreator.id,
      sourceType: "odysee",
      sourceExternalId: "subscribed-scope-excluded-video",
      title: "Excluded unsubscribed video",
      publishedAt: new Date("2026-04-06T00:00:00.000Z"),
    });
    await findOrCreateSubscription(testDatabase.db, { userId: "scoped-user", creatorId: subscribedCreator.id });

    const contentItems = await call(
      appRouter.overlays.subscribedContentItems,
      { limit: 10, offset: 0 },
      { context: authenticatedContext(testDatabase.db, "scoped-user") },
    );
    const unsubscribedCreatorPage = await call(
      appRouter.overlays.subscribedContentItems,
      { creatorId: unsubscribedCreator.id, limit: 10, offset: 0 },
      { context: authenticatedContext(testDatabase.db, "scoped-user") },
    );

    expect(contentItems.map((contentItem) => contentItem.id)).toEqual([includedItem.id]);
    expect(contentItems.map((contentItem) => contentItem.id)).not.toContain(excludedItem.id);
    expect(unsubscribedCreatorPage).toEqual([]);
  });

  test("refresh status is public and manual refresh procedures are protected", async () => {
    const run = await createRefreshRun(testDatabase.db, {
      scope: "all",
      force: false,
      status: "succeeded",
      feedsRequestedCount: 1,
      feedsSucceededCount: 1,
      startedAt: new Date("2026-05-16T12:00:00.000Z"),
      completedAt: new Date("2026-05-16T12:01:00.000Z"),
    });

    const status = await call(appRouter.refresh.status, { limit: 5 }, { context: anonymousContext(testDatabase.db) });

    expect(status.latestRun?.id).toBe(run.id);
    expect(status.recentRuns).toHaveLength(1);
    await expect(
      call(appRouter.refresh.runAll, { force: false }, { context: anonymousContext(testDatabase.db) }),
    ).rejects.toBeDefined();
    await expect(
      call(appRouter.refresh.runFeed, { feedId: "feed-id", force: false }, { context: anonymousContext(testDatabase.db) }),
    ).rejects.toBeDefined();
  });

  test("refresh status loads bounded runs and latest feed results at the API boundary", async () => {
    const creator = await findOrCreateCreator(testDatabase.db, {
      displayName: "Refresh Status Bounds Creator",
    });
    const firstFeed = await findOrCreateFeed(testDatabase.db, {
      creatorId: creator.id,
      sourceType: "youtube",
      sourceExternalId: "refresh-status-bounds-feed-one",
      url: "https://youtube.example.test/status/feed-one",
      title: "Status Feed One",
    });
    const secondFeed = await findOrCreateFeed(testDatabase.db, {
      creatorId: creator.id,
      sourceType: "youtube",
      sourceExternalId: "refresh-status-bounds-feed-two",
      url: "https://youtube.example.test/status/feed-two",
    });
    const thirdFeed = await findOrCreateFeed(testDatabase.db, {
      creatorId: creator.id,
      sourceType: "youtube",
      sourceExternalId: "refresh-status-bounds-feed-three",
      url: "https://youtube.example.test/status/feed-three",
    });
    await createRefreshRun(testDatabase.db, {
      scope: "all",
      force: false,
      status: "succeeded",
      startedAt: new Date("2026-05-16T10:00:00.000Z"),
    });
    const secondRun = await createRefreshRun(testDatabase.db, {
      scope: "all",
      force: false,
      status: "succeeded",
      startedAt: new Date("2026-05-16T11:00:00.000Z"),
    });
    const latestRun = await createRefreshRun(testDatabase.db, {
      scope: "all",
      force: false,
      status: "succeeded",
      startedAt: new Date("2026-05-16T12:00:00.000Z"),
    });

    await recordRefreshFeedResult(testDatabase.db, {
      refreshRunId: latestRun.id,
      feedId: firstFeed.id,
      status: "succeeded",
      startedAt: new Date("2026-05-16T12:00:01.000Z"),
    });
    await recordRefreshFeedResult(testDatabase.db, {
      refreshRunId: latestRun.id,
      feedId: secondFeed.id,
      status: "failed",
      startedAt: new Date("2026-05-16T12:00:02.000Z"),
    });
    await recordRefreshFeedResult(testDatabase.db, {
      refreshRunId: latestRun.id,
      feedId: thirdFeed.id,
      status: "partial",
      startedAt: new Date("2026-05-16T12:00:03.000Z"),
    });

    const status = await call(
      appRouter.refresh.status,
      { limit: 2, feedResultsLimit: 2 },
      { context: anonymousContext(testDatabase.db) },
    );

    expect(status.latestRun?.id).toBe(latestRun.id);
    expect(status.recentRuns.map((run) => run.id)).toEqual([latestRun.id, secondRun.id]);
    expect(status.latestFeedResults).toHaveLength(2);
    expect(status.latestFeedResults.at(0)?.feed.title).toBe("Status Feed One");
  });

  test("authenticated callers can run a per-creator normal or force refresh through the router", async () => {
    await insertUser(testDatabase.db, "active-user", "active-user@example.test");
    const creator = await findOrCreateCreator(testDatabase.db, {
      displayName: "Refresh Creator",
    });

    const result = await call(
      appRouter.refresh.runCreator,
      { creatorId: creator.id, force: true },
      { context: authenticatedContext(testDatabase.db, "active-user") },
    );

    expect(result.report).toMatchObject({ scope: "creator", force: true, status: "succeeded" });
    expect(result.selectedFeeds).toHaveLength(0);
  });

  test("authenticated callers can run a feed-scoped refresh through the router", async () => {
    await insertUser(testDatabase.db, "active-user", "active-user@example.test");
    const creator = await findOrCreateCreator(testDatabase.db, {
      displayName: "Refresh Feed Creator",
    });
    const feed = await findOrCreateFeed(testDatabase.db, {
      creatorId: creator.id,
      sourceType: "youtube",
      sourceExternalId: "refresh-feed",
      url: "https://youtube.example.test/refresh-feed.xml",
    });

    const result = await call(
      appRouter.refresh.runFeed,
      { feedId: feed.id, force: true },
      { context: authenticatedContext(testDatabase.db, "active-user") },
    );

    expect(result.run).toMatchObject({ scope: "feed", requestedCreatorId: null, requestedFeedId: feed.id });
    expect(result.selectedFeeds.map((selectedFeed) => selectedFeed.id)).toEqual([feed.id]);
    expect(result.report).toMatchObject({ scope: "feed", force: true, selectedFeedCount: 1 });
  });

  test("feed-scoped refresh rejects unknown feed ids", async () => {
    await insertUser(testDatabase.db, "active-user", "active-user@example.test");

    await expect(
      call(appRouter.refresh.runFeed, { feedId: "missing-feed", force: false }, {
        context: authenticatedContext(testDatabase.db, "active-user"),
      }),
    ).rejects.toBeDefined();
  });

  test("anonymous content detail includes creator, feeds, and playable sources without overlay leakage", async () => {
    await insertUser(testDatabase.db, "user-a", "user-a@example.test");
    const creator = await findOrCreateCreator(testDatabase.db, {
      displayName: "Peer Creator",
      imageUrl: "https://peertube.example.test/avatar.png",
    });
    const feed = await findOrCreateFeed(testDatabase.db, {
      creatorId: creator.id,
      sourceType: "peertube",
      sourceExternalId: "feed-account@example.test",
      url: "https://peertube.example.test/accounts/account/videos",
      title: "Peer videos",
    });
    const contentItem = await findOrCreateContentItem(testDatabase.db, {
      creatorId: creator.id,
      sourceType: "peertube",
      sourceExternalId: "video-123",
      title: "Playable catalog item",
      description: "A public video description.",
      canonicalUrl: "https://peertube.example.test/w/video-123",
      publishedAt: new Date("2026-02-01T00:00:00.000Z"),
    });
    await findOrCreateContentSource(testDatabase.db, {
      contentItemId: contentItem.id,
      sourceType: "peertube",
      sourceExternalId: "video-123",
      embedUrl: "https://peertube.example.test/videos/embed/video-123",
      nativeMediaUrl: "https://peertube.example.test/download/video-123.mp4",
      canonicalUrl: "https://peertube.example.test/w/video-123",
      priority: 0,
    });
    await linkFeedContent(testDatabase.db, {
      feedId: feed.id,
      contentItemId: contentItem.id,
      sourceExternalId: "video-123",
    });
    await findOrCreateSubscription(testDatabase.db, { userId: "user-a", creatorId: creator.id });
    await findOrCreateContentStatus(testDatabase.db, {
      userId: "user-a",
      contentItemId: contentItem.id,
      status: "favorite",
    });

    const detail = await call(appRouter.catalog.contentDetail, { id: contentItem.id }, {
      context: anonymousContext(testDatabase.db),
    });

    expect(detail).toMatchObject({ id: contentItem.id, title: "Playable catalog item" });
    expect(detail.creator).toMatchObject({ id: creator.id, displayName: "Peer Creator" });
    expect(detail.feeds).toHaveLength(1);
    expect(detail.sources).toHaveLength(1);
    expect(detail.sources[0]).toMatchObject({
      embedUrl: "https://peertube.example.test/videos/embed/video-123",
      nativeMediaUrl: "https://peertube.example.test/download/video-123.mp4",
    });
    expect(JSON.stringify(detail)).not.toContain("user-a");
    expect("favorite" in detail).toBe(false);
    expect("subscription" in detail).toBe(false);
    expect("playlist" in detail).toBe(false);
  });

  test("creator list sort lastUpdate orders by newest publish with NULLs last and stable tiebreakers", async () => {
    const newestCreator = await findOrCreateCreator(testDatabase.db, {
      displayName: "Zulu Newest",
    });
    const middleCreator = await findOrCreateCreator(testDatabase.db, {
      displayName: "Yankee Middle",
    });
    const tiedFirstCreator = await findOrCreateCreator(testDatabase.db, {
      displayName: "Alpha Tied",
    });
    const tiedSecondCreator = await findOrCreateCreator(testDatabase.db, {
      displayName: "Bravo Tied",
    });
    const nullCreator = await findOrCreateCreator(testDatabase.db, {
      displayName: "Aardvark Null",
    });
    await setCreatorLastContentPublishedAt(newestCreator.id, new Date("2026-06-03T00:00:00.000Z"));
    await setCreatorLastContentPublishedAt(middleCreator.id, new Date("2026-06-02T00:00:00.000Z"));
    await setCreatorLastContentPublishedAt(tiedFirstCreator.id, new Date("2026-06-02T00:00:00.000Z"));
    await setCreatorLastContentPublishedAt(tiedSecondCreator.id, new Date("2026-06-02T00:00:00.000Z"));

    const sorted = await call(
      appRouter.catalog.creators,
      { limit: 10, sort: "lastUpdate" },
      { context: anonymousContext(testDatabase.db) },
    );
    const secondPage = await call(
      appRouter.catalog.creators,
      { limit: 2, offset: 3, sort: "lastUpdate" },
      { context: anonymousContext(testDatabase.db) },
    );
    const searchSorted = await call(
      appRouter.catalog.creators,
      { search: "tied", limit: 10, sort: "lastUpdate" },
      { context: anonymousContext(testDatabase.db) },
    );

    expect(sorted.map((creator) => creator.id)).toEqual([
      newestCreator.id,
      tiedFirstCreator.id,
      tiedSecondCreator.id,
      middleCreator.id,
      nullCreator.id,
    ]);
    expect(secondPage.map((creator) => creator.id)).toEqual([middleCreator.id, nullCreator.id]);
    expect(searchSorted.map((creator) => creator.id)).toEqual([tiedFirstCreator.id, tiedSecondCreator.id]);
  });

  test("creator list defaults to name sort", async () => {
    const betaCreator = await findOrCreateCreator(testDatabase.db, { displayName: "Sort Beta" });
    const alphaCreator = await findOrCreateCreator(testDatabase.db, { displayName: "Sort Alpha" });
    await setCreatorLastContentPublishedAt(betaCreator.id, new Date("2026-06-03T00:00:00.000Z"));

    const byDefault = await call(
      appRouter.catalog.creators,
      { limit: 10 },
      { context: anonymousContext(testDatabase.db) },
    );
    const explicitName = await call(
      appRouter.catalog.creators,
      { limit: 10, sort: "name" },
      { context: anonymousContext(testDatabase.db) },
    );

    expect(byDefault.map((creator) => creator.id)).toEqual([alphaCreator.id, betaCreator.id]);
    expect(explicitName.map((creator) => creator.id)).toEqual(byDefault.map((creator) => creator.id));
  });

  test("invalid catalog browsing input is rejected before repository access", async () => {
    await expect(
      call(appRouter.catalog.contentItems, { limit: 101 }, { context: anonymousContext(testDatabase.db) }),
    ).rejects.toBeDefined();
    await expect(
      call(appRouter.catalog.creators, { limit: 10, offset: -1 }, { context: anonymousContext(testDatabase.db) }),
    ).rejects.toBeDefined();
  });
});

function anonymousContext(db: RepositoryDb): Context {
  return {
    db,
    session: null,
    sourceRegistry: createSourceAdapterRegistry(),
  };
}

function authenticatedContext(db: RepositoryDb, userId: string): Context {
  return {
    db,
    sourceRegistry: createSourceAdapterRegistry(),
    session: {
      session: {
        id: `session-${userId}`,
        userId,
        expiresAt: new Date("2027-01-01T00:00:00.000Z"),
        createdAt: new Date("2026-01-01T00:00:00.000Z"),
        updatedAt: new Date("2026-01-01T00:00:00.000Z"),
        ipAddress: null,
        userAgent: null,
      },
      user: {
        id: userId,
        name: userId,
        email: `${userId}@example.test`,
        emailVerified: true,
        image: null,
        createdAt: new Date("2026-01-01T00:00:00.000Z"),
        updatedAt: new Date("2026-01-01T00:00:00.000Z"),
        accountState: "active",
      },
    },
  };
}

async function setCreatorLastContentPublishedAt(creatorId: string, publishedAt: Date): Promise<void> {
  await testDatabase.db
    .update(schema.creator)
    .set({ lastContentPublishedAt: publishedAt })
    .where(eq(schema.creator.id, creatorId));
}

async function insertUser(db: RepositoryDb, id: string, email: string): Promise<void> {
  await db.insert(schema.user).values({
    id,
    name: id,
    email,
    emailVerified: true,
    accountState: "active",
  });
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
  `CREATE TABLE user (
    id TEXT PRIMARY KEY NOT NULL,
    name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    email_verified INTEGER NOT NULL DEFAULT 0,
    image TEXT,
    account_state TEXT NOT NULL DEFAULT 'active',
    created_at INTEGER NOT NULL DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)),
    updated_at INTEGER NOT NULL DEFAULT (cast(unixepoch('subsecond') * 1000 as integer))
  )`,
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
  `CREATE TABLE subscription (
    id TEXT PRIMARY KEY NOT NULL,
    user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
    creator_id TEXT NOT NULL REFERENCES creator(id) ON DELETE CASCADE,
    title_override TEXT,
    settings_json TEXT,
    created_at INTEGER NOT NULL DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)),
    updated_at INTEGER NOT NULL DEFAULT (cast(unixepoch('subsecond') * 1000 as integer))
  )`,
  "CREATE UNIQUE INDEX subscription_user_creator_uidx ON subscription (user_id, creator_id)",
  `CREATE TABLE content_status (
    id TEXT PRIMARY KEY NOT NULL,
    user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
    content_item_id TEXT NOT NULL REFERENCES content_item(id) ON DELETE CASCADE,
    status TEXT NOT NULL,
    metadata_json TEXT,
    created_at INTEGER NOT NULL DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)),
    updated_at INTEGER NOT NULL DEFAULT (cast(unixepoch('subsecond') * 1000 as integer))
  )`,
  "CREATE UNIQUE INDEX content_status_user_item_status_uidx ON content_status (user_id, content_item_id, status)",
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
