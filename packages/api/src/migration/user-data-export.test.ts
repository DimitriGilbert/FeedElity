import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { createClient } from "@libsql/client";
import type { Client } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";

import * as schema from "@FeedElity/db/schema";

import { exportUserDataForUser } from "./user-data-export";
import { USER_DATA_FINGERPRINT_SETTING_KEY } from "./user-data-schema";
import type { UserDataExport } from "./user-data-schema";
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
} from "../repositories/overlays";

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

describe("user data export", () => {
  test("exports the signed-in user's overlays attributed by natural keys", async () => {
    await insertUser(testDatabase.db, "user-a", "export-a@example.test");
    const alphaCreator = await findOrCreateCreator(testDatabase.db, { displayName: "Alpha Channel" });
    const contentItem = await findOrCreateContentItem(testDatabase.db, {
      creatorId: alphaCreator.id,
      sourceType: "youtube",
      sourceExternalId: "export-video-1",
      title: "Export video 1",
    });
    await findOrCreateSubscription(testDatabase.db, { userId: "user-a", creatorId: alphaCreator.id });
    const playbackMetadataJson = JSON.stringify({
      playback: { positionSeconds: 95, durationSeconds: 1_200, updatedAt: "2026-08-29T10:00:00.000Z" },
    });
    await findOrCreateContentStatus(testDatabase.db, {
      userId: "user-a",
      contentItemId: contentItem.id,
      status: "opened",
      metadataJson: playbackMetadataJson,
    });
    await findOrCreateContentStatus(testDatabase.db, {
      userId: "user-a",
      contentItemId: contentItem.id,
      status: "favorite",
    });
    const playlist = await createPlaylist(testDatabase.db, {
      userId: "user-a",
      name: "Road Trip",
      description: "Long drives",
      position: 4,
    });
    await addPlaylistItem(testDatabase.db, {
      userId: "user-a",
      playlistId: playlist.id,
      contentItemId: contentItem.id,
      position: 0,
      addedAt: new Date("2026-08-15T08:00:00.000Z"),
    });
    const collection = await createCollection(testDatabase.db, {
      userId: "user-a",
      name: "Daily",
      position: 2,
    });
    await addCollectionMember(testDatabase.db, {
      userId: "user-a",
      collectionId: collection.id,
      creatorId: alphaCreator.id,
    });
    await saveUserSetting(testDatabase.db, {
      userId: "user-a",
      key: "reader.layout",
      valueJson: JSON.stringify("compact"),
    });

    const envelope = await exportUserDataForUser(testDatabase.db, "user-a");

    expect(envelope.format).toBe("feedelity.user-data");
    expect(envelope.version).toBe(1);
    expect(Number.isNaN(Date.parse(envelope.exportedAt))).toBe(false);
    expect(envelope.data.subscriptions).toEqual([
      { creator: { nameKey: "alphachannel" }, titleOverride: null, settingsJson: null },
    ]);
    expect(envelope.data.contentStatuses).toEqual([
      {
        content: { sourceType: "youtube", sourceExternalId: "export-video-1" },
        status: "favorite",
        metadataJson: null,
        createdAt: expect.any(String),
        updatedAt: expect.any(String),
      },
      {
        content: { sourceType: "youtube", sourceExternalId: "export-video-1" },
        status: "opened",
        metadataJson: playbackMetadataJson,
        createdAt: expect.any(String),
        updatedAt: expect.any(String),
      },
    ]);
    expect(envelope.data.playlists).toEqual([
      {
        name: "Road Trip",
        description: "Long drives",
        sortMode: "manual",
        position: 4,
        items: [
          {
            content: { sourceType: "youtube", sourceExternalId: "export-video-1" },
            position: 0,
            addedAt: "2026-08-15T08:00:00.000Z",
          },
        ],
      },
    ]);
    expect(envelope.data.collections).toEqual([
      {
        name: "Daily",
        description: null,
        position: 2,
        members: [{ creator: { nameKey: "alphachannel" } }],
      },
    ]);
    expect(envelope.data.settings).toEqual([{ key: "reader.layout", valueJson: JSON.stringify("compact") }]);
  });

  test("export output carries no user ids or internal row ids", async () => {
    await insertUser(testDatabase.db, "user-a", "export-ids@example.test");
    const creator = await findOrCreateCreator(testDatabase.db, { displayName: "Row Id Channel" });
    const contentItem = await findOrCreateContentItem(testDatabase.db, {
      creatorId: creator.id,
      sourceType: "odysee",
      sourceExternalId: "export-ids-video",
      title: "Export ids video",
    });
    await findOrCreateSubscription(testDatabase.db, { userId: "user-a", creatorId: creator.id });
    await findOrCreateContentStatus(testDatabase.db, {
      userId: "user-a",
      contentItemId: contentItem.id,
      status: "opened",
    });
    const playlist = await createPlaylist(testDatabase.db, { userId: "user-a", name: "Id Playlist" });
    await addPlaylistItem(testDatabase.db, {
      userId: "user-a",
      playlistId: playlist.id,
      contentItemId: contentItem.id,
      position: 0,
    });
    const collection = await createCollection(testDatabase.db, { userId: "user-a", name: "Id Collection" });
    await addCollectionMember(testDatabase.db, {
      userId: "user-a",
      collectionId: collection.id,
      creatorId: creator.id,
    });

    const envelope = await exportUserDataForUser(testDatabase.db, "user-a");
    const serialized = JSON.stringify(envelope);

    expect(serialized).not.toContain("user-a");
    expect(serialized).not.toContain(creator.id);
    expect(serialized).not.toContain(contentItem.id);
    expect(serialized).not.toContain(playlist.id);
    expect(serialized).not.toContain(collection.id);
    expect(serialized).not.toContain('"userId"');
    expect(serialized).not.toContain('"id":');
  });

  test("repeated exports are deterministic apart from exportedAt and skip the import fingerprint setting", async () => {
    await insertUser(testDatabase.db, "user-a", "export-stable@example.test");
    // Inserted in reverse alphabetical order to pin the name-key ordering.
    const zetaCreator = await findOrCreateCreator(testDatabase.db, { displayName: "Zeta Channel" });
    const alphaCreator = await findOrCreateCreator(testDatabase.db, { displayName: "Alpha Channel" });
    await findOrCreateSubscription(testDatabase.db, { userId: "user-a", creatorId: zetaCreator.id });
    await findOrCreateSubscription(testDatabase.db, { userId: "user-a", creatorId: alphaCreator.id });
    await saveUserSetting(testDatabase.db, {
      userId: "user-a",
      key: "reader.layout",
      valueJson: JSON.stringify("compact"),
    });
    await saveUserSetting(testDatabase.db, {
      userId: "user-a",
      key: USER_DATA_FINGERPRINT_SETTING_KEY,
      valueJson: JSON.stringify("stale-fingerprint"),
    });

    const first = await exportUserDataForUser(testDatabase.db, "user-a");
    const second = await exportUserDataForUser(testDatabase.db, "user-a");

    expect(second.exportedAt).not.toBe(first.exportedAt);
    expect(withoutExportedAt(second)).toEqual(withoutExportedAt(first));
    expect(first.data.subscriptions.map((subscription) => subscription.creator.nameKey)).toEqual([
      "alphachannel",
      "zetachannel",
    ]);
    expect(first.data.settings).toEqual([{ key: "reader.layout", valueJson: JSON.stringify("compact") }]);
  });
});

function withoutExportedAt(envelope: UserDataExport): Omit<UserDataExport, "exportedAt"> {
  return {
    format: envelope.format,
    version: envelope.version,
    data: envelope.data,
  };
}

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
