import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { createClient } from "@libsql/client";
import type { Client } from "@libsql/client";
import { call } from "@orpc/server";
import { drizzle } from "drizzle-orm/libsql";

import * as schema from "@FeedElity/db/schema";

import type { AccountState, Context } from "../context";
import type { RepositoryDb } from "../repositories/catalog";
import { appRouter } from "../routers";
import { createSourceAdapterRegistry } from "../sources/registry";
import { runStrapiExportMigration } from "./run-migration";
import { validStrapiExportFixture } from "./strapi-export.fixtures";
import type { StrapiExport } from "./strapi-export";

interface TestDatabase {
  readonly client: Client;
  readonly db: RepositoryDb;
}

let testDatabase: TestDatabase;
const testSourceRegistry = createSourceAdapterRegistry();

beforeEach(async () => {
  testDatabase = await createTestDatabase();
});

afterEach(() => {
  testDatabase.client.close();
});

describe("Strapi migration runner", () => {
  test("rejects malformed exports before creating migration run or catalog rows", async () => {
    const report = await runStrapiExportMigration(testDatabase.db, { exportData: { malformed: true } });

    expect(report.status).toBe("failed");
    expect(report.migrationRun).toBeNull();
    expect(report.fingerprint).toBeNull();
    expect(report.failures.length).toBeGreaterThan(0);
    expect(await testDatabase.db.select().from(schema.migrationRun)).toHaveLength(0);
    expect(await testDatabase.db.select().from(schema.creator)).toHaveLength(0);
    expect(await testDatabase.db.select().from(schema.user)).toHaveLength(0);
  });

  test("runs catalog then overlay import and returns a complete success report", async () => {
    const report = await runStrapiExportMigration(testDatabase.db, {
      exportData: validStrapiExportFixture,
      sourceFilename: "strapi-export.json",
    });

    expect(report.status).toBe("succeeded");
    expect(report.alreadyImported).toBe(false);
    expect(report.migrationRun?.status).toBe("succeeded");
    expect(report.counts).toMatchObject({ users: 1, creators: 1, feeds: 1, contentItems: 1, subscriptions: 1, playlists: 1 });
    expect(report.mappingCounts).toMatchObject({ creator: 1, feed: 1, user: 1, playlist: 1 });
    expect(report.severitySummary).toEqual({ info: 0, warning: 0, error: 0 });
    expect(report.warnings).toEqual([]);
    expect(report.failures).toEqual([]);
  });

  test("returns an already imported report for a repeated successful fingerprint without rewriting", async () => {
    const firstReport = await runStrapiExportMigration(testDatabase.db, { exportData: validStrapiExportFixture });
    const secondReport = await runStrapiExportMigration(testDatabase.db, { exportData: validStrapiExportFixture });

    expect(firstReport.status).toBe("succeeded");
    expect(secondReport.status).toBe("succeeded");
    expect(secondReport.alreadyImported).toBe(true);
    expect(secondReport.migrationRun?.id).toBe(firstReport.migrationRun?.id);
    expect(secondReport.counts).toEqual(firstReport.counts);
    expect(secondReport.counts).toEqual({
      users: 1,
      creators: 1,
      feeds: 1,
      contentItems: 1,
      contentSources: 1,
      feedContentLinks: 1,
      subscriptions: 1,
      contentStatuses: 3,
      playlists: 1,
      playlistItems: 1,
    });
    expect(await testDatabase.db.select().from(schema.migrationRun)).toHaveLength(1);
    expect(await testDatabase.db.select().from(schema.creator)).toHaveLength(1);
    expect(await testDatabase.db.select().from(schema.user)).toHaveLength(1);
  });

  test("keeps repeated successful content source counts when old source option mappings are absent", async () => {
    const exportWithoutSourceOption = buildExportWithoutSourceOption();

    const firstReport = await runStrapiExportMigration(testDatabase.db, { exportData: exportWithoutSourceOption });
    const secondReport = await runStrapiExportMigration(testDatabase.db, { exportData: exportWithoutSourceOption });

    expect(firstReport.status).toBe("succeeded");
    expect(firstReport.counts.contentSources).toBe(1);
    expect(firstReport.mappingCounts["content-source"]).toBeUndefined();
    expect(secondReport.status).toBe("succeeded");
    expect(secondReport.alreadyImported).toBe(true);
    expect(secondReport.counts.contentItems).toBe(1);
    expect(secondReport.counts.contentSources).toBe(1);
    expect(secondReport.mappingCounts["content-source"]).toBeUndefined();
  });

  test("returns partial status with unmapped records and severity summaries", async () => {
    const exportWithUnmappedRecords = buildExportWithUnmappedRecords();

    const report = await runStrapiExportMigration(testDatabase.db, { exportData: exportWithUnmappedRecords });

    expect(report.status).toBe("partial");
    expect(report.migrationRun?.status).toBe("partial");
    expect(report.severitySummary.error).toBeGreaterThan(0);
    expect(report.failures.map((failure) => `${failure.oldEntityType}:${failure.oldEntityId}`)).toContain("strapi-creator:11");
    expect(report.failures.map((failure) => `${failure.oldEntityType}:${failure.oldEntityId}`)).toContain("strapi-subscription:52");
    expect(report.reportedRecords.length).toBe(report.warnings.length + report.failures.length);
  });

  test("retries a partial run with existing imported rows idempotently", async () => {
    const exportWithUnmappedRecords = buildExportWithUnmappedRecords();
    const firstReport = await runStrapiExportMigration(testDatabase.db, {
      exportData: exportWithUnmappedRecords,
      sourceFilename: "partial-export.json",
    });
    const firstRunId = firstReport.migrationRun?.id;

    expect(firstReport.status).toBe("partial");
    expect(firstRunId).toBeString();
    expect(firstReport.counts).toMatchObject({ users: 1, creators: 1, feeds: 1, contentItems: 1, subscriptions: 1 });

    const retryReport = await runStrapiExportMigration(testDatabase.db, {
      exportData: exportWithUnmappedRecords,
      sourceFilename: "partial-export-retry.json",
    });

    expect(retryReport.status).toBe("partial");
    expect(retryReport.alreadyImported).toBe(false);
    expect(retryReport.migrationRun?.id).toBe(firstRunId);
    expect(retryReport.migrationRun?.sourceFilename).toBe("partial-export-retry.json");
    expect(retryReport.counts).toEqual(firstReport.counts);
    expect(retryReport.mappingCounts).toEqual(firstReport.mappingCounts);
    expect(retryReport.counts).toEqual({
      users: 1,
      creators: 1,
      feeds: 1,
      contentItems: 1,
      contentSources: 1,
      feedContentLinks: 1,
      subscriptions: 1,
      contentStatuses: 3,
      playlists: 1,
      playlistItems: 1,
    });
    expect(retryReport.mappingCounts).toEqual({
      creator: 1,
      "creator-image": 1,
      feed: 1,
      "feed-refresh-cadence": 1,
      "content-item": 1,
      "content-item-duration": 1,
      "content-item-thumbnail": 1,
      "content-source": 1,
      "feed-content": 1,
      user: 1,
      subscription: 1,
      "subscription-setting": 1,
      "content-status": 3,
      playlist: 1,
      "playlist-item": 1,
    });
    expect(retryReport.failures.map((failure) => `${failure.oldEntityType}:${failure.oldEntityId}`)).toEqual(
      firstReport.failures.map((failure) => `${failure.oldEntityType}:${failure.oldEntityId}`),
    );
    expect(await testDatabase.db.select().from(schema.migrationRun)).toHaveLength(1);
    expect(await testDatabase.db.select().from(schema.creator)).toHaveLength(1);
    expect(await testDatabase.db.select().from(schema.feed)).toHaveLength(1);
    expect(await testDatabase.db.select().from(schema.contentItem)).toHaveLength(1);
    expect(await testDatabase.db.select().from(schema.user)).toHaveLength(1);
    expect(await testDatabase.db.select().from(schema.subscription)).toHaveLength(1);
    expect(await testDatabase.db.select().from(schema.contentStatus)).toHaveLength(3);
    expect(await testDatabase.db.select().from(schema.playlist)).toHaveLength(1);
    expect(await testDatabase.db.select().from(schema.playlistItem)).toHaveLength(1);
    expect(await testDatabase.db.select().from(schema.migrationMapping)).toHaveLength(17);
  });

  test("protected migration API rejects anonymous callers and derives authorization from the session", async () => {
    await expect(
      call(appRouter.migration.runImport, { exportData: validStrapiExportFixture }, { context: anonymousContext(testDatabase.db) }),
    ).rejects.toHaveProperty("code", "UNAUTHORIZED");

    const report = await call(appRouter.migration.runImport, { exportData: validStrapiExportFixture }, {
      context: authenticatedContext(testDatabase.db, "migration-admin", "active"),
    });

    expect(report.status).toBe("succeeded");
    expect(report.counts.users).toBe(1);
  });
});

