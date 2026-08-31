import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { createClient } from "@libsql/client";
import type { Client } from "@libsql/client";
import { call } from "@orpc/server";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/libsql";

import * as schema from "@FeedElity/db/schema";

import type { AccountState, Context } from "../context";
import { exportUserDataForUser } from "../migration/user-data-export";
import type { UserDataExport } from "../migration/user-data-schema";
import type { RepositoryDb } from "../repositories/catalog";
import { findOrCreateContentItem, findOrCreateCreator } from "../repositories/catalog";
import {
  addCollectionMember,
  addPlaylistItem,
  createCollection,
  createPlaylist,
  findOrCreateContentStatus,
  findOrCreateSubscription,
  saveUserSetting,
  upsertPlaybackPositionForUser,
} from "../repositories/overlays";
import { createSourceAdapterRegistry } from "../sources";
import { appRouter } from "./index";

const testSourceRegistry = createSourceAdapterRegistry();

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

describe("user data API", () => {
  test("user data procedures reject anonymous callers", async () => {
    await insertUser(testDatabase.db, "user-a", "userdata-anon@example.test", "active");

    await expect(
      call(appRouter.overlays.exportUserData, undefined, { context: anonymousContext(testDatabase.db) }),
    ).rejects.toHaveProperty("code", "UNAUTHORIZED");
    await expect(
      call(appRouter.overlays.importUserData, { exportData: {} }, { context: anonymousContext(testDatabase.db) }),
    ).rejects.toHaveProperty("code", "UNAUTHORIZED");
  });

  test("export -> wipe overlays -> import -> export reproduces the envelope modulo exportedAt", async () => {
    await seedOverlays(testDatabase.db, "user-a", "roundtrip@example.test");

    const first = await call(appRouter.overlays.exportUserData, undefined, {
      context: authenticatedContext(testDatabase.db, "user-a", "active"),
    });
    await wipeOverlays(testDatabase.db, "user-a");
    expect(await listOverlayRowCounts("user-a")).toEqual(zeroRowCounts());

    const importResult = await call(appRouter.overlays.importUserData, { exportData: first }, {
      context: authenticatedContext(testDatabase.db, "user-a", "active"),
    });
    expect(importResult.skipped).toBe(false);
    expect(importResult.report.failures).toEqual([]);
    expect(importResult.report.warnings).toEqual([]);
    expect(importResult.report.counts).toEqual({
      subscriptions: 1,
      contentStatuses: 3,
      playlists: 1,
      playlistItems: 2,
      collections: 1,
      collectionMembers: 1,
      settings: 2,
    });

    const second = await call(appRouter.overlays.exportUserData, undefined, {
      context: authenticatedContext(testDatabase.db, "user-a", "active"),
    });
    expect(withoutExportedAt(second)).toEqual(withoutExportedAt(first));

    const repeatResult = await call(appRouter.overlays.importUserData, { exportData: first }, {
      context: authenticatedContext(testDatabase.db, "user-a", "active"),
    });
    expect(repeatResult.skipped).toBe(true);
    expect(repeatResult.report.counts).toEqual(zeroRowCounts());
    expect(repeatResult.report.warnings).toEqual([]);
    expect(repeatResult.report.failures).toEqual([]);
  });

  test("importing another user's export writes only into the authenticated user's overlays", async () => {
    await seedOverlays(testDatabase.db, "user-a", "isolation-a@example.test");
    await insertUser(testDatabase.db, "user-b", "isolation-b@example.test", "active");
    const exportOfA = await exportUserDataForUser(testDatabase.db, "user-a");
    const rowsBefore = await listOverlayRowCounts("user-a");

    const result = await call(appRouter.overlays.importUserData, { exportData: exportOfA }, {
      context: authenticatedContext(testDatabase.db, "user-b", "active"),
    });

    expect(result.skipped).toBe(false);
    expect(result.report.failures).toEqual([]);
    const rowsForA = await listOverlayRowCounts("user-a");
    expect(rowsForA).toEqual(rowsBefore);
    const statusesForB = await testDatabase.db
      .select()
      .from(schema.contentStatus)
      .where(eq(schema.contentStatus.userId, "user-b"));
    expect(statusesForB).toHaveLength(3);
    expect(statusesForB.every((status) => status.userId === "user-b")).toBe(true);
  });
});

interface OverlayRowCounts {
  readonly subscriptions: number;
  readonly contentStatuses: number;
  readonly playlists: number;
  readonly playlistItems: number;
  readonly collections: number;
  readonly collectionMembers: number;
  readonly settings: number;
}

function zeroRowCounts(): OverlayRowCounts {
  return {
    subscriptions: 0,
    contentStatuses: 0,
    playlists: 0,
    playlistItems: 0,
    collections: 0,
    collectionMembers: 0,
    settings: 0,
  };
}

