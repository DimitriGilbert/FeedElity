import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { createClient } from "@libsql/client";
import type { Client } from "@libsql/client";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/libsql";

import * as schema from "@FeedElity/db/schema";

import {
  advanceCreatorLastContentPublishedAt,
  createRefreshRun,
  findOrCreateContentItem,
  findOrCreateContentSource,
  findCreatorByNameKey,
  findOrCreateCreator,
  findOrCreateFeed,
  getCatalogContentDetail,
  linkFeedContent,
  listCatalogContentItems,
  listCatalogCreators,
  listCatalogFeedsForBrowsing,
  listFeedHealth,
  listRefreshFeedResultsForRun,
  listRefreshRuns,
  recordRefreshFeedResult,
  type RepositoryDb,
  updateCreatorMetadata,
} from "./catalog";
import {
  addPlaylistItem,
  createPlaylist,
  findOrCreateContentStatus,
  findOrCreateMigrationRun,
  findOrCreateSubscription,
  listContentStatusesForUser,
  listContentStatusWithContentForUser,
  listCreatorUnreadForUser,
  listMigrationMappingsForRun,
  listMigrationRuns,
  listPlaylistItemsForUserPlaylist,
  listPlaylistItemsWithContentForUserPlaylist,
  listPlaylistsForUser,
  listSubscribedContentItemsForUser,
  listSubscriptionsForUser,
  listUserSettingsForUser,
  markAllCreatorsContentOpenedForUser,
  markCreatorContentOpenedForUser,
  recordMigrationMapping,
  reorderPlaylistItemsForUser,
  saveUserSetting,
  upsertPlaybackPositionForUser,
} from "./overlays";
import type { CreatorUnreadSummary } from "../domain/overlays";
import type { FeedHealthEntry } from "../domain/catalog";

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

