import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { createClient } from "@libsql/client";
import type { Client } from "@libsql/client";
import { call } from "@orpc/server";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/libsql";

import * as schema from "@FeedElity/db/schema";

import type { AccountState, Context } from "../context";
import type { RepositoryDb } from "../repositories/catalog";
import { findOrCreateContentItem, findOrCreateCreator } from "../repositories/catalog";
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

describe("playlist API", () => {
  test("authenticated users can create, list, update, and delete their playlists", async () => {
    await insertUser(testDatabase.db, "user-a", "user-a@example.test", "active");
    await insertUser(testDatabase.db, "user-b", "user-b@example.test", "active");

    const created = await call(appRouter.overlays.createPlaylist, {
      name: " Watch later ",
      description: " Videos to watch soon ",
      position: 10,
    }, { context: authenticatedContext(testDatabase.db, "user-a", "active") });
    await call(appRouter.overlays.createPlaylist, { name: "User B playlist" }, {
      context: authenticatedContext(testDatabase.db, "user-b", "active"),
    });
    const updated = await call(appRouter.overlays.updatePlaylist, {
      playlistId: created.id,
      name: "Queue",
      description: null,
      sortMode: "added_at_desc",
      position: 0,
    }, { context: authenticatedContext(testDatabase.db, "user-a", "active") });
    const userAPlaylists = await call(appRouter.overlays.playlists, undefined, {
      context: authenticatedContext(testDatabase.db, "user-a", "active"),
    });
    const crossUserDelete = await call(appRouter.overlays.deletePlaylist, { playlistId: created.id }, {
      context: authenticatedContext(testDatabase.db, "user-b", "active"),
    });
    const ownerDelete = await call(appRouter.overlays.deletePlaylist, { playlistId: created.id }, {
      context: authenticatedContext(testDatabase.db, "user-a", "active"),
    });
    const userAPlaylistsAfterDelete = await call(appRouter.overlays.playlists, undefined, {
      context: authenticatedContext(testDatabase.db, "user-a", "active"),
    });

    expect(created).toMatchObject({ userId: "user-a", name: "Watch later", description: "Videos to watch soon" });
    expect(updated).toMatchObject({ id: created.id, userId: "user-a", name: "Queue", description: null });
    expect(userAPlaylists).toHaveLength(1);
    expect(JSON.stringify(userAPlaylists)).not.toContain("User B playlist");
    expect(crossUserDelete).toEqual({ deleted: false });
    expect(ownerDelete).toEqual({ deleted: true });
    expect(userAPlaylistsAfterDelete).toHaveLength(0);
  });

  test("playlist items can be added idempotently, listed with content summaries, reordered, and removed", async () => {
    await insertUser(testDatabase.db, "user-a", "user-a@example.test", "active");
    await insertUser(testDatabase.db, "user-b", "user-b@example.test", "active");
    const creator = await findOrCreateCreator(testDatabase.db, {
      sourceType: "youtube",
      sourceExternalId: "playlist-api-channel",
      displayName: "Playlist API Creator",
    });
    const firstContentItem = await findOrCreateContentItem(testDatabase.db, {
      creatorId: creator.id,
      sourceType: "youtube",
      sourceExternalId: "playlist-api-video-1",
      title: "First playlist API video",
    });
    const secondContentItem = await findOrCreateContentItem(testDatabase.db, {
      creatorId: creator.id,
      sourceType: "youtube",
      sourceExternalId: "playlist-api-video-2",
      title: "Second playlist API video",
    });
    const playlist = await call(appRouter.overlays.createPlaylist, { name: "Queue" }, {
      context: authenticatedContext(testDatabase.db, "user-a", "active"),
    });

    const firstItem = await call(appRouter.overlays.addPlaylistItem, {
      playlistId: playlist.id,
      contentItemId: firstContentItem.id,
    }, { context: authenticatedContext(testDatabase.db, "user-a", "active") });
    const duplicateFirstItem = await call(appRouter.overlays.addPlaylistItem, {
      playlistId: playlist.id,
      contentItemId: firstContentItem.id,
    }, { context: authenticatedContext(testDatabase.db, "user-a", "active") });
    const secondItem = await call(appRouter.overlays.addPlaylistItem, {
      playlistId: playlist.id,
      contentItemId: secondContentItem.id,
    }, { context: authenticatedContext(testDatabase.db, "user-a", "active") });
    const listedItems = await call(appRouter.overlays.playlistItems, { playlistId: playlist.id }, {
      context: authenticatedContext(testDatabase.db, "user-a", "active"),
    });
    const reorderedItems = await call(appRouter.overlays.reorderPlaylistItems, {
      playlistId: playlist.id,
      playlistItemIds: [secondItem.id, firstItem.id],
    }, { context: authenticatedContext(testDatabase.db, "user-a", "active") });
    const crossUserItems = await call(appRouter.overlays.playlistItems, { playlistId: playlist.id }, {
      context: authenticatedContext(testDatabase.db, "user-b", "active"),
    });
    const crossUserRemove = await call(appRouter.overlays.removePlaylistItem, {
      playlistId: playlist.id,
      playlistItemId: secondItem.id,
    }, { context: authenticatedContext(testDatabase.db, "user-b", "active") });
    const ownerRemove = await call(appRouter.overlays.removePlaylistItem, {
      playlistId: playlist.id,
      playlistItemId: secondItem.id,
    }, { context: authenticatedContext(testDatabase.db, "user-a", "active") });
    const finalItems = await call(appRouter.overlays.playlistItems, { playlistId: playlist.id }, {
      context: authenticatedContext(testDatabase.db, "user-a", "active"),
    });

    expect(duplicateFirstItem.id).toBe(firstItem.id);
    expect(listedItems.map((item) => item.contentItemId)).toEqual([firstContentItem.id, secondContentItem.id]);
    expect(listedItems[0]).toMatchObject({ content: { id: firstContentItem.id, title: "First playlist API video" } });
    expect(reorderedItems.map((item) => item.contentItemId)).toEqual([secondContentItem.id, firstContentItem.id]);
    expect(reorderedItems.map((item) => item.position)).toEqual([0, 10]);
    expect(crossUserItems).toHaveLength(0);
    expect(crossUserRemove).toEqual({ removed: false });
    expect(ownerRemove).toEqual({ removed: true });
    expect(finalItems.map((item) => item.contentItemId)).toEqual([firstContentItem.id]);
  });

  test("playlist item operations reject anonymous callers, missing content, and cross-user reorders", async () => {
    await insertUser(testDatabase.db, "user-a", "user-a@example.test", "active");
    await insertUser(testDatabase.db, "user-b", "user-b@example.test", "active");
    const creator = await findOrCreateCreator(testDatabase.db, {
      sourceType: "odysee",
      sourceExternalId: "playlist-rejection-channel",
      displayName: "Playlist Rejection Creator",
    });
    const contentItem = await findOrCreateContentItem(testDatabase.db, {
      creatorId: creator.id,
      sourceType: "odysee",
      sourceExternalId: "playlist-rejection-video",
      title: "Playlist rejection video",
    });
    const playlist = await call(appRouter.overlays.createPlaylist, { name: "Queue" }, {
      context: authenticatedContext(testDatabase.db, "user-a", "active"),
    });
    const playlistItem = await call(appRouter.overlays.addPlaylistItem, {
      playlistId: playlist.id,
      contentItemId: contentItem.id,
    }, { context: authenticatedContext(testDatabase.db, "user-a", "active") });

    await expect(
      call(appRouter.overlays.createPlaylist, { name: "Anonymous" }, { context: anonymousContext(testDatabase.db) }),
    ).rejects.toHaveProperty("code", "UNAUTHORIZED");
    await expect(
      call(appRouter.overlays.addPlaylistItem, { playlistId: playlist.id, contentItemId: "missing-content" }, {
        context: authenticatedContext(testDatabase.db, "user-a", "active"),
      }),
    ).rejects.toHaveProperty("code", "NOT_FOUND");
    await expect(
      call(appRouter.overlays.addPlaylistItem, { playlistId: playlist.id, contentItemId: contentItem.id }, {
        context: authenticatedContext(testDatabase.db, "user-b", "active"),
      }),
    ).rejects.toHaveProperty("code", "NOT_FOUND");
    await expect(
      call(appRouter.overlays.reorderPlaylistItems, { playlistId: playlist.id, playlistItemIds: [playlistItem.id] }, {
        context: authenticatedContext(testDatabase.db, "user-b", "active"),
      }),
    ).rejects.toHaveProperty("code", "NOT_FOUND");
  });

  test("empty playlist reorders still require owning playlist access", async () => {
    await insertUser(testDatabase.db, "user-a", "empty-owner@example.test", "active");
    await insertUser(testDatabase.db, "user-b", "empty-other@example.test", "active");
    const emptyPlaylist = await call(appRouter.overlays.createPlaylist, { name: "Empty queue" }, {
      context: authenticatedContext(testDatabase.db, "user-a", "active"),
    });

    const ownerReorder = await call(appRouter.overlays.reorderPlaylistItems, {
      playlistId: emptyPlaylist.id,
      playlistItemIds: [],
    }, { context: authenticatedContext(testDatabase.db, "user-a", "active") });

    expect(ownerReorder).toEqual([]);
    await expect(
      call(appRouter.overlays.reorderPlaylistItems, { playlistId: emptyPlaylist.id, playlistItemIds: [] }, {
        context: authenticatedContext(testDatabase.db, "user-b", "active"),
      }),
    ).rejects.toHaveProperty("code", "NOT_FOUND");
    await expect(
      call(appRouter.overlays.reorderPlaylistItems, { playlistId: "missing-playlist", playlistItemIds: [] }, {
        context: authenticatedContext(testDatabase.db, "user-a", "active"),
      }),
    ).rejects.toHaveProperty("code", "NOT_FOUND");
  });

  test("playlist item listing honors each playlist sort mode", async () => {
    await insertUser(testDatabase.db, "user-a", "sort-owner@example.test", "active");
    const creator = await findOrCreateCreator(testDatabase.db, {
      sourceType: "youtube",
      sourceExternalId: "playlist-sort-channel",
      displayName: "Playlist Sort Creator",
    });
    const olderContentItem = await findOrCreateContentItem(testDatabase.db, {
      creatorId: creator.id,
      sourceType: "youtube",
      sourceExternalId: "playlist-sort-video-older",
      title: "Older playlist sort video",
      publishedAt: new Date("2025-01-01T00:00:00.000Z"),
    });
    const newerContentItem = await findOrCreateContentItem(testDatabase.db, {
      creatorId: creator.id,
      sourceType: "youtube",
      sourceExternalId: "playlist-sort-video-newer",
      title: "Newer playlist sort video",
      publishedAt: new Date("2025-02-01T00:00:00.000Z"),
    });

    const modes = ["manual", "published_at_desc", "published_at_asc", "added_at_desc", "added_at_asc"] as const;
    const listedOrders = new Map<(typeof modes)[number], readonly string[]>();

    for (const sortMode of modes) {
      const playlist = await call(appRouter.overlays.createPlaylist, { name: `Queue ${sortMode}`, sortMode }, {
        context: authenticatedContext(testDatabase.db, "user-a", "active"),
      });
      const firstItem = await call(appRouter.overlays.addPlaylistItem, {
        playlistId: playlist.id,
        contentItemId: olderContentItem.id,
      }, { context: authenticatedContext(testDatabase.db, "user-a", "active") });
      const secondItem = await call(appRouter.overlays.addPlaylistItem, {
        playlistId: playlist.id,
        contentItemId: newerContentItem.id,
      }, { context: authenticatedContext(testDatabase.db, "user-a", "active") });

      await testDatabase.db
        .update(schema.playlistItem)
        .set({ addedAt: new Date("2025-03-01T00:00:00.000Z") })
        .where(eq(schema.playlistItem.id, firstItem.id));
      await testDatabase.db
        .update(schema.playlistItem)
        .set({ addedAt: new Date("2025-04-01T00:00:00.000Z") })
        .where(eq(schema.playlistItem.id, secondItem.id));

      const listedItems = await call(appRouter.overlays.playlistItems, { playlistId: playlist.id }, {
        context: authenticatedContext(testDatabase.db, "user-a", "active"),
      });
      listedOrders.set(sortMode, listedItems.map((item) => item.contentItemId));
    }

    expect(listedOrders.get("manual")).toEqual([olderContentItem.id, newerContentItem.id]);
    expect(listedOrders.get("published_at_desc")).toEqual([newerContentItem.id, olderContentItem.id]);
    expect(listedOrders.get("published_at_asc")).toEqual([olderContentItem.id, newerContentItem.id]);
    expect(listedOrders.get("added_at_desc")).toEqual([newerContentItem.id, olderContentItem.id]);
    expect(listedOrders.get("added_at_asc")).toEqual([olderContentItem.id, newerContentItem.id]);
  });
});

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
];
