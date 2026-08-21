import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { createClient } from "@libsql/client";
import type { Client } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";

import * as schema from "@FeedElity/db/schema";

import {
  createRefreshRun,
  findOrCreateContentItem,
  findOrCreateContentSource,
  findCreatorByNameKey,
  findOrCreateCreator,
  findOrCreateFeed,
  linkFeedContent,
  listCatalogContentItems,
  listCatalogCreators,
  listCatalogFeedsForBrowsing,
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
  listMigrationMappingsForRun,
  listMigrationRuns,
  listPlaylistItemsForUserPlaylist,
  listPlaylistsForUser,
  listSubscriptionsForUser,
  listUserSettingsForUser,
  recordMigrationMapping,
  reorderPlaylistItemsForUser,
  saveUserSetting,
} from "./overlays";

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
});

async function insertUser(db: RepositoryDb, id: string, email: string): Promise<void> {
  await db.insert(schema.user).values({
    id,
    name: id,
    email,
    emailVerified: true,
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
