import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { createClient } from "@libsql/client";
import type { Client } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";

import * as schema from "@FeedElity/db/schema";

import { getCatalogContentDetail, listCatalogContentItems, listCatalogCreators, listCatalogFeeds, type RepositoryDb } from "../repositories/catalog";
import { findOrCreateMigrationRun, listMigrationMappingsForRun, recordMigrationMapping } from "../repositories/overlays";
import { importStrapiCatalog, type CatalogImportReportedRecord } from "./catalog-import";
import { validStrapiExportFixture } from "./strapi-export.fixtures";
import type { StrapiExport } from "./strapi-export";

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

describe("Strapi catalog import mapper", () => {
  test("imports validated Strapi catalog records into global catalog tables", async () => {
    const migrationRun = await findOrCreateMigrationRun(testDatabase.db, {
      sourceExportFingerprint: "catalog-import-success",
      status: "running",
    });

    const result = await importStrapiCatalog(testDatabase.db, {
      migrationRunId: migrationRun.id,
      exportData: validStrapiExportFixture,
    });

    const contentItems = await listCatalogContentItems(testDatabase.db);
    const feeds = await listCatalogFeeds(testDatabase.db);
    const mappings = await listMigrationMappingsForRun(testDatabase.db, migrationRun.id);

    expect(result.reportedRecords).toEqual([]);
    expect(result.counts).toMatchObject({ creators: 1, feeds: 1, contentItems: 1, contentSources: 1, feedContentLinks: 1 });
    expect(feeds).toHaveLength(1);
    expect(feeds[0]).toMatchObject({
      sourceType: "youtube",
      sourceExternalId: "UCfixture0000000000",
      title: "Fixture YouTube Feed",
      refreshCadenceSeconds: 7200,
    });
    expect(contentItems).toHaveLength(1);
    expect(contentItems[0]).toMatchObject({
      sourceType: "youtube",
      sourceExternalId: "yt-fixture-video-1",
      title: "Fixture Video",
      description: "Fixture description body.",
    });
    expect(mappings.map((mapping) => `${mapping.oldEntityType}:${mapping.oldEntityId}`).sort()).toEqual([
      "strapi-content-option:41",
      "strapi-content-option:42",
      "strapi-content-option:43",
      "strapi-creator-content:40",
      "strapi-creator-option:11",
      "strapi-creator:10",
      "strapi-feed-content:30",
      "strapi-feed-option:21",
      "strapi-feed:20",
    ]);
  });

  test("preserves thumbnail, duration, and YouTube playback source options", async () => {
    const migrationRun = await findOrCreateMigrationRun(testDatabase.db, {
      sourceExportFingerprint: "catalog-import-options",
      status: "running",
    });

    const result = await importStrapiCatalog(testDatabase.db, {
      migrationRunId: migrationRun.id,
      exportData: validStrapiExportFixture,
    });
    const importedContent = await listCatalogContentItems(testDatabase.db);
    const firstContent = importedContent[0];
    if (firstContent === undefined) {
      throw new Error("Expected fixture content to be imported.");
    }
    const detail = await getCatalogContentDetail(testDatabase.db, firstContent.id);

    expect(result.reportedRecords).toEqual([]);
    expect(detail).not.toBeNull();
    if (detail === null) {
      throw new Error("Expected imported content detail to be readable.");
    }
    expect(detail.thumbnailUrl).toBe("https://i.ytimg.com/vi/yt-fixture-video-1/hqdefault.jpg");
    expect(detail.durationSeconds).toBe(321);
    expect(detail.sources).toHaveLength(1);
    expect(detail.sources[0]).toMatchObject({
      sourceType: "youtube",
      sourceExternalId: "yt-fixture-video-1",
      embedUrl: "https://www.youtube-nocookie.com/embed/yt-fixture-video-1",
      nativeMediaUrl: null,
      canonicalUrl: "https://www.youtube.com/watch?v=yt-fixture-video-1",
    });
    const mappings = await listMigrationMappingsForRun(testDatabase.db, migrationRun.id);
    expect(
      mappings
        .filter((mapping) => mapping.oldEntityType === "strapi-content-option")
        .map((mapping) => ({
          oldEntityId: mapping.oldEntityId,
          newEntityType: mapping.newEntityType,
        }))
        .sort((left, right) => left.oldEntityId.localeCompare(right.oldEntityId)),
    ).toEqual([
      { oldEntityId: "41", newEntityType: "content-item-thumbnail" },
      { oldEntityId: "42", newEntityType: "content-source" },
      { oldEntityId: "43", newEntityType: "content-item-duration" },
    ]);
  });

  test("records migration mappings for creator image and feed refresh cadence options", async () => {
    const migrationRun = await findOrCreateMigrationRun(testDatabase.db, {
      sourceExportFingerprint: "catalog-import-creator-feed-option-mappings",
      status: "running",
    });

    const result = await importStrapiCatalog(testDatabase.db, {
      migrationRunId: migrationRun.id,
      exportData: validStrapiExportFixture,
    });
    const mappings = await listMigrationMappingsForRun(testDatabase.db, migrationRun.id);

    expect(result.reportedRecords).toEqual([]);
    expect(
      mappings
        .filter((mapping) => mapping.oldEntityType === "strapi-creator-option" || mapping.oldEntityType === "strapi-feed-option")
        .map((mapping) => ({
          oldEntityType: mapping.oldEntityType,
          oldEntityId: mapping.oldEntityId,
          newEntityType: mapping.newEntityType,
        }))
        .sort((left, right) => left.oldEntityType.localeCompare(right.oldEntityType)),
    ).toEqual([
      { oldEntityType: "strapi-creator-option", oldEntityId: "11", newEntityType: "creator-image" },
      { oldEntityType: "strapi-feed-option", oldEntityId: "21", newEntityType: "feed-refresh-cadence" },
    ]);
  });

  test("repeated catalog import for the same migration run reuses existing records and mappings", async () => {
    const migrationRun = await findOrCreateMigrationRun(testDatabase.db, {
      sourceExportFingerprint: "catalog-import-idempotent",
      status: "running",
    });
    const input = { migrationRunId: migrationRun.id, exportData: validStrapiExportFixture };

    const firstResult = await importStrapiCatalog(testDatabase.db, input);
    const secondResult = await importStrapiCatalog(testDatabase.db, input);

    const contentItems = await listCatalogContentItems(testDatabase.db);
    const feeds = await listCatalogFeeds(testDatabase.db);
    const mappings = await listMigrationMappingsForRun(testDatabase.db, migrationRun.id);

    expect(secondResult.counts).toEqual(firstResult.counts);
    expect(contentItems).toHaveLength(1);
    expect(feeds).toHaveLength(1);
    expect(mappings).toHaveLength(9);
  });

  test("reports old content items that collide on the same imported content item mapping", async () => {
    const migrationRun = await findOrCreateMigrationRun(testDatabase.db, {
      sourceExportFingerprint: "catalog-import-content-mapping-collision",
      status: "running",
    });
    const creatorContent = validStrapiExportFixture.creatorContents[0];
    const feedContent = validStrapiExportFixture.feedContents[0];
    if (creatorContent === undefined || feedContent === undefined) {
      throw new Error("Expected fixture content and feed content for collision test.");
    }
    const exportWithDuplicateSourceIdentity: StrapiExport = {
      ...validStrapiExportFixture,
      creatorContents: [
        creatorContent,
        {
          ...creatorContent,
          oldId: 41,
          title: "Fixture Video Duplicate",
          data: "Duplicate old content record for the same source identity.",
        },
      ],
      feedContents: [
        feedContent,
        {
          ...feedContent,
          oldId: 31,
          contentId: 41,
        },
      ],
    };

    const firstResult = await importStrapiCatalog(testDatabase.db, {
      migrationRunId: migrationRun.id,
      exportData: exportWithDuplicateSourceIdentity,
    });
    const secondResult = await importStrapiCatalog(testDatabase.db, {
      migrationRunId: migrationRun.id,
      exportData: exportWithDuplicateSourceIdentity,
    });
    const contentItems = await listCatalogContentItems(testDatabase.db);
    const mappings = await listMigrationMappingsForRun(testDatabase.db, migrationRun.id);
    const firstContentItem = contentItems[0];
    const feedContentMapping = mappings.find((mapping) => mapping.newEntityType === "feed-content");
    if (firstContentItem === undefined || feedContentMapping === undefined) {
      throw new Error("Expected duplicate source identity import to create content and feed-content mappings.");
    }
    const contentItemMappings = mappings.filter((mapping) => mapping.newEntityType === "content-item");
    const expectedContentReport: CatalogImportReportedRecord = {
      oldEntityType: "strapi-creator-content",
      oldEntityId: "41",
      severity: "warning",
      reason: `Migration mapping expected strapi-creator-content:41 -> content-item:${firstContentItem.id} but found strapi-creator-content:40 -> content-item:${firstContentItem.id}.`,
    };
    const expectedFeedContentReport: CatalogImportReportedRecord = {
      oldEntityType: "strapi-feed-content",
      oldEntityId: "31",
      severity: "warning",
      reason: `Migration mapping expected strapi-feed-content:31 -> feed-content:${feedContentMapping.newEntityId} but found strapi-feed-content:30 -> feed-content:${feedContentMapping.newEntityId}.`,
    };

    expect(firstResult.reportedRecords).toEqual([expectedContentReport, expectedFeedContentReport]);
    expect(secondResult.reportedRecords).toEqual([expectedContentReport, expectedFeedContentReport]);
    expect(contentItems).toHaveLength(1);
    expect(contentItemMappings).toHaveLength(1);
    expect(contentItemMappings[0]).toMatchObject({
      oldEntityType: "strapi-creator-content",
      oldEntityId: "40",
    });
  });

  test("reports old-entity mapping collisions that point to a different imported feed", async () => {
    const migrationRun = await findOrCreateMigrationRun(testDatabase.db, {
      sourceExportFingerprint: "catalog-import-feed-old-entity-collision",
      status: "running",
    });

    await recordMigrationMapping(testDatabase.db, {
      migrationRunId: migrationRun.id,
      oldEntityType: "strapi-feed",
      oldEntityId: "20",
      newEntityType: "feed",
      newEntityId: "preexisting-feed-id",
    });

    const result = await importStrapiCatalog(testDatabase.db, {
      migrationRunId: migrationRun.id,
      exportData: validStrapiExportFixture,
    });
    const feeds = await listCatalogFeeds(testDatabase.db);
    const importedFeed = feeds[0];
    if (importedFeed === undefined) {
      throw new Error("Expected fixture feed to be imported for collision test.");
    }

    expect(result.reportedRecords).toContainEqual({
      oldEntityType: "strapi-feed",
      oldEntityId: "20",
      severity: "warning",
      reason: `Migration mapping expected strapi-feed:20 -> feed:${importedFeed.id} but found strapi-feed:20 -> feed:preexisting-feed-id.`,
    });
  });

  test("reports malformed numeric option strings instead of accepting parseInt prefixes", async () => {
    const migrationRun = await findOrCreateMigrationRun(testDatabase.db, {
      sourceExportFingerprint: "catalog-import-malformed-numeric-options",
      status: "running",
    });
    const feedOption = validStrapiExportFixture.feedOptions[0];
    const durationOption = validStrapiExportFixture.contentOptions.find((option) => option.name === "duration");
    if (feedOption === undefined || durationOption === undefined) {
      throw new Error("Expected fixture numeric options for malformed numeric test.");
    }
    const exportWithMalformedNumericOptions: StrapiExport = {
      ...validStrapiExportFixture,
      feedOptions: [
        { ...feedOption, oldId: 22, value: "120abc" },
        { ...feedOption, oldId: 23, value: "1.5" },
      ],
      contentOptions: validStrapiExportFixture.contentOptions.map((option) =>
        option.oldId === durationOption.oldId ? { ...option, value: "1.5" } : option,
      ),
    };

    const result = await importStrapiCatalog(testDatabase.db, {
      migrationRunId: migrationRun.id,
      exportData: exportWithMalformedNumericOptions,
    });
    const feeds = await listCatalogFeeds(testDatabase.db);
    const importedContent = await listCatalogContentItems(testDatabase.db);
    const firstContent = importedContent[0];
    if (firstContent === undefined) {
      throw new Error("Expected fixture content to be imported for malformed numeric test.");
    }
    const detail = await getCatalogContentDetail(testDatabase.db, firstContent.id);

    expect(feeds).toHaveLength(1);
    expect(feeds[0]?.refreshCadenceSeconds).toBeNull();
    expect(detail?.durationSeconds).toBeNull();
    expect(result.reportedRecords).toEqual([
      {
        oldEntityType: "strapi-feed-option",
        oldEntityId: "22",
        severity: "warning",
        reason: "Refresh cadence option value is not a nonnegative integer.",
      },
      {
        oldEntityType: "strapi-feed-option",
        oldEntityId: "23",
        severity: "warning",
        reason: "Refresh cadence option value is not a nonnegative integer.",
      },
      {
        oldEntityType: "strapi-content-option",
        oldEntityId: "43",
        severity: "warning",
        reason: "Duration option value is not a nonnegative integer.",
      },
    ]);
  });

  test("reports invalid creator and feed options instead of silently ignoring them", async () => {
    const migrationRun = await findOrCreateMigrationRun(testDatabase.db, {
      sourceExportFingerprint: "catalog-import-option-reporting",
      status: "running",
    });
    const creatorOption = validStrapiExportFixture.creatorOptions[0];
    const feedOption = validStrapiExportFixture.feedOptions[0];
    if (creatorOption === undefined || feedOption === undefined) {
      throw new Error("Expected fixture options for reporting test.");
    }
    const exportWithInvalidOptions: StrapiExport = {
      ...validStrapiExportFixture,
      creatorOptions: [
        { ...creatorOption, oldId: 12, value: "not-a-url" },
        { ...creatorOption, oldId: 13, name: "profileColor", type: "text", value: "blue" },
      ],
      feedOptions: [
        { ...feedOption, oldId: 23, value: "-5" },
        { ...feedOption, oldId: 24, name: "legacyToggle", type: "boolean", value: "1" },
      ],
    };

    const result = await importStrapiCatalog(testDatabase.db, {
      migrationRunId: migrationRun.id,
      exportData: exportWithInvalidOptions,
    });

    expect(result.reportedRecords).toEqual([
      {
        oldEntityType: "strapi-creator-option",
        oldEntityId: "12",
        severity: "warning",
        reason: "Creator image option value is not an absolute URL.",
      },
      {
        oldEntityType: "strapi-creator-option",
        oldEntityId: "13",
        severity: "warning",
        reason: "Creator option profileColor with type text is not mapped to the new catalog.",
      },
      {
        oldEntityType: "strapi-feed-option",
        oldEntityId: "23",
        severity: "warning",
        reason: "Refresh cadence option value is not a nonnegative integer.",
      },
      {
        oldEntityType: "strapi-feed-option",
        oldEntityId: "24",
        severity: "warning",
        reason: "Feed option legacyToggle with type boolean is not mapped to the new catalog.",
      },
    ]);
  });

  test("reports unsupported and unused catalog records without importing user overlays", async () => {
    const migrationRun = await findOrCreateMigrationRun(testDatabase.db, {
      sourceExportFingerprint: "catalog-import-reporting",
      status: "running",
    });
    const unknownFeed = validStrapiExportFixture.feeds[0];
    const unknownContentOption = validStrapiExportFixture.contentOptions[0];
    const unknownFeedContent = validStrapiExportFixture.feedContents[0];
    if (unknownFeed === undefined || unknownContentOption === undefined || unknownFeedContent === undefined) {
      throw new Error("Expected fixture feed, feed content, and content option for reporting test.");
    }
    const exportWithUnmappedRecords: StrapiExport = {
      ...validStrapiExportFixture,
      feeds: [{ ...unknownFeed, oldId: 22, type: "unknown", externalId: "unknown-feed" }],
      feedContents: [{ ...unknownFeedContent, oldId: 31, feedId: 22 }],
      contentOptions: [{ ...unknownContentOption, oldId: 44, name: "unsupportedOption", type: "text", value: "unused" }],
      subscriptions: [],
      subscriptionOptions: [],
      subscriptionContentOptions: [],
      playlists: [],
      playlistContents: [],
    };

    const result = await importStrapiCatalog(testDatabase.db, {
      migrationRunId: migrationRun.id,
      exportData: exportWithUnmappedRecords,
    });
    const contentItems = await listCatalogContentItems(testDatabase.db);

    expect(contentItems).toHaveLength(0);
    expect(result.reportedRecords).toEqual([
      {
        oldEntityType: "strapi-feed",
        oldEntityId: "22",
        severity: "error",
        reason: "Feed source type unknown is not supported by the new catalog.",
      },
      {
        oldEntityType: "strapi-creator",
        oldEntityId: "10",
        severity: "error",
        reason: "Creator has no supported feed and no recoverable channel identity; it cannot be anchored in the global catalog without a fabricated id.",
      },
      {
        oldEntityType: "strapi-creator-content",
        oldEntityId: "40",
        severity: "error",
        reason: "Content has no importable feed content link and no supported source option to anchor a global catalog identity.",
      },
      {
        oldEntityType: "strapi-content-option",
        oldEntityId: "44",
        severity: "warning",
        reason: "Content option unsupportedOption with type text is not mapped to the new catalog.",
      },
      {
        oldEntityType: "strapi-feed-content",
        oldEntityId: "31",
        severity: "warning",
        reason: "Feed content row references a feed source that is not supported by the new catalog.",
      },
    ]);
  });

  test("imports content without a feed content link by deriving identity from the source option, and reports a creator with no feed as an error instead of fabricating an id", async () => {
    const migrationRun = await findOrCreateMigrationRun(testDatabase.db, {
      sourceExportFingerprint: "catalog-import-source-option-fallback",
      status: "running",
    });
    const creator = validStrapiExportFixture.creators[0];
    const sourceOption = validStrapiExportFixture.contentOptions.find((option) => option.name === "source");
    const thumbOption = validStrapiExportFixture.contentOptions.find((option) => option.name === "thumb");
    if (creator === undefined || sourceOption === undefined || thumbOption === undefined) {
      throw new Error("Expected fixture creator and source/thumb options for source-option fallback test.");
    }

    // Drop the feed (so the creator has no feed) and drop feed contents (so the
    // content has no feed_content link). The creator has no feed and therefore no
    // recoverable channel identity: it must be reported as an error, never given a
    // fabricated id. Because content items require a creator row, the content is
    // reported as an error too rather than anchored to a fake creator.
    const exportWithoutFeed: StrapiExport = {
      ...validStrapiExportFixture,
      feeds: [],
      feedContents: [],
      feedOptions: [],
      contentOptions: [
        { ...sourceOption, value: "https://www.youtube-nocookie.com/embed/yt-source-option-video" },
        { ...thumbOption, value: "https://i.ytimg.com/vi/yt-source-option-video/hqdefault.jpg" },
      ],
    };

    const result = await importStrapiCatalog(testDatabase.db, {
      migrationRunId: migrationRun.id,
      exportData: exportWithoutFeed,
    });

    const contentItems = await listCatalogContentItems(testDatabase.db);
    const creators = await listCatalogCreators(testDatabase.db, { limit: 100 });
    expect(contentItems).toHaveLength(0);
    expect(creators).toHaveLength(0);
    expect(result.counts).toMatchObject({ creators: 0, feeds: 0, contentItems: 0, contentSources: 0 });
    expect(result.reportedRecords).toContainEqual({
      oldEntityType: "strapi-creator",
      oldEntityId: "10",
      severity: "error",
      reason: "Creator has no supported feed and no recoverable channel identity; it cannot be anchored in the global catalog without a fabricated id.",
    });
    expect(result.reportedRecords.some(
      (record) => record.oldEntityType === "strapi-creator-content" && record.oldEntityId === "40" && record.severity === "error",
    )).toBe(true);
  });

  test("PeerTube content without source option uses a valid canonical URL fallback", async () => {
    const migrationRun = await findOrCreateMigrationRun(testDatabase.db, {
      sourceExportFingerprint: "catalog-import-peertube-url-fallback",
      status: "running",
    });
    const feed = validStrapiExportFixture.feeds[0];
    const feedContent = validStrapiExportFixture.feedContents[0];
    if (feed === undefined || feedContent === undefined) {
      throw new Error("Expected fixture feed and feed content for PeerTube fallback test.");
    }
    const exportWithoutSourceOption: StrapiExport = {
      ...validStrapiExportFixture,
      feeds: [
        {
          ...feed,
          type: "peertube",
          externalId: "peertube.example.test/video-channels/fixture-channel",
          url: "https://peertube.example.test/api/v1/video-channels/fixture-channel/videos",
        },
      ],
      feedContents: [
        {
          ...feedContent,
          externalId: "peertube.example.test/videos/fixture-video-uuid",
        },
      ],
      contentOptions: validStrapiExportFixture.contentOptions.filter((option) => option.name !== "source"),
    };

    await importStrapiCatalog(testDatabase.db, {
      migrationRunId: migrationRun.id,
      exportData: exportWithoutSourceOption,
    });
    const contentItems = await listCatalogContentItems(testDatabase.db);
    const firstContent = contentItems[0];
    if (firstContent === undefined) {
      throw new Error("Expected PeerTube content to be imported.");
    }
    const detail = await getCatalogContentDetail(testDatabase.db, firstContent.id);
    const canonicalUrl = detail?.sources[0]?.canonicalUrl;

    expect(canonicalUrl).toBe("https://peertube.example.test/w/fixture-video-uuid");
    expect(() => new URL(canonicalUrl ?? "")).not.toThrow();
  });
});

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
