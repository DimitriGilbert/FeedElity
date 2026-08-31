import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { createClient } from "@libsql/client";
import type { Client } from "@libsql/client";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/libsql";

import * as schema from "@FeedElity/db/schema";

import { importUserDataForUser } from "./user-data-import";
import { USER_DATA_FINGERPRINT_SETTING_KEY } from "./user-data-schema";
import type { UserDataExport } from "./user-data-schema";
import type { RepositoryDb } from "../repositories/catalog";
import { findOrCreateContentItem, findOrCreateCreator } from "../repositories/catalog";
import { saveUserSetting } from "../repositories/overlays";

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

const playbackMetadataJson = JSON.stringify({
  playback: { positionSeconds: 95, durationSeconds: 1_200, updatedAt: "2026-08-29T10:00:00.000Z" },
});

describe("user data import", () => {
  test("fresh import creates every overlay row owned by the importing user", async () => {
    await insertUser(testDatabase.db, "user-a", "import-a@example.test");
    await seedCatalog(testDatabase.db);

    const result = await importUserDataForUser(testDatabase.db, {
      userId: "user-a",
      exportData: buildExportPayload(),
    });

    expect(result.skipped).toBe(false);
    expect(result.report).toEqual({
      counts: {
        subscriptions: 1,
        contentStatuses: 2,
        playlists: 1,
        playlistItems: 1,
        collections: 1,
        collectionMembers: 1,
        settings: 1,
      },
      warnings: [],
      failures: [],
    });

    const subscriptions = await testDatabase.db.select().from(schema.subscription);
    const statuses = await testDatabase.db.select().from(schema.contentStatus);
    const playlists = await testDatabase.db.select().from(schema.playlist);
    const playlistItems = await testDatabase.db.select().from(schema.playlistItem);
    const collections = await testDatabase.db.select().from(schema.creatorCollection);
    const collectionMembers = await testDatabase.db.select().from(schema.collectionMember);
    const settings = await testDatabase.db.query.userSetting.findMany({
      where: eqUser("user-a"),
    });

    expect(subscriptions).toHaveLength(1);
    expect(subscriptions[0]).toMatchObject({ userId: "user-a", titleOverride: null, settingsJson: null });
    expect(statuses).toHaveLength(2);
    const opened = statuses.find((status) => status.status === "opened");
    expect(opened).toMatchObject({ userId: "user-a", metadataJson: playbackMetadataJson });
    expect(opened?.createdAt.toISOString()).toBe("2026-08-01T00:00:00.000Z");
    expect(opened?.updatedAt.toISOString()).toBe("2026-08-02T12:00:00.000Z");
    expect(playlists).toHaveLength(1);
    expect(playlists[0]).toMatchObject({
      userId: "user-a",
      name: "Watch Later",
      description: "Imported playlist",
      sortMode: "manual",
      position: 0,
    });
    expect(playlistItems).toHaveLength(1);
    expect(playlistItems[0]).toMatchObject({ userId: "user-a", position: 0 });
    expect(playlistItems[0]?.addedAt.toISOString()).toBe("2026-08-05T09:30:00.000Z");
    expect(collections).toHaveLength(1);
    expect(collections[0]).toMatchObject({ userId: "user-a", name: "Daily", position: 1 });
    expect(collectionMembers).toHaveLength(1);
    expect(collectionMembers[0]).toMatchObject({ userId: "user-a", collectionId: collections[0]?.id });
    const settingKeys = settings.map((setting) => setting.key).sort();
    expect(settingKeys).toEqual([USER_DATA_FINGERPRINT_SETTING_KEY, "reader.layout"]);
    const layoutSetting = settings.find((setting) => setting.key === "reader.layout");
    expect(layoutSetting?.valueJson).toBe(JSON.stringify("compact"));
  });

  test("re-importing the same payload is skipped with zero writes", async () => {
    await insertUser(testDatabase.db, "user-a", "import-skip@example.test");
    await seedCatalog(testDatabase.db);
    const payload = buildExportPayload();
    await importUserDataForUser(testDatabase.db, { userId: "user-a", exportData: payload });
    // Local drift after the first import must survive the skipped re-import.
    await saveUserSetting(testDatabase.db, {
      userId: "user-a",
      key: "reader.layout",
      valueJson: JSON.stringify("spacious"),
    });

    const second = await importUserDataForUser(testDatabase.db, { userId: "user-a", exportData: payload });

    expect(second).toEqual({
      skipped: true,
      report: {
        counts: {
          subscriptions: 0,
          contentStatuses: 0,
          playlists: 0,
          playlistItems: 0,
          collections: 0,
          collectionMembers: 0,
          settings: 0,
        },
        warnings: [],
        failures: [],
      },
    });
    const statuses = await testDatabase.db.select().from(schema.contentStatus);
    const layoutSetting = await testDatabase.db.query.userSetting.findFirst({
      where: andKey("user-a", "reader.layout"),
    });
    expect(statuses).toHaveLength(2);
    expect(layoutSetting?.valueJson).toBe(JSON.stringify("spacious"));
  });

  test("duplicate import without the fingerprint still writes no duplicate rows", async () => {
    await insertUser(testDatabase.db, "user-a", "import-idempotent@example.test");
    await seedCatalog(testDatabase.db);
    const payload = buildExportPayload();
    await importUserDataForUser(testDatabase.db, { userId: "user-a", exportData: payload });
    await testDatabase.db
      .delete(schema.userSetting)
      .where(andKey("user-a", USER_DATA_FINGERPRINT_SETTING_KEY));

    const second = await importUserDataForUser(testDatabase.db, { userId: "user-a", exportData: payload });

    expect(second.skipped).toBe(false);
    expect(second.report.warnings).toEqual([]);
    expect(await testDatabase.db.select().from(schema.subscription)).toHaveLength(1);
    expect(await testDatabase.db.select().from(schema.contentStatus)).toHaveLength(2);
    expect(await testDatabase.db.select().from(schema.playlist)).toHaveLength(1);
    expect(await testDatabase.db.select().from(schema.playlistItem)).toHaveLength(1);
    expect(await testDatabase.db.select().from(schema.creatorCollection)).toHaveLength(1);
    expect(await testDatabase.db.select().from(schema.collectionMember)).toHaveLength(1);
    const settings = await testDatabase.db.query.userSetting.findMany({ where: eqUser("user-a") });
    expect(settings).toHaveLength(2);
  });

  test("unresolved content becomes a warning, the entry is skipped and counted", async () => {
    await insertUser(testDatabase.db, "user-a", "import-unresolved@example.test");
    await seedCatalog(testDatabase.db);
    const payload = buildExportPayload();
    payload.data.contentStatuses = [
      ...payload.data.contentStatuses,
      {
        content: { sourceType: "peertube", sourceExternalId: "missing-video" },
        status: "played",
        metadataJson: null,
        createdAt: "2026-08-04T00:00:00.000Z",
        updatedAt: "2026-08-04T00:00:00.000Z",
      },
    ];
    const playlist = payload.data.playlists[0];
    if (playlist === undefined) {
      throw new Error("Expected playlist entry in the import fixture.");
    }
    playlist.items = [
      ...playlist.items,
      {
        content: { sourceType: "odysee", sourceExternalId: "missing-item" },
        position: 10,
        addedAt: "2026-08-06T00:00:00.000Z",
      },
    ];

    const result = await importUserDataForUser(testDatabase.db, { userId: "user-a", exportData: payload });

    expect(result.report.failures).toEqual([]);
    expect(result.report.warnings).toContainEqual({
      entityType: "content-status",
      entityKey: "peertube:missing-video",
      severity: "warning",
      reason: "Content status references content that is not in the catalog.",
    });
    expect(result.report.warnings).toContainEqual({
      entityType: "playlist-item",
      entityKey: "Watch Later:odysee:missing-item",
      severity: "warning",
      reason: "Playlist item references content that is not in the catalog.",
    });
    expect(result.report.counts.contentStatuses).toBe(2);
    expect(result.report.counts.playlistItems).toBe(1);
    expect(await testDatabase.db.select().from(schema.contentStatus)).toHaveLength(2);
    expect(await testDatabase.db.select().from(schema.playlistItem)).toHaveLength(1);
  });

  test("unresolved creators become warnings for subscriptions and collection members", async () => {
    await insertUser(testDatabase.db, "user-a", "import-unresolved-creator@example.test");
    await seedCatalog(testDatabase.db);
    const payload = buildExportPayload();
    payload.data.subscriptions = [{ creator: { nameKey: "missingcreator" }, titleOverride: null, settingsJson: null }];
    const collection = payload.data.collections[0];
    if (collection === undefined) {
      throw new Error("Expected collection entry in the import fixture.");
    }
    collection.members = [{ creator: { nameKey: "missingcreator" } }];

    const result = await importUserDataForUser(testDatabase.db, { userId: "user-a", exportData: payload });

    expect(result.report.failures).toEqual([]);
    expect(result.report.warnings).toContainEqual({
      entityType: "subscription",
      entityKey: "missingcreator",
      severity: "warning",
      reason: "Subscription references a creator that is not in the catalog.",
    });
    expect(result.report.warnings).toContainEqual({
      entityType: "collection-member",
      entityKey: "Daily:missingcreator",
      severity: "warning",
      reason: "Collection member references a creator that is not in the catalog.",
    });
    expect(result.report.counts.subscriptions).toBe(0);
    expect(result.report.counts.collectionMembers).toBe(0);
    expect(result.report.counts.collections).toBe(1);
    expect(await testDatabase.db.select().from(schema.subscription)).toHaveLength(0);
    expect(await testDatabase.db.select().from(schema.collectionMember)).toHaveLength(0);
    expect(await testDatabase.db.select().from(schema.creatorCollection)).toHaveLength(1);
  });

  test("malformed payloads fail validation with zero writes", async () => {
    await insertUser(testDatabase.db, "user-a", "import-malformed@example.test");
    await seedCatalog(testDatabase.db);

    const result = await importUserDataForUser(testDatabase.db, {
      userId: "user-a",
      exportData: { format: "something-else", version: 1, data: {} },
    });

    expect(result.skipped).toBe(false);
    expect(result.report.failures.length).toBeGreaterThan(0);
    expect(result.report.failures[0]).toMatchObject({ entityType: "user-data-export", severity: "error" });
    expect(result.report.warnings).toEqual([]);
    expect(await testDatabase.db.select().from(schema.subscription)).toHaveLength(0);
    expect(await testDatabase.db.select().from(schema.contentStatus)).toHaveLength(0);
    expect(await testDatabase.db.select().from(schema.playlist)).toHaveLength(0);
    expect(await testDatabase.db.select().from(schema.creatorCollection)).toHaveLength(0);
    expect(await testDatabase.db.select().from(schema.userSetting)).toHaveLength(0);
  });

  test("a changed payload re-imports after a prior import instead of short-circuiting", async () => {
    await insertUser(testDatabase.db, "user-a", "import-changed@example.test");
    await seedCatalog(testDatabase.db);
    await importUserDataForUser(testDatabase.db, { userId: "user-a", exportData: buildExportPayload() });

    const changed = buildExportPayload();
    changed.exportedAt = "2026-08-31T00:00:00.000Z";
    changed.data.settings = [{ key: "reader.layout", valueJson: JSON.stringify("spacious") }];
    const second = await importUserDataForUser(testDatabase.db, { userId: "user-a", exportData: changed });

    expect(second.skipped).toBe(false);
    const layoutSetting = await testDatabase.db.query.userSetting.findFirst({
      where: andKey("user-a", "reader.layout"),
    });
    expect(layoutSetting?.valueJson).toBe(JSON.stringify("spacious"));
  });

  test("imports stay scoped to the requesting user", async () => {
    await insertUser(testDatabase.db, "user-a", "import-scope-a@example.test");
    await insertUser(testDatabase.db, "user-b", "import-scope-b@example.test");
    await seedCatalog(testDatabase.db);
    const payload = buildExportPayload();

    await importUserDataForUser(testDatabase.db, { userId: "user-a", exportData: payload });
    await importUserDataForUser(testDatabase.db, { userId: "user-b", exportData: payload });

    const subscriptions = await testDatabase.db.select().from(schema.subscription);
    const statuses = await testDatabase.db.select().from(schema.contentStatus);
    const playlists = await testDatabase.db.select().from(schema.playlist);
    expect(subscriptions.map((subscription) => subscription.userId).sort()).toEqual(["user-a", "user-b"]);
    expect(statuses).toHaveLength(4);
    expect(statuses.filter((status) => status.userId === "user-a")).toHaveLength(2);
    expect(statuses.filter((status) => status.userId === "user-b")).toHaveLength(2);
    expect(playlists.map((playlist) => playlist.userId).sort()).toEqual(["user-a", "user-b"]);
  });
});

