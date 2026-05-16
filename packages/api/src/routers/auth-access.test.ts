import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { createClient } from "@libsql/client";
import type { Client } from "@libsql/client";
import { call } from "@orpc/server";
import { drizzle } from "drizzle-orm/libsql";

import * as schema from "@FeedElity/db/schema";

import type { AccountState, Context } from "../context";
import type { RepositoryDb } from "../repositories/catalog";
import { findOrCreateContentItem, findOrCreateCreator } from "../repositories/catalog";
import { createPlaylist, findOrCreateSubscription, saveUserSetting } from "../repositories/overlays";
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

describe("auth access rules", () => {
  test("anonymous users can read public catalog items without user overlays", async () => {
    await insertUser(testDatabase.db, "user-a", "catalog-owner@example.test", "active");
    const creator = await findOrCreateCreator(testDatabase.db, {
      sourceType: "youtube",
      sourceExternalId: "public-channel",
      displayName: "Public Creator",
    });
    await findOrCreateContentItem(testDatabase.db, {
      creatorId: creator.id,
      sourceType: "youtube",
      sourceExternalId: "public-video",
      title: "Public video",
    });
    await findOrCreateSubscription(testDatabase.db, {
      userId: "user-a",
      creatorId: creator.id,
      titleOverride: "Private title",
    });

    const rows = await call(appRouter.catalog.contentItems, undefined, { context: anonymousContext(testDatabase.db) });

    expect(rows).toHaveLength(1);
    const firstRow = rows.at(0);
    if (firstRow === undefined) {
      throw new Error("Expected public catalog procedure to return the seeded content item.");
    }
    expect(firstRow).toMatchObject({ title: "Public video" });
    expect("userId" in firstRow).toBe(false);
  });

  test("anonymous users cannot read protected overlays", async () => {
    await expect(
      call(appRouter.overlays.subscriptions, undefined, { context: anonymousContext(testDatabase.db) }),
    ).rejects.toHaveProperty("code", "UNAUTHORIZED");
  });

  test("session restore returns a safe session view without credential tokens", async () => {
    const current = await call(appRouter.session.current, undefined, {
      context: authenticatedContext(testDatabase.db, "user-a", "active"),
    });

    if (current === null) {
      throw new Error("Expected session.current to return the authenticated session view.");
    }
    expect(current).toEqual({
      session: {
        id: "session-user-a",
        expiresAt: new Date("2026-01-02T00:00:00.000Z"),
      },
      user: {
        id: "user-a",
        name: "user-a",
        email: "user-a@example.test",
        emailVerified: true,
        image: null,
        accountState: "active",
      },
    });
    expect("token" in current.session).toBe(false);
    expect("userId" in current.session).toBe(false);
  });

  test("protected overlay procedures derive ownership from the session user", async () => {
    await insertUser(testDatabase.db, "user-a", "user-a@example.test", "active");
    await insertUser(testDatabase.db, "user-b", "user-b@example.test", "active");
    const creator = await findOrCreateCreator(testDatabase.db, {
      sourceType: "odysee",
      sourceExternalId: "scoped-channel",
      displayName: "Scoped Creator",
    });
    await findOrCreateSubscription(testDatabase.db, {
      userId: "user-a",
      creatorId: creator.id,
      titleOverride: "User A subscription",
    });
    await findOrCreateSubscription(testDatabase.db, {
      userId: "user-b",
      creatorId: creator.id,
      titleOverride: "User B subscription",
    });
    await createPlaylist(testDatabase.db, {
      userId: "user-a",
      name: "User A queue",
    });
    await createPlaylist(testDatabase.db, {
      userId: "user-b",
      name: "User B queue",
    });
    await saveUserSetting(testDatabase.db, {
      userId: "user-b",
      key: "reader.layout",
      valueJson: JSON.stringify({ density: "comfortable" }),
    });

    const subscriptions = await call(appRouter.overlays.subscriptions, undefined, {
      context: authenticatedContext(testDatabase.db, "user-a", "active"),
    });
    const playlists = await call(appRouter.overlays.playlists, undefined, {
      context: authenticatedContext(testDatabase.db, "user-a", "active"),
    });
    const settings = await call(appRouter.overlays.settings, undefined, {
      context: authenticatedContext(testDatabase.db, "user-a", "active"),
    });

    expect(subscriptions).toHaveLength(1);
    const subscription = subscriptions.at(0);
    if (subscription === undefined) {
      throw new Error("Expected protected subscription procedure to return user A's subscription.");
    }
    expect(subscription).toMatchObject({ userId: "user-a", titleOverride: "User A subscription" });
    expect(playlists).toHaveLength(1);
    const playlist = playlists.at(0);
    if (playlist === undefined) {
      throw new Error("Expected protected playlist procedure to return user A's playlist.");
    }
    expect(playlist).toMatchObject({ userId: "user-a", name: "User A queue" });
    expect(settings).toHaveLength(0);
  });

  test("migrated pending users cannot access protected procedures until password setup is complete", async () => {
    await insertUser(
      testDatabase.db,
      "migrated-user",
      "migrated@example.test",
      "migrated_pending_password_setup",
    );

    await expect(
      call(appRouter.overlays.subscriptions, undefined, {
        context: authenticatedContext(testDatabase.db, "migrated-user", "migrated_pending_password_setup"),
      }),
    ).rejects.toHaveProperty("code", "FORBIDDEN");
  });
});

function anonymousContext(db: RepositoryDb): Context {
  return {
    db,
    session: null,
  };
}

function authenticatedContext(db: RepositoryDb, userId: string, accountState: AccountState): Context {
  const now = new Date("2026-01-01T00:00:00.000Z");
  return {
    db,
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
  `CREATE TABLE playlist_item (
    id TEXT PRIMARY KEY NOT NULL,
    user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
    playlist_id TEXT NOT NULL REFERENCES playlist(id) ON DELETE CASCADE,
    content_item_id TEXT NOT NULL REFERENCES content_item(id) ON DELETE CASCADE,
    position INTEGER NOT NULL,
    added_at INTEGER NOT NULL DEFAULT (cast(unixepoch('subsecond') * 1000 as integer))
  )`,
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