function withoutExportedAt(envelope: UserDataExport): Omit<UserDataExport, "exportedAt"> {
  return {
    format: envelope.format,
    version: envelope.version,
    data: envelope.data,
  };
}

async function seedOverlays(db: RepositoryDb, userId: string, email: string): Promise<void> {
  await insertUser(db, userId, email, "active");
  const creator = await findOrCreateCreator(db, { displayName: "Round Trip Channel" });
  const firstItem = await findOrCreateContentItem(db, {
    creatorId: creator.id,
    sourceType: "youtube",
    sourceExternalId: "roundtrip-video-1",
    title: "Round trip video 1",
  });
  const secondItem = await findOrCreateContentItem(db, {
    creatorId: creator.id,
    sourceType: "odysee",
    sourceExternalId: "roundtrip-video-2",
    title: "Round trip video 2",
  });

  await findOrCreateSubscription(db, { userId, creatorId: creator.id });
  await upsertPlaybackPositionForUser(db, {
    userId,
    contentItemId: firstItem.id,
    positionSeconds: 95,
    durationSeconds: 1_200,
  });
  await findOrCreateContentStatus(db, { userId, contentItemId: firstItem.id, status: "favorite" });
  await findOrCreateContentStatus(db, { userId, contentItemId: secondItem.id, status: "played" });

  const playlist = await createPlaylist(db, {
    userId,
    name: "Round Trip Playlist",
    description: "Before the wipe",
    position: 3,
  });
  await addPlaylistItem(db, {
    userId,
    playlistId: playlist.id,
    contentItemId: firstItem.id,
    position: 0,
    addedAt: new Date("2026-08-20T10:00:00.000Z"),
  });
  await addPlaylistItem(db, {
    userId,
    playlistId: playlist.id,
    contentItemId: secondItem.id,
    position: 10,
    addedAt: new Date("2026-08-21T10:00:00.000Z"),
  });

  const collection = await createCollection(db, { userId, name: "Round Trip Collection", position: 1 });
  await addCollectionMember(db, { userId, collectionId: collection.id, creatorId: creator.id });

  await saveUserSetting(db, { userId, key: "player.autoplay", valueJson: JSON.stringify("disabled") });
  await saveUserSetting(db, { userId, key: "reader.layout", valueJson: JSON.stringify("compact") });
}

async function wipeOverlays(db: RepositoryDb, userId: string): Promise<void> {
  await db.delete(schema.collectionMember).where(eq(schema.collectionMember.userId, userId));
  await db.delete(schema.creatorCollection).where(eq(schema.creatorCollection.userId, userId));
  await db.delete(schema.playlistItem).where(eq(schema.playlistItem.userId, userId));
  await db.delete(schema.playlist).where(eq(schema.playlist.userId, userId));
  await db.delete(schema.contentStatus).where(eq(schema.contentStatus.userId, userId));
  await db.delete(schema.subscription).where(eq(schema.subscription.userId, userId));
  await db.delete(schema.userSetting).where(eq(schema.userSetting.userId, userId));
}

async function listOverlayRowCounts(userId: string): Promise<OverlayRowCounts> {
  const db = testDatabase.db;
  return {
    subscriptions: (await db.select().from(schema.subscription).where(eq(schema.subscription.userId, userId))).length,
    contentStatuses: (await db.select().from(schema.contentStatus).where(eq(schema.contentStatus.userId, userId))).length,
    playlists: (await db.select().from(schema.playlist).where(eq(schema.playlist.userId, userId))).length,
    playlistItems: (await db.select().from(schema.playlistItem).where(eq(schema.playlistItem.userId, userId))).length,
    collections: (
      await db.select().from(schema.creatorCollection).where(eq(schema.creatorCollection.userId, userId))
    ).length,
    collectionMembers: (
      await db.select().from(schema.collectionMember).where(eq(schema.collectionMember.userId, userId))
    ).length,
    settings: (await db.select().from(schema.userSetting).where(eq(schema.userSetting.userId, userId))).length,
  };
}

function anonymousContext(db: RepositoryDb): Context {
  return {
    db,
    sourceRegistry: testSourceRegistry,
    session: null,
  };
}

function authenticatedContext(db: RepositoryDb, userId: string, accountState: AccountState): Context {
  const now = new Date("2026-01-01T00:00:00.000Z");
  return {
    db,
    sourceRegistry: testSourceRegistry,
    session: {
      session: {
        id: `session-${userId}`,
        userId,
        expiresAt: new Date("2026-01-02T00:00:00.000Z"),
        createdAt: now,
        updatedAt: now,
      },
      user: {
        id: userId,
        name: userId,
        email: `${userId}@example.test`,
        emailVerified: true,
        image: null,
        createdAt: now,
        updatedAt: now,
        accountState,
      },
    },
  };
}

async function insertUser(db: RepositoryDb, id: string, email: string, accountState: AccountState): Promise<void> {
  await db.insert(schema.user).values({
    id,
    name: id,
    email,
    emailVerified: true,
    accountState,
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