describe("catalog and overlay repositories", () => {
  test("global catalog records can exist and be read without user ownership", async () => {
    const creator = await findOrCreateCreator(testDatabase.db, {
      displayName: "Global Creator",
    });
    const feed = await findOrCreateFeed(testDatabase.db, {
      creatorId: creator.id,
      sourceType: "youtube",
      sourceExternalId: "feed-1",
      url: "https://www.youtube.com/feeds/videos.xml?channel_id=channel-1",
      title: "Global Creator uploads",
    });
    const contentItem = await findOrCreateContentItem(testDatabase.db, {
      creatorId: creator.id,
      sourceType: "youtube",
      sourceExternalId: "video-1",
      title: "Source-neutral video",
      publishedAt: new Date("2026-01-02T03:04:05.000Z"),
    });
    const contentSource = await findOrCreateContentSource(testDatabase.db, {
      contentItemId: contentItem.id,
      sourceType: "youtube",
      sourceExternalId: "video-1",
      canonicalUrl: "https://www.youtube.com/watch?v=video-1",
      embedUrl: "https://www.youtube-nocookie.com/embed/video-1",
      priority: 0,
    });
    const feedContent = await linkFeedContent(testDatabase.db, {
      feedId: feed.id,
      contentItemId: contentItem.id,
      sourceExternalId: "video-1",
    });

    const rows = await listCatalogContentItems(testDatabase.db);

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: contentItem.id,
      creatorId: creator.id,
      sourceType: "youtube",
      sourceExternalId: "video-1",
      title: "Source-neutral video",
    });
    expect(contentSource.contentItemId).toBe(contentItem.id);
    expect(feedContent.feedId).toBe(feed.id);
  });

  test("updateCreatorMetadata overwrites only supplied fields and never wipes stored values", async () => {
    const creator = await findOrCreateCreator(testDatabase.db, {
      displayName: "Metadata Creator",
      description: "Stored description",
      imageUrl: "https://icons.example.test/stored.png",
      canonicalUrl: "https://canonical.example.test/stored",
    });

    const unchanged = await updateCreatorMetadata(testDatabase.db, {
      creatorId: creator.id,
      imageUrl: "https://icons.example.test/stored.png",
      description: null,
      canonicalUrl: undefined,
    });
    expect(unchanged.changed).toBe(false);
    expect(unchanged.creator.description).toBe("Stored description");
    expect(unchanged.creator.imageUrl).toBe("https://icons.example.test/stored.png");
    expect(unchanged.creator.canonicalUrl).toBe("https://canonical.example.test/stored");

    const updated = await updateCreatorMetadata(testDatabase.db, {
      creatorId: creator.id,
      imageUrl: "https://icons.example.test/fresh.png",
      canonicalUrl: "https://canonical.example.test/fresh",
    });
    expect(updated.changed).toBe(true);
    expect(updated.creator.imageUrl).toBe("https://icons.example.test/fresh.png");
    expect(updated.creator.canonicalUrl).toBe("https://canonical.example.test/fresh");
    expect(updated.creator.description).toBe("Stored description");
    expect(updated.creator.displayName).toBe("Metadata Creator");

    const byStoredNameKey = await findCreatorByNameKey(testDatabase.db, "metadatacreator");
    expect(byStoredNameKey?.id).toBe(creator.id);
  });

  test("user overlays are created and read only for the requested userId", async () => {
    await insertUser(testDatabase.db, "user-a", "user-a@example.test");
    await insertUser(testDatabase.db, "user-b", "user-b@example.test");
    const creator = await findOrCreateCreator(testDatabase.db, {
      displayName: "Scoped Creator",
    });
    const contentItem = await findOrCreateContentItem(testDatabase.db, {
      creatorId: creator.id,
      sourceType: "odysee",
      sourceExternalId: "claim-1",
      title: "Scoped video",
    });

    await findOrCreateSubscription(testDatabase.db, {
      userId: "user-a",
      creatorId: creator.id,
      titleOverride: "User A title",
    });
    await findOrCreateSubscription(testDatabase.db, {
      userId: "user-b",
      creatorId: creator.id,
      titleOverride: "User B title",
    });
    await findOrCreateContentStatus(testDatabase.db, {
      userId: "user-a",
      contentItemId: contentItem.id,
      status: "favorite",
    });
    await findOrCreateContentStatus(testDatabase.db, {
      userId: "user-b",
      contentItemId: contentItem.id,
      status: "played",
    });

    const userASubscriptions = await listSubscriptionsForUser(testDatabase.db, "user-a");
    const userAStatuses = await listContentStatusesForUser(testDatabase.db, "user-a");

    expect(userASubscriptions).toHaveLength(1);
    expect(userASubscriptions[0]).toMatchObject({ userId: "user-a", titleOverride: "User A title" });
    expect(userAStatuses).toHaveLength(1);
    expect(userAStatuses[0]).toMatchObject({ userId: "user-a", status: "favorite" });
  });

  test("duplicate source records reuse existing catalog identities deterministically", async () => {
    const creator = await findOrCreateCreator(testDatabase.db, {
      displayName: "Original Creator",
    });
    const duplicateCreator = await findOrCreateCreator(testDatabase.db, {
      displayName: "Original Creator",
    });
    const feed = await findOrCreateFeed(testDatabase.db, {
      creatorId: creator.id,
      sourceType: "peertube",
      sourceExternalId: "feeds/source@example.test",
      url: "https://peertube.example.test/accounts/source/videos",
    });
    const duplicateFeed = await findOrCreateFeed(testDatabase.db, {
      creatorId: creator.id,
      sourceType: "peertube",
      sourceExternalId: "feeds/source@example.test",
      url: "https://peertube.example.test/accounts/source/videos?duplicate=true",
    });
    const contentItem = await findOrCreateContentItem(testDatabase.db, {
      creatorId: creator.id,
      sourceType: "peertube",
      sourceExternalId: "videos/123",
      title: "Original title",
    });
    const duplicateContentItem = await findOrCreateContentItem(testDatabase.db, {
      creatorId: creator.id,
      sourceType: "peertube",
      sourceExternalId: "videos/123",
      title: "Duplicate title",
    });
    const contentSource = await findOrCreateContentSource(testDatabase.db, {
      contentItemId: contentItem.id,
      sourceType: "peertube",
      canonicalUrl: "https://peertube.example.test/w/videos-123",
      priority: 0,
    });
    const duplicateContentSource = await findOrCreateContentSource(testDatabase.db, {
      contentItemId: contentItem.id,
      sourceType: "peertube",
      canonicalUrl: "https://peertube.example.test/w/videos-123",
      priority: 1,
    });

    expect(duplicateCreator).toEqual(creator);
    expect(duplicateFeed).toEqual(feed);
    expect(duplicateContentItem).toEqual(contentItem);
    expect(duplicateContentSource).toEqual(contentSource);
    expect(await listCatalogContentItems(testDatabase.db)).toHaveLength(1);
  });

  test("persisting a source identity under a merged creator re-points stale feed and content rows", async () => {
    const staleCreator = await findOrCreateCreator(testDatabase.db, {
      displayName: "Stale Creator",
    });
    const mergedCreator = await findOrCreateCreator(testDatabase.db, {
      displayName: "Merged Creator",
    });
    const staleFeed = await findOrCreateFeed(testDatabase.db, {
      creatorId: staleCreator.id,
      sourceType: "youtube",
      sourceExternalId: "heal-feed",
      url: "https://youtube.example.test/heal.xml",
    });
    const staleItem = await findOrCreateContentItem(testDatabase.db, {
      creatorId: staleCreator.id,
      sourceType: "youtube",
      sourceExternalId: "heal-video",
      title: "Heal video",
    });

    const healedFeed = await findOrCreateFeed(testDatabase.db, {
      creatorId: mergedCreator.id,
      sourceType: "youtube",
      sourceExternalId: "heal-feed",
      url: "https://youtube.example.test/heal.xml",
    });
    const healedItem = await findOrCreateContentItem(testDatabase.db, {
      creatorId: mergedCreator.id,
      sourceType: "youtube",
      sourceExternalId: "heal-video",
      title: "Heal video",
    });

    // Same source identity, new owner: the existing rows are re-pointed, not duplicated.
    expect(healedFeed.id).toBe(staleFeed.id);
    expect(healedFeed.creatorId).toBe(mergedCreator.id);
    expect(healedItem.id).toBe(staleItem.id);
    expect(healedItem.creatorId).toBe(mergedCreator.id);
    expect(await listCatalogContentItems(testDatabase.db)).toHaveLength(1);

    const feedRow = await testDatabase.db.query.feed.findFirst({ where: eq(schema.feed.id, staleFeed.id) });
    const itemRow = await testDatabase.db.query.contentItem.findFirst({
      where: eq(schema.contentItem.id, staleItem.id),
    });
    expect(feedRow?.creatorId).toBe(mergedCreator.id);
    expect(itemRow?.creatorId).toBe(mergedCreator.id);
  });

  test("cross_source_key is set on create and backfilled on conflict alongside the thumbnail backfill", async () => {
    const creator = await findOrCreateCreator(testDatabase.db, {
      displayName: "Mirror Creator",
    });

    const created = await findOrCreateContentItem(testDatabase.db, {
      creatorId: creator.id,
      sourceType: "odysee",
      sourceExternalId: "mirror-video",
      title: "Mirror video",
      thumbnailUrl: "https://icons.example.test/mirror.png",
      crossSourceKey: "mirrorcreator:mirrorvideo",
    });
    expect((await readContentItemRow(created.id))?.crossSourceKey).toBe("mirrorcreator:mirrorvideo");

    // Repeating the same identity without a key changes nothing.
    await findOrCreateContentItem(testDatabase.db, {
      creatorId: creator.id,
      sourceType: "odysee",
      sourceExternalId: "mirror-video",
      title: "Mirror video",
    });
    expect((await readContentItemRow(created.id))?.crossSourceKey).toBe("mirrorcreator:mirrorvideo");

    // A row created before keys existed (NULL key) gets the key backfilled in
    // the same update as the thumbnail backfill on the next conflict.
    const legacyItem = await findOrCreateContentItem(testDatabase.db, {
      creatorId: creator.id,
      sourceType: "peertube",
      sourceExternalId: "legacy-video",
      title: "Legacy video",
    });
    expect((await readContentItemRow(legacyItem.id))?.crossSourceKey).toBeNull();
    expect((await readContentItemRow(legacyItem.id))?.thumbnailUrl).toBeNull();

    const backfilled = await findOrCreateContentItem(testDatabase.db, {
      creatorId: creator.id,
      sourceType: "peertube",
      sourceExternalId: "legacy-video",
      title: "Legacy video",
      thumbnailUrl: "https://icons.example.test/legacy.png",
      crossSourceKey: "mirrorcreator:legacyvideo",
    });
    expect(backfilled.id).toBe(legacyItem.id);
    expect(backfilled.thumbnailUrl).toBe("https://icons.example.test/legacy.png");
    const legacyRow = await readContentItemRow(legacyItem.id);
    expect(legacyRow?.crossSourceKey).toBe("mirrorcreator:legacyvideo");
    expect(legacyRow?.thumbnailUrl).toBe("https://icons.example.test/legacy.png");
  });

  test("content source priority collision returns the existing row", async () => {
    const creator = await findOrCreateCreator(testDatabase.db, {
      displayName: "Priority Creator",
    });
    const contentItem = await findOrCreateContentItem(testDatabase.db, {
      creatorId: creator.id,
      sourceType: "youtube",
      sourceExternalId: "priority-video",
      title: "Priority video",
    });
    const firstSource = await findOrCreateContentSource(testDatabase.db, {
      contentItemId: contentItem.id,
      sourceType: "youtube",
      sourceExternalId: "priority-video",
      canonicalUrl: "https://www.youtube.com/watch?v=priority-video",
      priority: 0,
    });
    const priorityCollision = await findOrCreateContentSource(testDatabase.db, {
      contentItemId: contentItem.id,
      sourceType: "youtube",
      sourceExternalId: "priority-video-alt",
      canonicalUrl: "https://www.youtube.com/watch?v=priority-video-alt",
      priority: 0,
    });

    expect(priorityCollision).toEqual(firstSource);
  });

  test("playlists and playlist items are scoped by owner and ordered by position", async () => {
    await insertUser(testDatabase.db, "user-a", "playlist-a@example.test");
    await insertUser(testDatabase.db, "user-b", "playlist-b@example.test");
    const creator = await findOrCreateCreator(testDatabase.db, {
      displayName: "Playlist Creator",
    });
    const firstContentItem = await findOrCreateContentItem(testDatabase.db, {
      creatorId: creator.id,
      sourceType: "youtube",
      sourceExternalId: "playlist-video-1",
      title: "First playlist video",
    });
    const secondContentItem = await findOrCreateContentItem(testDatabase.db, {
      creatorId: creator.id,
      sourceType: "youtube",
      sourceExternalId: "playlist-video-2",
      title: "Second playlist video",
    });

    const userASecondPlaylist = await createPlaylist(testDatabase.db, {
      userId: "user-a",
      name: "Watch later",
      position: 20,
    });
    const userAFirstPlaylist = await createPlaylist(testDatabase.db, {
      userId: "user-a",
      name: "Queue",
      position: 10,
    });
    await createPlaylist(testDatabase.db, {
      userId: "user-b",
      name: "Other queue",
      position: 0,
    });

    await addPlaylistItem(testDatabase.db, {
      userId: "user-a",
      playlistId: userAFirstPlaylist.id,
      contentItemId: secondContentItem.id,
      position: 20,
    });
    await addPlaylistItem(testDatabase.db, {
      userId: "user-a",
      playlistId: userAFirstPlaylist.id,
      contentItemId: firstContentItem.id,
      position: 10,
    });

    const playlists = await listPlaylistsForUser(testDatabase.db, "user-a");
    const playlistItems = await listPlaylistItemsForUserPlaylist(testDatabase.db, "user-a", userAFirstPlaylist.id);
    const otherUserItems = await listPlaylistItemsForUserPlaylist(testDatabase.db, "user-b", userAFirstPlaylist.id);

    expect(playlists.map((playlist) => playlist.id)).toEqual([userAFirstPlaylist.id, userASecondPlaylist.id]);
    expect(playlistItems.map((playlistItem) => playlistItem.contentItemId)).toEqual([
      firstContentItem.id,
      secondContentItem.id,
    ]);
    expect(otherUserItems).toHaveLength(0);
  });

  test("playlist item position replay reuses same content and rejects different content", async () => {
    await insertUser(testDatabase.db, "user-a", "playlist-position-a@example.test");
    const creator = await findOrCreateCreator(testDatabase.db, {
      displayName: "Playlist Position Creator",
    });
    const firstContentItem = await findOrCreateContentItem(testDatabase.db, {
      creatorId: creator.id,
      sourceType: "youtube",
      sourceExternalId: "playlist-position-video-1",
      title: "First position video",
    });
    const secondContentItem = await findOrCreateContentItem(testDatabase.db, {
      creatorId: creator.id,
      sourceType: "youtube",
      sourceExternalId: "playlist-position-video-2",
      title: "Second position video",
    });
    const playlist = await createPlaylist(testDatabase.db, {
      userId: "user-a",
      name: "Position queue",
    });

    const firstItem = await addPlaylistItem(testDatabase.db, {
      userId: "user-a",
      playlistId: playlist.id,
      contentItemId: firstContentItem.id,
      position: 0,
    });
    const positionCollision = await addPlaylistItem(testDatabase.db, {
      userId: "user-a",
      playlistId: playlist.id,
      contentItemId: secondContentItem.id,
      position: 0,
    });
    const positionReplay = await addPlaylistItem(testDatabase.db, {
      userId: "user-a",
      playlistId: playlist.id,
      contentItemId: firstContentItem.id,
      position: 0,
    });

    expect(firstItem).not.toBeNull();
    expect(positionReplay).toEqual(firstItem);
    expect(positionCollision).toBeNull();
  });

  test("empty playlist reorders verify playlist ownership before returning items", async () => {
    await insertUser(testDatabase.db, "user-a", "empty-playlist-a@example.test");
    await insertUser(testDatabase.db, "user-b", "empty-playlist-b@example.test");
    const emptyPlaylist = await createPlaylist(testDatabase.db, {
      userId: "user-a",
      name: "Empty queue",
    });

    const ownerResult = await reorderPlaylistItemsForUser(testDatabase.db, {
      userId: "user-a",
      playlistId: emptyPlaylist.id,
      playlistItemIds: [],
    });
    const otherUserResult = await reorderPlaylistItemsForUser(testDatabase.db, {
      userId: "user-b",
      playlistId: emptyPlaylist.id,
      playlistItemIds: [],
    });
    const missingPlaylistResult = await reorderPlaylistItemsForUser(testDatabase.db, {
      userId: "user-a",
      playlistId: "missing-playlist",
      playlistItemIds: [],
    });

    expect(ownerResult).toEqual([]);
    expect(otherUserResult).toBeNull();
    expect(missingPlaylistResult).toBeNull();
  });

  test("user settings are idempotent and scoped by user", async () => {
    await insertUser(testDatabase.db, "user-a", "settings-a@example.test");
    await insertUser(testDatabase.db, "user-b", "settings-b@example.test");

    const originalSetting = await saveUserSetting(testDatabase.db, {
      userId: "user-a",
      key: "reader.layout",
      valueJson: JSON.stringify({ density: "compact" }),
    });
    const updatedSetting = await saveUserSetting(testDatabase.db, {
      userId: "user-a",
      key: "reader.layout",
      valueJson: JSON.stringify({ density: "comfortable" }),
    });
    await saveUserSetting(testDatabase.db, {
      userId: "user-b",
      key: "reader.layout",
      valueJson: JSON.stringify({ density: "spacious" }),
    });

    const userASettings = await listUserSettingsForUser(testDatabase.db, "user-a");

    expect(updatedSetting.id).toBe(originalSetting.id);
    expect(userASettings).toHaveLength(1);
    expect(userASettings[0]).toMatchObject({ userId: "user-a", valueJson: JSON.stringify({ density: "comfortable" }) });
  });

  test("migration runs and mappings are recorded idempotently", async () => {
    const migrationRun = await findOrCreateMigrationRun(testDatabase.db, {
      sourceExportFingerprint: "fingerprint-1",
      sourceFilename: "export.json",
      status: "succeeded",
      usersImportedCount: 1,
    });
    const duplicateMigrationRun = await findOrCreateMigrationRun(testDatabase.db, {
      sourceExportFingerprint: "fingerprint-1",
      sourceFilename: "renamed-export.json",
      status: "failed",
    });
    const migrationMapping = await recordMigrationMapping(testDatabase.db, {
      migrationRunId: migrationRun.id,
      oldEntityType: "strapi-user",
      oldEntityId: "42",
      newEntityType: "user",
      newEntityId: "user-42",
      severity: "warning",
      message: "Password reset required",
    });
    const duplicateMigrationMapping = await recordMigrationMapping(testDatabase.db, {
      migrationRunId: migrationRun.id,
      oldEntityType: "strapi-user",
      oldEntityId: "42",
      newEntityType: "user",
      newEntityId: "user-42",
      severity: "info",
    });

    const migrationRuns = await listMigrationRuns(testDatabase.db);
    const migrationMappings = await listMigrationMappingsForRun(testDatabase.db, migrationRun.id);

    expect(duplicateMigrationRun).toEqual(migrationRun);
    expect(duplicateMigrationMapping).toEqual(migrationMapping);
    expect(migrationRuns).toHaveLength(1);
    expect(migrationMappings).toHaveLength(1);
    expect(migrationMappings[0]).toMatchObject({ severity: "warning", message: "Password reset required" });
  });

  test("refresh runs and feed results are persisted without running refresh orchestration", async () => {
    const creator = await findOrCreateCreator(testDatabase.db, {
      displayName: "Refresh Creator",
    });
    const feed = await findOrCreateFeed(testDatabase.db, {
      creatorId: creator.id,
      sourceType: "peertube",
      sourceExternalId: "refresh-feed",
      url: "https://peertube.example.test/accounts/refresh/videos",
    });
    const refreshRun = await createRefreshRun(testDatabase.db, {
      scope: "feed",
      force: true,
      status: "partial",
      requestedFeedId: feed.id,
      feedsRequestedCount: 1,
      feedsSkippedCount: 0,
      feedsSucceededCount: 0,
      feedsFailedCount: 1,
      errorSummaryJson: JSON.stringify([{ feedId: feed.id, message: "timeout" }]),
    });
    const refreshFeedResult = await recordRefreshFeedResult(testDatabase.db, {
      refreshRunId: refreshRun.id,
      feedId: feed.id,
      status: "failed",
      errorSummaryJson: JSON.stringify({ message: "timeout" }),
    });
    const duplicateRefreshFeedResult = await recordRefreshFeedResult(testDatabase.db, {
      refreshRunId: refreshRun.id,
      feedId: feed.id,
      status: "succeeded",
    });

    const refreshRuns = await listRefreshRuns(testDatabase.db, { limit: 10 });
    const refreshFeedResults = await listRefreshFeedResultsForRun(testDatabase.db, { refreshRunId: refreshRun.id, limit: 10 });

    expect(refreshRuns).toHaveLength(1);
    expect(refreshRuns[0]).toMatchObject({ id: refreshRun.id, force: true, status: "partial", feedsSkippedCount: 0 });
    expect(duplicateRefreshFeedResult).toEqual(refreshFeedResult);
    expect(refreshFeedResults).toHaveLength(1);
    expect(refreshFeedResults[0]).toMatchObject({ refreshRunId: refreshRun.id, feedId: feed.id, status: "failed" });
  });

  test("refresh run and feed result listing applies repository limits", async () => {
    const creator = await findOrCreateCreator(testDatabase.db, {
      displayName: "Bounded Refresh Creator",
    });
    const feedOne = await findOrCreateFeed(testDatabase.db, {
      creatorId: creator.id,
      sourceType: "youtube",
      sourceExternalId: "bounded-refresh-feed-one",
      url: "https://youtube.example.test/feeds/one",
    });
    const feedTwo = await findOrCreateFeed(testDatabase.db, {
      creatorId: creator.id,
      sourceType: "youtube",
      sourceExternalId: "bounded-refresh-feed-two",
      url: "https://youtube.example.test/feeds/two",
    });
    const feedThree = await findOrCreateFeed(testDatabase.db, {
      creatorId: creator.id,
      sourceType: "youtube",
      sourceExternalId: "bounded-refresh-feed-three",
      url: "https://youtube.example.test/feeds/three",
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

    await recordRefreshFeedResult(testDatabase.db, { refreshRunId: latestRun.id, feedId: feedOne.id, status: "succeeded" });
    await recordRefreshFeedResult(testDatabase.db, { refreshRunId: latestRun.id, feedId: feedTwo.id, status: "succeeded" });
    await recordRefreshFeedResult(testDatabase.db, { refreshRunId: latestRun.id, feedId: feedThree.id, status: "succeeded" });

    const refreshRuns = await listRefreshRuns(testDatabase.db, { limit: 2 });
    const refreshFeedResults = await listRefreshFeedResultsForRun(testDatabase.db, { refreshRunId: latestRun.id, limit: 2 });

    expect(refreshRuns.map((run) => run.id)).toEqual([latestRun.id, secondRun.id]);
    expect(refreshFeedResults).toHaveLength(2);
  });

  test("feed health metrics honor the result window, trailing failure runs, and null-safe successes", async () => {
    const creator = await findOrCreateCreator(testDatabase.db, {
      displayName: "Health Creator",
    });
    // Created in ccc/aaa/bbb order: the repository must still return rows
    // sorted by feed.url for determinism.
    const feedCcc = await findOrCreateFeed(testDatabase.db, {
      creatorId: creator.id,
      sourceType: "youtube",
      sourceExternalId: "health-feed-ccc",
      url: "https://health.example.test/ccc",
      title: "Health Feed Ccc",
    });
    const feedAaa = await findOrCreateFeed(testDatabase.db, {
      creatorId: creator.id,
      sourceType: "odysee",
      sourceExternalId: "health-feed-aaa",
      url: "https://health.example.test/aaa",
      title: "Health Feed Aaa",
    });
    const feedBbb = await findOrCreateFeed(testDatabase.db, {
      creatorId: creator.id,
      sourceType: "peertube",
      sourceExternalId: "health-feed-bbb",
      url: "https://health.example.test/bbb",
      title: "Health Feed Bbb",
    });
    await setFeedNextRefreshAfter(testDatabase.db, feedBbb.id, new Date("2026-06-05T00:00:00.000Z"));

    // aaa: fail, success, fail, fail (oldest -> newest). The success inside the
    // window resets the trailing failure count to 2.
    const aaaOldestFailureJson = JSON.stringify({ feedId: feedAaa.id, code: "remote-fetch-failed", message: "old timeout" });
    const aaaNewestFailureJson = JSON.stringify({ feedId: feedAaa.id, code: "remote-fetch-failed", message: "timeout again" });
    await seedFeedHealthResult(testDatabase.db, {
      feedId: feedAaa.id,
      status: "failed",
      startedAt: new Date("2026-06-01T10:00:00.000Z"),
      completedAt: new Date("2026-06-01T10:00:05.000Z"),
      errorSummaryJson: aaaOldestFailureJson,
    });
    await seedFeedHealthResult(testDatabase.db, {
      feedId: feedAaa.id,
      status: "succeeded",
      startedAt: new Date("2026-06-02T10:00:00.000Z"),
      completedAt: new Date("2026-06-02T10:01:00.000Z"),
      itemsCreatedCount: 3,
    });
    await seedFeedHealthResult(testDatabase.db, {
      feedId: feedAaa.id,
      status: "failed",
      startedAt: new Date("2026-06-03T10:00:00.000Z"),
      completedAt: new Date("2026-06-03T10:00:05.000Z"),
      errorSummaryJson: JSON.stringify({ feedId: feedAaa.id, code: "provider-refresh-paused", message: "rate limited" }),
    });
    await seedFeedHealthResult(testDatabase.db, {
      feedId: feedAaa.id,
      status: "failed",
      startedAt: new Date("2026-06-04T10:00:00.000Z"),
      completedAt: new Date("2026-06-04T10:00:05.000Z"),
      errorSummaryJson: aaaNewestFailureJson,
    });

    // bbb: never refreshed — every metric must be null-safe.

    // ccc: eleven consecutive failures. The window keeps the latest 10, so the
    // trailing count caps at 10 and the oldest run's items stay out of the sum.
    for (let index = 0; index < 11; index += 1) {
      const startedAt = new Date(Date.parse("2026-06-01T00:00:00.000Z") + index * 3_600_000);
      await seedFeedHealthResult(testDatabase.db, {
        feedId: feedCcc.id,
        status: "failed",
        startedAt,
        completedAt: new Date(startedAt.getTime() + 5_000),
        itemsCreatedCount: index,
        errorSummaryJson: JSON.stringify({ feedId: feedCcc.id, code: "remote-fetch-failed", message: `failure ${index}` }),
      });
    }
    const cccNewestStartedAt = new Date(Date.parse("2026-06-01T00:00:00.000Z") + 10 * 3_600_000);
    const cccNewestFailureJson = JSON.stringify({ feedId: feedCcc.id, code: "remote-fetch-failed", message: "failure 10" });

    const entries = await listFeedHealth(testDatabase.db, {});

    expect(entries.map((entry) => entry.feedUrl)).toEqual([
      "https://health.example.test/aaa",
      "https://health.example.test/bbb",
      "https://health.example.test/ccc",
    ]);

    const aaaEntry = requireFeedHealthEntry(entries, feedAaa.id);
    expect(aaaEntry).toEqual({
      feedId: feedAaa.id,
      feedTitle: "Health Feed Aaa",
      feedUrl: "https://health.example.test/aaa",
      sourceType: "odysee",
      creatorId: creator.id,
      creatorDisplayName: "Health Creator",
      nextRefreshAfter: null,
      lastAttemptAt: new Date("2026-06-04T10:00:00.000Z"),
      lastSuccessAt: new Date("2026-06-02T10:01:00.000Z"),
      consecutiveFailureCount: 2,
      lastErrorSummaryJson: aaaNewestFailureJson,
      itemsCreatedTotal: 3,
    });

    // Health entries are catalog-global: exactly these keys, never user overlay data.
    expect(Object.keys(aaaEntry).sort()).toEqual([
      "consecutiveFailureCount",
      "creatorDisplayName",
      "creatorId",
      "feedId",
      "feedTitle",
      "feedUrl",
      "itemsCreatedTotal",
      "lastAttemptAt",
      "lastErrorSummaryJson",
      "lastSuccessAt",
      "nextRefreshAfter",
      "sourceType",
    ]);

    const bbbEntry = requireFeedHealthEntry(entries, feedBbb.id);
    expect(bbbEntry).toMatchObject({
      lastAttemptAt: null,
      lastSuccessAt: null,
      consecutiveFailureCount: 0,
      lastErrorSummaryJson: null,
      itemsCreatedTotal: 0,
      nextRefreshAfter: new Date("2026-06-05T00:00:00.000Z"),
    });

    const cccEntry = requireFeedHealthEntry(entries, feedCcc.id);
    expect(cccEntry).toMatchObject({
      lastAttemptAt: cccNewestStartedAt,
      lastSuccessAt: null,
      consecutiveFailureCount: 10,
      lastErrorSummaryJson: cccNewestFailureJson,
      itemsCreatedTotal: 55,
    });

    const limitedEntries = await listFeedHealth(testDatabase.db, { limit: 2 });
    expect(limitedEntries.map((entry) => entry.feedUrl)).toEqual([
      "https://health.example.test/aaa",
      "https://health.example.test/bbb",
    ]);
  });

  test("catalog repository pagination uses explicit offsets and stable tie-breakers", async () => {
    const alphaCreator = await findOrCreateCreator(testDatabase.db, {
      displayName: "Alpha Repository",
    });
    const betaCreator = await findOrCreateCreator(testDatabase.db, {
      displayName: "Beta Repository",
    });
    const firstFeed = await findOrCreateFeed(testDatabase.db, {
      creatorId: alphaCreator.id,
      sourceType: "youtube",
      sourceExternalId: "repo-pagination-feed-first",
      url: "https://youtube.example.test/repo/first.xml",
    });
    const secondFeed = await findOrCreateFeed(testDatabase.db, {
      creatorId: alphaCreator.id,
      sourceType: "youtube",
      sourceExternalId: "repo-pagination-feed-second",
      url: "https://youtube.example.test/repo/second.xml",
    });
    const newestItem = await findOrCreateContentItem(testDatabase.db, {
      creatorId: alphaCreator.id,
      sourceType: "youtube",
      sourceExternalId: "repo-pagination-newest",
      title: "Repository newest",
      publishedAt: new Date("2026-04-03T00:00:00.000Z"),
    });
    const olderItem = await findOrCreateContentItem(testDatabase.db, {
      creatorId: betaCreator.id,
      sourceType: "youtube",
      sourceExternalId: "repo-pagination-older",
      title: "Repository older",
      publishedAt: new Date("2026-04-02T00:00:00.000Z"),
    });

    const creators = await listCatalogCreators(testDatabase.db, { limit: 1, offset: 1 });
    const feeds = await listCatalogFeedsForBrowsing(testDatabase.db, { creatorId: alphaCreator.id, limit: 1, offset: 1 });
    const contentItems = await listCatalogContentItems(testDatabase.db, { limit: 1, offset: 1 });

    expect(creators.map((creator) => creator.id)).toEqual([betaCreator.id]);
    expect(feeds.map((feed) => feed.id)).toEqual([secondFeed.id]);
    expect(contentItems.map((contentItem) => contentItem.id)).toEqual([olderItem.id]);
    expect(firstFeed.id).not.toBe(secondFeed.id);
    expect(newestItem.id).not.toBe(olderItem.id);
  });

  test("creator list entries carry sourceTypes aggregated from feeds and content items", async () => {
    const multiSourceCreator = await findOrCreateCreator(testDatabase.db, {
      displayName: "Multi Source Creator",
    });
    await findOrCreateFeed(testDatabase.db, {
      creatorId: multiSourceCreator.id,
      sourceType: "odysee",
      sourceExternalId: "multi-source-odysee-feed",
      url: "https://odysee.com/$/rss/@multisource:abc",
    });
    await findOrCreateContentItem(testDatabase.db, {
      creatorId: multiSourceCreator.id,
      sourceType: "youtube",
      sourceExternalId: "multi-source-video",
      title: "Multi source video",
    });
    const singleSourceCreator = await findOrCreateCreator(testDatabase.db, {
      displayName: "Single Source Creator",
    });
    await findOrCreateContentItem(testDatabase.db, {
      creatorId: singleSourceCreator.id,
      sourceType: "peertube",
      sourceExternalId: "single-source-video",
      title: "Single source video",
    });

    const creators = await listCatalogCreators(testDatabase.db, { limit: 10 });

    const multiSummary = creators.find((creator) => creator.id === multiSourceCreator.id);
    const singleSummary = creators.find((creator) => creator.id === singleSourceCreator.id);
    if (multiSummary === undefined || singleSummary === undefined) {
      throw new Error("Expected both creators in the catalog creator list.");
    }
    // The summary keeps the fields the UI renders and carries sources derived
    // from both the creator's feeds (odysee) and its content items (youtube).
    expect(multiSummary).toMatchObject({ displayName: "Multi Source Creator", imageUrl: null, canonicalUrl: null });
    expect([...multiSummary.sourceTypes].sort()).toEqual(["odysee", "youtube"]);
    expect([...singleSummary.sourceTypes].sort()).toEqual(["peertube"]);
  });

  test("cross-source mirrors surface in list mirror counts and detail mirrors while null keys stay unlinked", async () => {
    const creator = await findOrCreateCreator(testDatabase.db, {
      displayName: "Mirror List Creator",
    });
    const youtubeCopy = await findOrCreateContentItem(testDatabase.db, {
      creatorId: creator.id,
      sourceType: "youtube",
      sourceExternalId: "mirror-list-youtube",
      title: "Mirror list video",
      publishedAt: new Date("2026-05-01T00:00:00.000Z"),
      crossSourceKey: "mirrorlistcreator:mirrorlistvideo",
    });
    const odyseeCopy = await findOrCreateContentItem(testDatabase.db, {
      creatorId: creator.id,
      sourceType: "odysee",
      sourceExternalId: "mirror-list-odysee",
      title: "Mirror list video",
      publishedAt: new Date("2026-05-02T00:00:00.000Z"),
      crossSourceKey: "mirrorlistcreator:mirrorlistvideo",
    });
    const peertubeCopy = await findOrCreateContentItem(testDatabase.db, {
      creatorId: creator.id,
      sourceType: "peertube",
      sourceExternalId: "mirror-list-peertube",
      title: "Mirror list video",
      publishedAt: new Date("2026-05-03T00:00:00.000Z"),
      crossSourceKey: "mirrorlistcreator:mirrorlistvideo",
    });
    // Same-source re-upload: identical creator + title + key, but mirrors must
    // only ever link ACROSS sources, so the two youtube rows never count each
    // other.
    const youtubeDuplicate = await findOrCreateContentItem(testDatabase.db, {
      creatorId: creator.id,
      sourceType: "youtube",
      sourceExternalId: "mirror-list-youtube-duplicate",
      title: "Mirror list video",
      publishedAt: new Date("2026-05-04T00:00:00.000Z"),
      crossSourceKey: "mirrorlistcreator:mirrorlistvideo",
    });
    const unkeyedItem = await findOrCreateContentItem(testDatabase.db, {
      creatorId: creator.id,
      sourceType: "youtube",
      sourceExternalId: "mirror-list-unkeyed",
      title: "Mirror list unkeyed video",
    });

    const rows = await listCatalogContentItems(testDatabase.db);
    const mirrorCountById = new Map(rows.map((row) => [row.id, row.mirrorCount]));
    // Each youtube row sees exactly its two cross-source siblings and NEVER
    // its same-source duplicate; the odysee/peertube rows see both youtube
    // rows (both are cross-source to them).
    expect(mirrorCountById.get(youtubeCopy.id)).toBe(2);
    expect(mirrorCountById.get(youtubeDuplicate.id)).toBe(2);
    expect(mirrorCountById.get(odyseeCopy.id)).toBe(3);
    expect(mirrorCountById.get(peertubeCopy.id)).toBe(3);
    expect(mirrorCountById.get(unkeyedItem.id)).toBe(0);

    const detail = await getCatalogContentDetail(testDatabase.db, youtubeCopy.id);
    if (detail === null) {
      throw new Error("Expected catalog content detail for the YouTube mirror copy.");
    }
    // Mirrors exclude the viewed item, its same-source duplicate, and order by
    // sourceType asc.
    expect(detail.mirrors.map((mirror) => mirror.id)).toEqual([odyseeCopy.id, peertubeCopy.id]);
    const odyseeMirror = detail.mirrors[0];
    if (odyseeMirror === undefined) {
      throw new Error("Expected the Odysee mirror to be listed first.");
    }
    // Each mirror is the full list-item shape the web select-content flow needs.
    expect(odyseeMirror).toMatchObject({
      id: odyseeCopy.id,
      sourceType: "odysee",
      title: "Mirror list video",
      mirrorCount: 3,
    });
    expect(odyseeMirror.creator).toMatchObject({ id: creator.id, displayName: "Mirror List Creator" });

    // The same-source duplicate gets the same cross-source mirrors and never
    // the original youtube row.
    const duplicateDetail = await getCatalogContentDetail(testDatabase.db, youtubeDuplicate.id);
    if (duplicateDetail === null) {
      throw new Error("Expected catalog content detail for the YouTube duplicate copy.");
    }
    expect(duplicateDetail.mirrors.map((mirror) => mirror.id)).toEqual([odyseeCopy.id, peertubeCopy.id]);

    const unkeyedDetail = await getCatalogContentDetail(testDatabase.db, unkeyedItem.id);
    if (unkeyedDetail === null) {
      throw new Error("Expected catalog content detail for the unkeyed item.");
    }
    expect(unkeyedDetail.mirrors).toEqual([]);
  });

  test("catalog and overlay list rows stay slim while detail keeps description and metadata", async () => {
    await insertUser(testDatabase.db, "user-a", "slim-projection-a@example.test");
    const creator = await findOrCreateCreator(testDatabase.db, {
      displayName: "Slim Projection Creator",
    });
    const contentItem = await findOrCreateContentItem(testDatabase.db, {
      creatorId: creator.id,
      sourceType: "youtube",
      sourceExternalId: "slim-projection-video",
      title: "Slim projection video",
      description: "Long catalog description",
      metadataJson: JSON.stringify({ kind: "meta" }),
      publishedAt: new Date("2026-06-01T00:00:00.000Z"),
    });
    await findOrCreateContentSource(testDatabase.db, {
      contentItemId: contentItem.id,
      sourceType: "youtube",
      sourceExternalId: "slim-projection-video",
      canonicalUrl: "https://www.youtube.com/watch?v=slim-projection-video",
      priority: 0,
    });
    await findOrCreateSubscription(testDatabase.db, { userId: "user-a", creatorId: creator.id });
    await findOrCreateContentStatus(testDatabase.db, {
      userId: "user-a",
      contentItemId: contentItem.id,
      status: "favorite",
    });
    const playlist = await createPlaylist(testDatabase.db, { userId: "user-a", name: "Slim queue" });
    const playlistItem = await addPlaylistItem(testDatabase.db, {
      userId: "user-a",
      playlistId: playlist.id,
      contentItemId: contentItem.id,
      position: 0,
    });
    if (playlistItem === null) {
      throw new Error("Expected the playlist item write to succeed.");
    }

    const catalogRows = await listCatalogContentItems(testDatabase.db);
    const subscribedRows = await listSubscribedContentItemsForUser(testDatabase.db, {
      userId: "user-a",
      limit: 10,
    });
    const favoriteRows = await listContentStatusWithContentForUser(testDatabase.db, {
      userId: "user-a",
      status: "favorite",
    });
    const playlistRows = await listPlaylistItemsWithContentForUserPlaylist(testDatabase.db, "user-a", playlist.id);

    const listRows = [
      ...catalogRows,
      ...subscribedRows,
      ...favoriteRows.map((row) => row.content),
      ...playlistRows.map((row) => row.content),
    ];
    expect(listRows.length).toBeGreaterThanOrEqual(4);
    // List projections never carry the heavyweight detail-only columns.
    for (const row of listRows) {
      expect("description" in row).toBe(false);
      expect("metadataJson" in row).toBe(false);
    }
    // They still carry the fields the list pages render.
    expect(catalogRows[0]).toMatchObject({ id: contentItem.id, title: "Slim projection video" });
    // Favorites and playlist views deliberately report no mirror linkage;
    // subscribed views keep the (real, here unkeyed-zero) mirror count field.
    expect(favoriteRows[0]?.content.mirrorCount).toBe(0);
    expect(playlistRows[0]?.content.mirrorCount).toBe(0);
    expect(subscribedRows[0]?.mirrorCount).toBe(0);

    const detail = await getCatalogContentDetail(testDatabase.db, contentItem.id);
    if (detail === null) {
      throw new Error("Expected catalog content detail for the slim projection item.");
    }
    expect(detail.description).toBe("Long catalog description");
    expect(detail.metadataJson).toBe(JSON.stringify({ kind: "meta" }));
    // Detail mirrors are list items too, so they stay slim as well.
    expect(
      detail.mirrors.every((mirror) => !("description" in mirror) && !("metadataJson" in mirror)),
    ).toBe(true);
  });

  test("playback position upsert creates the opened row when absent without duplicating rows", async () => {
    await insertUser(testDatabase.db, "user-a", "playback-create-a@example.test");
    const creator = await findOrCreateCreator(testDatabase.db, {
      displayName: "Playback Create Creator",
    });
    const contentItem = await findOrCreateContentItem(testDatabase.db, {
      creatorId: creator.id,
      sourceType: "youtube",
      sourceExternalId: "playback-create-video",
      title: "Playback create video",
    });

    const status = await upsertPlaybackPositionForUser(testDatabase.db, {
      userId: "user-a",
      contentItemId: contentItem.id,
      positionSeconds: 300,
      durationSeconds: 1_500,
    });
    const replayedStatus = await upsertPlaybackPositionForUser(testDatabase.db, {
      userId: "user-a",
      contentItemId: contentItem.id,
      positionSeconds: 300,
      durationSeconds: 1_500,
    });
    const statuses = await listContentStatusesForUser(testDatabase.db, "user-a");

    expect(status.status).toBe("opened");
    expect(replayedStatus.id).toBe(status.id);
    expect(statuses).toHaveLength(1);
    expect(statuses[0]).toMatchObject({ userId: "user-a", status: "opened" });
    const storedMetadata: unknown = JSON.parse(requireMetadataJson(statuses[0]?.metadataJson));
    expect(storedMetadata).toMatchObject({
      playback: { positionSeconds: 300, durationSeconds: 1_500 },
    });
    const playback = readPlaybackMetadata(storedMetadata);
    expect(new Date(playback.updatedAt).toISOString()).toBe(playback.updatedAt);
  });

  test("playback position upsert preserves unrelated metadata keys on the opened row", async () => {
    await insertUser(testDatabase.db, "user-a", "playback-preserve-a@example.test");
    const creator = await findOrCreateCreator(testDatabase.db, {
      displayName: "Playback Preserve Creator",
    });
    const contentItem = await findOrCreateContentItem(testDatabase.db, {
      creatorId: creator.id,
      sourceType: "odysee",
      sourceExternalId: "playback-preserve-video",
      title: "Playback preserve video",
    });
    await findOrCreateContentStatus(testDatabase.db, {
      userId: "user-a",
      contentItemId: contentItem.id,
      status: "opened",
      metadataJson: JSON.stringify({ lastSurface: "viewer", sourceImport: "strapi" }),
    });

    const status = await upsertPlaybackPositionForUser(testDatabase.db, {
      userId: "user-a",
      contentItemId: contentItem.id,
      positionSeconds: 42,
    });

    const storedMetadata: unknown = JSON.parse(requireMetadataJson(status.metadataJson));
    expect(storedMetadata).toMatchObject({
      lastSurface: "viewer",
      sourceImport: "strapi",
      playback: { positionSeconds: 42, durationSeconds: null },
    });
  });

  test("repeated playback position saves merge with last write winning", async () => {
    await insertUser(testDatabase.db, "user-a", "playback-merge-a@example.test");
    const creator = await findOrCreateCreator(testDatabase.db, {
      displayName: "Playback Merge Creator",
    });
    const contentItem = await findOrCreateContentItem(testDatabase.db, {
      creatorId: creator.id,
      sourceType: "peertube",
      sourceExternalId: "playback-merge-video",
      title: "Playback merge video",
    });

    const firstSave = await upsertPlaybackPositionForUser(testDatabase.db, {
      userId: "user-a",
      contentItemId: contentItem.id,
      positionSeconds: 100,
      durationSeconds: 600,
    });
    const secondSave = await upsertPlaybackPositionForUser(testDatabase.db, {
      userId: "user-a",
      contentItemId: contentItem.id,
      positionSeconds: 250,
      durationSeconds: null,
    });
    const statuses = await listContentStatusesForUser(testDatabase.db, "user-a");

    expect(secondSave.id).toBe(firstSave.id);
    expect(statuses).toHaveLength(1);
    const storedMetadata: unknown = JSON.parse(requireMetadataJson(statuses[0]?.metadataJson));
    expect(storedMetadata).toMatchObject({
      playback: { positionSeconds: 250, durationSeconds: null },
    });
  });

  test("malformed existing metadataJson does not crash the playback position upsert", async () => {
    await insertUser(testDatabase.db, "user-a", "playback-malformed-a@example.test");
    const creator = await findOrCreateCreator(testDatabase.db, {
      displayName: "Playback Malformed Creator",
    });
    const contentItem = await findOrCreateContentItem(testDatabase.db, {
      creatorId: creator.id,
      sourceType: "youtube",
      sourceExternalId: "playback-malformed-video",
      title: "Playback malformed video",
    });
    const seeded = await findOrCreateContentStatus(testDatabase.db, {
      userId: "user-a",
      contentItemId: contentItem.id,
      status: "opened",
      metadataJson: "{definitely-not-json",
    });
    await testDatabase.db
      .update(schema.contentStatus)
      .set({ metadataJson: "{definitely-not-json" })
      .where(eq(schema.contentStatus.id, seeded.id));

    const status = await upsertPlaybackPositionForUser(testDatabase.db, {
      userId: "user-a",
      contentItemId: contentItem.id,
      positionSeconds: 15,
      durationSeconds: 90,
    });

    const storedMetadata: unknown = JSON.parse(requireMetadataJson(status.metadataJson));
    expect(storedMetadata).toMatchObject({
      playback: { positionSeconds: 15, durationSeconds: 90 },
    });
  });

  test("playback position upsert rejects invalid position and duration values", async () => {
    await insertUser(testDatabase.db, "user-a", "playback-invalid-a@example.test");
    const creator = await findOrCreateCreator(testDatabase.db, {
      displayName: "Playback Invalid Creator",
    });
    const contentItem = await findOrCreateContentItem(testDatabase.db, {
      creatorId: creator.id,
      sourceType: "youtube",
      sourceExternalId: "playback-invalid-video",
      title: "Playback invalid video",
    });

    await expect(
      upsertPlaybackPositionForUser(testDatabase.db, {
        userId: "user-a",
        contentItemId: contentItem.id,
        positionSeconds: -1,
      }),
    ).rejects.toThrow("Playback position must be an integer >= 0");
    await expect(
      upsertPlaybackPositionForUser(testDatabase.db, {
        userId: "user-a",
        contentItemId: contentItem.id,
        positionSeconds: 1.5,
      }),
    ).rejects.toThrow("Playback position must be an integer >= 0");
    await expect(
      upsertPlaybackPositionForUser(testDatabase.db, {
        userId: "user-a",
        contentItemId: contentItem.id,
        positionSeconds: 0,
        durationSeconds: -10,
      }),
    ).rejects.toThrow("Playback duration must be null or an integer >= 0");
    const statuses = await listContentStatusesForUser(testDatabase.db, "user-a");
    expect(statuses).toHaveLength(0);
  });

  test("unread counts default the threshold to the subscription created_at and carry creator freshness", async () => {
    await insertUser(testDatabase.db, "user-a", "unread-default-a@example.test");
    await insertUser(testDatabase.db, "user-b", "unread-default-b@example.test");
    const creator = await findOrCreateCreator(testDatabase.db, {
      displayName: "Unread Default Creator",
    });
    await advanceCreatorLastContentPublishedAt(testDatabase.db, {
      creatorId: creator.id,
      publishedAt: new Date("2026-01-05T00:00:00.000Z"),
    });
    await findOrCreateContentItem(testDatabase.db, {
      creatorId: creator.id,
      sourceType: "youtube",
      sourceExternalId: "unread-default-old",
      title: "Unread default old video",
      publishedAt: new Date("2026-01-02T00:00:00.000Z"),
    });
    await findOrCreateContentItem(testDatabase.db, {
      creatorId: creator.id,
      sourceType: "youtube",
      sourceExternalId: "unread-default-new",
      title: "Unread default new video",
      publishedAt: new Date("2026-01-05T00:00:00.000Z"),
    });
    await insertSubscriptionFixture(testDatabase.db, {
      id: "sub-unread-default-a",
      userId: "user-a",
      creatorId: creator.id,
      createdAt: new Date("2026-01-03T00:00:00.000Z"),
    });

    const summaries = await listCreatorUnreadForUser(testDatabase.db, "user-a");
    const userBSummaries = await listCreatorUnreadForUser(testDatabase.db, "user-b");

    expect(summaries).toEqual([
      {
        creatorId: creator.id,
        unreadCount: 1,
        lastContentPublishedAt: new Date("2026-01-05T00:00:00.000Z"),
      },
    ]);
    // A user without subscriptions has no unread summaries at all.
    expect(userBSummaries).toEqual([]);
  });

  test("unread counts respect an explicit threshold setting over the subscription default", async () => {
    await insertUser(testDatabase.db, "user-a", "unread-threshold-a@example.test");
    const creator = await findOrCreateCreator(testDatabase.db, {
      displayName: "Unread Threshold Creator",
    });
    await findOrCreateContentItem(testDatabase.db, {
      creatorId: creator.id,
      sourceType: "odysee",
      sourceExternalId: "unread-threshold-mid",
      title: "Unread threshold mid video",
      publishedAt: new Date("2026-01-02T00:00:00.000Z"),
    });
    await findOrCreateContentItem(testDatabase.db, {
      creatorId: creator.id,
      sourceType: "odysee",
      sourceExternalId: "unread-threshold-new",
      title: "Unread threshold new video",
      publishedAt: new Date("2026-01-05T00:00:00.000Z"),
    });
    await insertSubscriptionFixture(testDatabase.db, {
      id: "sub-unread-threshold-a",
      userId: "user-a",
      creatorId: creator.id,
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
    });
    await saveUserSetting(testDatabase.db, {
      userId: "user-a",
      key: `unread.threshold.${creator.id}`,
      valueJson: JSON.stringify(Date.parse("2026-01-04T00:00:00.000Z")),
    });

    const summaries = await listCreatorUnreadForUser(testDatabase.db, "user-a");

    // The 2026-01-02 item is newer than the subscription but older than the
    // explicit threshold, so only the 2026-01-05 item stays unread.
    expect(summaries).toHaveLength(1);
    expect(summaries[0]).toMatchObject({ creatorId: creator.id, unreadCount: 1 });
  });

  test("malformed or non-numeric threshold settings are tolerated and fall back to the subscription default", async () => {
    await insertUser(testDatabase.db, "user-a", "unread-malformed-a@example.test");
    const creator = await findOrCreateCreator(testDatabase.db, {
      displayName: "Unread Malformed Creator",
    });
    await findOrCreateContentItem(testDatabase.db, {
      creatorId: creator.id,
      sourceType: "peertube",
      sourceExternalId: "unread-malformed-old",
      title: "Unread malformed old video",
      publishedAt: new Date("2026-01-02T00:00:00.000Z"),
    });
    await findOrCreateContentItem(testDatabase.db, {
      creatorId: creator.id,
      sourceType: "peertube",
      sourceExternalId: "unread-malformed-new",
      title: "Unread malformed new video",
      publishedAt: new Date("2026-01-05T00:00:00.000Z"),
    });
    await insertSubscriptionFixture(testDatabase.db, {
      id: "sub-unread-malformed-a",
      userId: "user-a",
      creatorId: creator.id,
      createdAt: new Date("2026-01-03T00:00:00.000Z"),
    });

    const thresholdKey = `unread.threshold.${creator.id}`;
    for (const malformedValueJson of ["{definitely-not-json", JSON.stringify("oops"), JSON.stringify({ epochMs: 5 })]) {
      await saveUserSetting(testDatabase.db, { userId: "user-a", key: thresholdKey, valueJson: malformedValueJson });

      const summaries = await listCreatorUnreadForUser(testDatabase.db, "user-a");

      expect(summaries).toHaveLength(1);
      expect(summaries[0]).toMatchObject({ creatorId: creator.id, unreadCount: 1 });
    }
  });

  test("opened and played rows are excluded from unread counts while favorite-only rows still count", async () => {
    await insertUser(testDatabase.db, "user-a", "unread-excluded-a@example.test");
    const creator = await findOrCreateCreator(testDatabase.db, {
      displayName: "Unread Excluded Creator",
    });
    const statusKinds = ["opened", "played", "favorite", "none"] as const;
    const itemsByKind = new Map<string, Awaited<ReturnType<typeof findOrCreateContentItem>>>();
    for (const [index, statusKind] of statusKinds.entries()) {
      itemsByKind.set(
        statusKind,
        await findOrCreateContentItem(testDatabase.db, {
          creatorId: creator.id,
          sourceType: "youtube",
          sourceExternalId: `unread-excluded-${statusKind}`,
          title: `Unread excluded ${statusKind} video`,
          publishedAt: new Date(Date.parse("2026-01-05T00:00:00.000Z") + index * 1_000),
        }),
      );
    }
    await insertSubscriptionFixture(testDatabase.db, {
      id: "sub-unread-excluded-a",
      userId: "user-a",
      creatorId: creator.id,
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
    });
    for (const statusKind of ["opened", "played", "favorite"] as const) {
      await findOrCreateContentStatus(testDatabase.db, {
        userId: "user-a",
        contentItemId: itemsByKind.get(statusKind)?.id ?? "",
        status: statusKind,
      });
    }

    const summaries = await listCreatorUnreadForUser(testDatabase.db, "user-a");

    // opened and played are read; favorite alone does not mark an item read.
    expect(summaries).toHaveLength(1);
    expect(summaries[0]).toMatchObject({ creatorId: creator.id, unreadCount: 2 });
  });

  test("marking creator content opened is idempotent, writes only opened rows, and advances the threshold", async () => {
    await insertUser(testDatabase.db, "user-a", "unread-mark-a@example.test");
    const creator = await findOrCreateCreator(testDatabase.db, {
      displayName: "Unread Mark Creator",
    });
    for (let index = 0; index < 3; index += 1) {
      await findOrCreateContentItem(testDatabase.db, {
        creatorId: creator.id,
        sourceType: "youtube",
        sourceExternalId: `unread-mark-video-${index}`,
        title: `Unread mark video ${index}`,
        publishedAt: new Date(Date.parse("2026-01-05T00:00:00.000Z") + index * 1_000),
      });
    }
    await insertSubscriptionFixture(testDatabase.db, {
      id: "sub-unread-mark-a",
      userId: "user-a",
      creatorId: creator.id,
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
    });
    const markedBeforeMs = Date.parse("2026-01-10T00:00:00.000Z");

    const firstMark = await markCreatorContentOpenedForUser(testDatabase.db, {
      userId: "user-a",
      creatorId: creator.id,
      markedBeforeMs,
    });
    const markedSummaries = await listCreatorUnreadForUser(testDatabase.db, "user-a");
    const secondMark = await markCreatorContentOpenedForUser(testDatabase.db, {
      userId: "user-a",
      creatorId: creator.id,
      markedBeforeMs,
    });
    const statuses = await listContentStatusesForUser(testDatabase.db, "user-a");
    const settings = await listUserSettingsForUser(testDatabase.db, "user-a");
    const unsubscribedMark = await markCreatorContentOpenedForUser(testDatabase.db, {
      userId: "user-a",
      creatorId: "not-subscribed-creator",
      markedBeforeMs,
    });

    expect(firstMark).toEqual({ markedCount: 3 });
    expect(markedSummaries).toEqual([]);
    expect(secondMark).toEqual({ markedCount: 0 });
    expect(statuses).toHaveLength(3);
    expect(statuses.every((status) => status.status === "opened")).toBe(true);
    expect(settings).toHaveLength(1);
    expect(settings[0]).toMatchObject({
      userId: "user-a",
      key: `unread.threshold.${creator.id}`,
      valueJson: JSON.stringify(markedBeforeMs),
    });
    expect(unsubscribedMark).toEqual({ markedCount: 0 });
  });

  test("marking creator content opened honors the 1000-item batch limit and the threshold covers the tail", async () => {
    await insertUser(testDatabase.db, "user-a", "unread-cap-a@example.test");
    const creator = await findOrCreateCreator(testDatabase.db, {
      displayName: "Unread Cap Creator",
    });
    const capBaseMs = Date.parse("2026-02-01T00:00:00.000Z");
    await testDatabase.db.insert(schema.contentItem).values(
      Array.from({ length: 1001 }, (_, index) => ({
        id: `cap-item-${String(index).padStart(4, "0")}`,
        creatorId: creator.id,
        sourceType: "youtube" as const,
        sourceExternalId: `cap-video-${index}`,
        title: `Cap video ${index}`,
        publishedAt: new Date(capBaseMs + index * 1_000),
      })),
    );
    await insertSubscriptionFixture(testDatabase.db, {
      id: "sub-unread-cap-a",
      userId: "user-a",
      creatorId: creator.id,
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
    });

    const beforeSummaries = await listCreatorUnreadForUser(testDatabase.db, "user-a");
    const mark = await markCreatorContentOpenedForUser(testDatabase.db, {
      userId: "user-a",
      creatorId: creator.id,
      markedBeforeMs: capBaseMs + 10_000_000,
    });
    const afterSummaries = await listCreatorUnreadForUser(testDatabase.db, "user-a");
    const statuses = await listContentStatusesForUser(testDatabase.db, "user-a");

    expect(beforeSummaries).toHaveLength(1);
    expect(beforeSummaries[0]).toMatchObject({ creatorId: creator.id, unreadCount: 1001 });
    expect(mark).toEqual({ markedCount: 1000 });
    // The 1001st item never gets an opened row, but the threshold write marks
    // everything at or before markedBeforeMs as read, so no residual badge.
    expect(afterSummaries).toEqual([]);
    expect(statuses).toHaveLength(1000);
    expect(statuses.every((status) => status.status === "opened")).toBe(true);
  });

  test("marking all creators aggregates per-creator counts and stays scoped to the marking user", async () => {
    await insertUser(testDatabase.db, "user-a", "unread-markall-a@example.test");
    await insertUser(testDatabase.db, "user-b", "unread-markall-b@example.test");
    const creatorX = await findOrCreateCreator(testDatabase.db, {
      displayName: "Unread MarkAll X",
    });
    const creatorY = await findOrCreateCreator(testDatabase.db, {
      displayName: "Unread MarkAll Y",
    });
    const xItemIds: string[] = [];
    for (let index = 0; index < 2; index += 1) {
      const item = await findOrCreateContentItem(testDatabase.db, {
        creatorId: creatorX.id,
        sourceType: "odysee",
        sourceExternalId: `unread-markall-x-${index}`,
        title: `Unread markall X ${index}`,
        publishedAt: new Date(Date.parse("2026-01-05T00:00:00.000Z") + index * 1_000),
      });
      xItemIds.push(item.id);
    }
    await findOrCreateContentItem(testDatabase.db, {
      creatorId: creatorY.id,
      sourceType: "odysee",
      sourceExternalId: "unread-markall-y-0",
      title: "Unread markall Y 0",
      publishedAt: new Date("2026-01-06T00:00:00.000Z"),
    });
    await insertSubscriptionFixture(testDatabase.db, {
      id: "sub-unread-markall-a-x",
      userId: "user-a",
      creatorId: creatorX.id,
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
    });
    await insertSubscriptionFixture(testDatabase.db, {
      id: "sub-unread-markall-a-y",
      userId: "user-a",
      creatorId: creatorY.id,
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
    });
    await insertSubscriptionFixture(testDatabase.db, {
      id: "sub-unread-markall-b-x",
      userId: "user-b",
      creatorId: creatorX.id,
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
    });
    const markedBeforeMs = Date.parse("2026-01-10T00:00:00.000Z");

    const userAMarkAll = await markAllCreatorsContentOpenedForUser(testDatabase.db, {
      userId: "user-a",
      markedBeforeMs,
    });
    const userASummaries = await listCreatorUnreadForUser(testDatabase.db, "user-a");
    const userBSummaries = await listCreatorUnreadForUser(testDatabase.db, "user-b");
    const userBStatuses = await listContentStatusesForUser(testDatabase.db, "user-b");
    const userBMarkAll = await markAllCreatorsContentOpenedForUser(testDatabase.db, {
      userId: "user-b",
      markedBeforeMs,
    });
    const userBStatusesAfterOwnMarkAll = await listContentStatusesForUser(testDatabase.db, "user-b");

    expect(userAMarkAll).toEqual({ markedCount: 3 });
    expect(userASummaries).toEqual([]);
    // User B subscribed to creator X only, and user A's mark-all must not
    // touch B's overlay rows: B still sees both X items unread.
    expect(requireUnreadSummary(userBSummaries, creatorX.id).unreadCount).toBe(2);
    expect(userBSummaries.map((summary) => summary.creatorId)).not.toContain(creatorY.id);
    expect(userBStatuses).toEqual([]);
    expect(userBMarkAll).toEqual({ markedCount: 2 });
    expect(userBStatusesAfterOwnMarkAll.map((status) => status.contentItemId).sort()).toEqual([...xItemIds].sort());
    expect(
      userBStatusesAfterOwnMarkAll.every((status) => status.userId === "user-b" && status.status === "opened"),
    ).toBe(true);
  });

  test("unread summaries order deterministically by unread count then display name then id", async () => {
    await insertUser(testDatabase.db, "user-a", "unread-order-a@example.test");
    const busyCreator = await findOrCreateCreator(testDatabase.db, {
      displayName: "Beta Creator",
    });
    const alphaCreatorOne = await findOrCreateCreator(testDatabase.db, {
      displayName: "Alpha Creator",
    });
    // findOrCreateCreator dedupes by display name, so the display-name tie is
    // seeded with a direct fixture row instead.
    const alphaCreatorTwo = { id: "creator-unread-order-alpha-two" };
    await testDatabase.db.insert(schema.creator).values({
      id: alphaCreatorTwo.id,
      nameKey: "alphacreatoruntied",
      displayName: "Alpha Creator",
    });
    const seedItems = [
      { creator: busyCreator, count: 2, externalIdPrefix: "unread-order-busy" },
      { creator: alphaCreatorOne, count: 1, externalIdPrefix: "unread-order-alpha-one" },
      { creator: alphaCreatorTwo, count: 1, externalIdPrefix: "unread-order-alpha-two" },
    ] as const;
    for (const seed of seedItems) {
      for (let index = 0; index < seed.count; index += 1) {
        await findOrCreateContentItem(testDatabase.db, {
          creatorId: seed.creator.id,
          sourceType: "youtube",
          sourceExternalId: `${seed.externalIdPrefix}-${index}`,
          title: `${seed.externalIdPrefix} ${index}`,
          publishedAt: new Date("2026-01-05T00:00:00.000Z"),
        });
      }
      await insertSubscriptionFixture(testDatabase.db, {
        id: `sub-unread-order-${seed.externalIdPrefix}`,
        userId: "user-a",
        creatorId: seed.creator.id,
        createdAt: new Date("2026-01-01T00:00:00.000Z"),
      });
    }

    const summaries = await listCreatorUnreadForUser(testDatabase.db, "user-a");

    // count desc, then display name asc, then creator id asc breaks the
    // display-name tie deterministically.
    expect(summaries.map((summary) => summary.creatorId)).toEqual([
      busyCreator.id,
      ...[alphaCreatorOne.id, alphaCreatorTwo.id].sort(),
    ]);
    expect(summaries.map((summary) => summary.unreadCount)).toEqual([2, 1, 1]);
  });
});

