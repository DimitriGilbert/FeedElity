import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { createClient } from "@libsql/client";
import type { Client } from "@libsql/client";
import { call } from "@orpc/server";
import { and, eq } from "drizzle-orm";
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

describe("unread API", () => {
  test("unread endpoints reject anonymous callers", async () => {
    await insertUser(testDatabase.db, "user-a", "unread-api-anon@example.test", "active");

    await expect(
      call(appRouter.overlays.unreadCounts, undefined, { context: anonymousContext(testDatabase.db) }),
    ).rejects.toHaveProperty("code", "UNAUTHORIZED");
    await expect(
      call(appRouter.overlays.markCreatorContentOpened, { creatorId: "any-creator" }, {
        context: anonymousContext(testDatabase.db),
      }),
    ).rejects.toHaveProperty("code", "UNAUTHORIZED");
    await expect(
      call(appRouter.overlays.markAllContentOpened, undefined, { context: anonymousContext(testDatabase.db) }),
    ).rejects.toHaveProperty("code", "UNAUTHORIZED");
  });

  test("unread counts surface subscribed content and clear after markCreatorContentOpened", async () => {
    await insertUser(testDatabase.db, "user-a", "unread-api-flow@example.test", "active");
    const creator = await findOrCreateCreator(testDatabase.db, {
      displayName: "Unread API Creator",
    });
    await subscribeAndBackdate("user-a", creator.id);
    await findOrCreateContentItem(testDatabase.db, {
      creatorId: creator.id,
      sourceType: "youtube",
      sourceExternalId: "unread-api-video-1",
      title: "Unread API video 1",
      publishedAt: new Date("2026-01-05T00:00:00.000Z"),
    });
    await findOrCreateContentItem(testDatabase.db, {
      creatorId: creator.id,
      sourceType: "youtube",
      sourceExternalId: "unread-api-video-2",
      title: "Unread API video 2",
      publishedAt: new Date("2026-01-06T00:00:00.000Z"),
    });

    const beforeCounts = await call(appRouter.overlays.unreadCounts, undefined, {
      context: authenticatedContext(testDatabase.db, "user-a", "active"),
    });
    const firstMark = await call(appRouter.overlays.markCreatorContentOpened, { creatorId: creator.id }, {
      context: authenticatedContext(testDatabase.db, "user-a", "active"),
    });
    const afterCounts = await call(appRouter.overlays.unreadCounts, undefined, {
      context: authenticatedContext(testDatabase.db, "user-a", "active"),
    });
    const statuses = await call(appRouter.overlays.contentStatuses, undefined, {
      context: authenticatedContext(testDatabase.db, "user-a", "active"),
    });
    const secondMark = await call(appRouter.overlays.markCreatorContentOpened, { creatorId: creator.id }, {
      context: authenticatedContext(testDatabase.db, "user-a", "active"),
    });

    expect(beforeCounts).toHaveLength(1);
    expect(beforeCounts[0]).toMatchObject({ creatorId: creator.id, unreadCount: 2 });
    expect(firstMark.markedCount).toBe(2);
    expect(afterCounts).toEqual([]);
    expect(statuses).toHaveLength(2);
    expect(statuses.every((status) => status.status === "opened")).toBe(true);
    // Re-marking is a no-op: the threshold write covers everything up to now.
    expect(secondMark.markedCount).toBe(0);
  });

  test("markCreatorContentOpened is not found for unknown and unsubscribed creators", async () => {
    await insertUser(testDatabase.db, "user-a", "unread-api-404@example.test", "active");
    const unsubscribedCreator = await findOrCreateCreator(testDatabase.db, {
      displayName: "Unread API Unsubscribed Creator",
    });

    await expect(
      call(appRouter.overlays.markCreatorContentOpened, { creatorId: "missing-creator" }, {
        context: authenticatedContext(testDatabase.db, "user-a", "active"),
      }),
    ).rejects.toHaveProperty("code", "NOT_FOUND");
    await expect(
      call(appRouter.overlays.markCreatorContentOpened, { creatorId: unsubscribedCreator.id }, {
        context: authenticatedContext(testDatabase.db, "user-a", "active"),
      }),
    ).rejects.toHaveProperty("code", "NOT_FOUND");
    const statuses = await call(appRouter.overlays.contentStatuses, undefined, {
      context: authenticatedContext(testDatabase.db, "user-a", "active"),
    });
    expect(statuses).toEqual([]);
  });

  test("markAllContentOpened covers every subscribed creator and is idempotent", async () => {
    await insertUser(testDatabase.db, "user-a", "unread-api-all@example.test", "active");
    const creatorX = await findOrCreateCreator(testDatabase.db, {
      displayName: "Unread API All X",
    });
    const creatorY = await findOrCreateCreator(testDatabase.db, {
      displayName: "Unread API All Y",
    });
    for (const creator of [creatorX, creatorY]) {
      await subscribeAndBackdate("user-a", creator.id);
      await findOrCreateContentItem(testDatabase.db, {
        creatorId: creator.id,
        sourceType: "odysee",
        sourceExternalId: `unread-api-all-${creator.displayName}`,
        title: `Unread API all ${creator.displayName}`,
        publishedAt: new Date("2026-01-05T00:00:00.000Z"),
      });
    }

    const firstMarkAll = await call(appRouter.overlays.markAllContentOpened, undefined, {
      context: authenticatedContext(testDatabase.db, "user-a", "active"),
    });
    const counts = await call(appRouter.overlays.unreadCounts, undefined, {
      context: authenticatedContext(testDatabase.db, "user-a", "active"),
    });
    const secondMarkAll = await call(appRouter.overlays.markAllContentOpened, undefined, {
      context: authenticatedContext(testDatabase.db, "user-a", "active"),
    });

    expect(firstMarkAll.markedCount).toBe(2);
    expect(counts).toEqual([]);
    expect(secondMarkAll.markedCount).toBe(0);
  });

  test("one user's read state stays invisible to other users", async () => {
    await insertUser(testDatabase.db, "user-a", "unread-api-iso-a@example.test", "active");
    await insertUser(testDatabase.db, "user-b", "unread-api-iso-b@example.test", "active");
    const creator = await findOrCreateCreator(testDatabase.db, {
      displayName: "Unread API Isolation Creator",
    });
    for (const userId of ["user-a", "user-b"]) {
      await subscribeAndBackdate(userId, creator.id);
    }
    await findOrCreateContentItem(testDatabase.db, {
      creatorId: creator.id,
      sourceType: "peertube",
      sourceExternalId: "unread-api-iso-video-1",
      title: "Unread API isolation video 1",
      publishedAt: new Date("2026-01-05T00:00:00.000Z"),
    });
    await findOrCreateContentItem(testDatabase.db, {
      creatorId: creator.id,
      sourceType: "peertube",
      sourceExternalId: "unread-api-iso-video-2",
      title: "Unread API isolation video 2",
      publishedAt: new Date("2026-01-06T00:00:00.000Z"),
    });

    await call(appRouter.overlays.markAllContentOpened, undefined, {
      context: authenticatedContext(testDatabase.db, "user-a", "active"),
    });
    const userACounts = await call(appRouter.overlays.unreadCounts, undefined, {
      context: authenticatedContext(testDatabase.db, "user-a", "active"),
    });
    const userBCounts = await call(appRouter.overlays.unreadCounts, undefined, {
      context: authenticatedContext(testDatabase.db, "user-b", "active"),
    });
    const userBStatuses = await call(appRouter.overlays.contentStatuses, undefined, {
      context: authenticatedContext(testDatabase.db, "user-b", "active"),
    });

    expect(userACounts).toEqual([]);
    // User A's mark-all must not consume user B's unread items.
    expect(userBCounts).toHaveLength(1);
    expect(userBCounts[0]).toMatchObject({ creatorId: creator.id, unreadCount: 2 });
    expect(userBStatuses).toEqual([]);
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

/**
 * Subscribes through the real router procedure, then pins the subscription's
 * created_at to a fixed past instant. The default unread threshold is the
 * subscription's created_at while the mark endpoints use the server clock for
 * `markedBeforeMs`, so fixed dates keep both deterministic.
 */
async function subscribeAndBackdate(userId: string, creatorId: string): Promise<void> {
  await call(appRouter.overlays.subscribeToCreator, { creatorId }, {
    context: authenticatedContext(testDatabase.db, userId, "active"),
  });
  await testDatabase.db
    .update(schema.subscription)
    .set({ createdAt: new Date("2026-01-01T00:00:00.000Z"), updatedAt: new Date("2026-01-01T00:00:00.000Z") })
    .where(and(eq(schema.subscription.userId, userId), eq(schema.subscription.creatorId, creatorId)));
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
