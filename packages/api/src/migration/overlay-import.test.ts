import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { createClient } from "@libsql/client";
import type { Client } from "@libsql/client";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/libsql";

import * as schema from "@FeedElity/db/schema";

import { importStrapiCatalog } from "./catalog-import";
import { importStrapiOverlays } from "./overlay-import";
import { findOrCreateMigrationRun, listMigrationMappingsForRun } from "../repositories/overlays";
import type { RepositoryDb } from "../repositories/catalog";
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

describe("Strapi overlay import mapper", () => {
  test("imports users as pending password setup identities without password credentials", async () => {
    const migrationRun = await createCatalogBaseline("overlay-users");

    const result = await importStrapiOverlays(testDatabase.db, {
      migrationRunId: migrationRun.id,
      exportData: validStrapiExportFixture,
    });

    const users = await testDatabase.db.select().from(schema.user);
    const accounts = await testDatabase.db.select().from(schema.account);

    expect(result.reportedRecords).toEqual([]);
    expect(result.counts.users).toBe(1);
    expect(users).toHaveLength(1);
    expect(users[0]).toMatchObject({
      name: "fixture-user",
      email: "fixture@example.com",
      emailVerified: true,
      accountState: "migrated_pending_password_setup",
    });
    expect(accounts).toEqual([]);
  });

  test("imports subscriptions, statuses, playlists, and playlist contents with explicit ownership", async () => {
    const migrationRun = await createCatalogBaseline("overlay-main-flow");

    const result = await importStrapiOverlays(testDatabase.db, {
      migrationRunId: migrationRun.id,
      exportData: validStrapiExportFixture,
    });

    const users = await testDatabase.db.select().from(schema.user);
    const user = users[0];
    if (user === undefined) {
      throw new Error("Expected migrated user for overlay import test.");
    }
    const subscriptions = await testDatabase.db.select().from(schema.subscription);
    const statuses = await testDatabase.db.select().from(schema.contentStatus);
    const playlists = await testDatabase.db.select().from(schema.playlist);
    const playlistItems = await testDatabase.db.select().from(schema.playlistItem);
    const mappings = await listMigrationMappingsForRun(testDatabase.db, migrationRun.id);

    expect(result.counts).toEqual({ users: 1, subscriptions: 1, contentStatuses: 3, playlists: 1, playlistItems: 1 });
    expect(subscriptions).toHaveLength(1);
    expect(subscriptions[0]?.userId).toBe(user.id);
    expect(statuses.map((status) => status.status).sort()).toEqual(["favorite", "opened", "played"]);
    expect(statuses.every((status) => status.userId === user.id)).toBe(true);
    expect(playlists).toHaveLength(1);
    expect(playlists[0]).toMatchObject({ userId: user.id, name: "Watch Later", description: "Old Strapi playlist fixture." });
    expect(playlistItems).toHaveLength(1);
    expect(playlistItems[0]).toMatchObject({ userId: user.id, playlistId: playlists[0]?.id, position: 0 });
    expect(mappings.map((mapping) => `${mapping.oldEntityType}:${mapping.oldEntityId}`).sort()).toContain("strapi-user:1");
    expect(mappings.map((mapping) => `${mapping.oldEntityType}:${mapping.oldEntityId}`).sort()).toContain("strapi-playlist-content:71");
  });

  test("reports overlay records whose users or catalog records were not mapped", async () => {
    const unsupportedCreator = validStrapiExportFixture.creators[0];
    const unsupportedFeed = validStrapiExportFixture.feeds[0];
    const subscription = validStrapiExportFixture.subscriptions[0];
    const playlist = validStrapiExportFixture.playlists[0];
    const playlistContent = validStrapiExportFixture.playlistContents[0];
    if (
      unsupportedCreator === undefined ||
      unsupportedFeed === undefined ||
      subscription === undefined ||
      playlist === undefined ||
      playlistContent === undefined
    ) {
      throw new Error("Expected fixture records for unmapped overlay test.");
    }
    const exportWithUnmappedCatalog: StrapiExport = {
      ...validStrapiExportFixture,
      creators: [...validStrapiExportFixture.creators, { ...unsupportedCreator, oldId: 11, name: "Unsupported Creator" }],
      feeds: [
        ...validStrapiExportFixture.feeds,
        { ...unsupportedFeed, oldId: 21, creatorId: 11, type: "unknown", externalId: "unsupported-feed" },
      ],
      subscriptions: [...validStrapiExportFixture.subscriptions, { ...subscription, oldId: 52, creatorId: 11 }],
      playlists: [...validStrapiExportFixture.playlists, { ...playlist, oldId: 72, userId: 2, name: "Missing owner" }],
      playlistContents: [...validStrapiExportFixture.playlistContents, { ...playlistContent, oldId: 73, playlistId: 72 }],
      users: validStrapiExportFixture.users,
    };
    const migrationRun = await createCatalogBaseline("overlay-unmapped", exportWithUnmappedCatalog);

    const result = await importStrapiOverlays(testDatabase.db, {
      migrationRunId: migrationRun.id,
      exportData: exportWithUnmappedCatalog,
    });

    expect(result.reportedRecords).toEqual([
      {
        oldEntityType: "strapi-subscription",
        oldEntityId: "52",
        severity: "error",
        reason: "Subscription references a creator that was not imported into the new catalog.",
      },
      {
        oldEntityType: "strapi-playlist",
        oldEntityId: "72",
        severity: "error",
        reason: "Playlist references a user that was not imported into the new auth model.",
      },
      {
        oldEntityType: "strapi-playlist-content",
        oldEntityId: "73",
        severity: "error",
        reason: "Playlist content references a playlist that was not imported.",
      },
    ]);
  });

  test("repeated overlay import in the same migration run is idempotent", async () => {
    const migrationRun = await createCatalogBaseline("overlay-idempotent");
    const input = { migrationRunId: migrationRun.id, exportData: validStrapiExportFixture };

    const firstResult = await importStrapiOverlays(testDatabase.db, input);
    const secondResult = await importStrapiOverlays(testDatabase.db, input);

    const users = await testDatabase.db.select().from(schema.user);
    const subscriptions = await testDatabase.db.select().from(schema.subscription);
    const statuses = await testDatabase.db.select().from(schema.contentStatus);
    const playlists = await testDatabase.db.select().from(schema.playlist);
    const playlistItems = await testDatabase.db.select().from(schema.playlistItem);

    expect(secondResult.counts).toEqual(firstResult.counts);
    expect(users).toHaveLength(1);
    expect(subscriptions).toHaveLength(1);
    expect(statuses).toHaveLength(3);
    expect(playlists).toHaveLength(1);
    expect(playlistItems).toHaveLength(1);
  });

  test("reports migration mapping collisions for overlays resolving to the same new identity", async () => {
    const openedOption = validStrapiExportFixture.subscriptionContentOptions.find((option) => option.interpretedStatus.statusName === "open");
    if (openedOption === undefined) {
      throw new Error("Expected opened status option for mapping collision test.");
    }
    const exportWithDuplicateStatus: StrapiExport = {
      ...validStrapiExportFixture,
      subscriptionContentOptions: [
        ...validStrapiExportFixture.subscriptionContentOptions,
        { ...openedOption, oldId: 63 },
      ],
    };
    const migrationRun = await createCatalogBaseline("overlay-mapping-collision", exportWithDuplicateStatus);

    const result = await importStrapiOverlays(testDatabase.db, {
      migrationRunId: migrationRun.id,
      exportData: exportWithDuplicateStatus,
    });

    const collisionReport = result.reportedRecords.find(
      (record) => record.oldEntityType === "strapi-subscription-content-option" && record.oldEntityId === "63",
    );
    expect(collisionReport).toMatchObject({
      severity: "warning",
      reason: expect.stringContaining("already belongs to strapi-subscription-content-option 60"),
    });
  });

  test("reports duplicate playlist item positions and continues importing overlays", async () => {
    const content = validStrapiExportFixture.creatorContents[0];
    const feedContent = validStrapiExportFixture.feedContents[0];
    const playlistContent = validStrapiExportFixture.playlistContents[0];
    if (content === undefined || feedContent === undefined || playlistContent === undefined) {
      throw new Error("Expected playlist content fixture for duplicate position import test.");
    }
    const exportWithDuplicatePlaylistPosition: StrapiExport = {
      ...validStrapiExportFixture,
      creatorContents: [
        ...validStrapiExportFixture.creatorContents,
        { ...content, oldId: 44, title: "Fixture Video 2" },
      ],
      feedContents: [
        ...validStrapiExportFixture.feedContents,
        { ...feedContent, oldId: 31, contentId: 44, externalId: "yt-fixture-video-2" },
      ],
      playlistContents: [
        ...validStrapiExportFixture.playlistContents,
        { ...playlistContent, oldId: 72, contentId: 44 },
      ],
    };
    const migrationRun = await createCatalogBaseline("overlay-playlist-position-collision", exportWithDuplicatePlaylistPosition);

    const result = await importStrapiOverlays(testDatabase.db, {
      migrationRunId: migrationRun.id,
      exportData: exportWithDuplicatePlaylistPosition,
    });

    const playlistItems = await testDatabase.db.select().from(schema.playlistItem);

    expect(result.counts.playlistItems).toBe(1);
    expect(playlistItems).toHaveLength(1);
    expect(result.reportedRecords).toContainEqual({
      oldEntityType: "strapi-playlist-content",
      oldEntityId: "72",
      severity: "error",
      reason: "Playlist item position is already occupied.",
    });
  });

  test("reports thrown playlist item write failures and continues importing later playlist contents", async () => {
    const content = validStrapiExportFixture.creatorContents[0];
    const feedContent = validStrapiExportFixture.feedContents[0];
    const playlistContent = validStrapiExportFixture.playlistContents[0];
    if (content === undefined || feedContent === undefined || playlistContent === undefined) {
      throw new Error("Expected fixture records for playlist item write failure test.");
    }
    const exportWithTwoPlaylistContents: StrapiExport = {
      ...validStrapiExportFixture,
      creatorContents: [
        ...validStrapiExportFixture.creatorContents,
        { ...content, oldId: 44, title: "Fixture Video 2" },
      ],
      feedContents: [
        ...validStrapiExportFixture.feedContents,
        { ...feedContent, oldId: 31, contentId: 44, externalId: "yt-fixture-video-2" },
      ],
      subscriptionContentOptions: [],
      playlistContents: [
        playlistContent,
        { ...playlistContent, oldId: 72, contentId: 44, position: 10 },
      ],
    };
    const migrationRun = await createCatalogBaseline("overlay-playlist-write-failure", exportWithTwoPlaylistContents);
    const contentMappings = await listMigrationMappingsForRun(testDatabase.db, migrationRun.id);
    const deletedContentMapping = contentMappings.find(
      (mapping) => mapping.oldEntityType === "strapi-creator-content" && mapping.oldEntityId === "40" && mapping.newEntityType === "content-item",
    );
    if (deletedContentMapping === undefined) {
      throw new Error("Expected content mapping before playlist item write failure test.");
    }
    await testDatabase.db.delete(schema.contentItem).where(eq(schema.contentItem.id, deletedContentMapping.newEntityId));

    const result = await importStrapiOverlays(testDatabase.db, {
      migrationRunId: migrationRun.id,
      exportData: exportWithTwoPlaylistContents,
    });

    const playlistItems = await testDatabase.db.select().from(schema.playlistItem);

    expect(result.counts.playlistItems).toBe(1);
    expect(playlistItems).toHaveLength(1);
    expect(playlistItems[0]?.position).toBe(10);
    expect(result.reportedRecords).toContainEqual({
      oldEntityType: "strapi-playlist-content",
      oldEntityId: "71",
      severity: "error",
      reason: expect.stringContaining("Playlist item could not be imported:"),
    });
  });

  test("retry reuses an existing migrated playlist even when its mapping is missing", async () => {
    const migrationRun = await createCatalogBaseline("overlay-playlist-retry");
    const input = { migrationRunId: migrationRun.id, exportData: validStrapiExportFixture };

    await importStrapiOverlays(testDatabase.db, input);
    const firstPlaylists = await testDatabase.db.select().from(schema.playlist);
    const firstPlaylist = firstPlaylists[0];
    if (firstPlaylist === undefined) {
      throw new Error("Expected migrated playlist before retry simulation.");
    }

    await testDatabase.db
      .delete(schema.migrationMapping)
      .where(
        and(
          eq(schema.migrationMapping.migrationRunId, migrationRun.id),
          eq(schema.migrationMapping.oldEntityType, "strapi-playlist"),
          eq(schema.migrationMapping.oldEntityId, "70"),
        ),
      );

    const retryResult = await importStrapiOverlays(testDatabase.db, input);
    const retriedPlaylists = await testDatabase.db.select().from(schema.playlist);

    expect(retryResult.counts.playlists).toBe(1);
    expect(retriedPlaylists).toHaveLength(1);
    expect(retriedPlaylists[0]?.id).toBe(firstPlaylist.id);
    expect(retriedPlaylists[0]?.userId).toBe(firstPlaylist.userId);
  });

  test("preserves cross-user ownership for subscriptions, statuses, and playlists", async () => {
    const secondUser = validStrapiExportFixture.users[0];
    const subscription = validStrapiExportFixture.subscriptions[0];
    const playlist = validStrapiExportFixture.playlists[0];
    if (secondUser === undefined || subscription === undefined || playlist === undefined) {
      throw new Error("Expected fixture records for cross-user overlay test.");
    }
    const exportWithSecondUser: StrapiExport = {
      ...validStrapiExportFixture,
      users: [
        ...validStrapiExportFixture.users,
        { ...secondUser, oldId: 2, username: "second-user", email: "second@example.com" },
      ],
      subscriptions: [...validStrapiExportFixture.subscriptions, { ...subscription, oldId: 53, userId: 2 }],
      subscriptionContentOptions: validStrapiExportFixture.subscriptionContentOptions.flatMap((option) => [
        option,
        { ...option, oldId: option.oldId + 100, subscriptionId: 53 },
      ]),
      playlists: [...validStrapiExportFixture.playlists, { ...playlist, oldId: 74, userId: 2, name: "Second Watch Later" }],
    };
    const migrationRun = await createCatalogBaseline("overlay-cross-user", exportWithSecondUser);

    await importStrapiOverlays(testDatabase.db, {
      migrationRunId: migrationRun.id,
      exportData: exportWithSecondUser,
    });

    const users = await testDatabase.db.select().from(schema.user);
    const subscriptions = await testDatabase.db.select().from(schema.subscription);
    const statuses = await testDatabase.db.select().from(schema.contentStatus);
    const playlists = await testDatabase.db.select().from(schema.playlist);

    expect(users).toHaveLength(2);
    expect(subscriptions.map((row) => row.userId).sort()).toEqual(users.map((row) => row.id).sort());
    for (const user of users) {
      expect(statuses.filter((status) => status.userId === user.id)).toHaveLength(3);
      expect(playlists.filter((row) => row.userId === user.id)).toHaveLength(1);
    }
  });
});

async function createCatalogBaseline(fingerprint: string, exportData: StrapiExport = validStrapiExportFixture) {
  const migrationRun = await findOrCreateMigrationRun(testDatabase.db, {
    sourceExportFingerprint: fingerprint,
    status: "running",
  });
  await importStrapiCatalog(testDatabase.db, { migrationRunId: migrationRun.id, exportData });
  return migrationRun;
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
  `CREATE TABLE account (
    id TEXT PRIMARY KEY NOT NULL,
    account_id TEXT NOT NULL,
    provider_id TEXT NOT NULL,
    user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
    access_token TEXT,
    refresh_token TEXT,
    id_token TEXT,
    access_token_expires_at INTEGER,
    refresh_token_expires_at INTEGER,
    scope TEXT,
    password TEXT,
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