function requireMetadataJson(metadataJson: string | null | undefined): string {
  if (metadataJson === null || metadataJson === undefined) {
    throw new Error("Expected playback metadata to be persisted on the opened row.");
  }
  return metadataJson;
}

/**
 * Seed one feed refresh attempt through the real repository writes, wrapped in
 * its own refresh run (refresh_feed_result is unique per (run, feed)).
 */
async function seedFeedHealthResult(
  db: RepositoryDb,
  input: {
    readonly feedId: string;
    readonly status: "succeeded" | "failed";
    readonly startedAt: Date;
    readonly completedAt?: Date;
    readonly itemsCreatedCount?: number;
    readonly errorSummaryJson?: string;
  },
): Promise<void> {
  const run = await createRefreshRun(db, { scope: "all", status: "succeeded", startedAt: input.startedAt });
  await recordRefreshFeedResult(db, {
    refreshRunId: run.id,
    feedId: input.feedId,
    status: input.status,
    itemsCreatedCount: input.itemsCreatedCount ?? 0,
    startedAt: input.startedAt,
    completedAt: input.completedAt ?? null,
    errorSummaryJson: input.errorSummaryJson ?? null,
  });
}

async function setFeedNextRefreshAfter(db: RepositoryDb, feedId: string, nextRefreshAfter: Date): Promise<void> {
  await db.update(schema.feed).set({ nextRefreshAfter }).where(eq(schema.feed.id, feedId));
}