function buildExportPayload(): UserDataExport {
  return {
    format: "feedelity.user-data",
    version: 1,
    exportedAt: "2026-08-30T00:00:00.000Z",
    data: {
      subscriptions: [{ creator: { nameKey: "importcreator" }, titleOverride: null, settingsJson: null }],
      contentStatuses: [
        {
          content: { sourceType: "youtube", sourceExternalId: "import-video-1" },
          status: "opened",
          metadataJson: playbackMetadataJson,
          createdAt: "2026-08-01T00:00:00.000Z",
          updatedAt: "2026-08-02T12:00:00.000Z",
        },
        {
          content: { sourceType: "youtube", sourceExternalId: "import-video-1" },
          status: "favorite",
          metadataJson: null,
          createdAt: "2026-08-03T00:00:00.000Z",
          updatedAt: "2026-08-03T00:00:00.000Z",
        },
      ],
      playlists: [
        {
          name: "Watch Later",
          description: "Imported playlist",
          sortMode: "manual",
          position: 0,
          items: [
            {
              content: { sourceType: "youtube", sourceExternalId: "import-video-1" },
              position: 0,
              addedAt: "2026-08-05T09:30:00.000Z",
            },
          ],
        },
      ],
      collections: [
        {
          name: "Daily",
          description: null,
          position: 1,
          members: [{ creator: { nameKey: "importcreator" } }],
        },
      ],
      settings: [{ key: "reader.layout", valueJson: JSON.stringify("compact") }],
    },
  };
}

