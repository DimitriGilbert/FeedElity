import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { createClient } from "@libsql/client";
import type { Client } from "@libsql/client";
import { call } from "@orpc/server";
import { drizzle } from "drizzle-orm/libsql";

import * as schema from "@FeedElity/db/schema";

import type { AccountState, Context } from "../context";
import type { RepositoryDb } from "../repositories/catalog";
import { findOrCreateCreator } from "../repositories/catalog";
import { getSubscriptionWithCreatorForUser } from "../repositories/overlays";
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

describe("bulk unsubscribe API", () => {
  test("bulkUnsubscribe rejects anonymous callers", async () => {
    await expect(
      call(appRouter.overlays.bulkUnsubscribe, { creatorIds: ["any-creator"] }, {
        context: anonymousContext(testDatabase.db),
      }),
    ).rejects.toHaveProperty("code", "UNAUTHORIZED");
  });

  test("bulkUnsubscribe removes only the caller's subscriptions and reports them", async () => {
    await insertUser(testDatabase.db, "user-a", "bulk-unsub-a@example.test", "active");
    const firstCreator = await findOrCreateCreator(testDatabase.db, {
      displayName: "Bulk Unsubscribe First",
    });
    const secondCreator = await findOrCreateCreator(testDatabase.db, {
      displayName: "Bulk Unsubscribe Second",
    });
    await subscribeViaRouter("user-a", firstCreator.id);
    await subscribeViaRouter("user-a", secondCreator.id);

    const result = await call(appRouter.overlays.bulkUnsubscribe, { creatorIds: [firstCreator.id, secondCreator.id] }, {
      context: authenticatedContext(testDatabase.db, "user-a", "active"),
    });

    expect(result).toEqual({
      unsubscribedCount: 2,
      missingCreatorIds: [],
    });
    expect(await getSubscriptionWithCreatorForUser(testDatabase.db, "user-a", firstCreator.id)).toBeNull();
    expect(await getSubscriptionWithCreatorForUser(testDatabase.db, "user-a", secondCreator.id)).toBeNull();
  });

  test("bulkUnsubscribe is scoped to the caller and never touches other users", async () => {
    await insertUser(testDatabase.db, "user-a", "bulk-unsub-caller@example.test", "active");
    await insertUser(testDatabase.db, "user-b", "bulk-unsub-other@example.test", "active");
    const creator = await findOrCreateCreator(testDatabase.db, {
      displayName: "Bulk Unsubscribe Shared",
    });
    await subscribeViaRouter("user-a", creator.id);
    await subscribeViaRouter("user-b", creator.id);

    const result = await call(appRouter.overlays.bulkUnsubscribe, { creatorIds: [creator.id] }, {
      context: authenticatedContext(testDatabase.db, "user-a", "active"),
    });

    expect(result).toEqual({
      unsubscribedCount: 1,
      missingCreatorIds: [],
    });
    expect(await getSubscriptionWithCreatorForUser(testDatabase.db, "user-a", creator.id)).toBeNull();
    // Cross-user isolation: user-b's subscription must survive the bulk call.
    expect(await getSubscriptionWithCreatorForUser(testDatabase.db, "user-b", creator.id)).not.toBeNull();
  });

  test("bulkUnsubscribe reports creator ids without a subscription instead of failing", async () => {
    await insertUser(testDatabase.db, "user-a", "bulk-unsub-missing@example.test", "active");
    const subscribedCreator = await findOrCreateCreator(testDatabase.db, {
      displayName: "Bulk Unsubscribe Kept",
    });
    const unsubscribedCreator = await findOrCreateCreator(testDatabase.db, {
      displayName: "Bulk Unsubscribe Missing",
    });
    await subscribeViaRouter("user-a", subscribedCreator.id);

    const result = await call(appRouter.overlays.bulkUnsubscribe, {
      creatorIds: [subscribedCreator.id, unsubscribedCreator.id, "totally-unknown-creator"],
    }, {
      context: authenticatedContext(testDatabase.db, "user-a", "active"),
    });

    expect(result).toEqual({
      unsubscribedCount: 1,
      missingCreatorIds: [unsubscribedCreator.id, "totally-unknown-creator"],
    });
    expect(await getSubscriptionWithCreatorForUser(testDatabase.db, "user-a", subscribedCreator.id)).toBeNull();
  });

  test("bulkUnsubscribe rejects more than 100 creator ids and writes nothing", async () => {
    await insertUser(testDatabase.db, "user-a", "bulk-unsub-limit@example.test", "active");
    const creator = await findOrCreateCreator(testDatabase.db, {
      displayName: "Bulk Unsubscribe Limit",
    });
    await subscribeViaRouter("user-a", creator.id);
    const oversizedCreatorIds = [creator.id, ...Array.from({ length: 100 }, (_, index) => `filler-${index}`)];

    await expect(
      call(appRouter.overlays.bulkUnsubscribe, { creatorIds: oversizedCreatorIds }, {
        context: authenticatedContext(testDatabase.db, "user-a", "active"),
      }),
    ).rejects.toThrow();

    // Validation must happen before any write: the subscription survives.
    expect(await getSubscriptionWithCreatorForUser(testDatabase.db, "user-a", creator.id)).not.toBeNull();
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

async function subscribeViaRouter(userId: string, creatorId: string): Promise<void> {
  await call(appRouter.overlays.subscribeToCreator, { creatorId }, {
    context: authenticatedContext(testDatabase.db, userId, "active"),
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
];