function requireFeedHealthEntry(
  entries: readonly FeedHealthEntry[],
  feedId: string,
): FeedHealthEntry {
  const entry = entries.find((candidate) => candidate.feedId === feedId);
  if (entry === undefined) {
    throw new Error(`Expected a feed health entry for feed ${feedId}.`);
  }
  return entry;
}

function readPlaybackMetadata(metadata: unknown): { updatedAt: string } {
  if (!isJsonObjectFixture(metadata) || !isJsonObjectFixture(metadata.playback)) {
    throw new Error("Expected a playback metadata object on the opened row.");
  }
  const { updatedAt } = metadata.playback;
  if (typeof updatedAt !== "string") {
    throw new Error("Expected the playback updatedAt field to be a UTC ISO string.");
  }
  return { updatedAt };
}

function isJsonObjectFixture(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function insertUser(db: RepositoryDb, id: string, email: string): Promise<void> {
  await db.insert(schema.user).values({
    id,
    name: id,
    email,
    emailVerified: true,
  });
}

/**
 * Subscription fixture with an explicit created_at: the default unread
 * threshold is the subscription's created_at, so unread tests pin it to a
 * fixed instant instead of the wall clock.
 */
async function insertSubscriptionFixture(
  db: RepositoryDb,
  input: { readonly id: string; readonly userId: string; readonly creatorId: string; readonly createdAt: Date },
): Promise<void> {
  await db.insert(schema.subscription).values({
    id: input.id,
    userId: input.userId,
    creatorId: input.creatorId,
    createdAt: input.createdAt,
    updatedAt: input.createdAt,
  });
}

function requireUnreadSummary(
  summaries: readonly CreatorUnreadSummary[],
  creatorId: string,
): CreatorUnreadSummary {
  const summary = summaries.find((candidate) => candidate.creatorId === creatorId);
  if (summary === undefined) {
    throw new Error(`Expected an unread summary for creator ${creatorId}.`);
  }
  return summary;
}

async function readContentItemRow(contentItemId: string) {
  return testDatabase.db.query.contentItem.findFirst({
    where: eq(schema.contentItem.id, contentItemId),
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
  `CREATE TABLE playlist (
    id TEXT PRIMARY KEY NOT NULL,
    user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    description TEXT,
    sort_mode TEXT NOT NULL DEFAULT 'manual',
    position INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)),
    updated_at INTEGER NOT NULL DEFAULT (cast(unixepoch('subsecond') * 1000 as integer))
  )`,
  "CREATE UNIQUE INDEX playlist_id_user_uidx ON playlist (id, user_id)",
  `CREATE TABLE playlist_item (
    id TEXT PRIMARY KEY NOT NULL,
    user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
    playlist_id TEXT NOT NULL REFERENCES playlist(id) ON DELETE CASCADE,
    content_item_id TEXT NOT NULL REFERENCES content_item(id) ON DELETE CASCADE,
    position INTEGER NOT NULL,
    added_at INTEGER NOT NULL DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)),
    CONSTRAINT playlist_item_playlist_owner_fk FOREIGN KEY (playlist_id, user_id) REFERENCES playlist(id, user_id) ON DELETE CASCADE
  )`,
  "CREATE UNIQUE INDEX playlist_item_playlist_position_uidx ON playlist_item (playlist_id, position)",
  "CREATE UNIQUE INDEX playlist_item_playlist_content_uidx ON playlist_item (playlist_id, content_item_id)",
  `CREATE TABLE user_setting (
    id TEXT PRIMARY KEY NOT NULL,
    user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
    key TEXT NOT NULL,
    value_json TEXT NOT NULL,
    created_at INTEGER NOT NULL DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)),
    updated_at INTEGER NOT NULL DEFAULT (cast(unixepoch('subsecond') * 1000 as integer))
  )`,
  "CREATE UNIQUE INDEX user_setting_user_key_uidx ON user_setting (user_id, key)",
  `CREATE TABLE migration_run (
    id TEXT PRIMARY KEY NOT NULL,
    source_export_fingerprint TEXT NOT NULL,
    source_filename TEXT,
    status TEXT NOT NULL,
    started_at INTEGER NOT NULL DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)),
    completed_at INTEGER,
    users_imported_count INTEGER NOT NULL DEFAULT 0,
    creators_imported_count INTEGER NOT NULL DEFAULT 0,
    feeds_imported_count INTEGER NOT NULL DEFAULT 0,
    content_items_imported_count INTEGER NOT NULL DEFAULT 0,
    subscriptions_imported_count INTEGER NOT NULL DEFAULT 0,
    playlists_imported_count INTEGER NOT NULL DEFAULT 0,
    warnings_json TEXT,
    failures_json TEXT
  )`,
  "CREATE UNIQUE INDEX migration_run_source_fingerprint_uidx ON migration_run (source_export_fingerprint)",
  `CREATE TABLE migration_mapping (
    id TEXT PRIMARY KEY NOT NULL,
    migration_run_id TEXT NOT NULL REFERENCES migration_run(id) ON DELETE CASCADE,
    old_entity_type TEXT NOT NULL,
    old_entity_id TEXT NOT NULL,
    new_entity_type TEXT NOT NULL,
    new_entity_id TEXT NOT NULL,
    severity TEXT NOT NULL DEFAULT 'info',
    message TEXT,
    metadata_json TEXT,
    created_at INTEGER NOT NULL DEFAULT (cast(unixepoch('subsecond') * 1000 as integer))
  )`,
  "CREATE UNIQUE INDEX migration_mapping_run_old_entity_uidx ON migration_mapping (migration_run_id, old_entity_type, old_entity_id)",
  "CREATE UNIQUE INDEX migration_mapping_run_new_entity_uidx ON migration_mapping (migration_run_id, new_entity_type, new_entity_id)",
];