function buildExportWithUnmappedRecords(): StrapiExport {
  const creator = validStrapiExportFixture.creators[0];
  const feed = validStrapiExportFixture.feeds[0];
  const subscription = validStrapiExportFixture.subscriptions[0];
  if (creator === undefined || feed === undefined || subscription === undefined) {
    throw new Error("Expected fixture records for unmapped runner test.");
  }
  return {
    ...validStrapiExportFixture,
    creators: [...validStrapiExportFixture.creators, { ...creator, oldId: 11, name: "Unsupported Creator" }],
    feeds: [...validStrapiExportFixture.feeds, { ...feed, oldId: 21, creatorId: 11, type: "unknown", externalId: "unsupported-feed" }],
    subscriptions: [...validStrapiExportFixture.subscriptions, { ...subscription, oldId: 52, creatorId: 11 }],
  };
}

function buildExportWithoutSourceOption(): StrapiExport {
  return {
    ...validStrapiExportFixture,
    contentOptions: validStrapiExportFixture.contentOptions.filter((option) => option.name !== "source"),
  };
}

function anonymousContext(db: RepositoryDb): Context {
  return { db, session: null, sourceRegistry: testSourceRegistry };
}

function authenticatedContext(db: RepositoryDb, userId: string, accountState: AccountState): Context {
  return {
    db,
    sourceRegistry: testSourceRegistry,
    session: {
      session: {
        id: `session-${userId}`,
        userId,
        expiresAt: new Date("2026-01-02T00:00:00.000Z"),
        createdAt: new Date("2026-01-01T00:00:00.000Z"),
        updatedAt: new Date("2026-01-01T00:00:00.000Z"),
      },
      user: {
        id: userId,
        name: userId,
        email: `${userId}@example.test`,
        emailVerified: true,
        image: null,
        createdAt: new Date("2026-01-01T00:00:00.000Z"),
        updatedAt: new Date("2026-01-01T00:00:00.000Z"),
        accountState,
      },
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