async function seedCatalog(db: RepositoryDb): Promise<void> {
  const creator = await findOrCreateCreator(db, { displayName: "Import Creator" });
  await findOrCreateContentItem(db, {
    creatorId: creator.id,
    sourceType: "youtube",
    sourceExternalId: "import-video-1",
    title: "Import video 1",
  });
}

async function insertUser(db: RepositoryDb, id: string, email: string): Promise<void> {
  await db.insert(schema.user).values({
    id,
    name: id,
    email,
    emailVerified: true,
  });
}

function eqUser(userId: string) {
  return eq(schema.userSetting.userId, userId);
}

function andKey(userId: string, key: string) {
  return and(eq(schema.userSetting.userId, userId), eq(schema.userSetting.key, key));
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
  `CREATE TABLE content_item (
    id TEXT PRIMARY KEY,
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
  `CREATE TABLE creator_collection (
    id TEXT PRIMARY KEY NOT NULL,
    user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    description TEXT,
    position INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)),
    updated_at INTEGER NOT NULL DEFAULT (cast(unixepoch('subsecond') * 1000 as integer))
  )`,
  "CREATE UNIQUE INDEX creator_collection_id_user_uidx ON creator_collection (id, user_id)",
  `CREATE TABLE collection_member (
    id TEXT PRIMARY KEY NOT NULL,
    user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
    collection_id TEXT NOT NULL REFERENCES creator_collection(id) ON DELETE CASCADE,
    creator_id TEXT NOT NULL REFERENCES creator(id) ON DELETE CASCADE,
    added_at INTEGER NOT NULL DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)),
    CONSTRAINT collection_member_collection_owner_fk FOREIGN KEY (collection_id, user_id) REFERENCES creator_collection(id, user_id) ON DELETE CASCADE
  )`,
  "CREATE UNIQUE INDEX collection_member_collection_creator_uidx ON collection_member (collection_id, creator_id)",
  `CREATE TABLE user_setting (
    id TEXT PRIMARY KEY NOT NULL,
    user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
    key TEXT NOT NULL,
    value_json TEXT NOT NULL,
    created_at INTEGER NOT NULL DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)),
    updated_at INTEGER NOT NULL DEFAULT (cast(unixepoch('subsecond') * 1000 as integer))
  )`,
  "CREATE UNIQUE INDEX user_setting_user_key_uidx ON user_setting (user_id, key)",
];
