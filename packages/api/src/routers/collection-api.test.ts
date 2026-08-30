import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { createClient } from "@libsql/client";
import type { Client } from "@libsql/client";
import { call } from "@orpc/server";
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

describe("collection API", () => {
  test("authenticated users can create, list, update, and delete their collections", async () => {
    await insertUser(testDatabase.db, "user-a", "user-a@example.test", "active");
    await insertUser(testDatabase.db, "user-b", "user-b@example.test", "active");

    const created = await call(appRouter.overlays.createCollection, {
      name: " Tech ",
      description: " Tech creators ",
    }, { context: authenticatedContext(testDatabase.db, "user-a", "active") });
    await call(appRouter.overlays.createCollection, { name: "User B collection" }, {
      context: authenticatedContext(testDatabase.db, "user-b", "active"),
    });
    const updated = await call(appRouter.overlays.updateCollection, {
      collectionId: created.id,
      name: "Technology",
      description: null,
      position: 0,
    }, { context: authenticatedContext(testDatabase.db, "user-a", "active") });
    const userACollections = await call(appRouter.overlays.collections, undefined, {
      context: authenticatedContext(testDatabase.db, "user-a", "active"),
    });
    const crossUserDelete = await call(appRouter.overlays.deleteCollection, { collectionId: created.id }, {
      context: authenticatedContext(testDatabase.db, "user-b", "active"),
    });
    const ownerDelete = await call(appRouter.overlays.deleteCollection, { collectionId: created.id }, {
      context: authenticatedContext(testDatabase.db, "user-a", "active"),
    });
    const userACollectionsAfterDelete = await call(appRouter.overlays.collections, undefined, {
      context: authenticatedContext(testDatabase.db, "user-a", "active"),
    });

    expect(created).toMatchObject({ userId: "user-a", name: "Tech", description: "Tech creators" });
    expect(updated).toMatchObject({ id: created.id, userId: "user-a", name: "Technology", description: null });
    expect(userACollections).toHaveLength(1);
    expect(JSON.stringify(userACollections)).not.toContain("User B collection");
    expect(crossUserDelete).toEqual({ deleted: false });
    expect(ownerDelete).toEqual({ deleted: true });
    expect(userACollectionsAfterDelete).toHaveLength(0);
  });

  test("collection members can be added idempotently, listed with creator summaries, and removed", async () => {
    await insertUser(testDatabase.db, "user-a", "user-a@example.test", "active");
    await insertUser(testDatabase.db, "user-b", "user-b@example.test", "active");
    const firstCreator = await findOrCreateCreator(testDatabase.db, {
      displayName: "Collection API Creator One",
    });
    const secondCreator = await findOrCreateCreator(testDatabase.db, {
      displayName: "Collection API Creator Two",
    });
    const collection = await call(appRouter.overlays.createCollection, { name: "Tech" }, {
      context: authenticatedContext(testDatabase.db, "user-a", "active"),
    });

    const firstMember = await call(appRouter.overlays.addCollectionMember, {
      collectionId: collection.id,
      creatorId: firstCreator.id,
    }, { context: authenticatedContext(testDatabase.db, "user-a", "active") });
    const duplicateFirstMember = await call(appRouter.overlays.addCollectionMember, {
      collectionId: collection.id,
      creatorId: firstCreator.id,
    }, { context: authenticatedContext(testDatabase.db, "user-a", "active") });
    const secondMember = await call(appRouter.overlays.addCollectionMember, {
      collectionId: collection.id,
      creatorId: secondCreator.id,
    }, { context: authenticatedContext(testDatabase.db, "user-a", "active") });
    const listedMembers = await call(appRouter.overlays.collectionMembers, { collectionId: collection.id }, {
      context: authenticatedContext(testDatabase.db, "user-a", "active"),
    });
    const crossUserMembers = await call(appRouter.overlays.collectionMembers, { collectionId: collection.id }, {
      context: authenticatedContext(testDatabase.db, "user-b", "active"),
    });
    const crossUserRemove = await call(appRouter.overlays.removeCollectionMember, {
      collectionId: collection.id,
      memberId: secondMember.id,
    }, { context: authenticatedContext(testDatabase.db, "user-b", "active") });
    const ownerRemove = await call(appRouter.overlays.removeCollectionMember, {
      collectionId: collection.id,
      memberId: secondMember.id,
    }, { context: authenticatedContext(testDatabase.db, "user-a", "active") });
    const finalMembers = await call(appRouter.overlays.collectionMembers, { collectionId: collection.id }, {
      context: authenticatedContext(testDatabase.db, "user-a", "active"),
    });

    expect(duplicateFirstMember.id).toBe(firstMember.id);
    expect(listedMembers.map((member) => member.creatorId)).toEqual([firstCreator.id, secondCreator.id]);
    expect(listedMembers[0]).toMatchObject({ creator: { id: firstCreator.id, displayName: "Collection API Creator One" } });
    expect(crossUserMembers).toHaveLength(0);
    expect(crossUserRemove).toEqual({ removed: false });
    expect(ownerRemove).toEqual({ removed: true });
    expect(finalMembers.map((member) => member.creatorId)).toEqual([firstCreator.id]);
  });

  test("a creator can be a member of multiple collections", async () => {
    await insertUser(testDatabase.db, "user-a", "user-a@example.test", "active");
    const creator = await findOrCreateCreator(testDatabase.db, {
      displayName: "Multi Collection Creator",
    });
    const firstCollection = await call(appRouter.overlays.createCollection, { name: "First" }, {
      context: authenticatedContext(testDatabase.db, "user-a", "active"),
    });
    const secondCollection = await call(appRouter.overlays.createCollection, { name: "Second" }, {
      context: authenticatedContext(testDatabase.db, "user-a", "active"),
    });

    await call(appRouter.overlays.addCollectionMember, {
      collectionId: firstCollection.id,
      creatorId: creator.id,
    }, { context: authenticatedContext(testDatabase.db, "user-a", "active") });
    await call(appRouter.overlays.addCollectionMember, {
      collectionId: secondCollection.id,
      creatorId: creator.id,
    }, { context: authenticatedContext(testDatabase.db, "user-a", "active") });
    const firstMembers = await call(appRouter.overlays.collectionMembers, { collectionId: firstCollection.id }, {
      context: authenticatedContext(testDatabase.db, "user-a", "active"),
    });
    const secondMembers = await call(appRouter.overlays.collectionMembers, { collectionId: secondCollection.id }, {
      context: authenticatedContext(testDatabase.db, "user-a", "active"),
    });

    expect(firstMembers.map((member) => member.creatorId)).toEqual([creator.id]);
    expect(secondMembers.map((member) => member.creatorId)).toEqual([creator.id]);
  });

  test("collection member operations reject anonymous callers, missing creators, and cross-user access", async () => {
    await insertUser(testDatabase.db, "user-a", "user-a@example.test", "active");
    const collection = await call(appRouter.overlays.createCollection, { name: "Tech" }, {
      context: authenticatedContext(testDatabase.db, "user-a", "active"),
    });

    await expect(
      call(appRouter.overlays.createCollection, { name: "Anonymous" }, { context: anonymousContext(testDatabase.db) }),
    ).rejects.toHaveProperty("code", "UNAUTHORIZED");
    await expect(
      call(appRouter.overlays.addCollectionMember, { collectionId: collection.id, creatorId: "missing-creator" }, {
        context: authenticatedContext(testDatabase.db, "user-a", "active"),
      }),
    ).rejects.toHaveProperty("code", "NOT_FOUND");
    await expect(
      call(appRouter.overlays.collectionMembers, { collectionId: collection.id }, {
        context: anonymousContext(testDatabase.db),
      }),
    ).rejects.toHaveProperty("code", "UNAUTHORIZED");
  });

  test("subscribed content can be scoped to a collection's member creators", async () => {
    await insertUser(testDatabase.db, "library-user", "library-user@example.test", "active");
    const inCollectionCreator = await findOrCreateCreator(testDatabase.db, {
      displayName: "Collection Scoped In",
    });
    const outCollectionCreator = await findOrCreateCreator(testDatabase.db, {
      displayName: "Collection Scoped Out",
    });
    const includedItem = await findOrCreateContentItem(testDatabase.db, {
      creatorId: inCollectionCreator.id,
      sourceType: "youtube",
      sourceExternalId: "collection-scoped-in-video",
      title: "Included collection video",
      publishedAt: new Date("2026-06-01T00:00:00.000Z"),
    });
    await findOrCreateContentItem(testDatabase.db, {
      creatorId: outCollectionCreator.id,
      sourceType: "youtube",
      sourceExternalId: "collection-scoped-out-video",
      title: "Excluded collection video",
      publishedAt: new Date("2026-06-02T00:00:00.000Z"),
    });
    // Subscribed mode requires a subscription (the collection filter narrows within it);
    // subscribe to both so the collection scope is the only difference.
    await call(appRouter.overlays.subscribeToCreator, { creatorId: inCollectionCreator.id }, {
      context: authenticatedContext(testDatabase.db, "library-user", "active"),
    });
    await call(appRouter.overlays.subscribeToCreator, { creatorId: outCollectionCreator.id }, {
      context: authenticatedContext(testDatabase.db, "library-user", "active"),
    });
    const collection = await call(appRouter.overlays.createCollection, { name: "Scoped" }, {
      context: authenticatedContext(testDatabase.db, "library-user", "active"),
    });
    await call(appRouter.overlays.addCollectionMember, {
      collectionId: collection.id,
      creatorId: inCollectionCreator.id,
    }, { context: authenticatedContext(testDatabase.db, "library-user", "active") });

    const scopedItems = await call(
      appRouter.overlays.subscribedContentItems,
      { collectionId: collection.id, limit: 10, offset: 0 },
      { context: authenticatedContext(testDatabase.db, "library-user", "active") },
    );

    expect(scopedItems.map((item) => item.id)).toEqual([includedItem.id]);
  });

  test("catalog content can be scoped to a collection for an authenticated caller", async () => {
    await insertUser(testDatabase.db, "catalog-user", "catalog-user@example.test", "active");
    const inCollectionCreator = await findOrCreateCreator(testDatabase.db, {
      displayName: "Catalog Collection In",
    });
    const outCollectionCreator = await findOrCreateCreator(testDatabase.db, {
      displayName: "Catalog Collection Out",
    });
    const includedItem = await findOrCreateContentItem(testDatabase.db, {
      creatorId: inCollectionCreator.id,
      sourceType: "youtube",
      sourceExternalId: "catalog-collection-in-video",
      title: "Included catalog collection video",
      publishedAt: new Date("2026-07-01T00:00:00.000Z"),
    });
    await findOrCreateContentItem(testDatabase.db, {
      creatorId: outCollectionCreator.id,
      sourceType: "youtube",
      sourceExternalId: "catalog-collection-out-video",
      title: "Excluded catalog collection video",
      publishedAt: new Date("2026-07-02T00:00:00.000Z"),
    });
    const collection = await call(appRouter.overlays.createCollection, { name: "Catalog scoped" }, {
      context: authenticatedContext(testDatabase.db, "catalog-user", "active"),
    });
    await call(appRouter.overlays.addCollectionMember, {
      collectionId: collection.id,
      creatorId: inCollectionCreator.id,
    }, { context: authenticatedContext(testDatabase.db, "catalog-user", "active") });

    const scopedItems = await call(
      appRouter.catalog.contentItems,
      { collectionId: collection.id, limit: 10, offset: 0 },
      { context: authenticatedContext(testDatabase.db, "catalog-user", "active") },
    );
    // A collection owned by another user must not scope an anonymous caller's catalog browse.
    const anonymousScoped = await call(
      appRouter.catalog.contentItems,
      { collectionId: collection.id, limit: 10, offset: 0 },
      { context: anonymousContext(testDatabase.db) },
    );

    expect(scopedItems.map((item) => item.id)).toEqual([includedItem.id]);
    expect(anonymousScoped.map((item) => item.id)).toContain(includedItem.id);
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
  "CREATE INDEX creator_collection_user_position_idx ON creator_collection (user_id, position)",
  "CREATE INDEX creator_collection_user_name_idx ON creator_collection (user_id, name)",
  `CREATE TABLE collection_member (
    id TEXT PRIMARY KEY NOT NULL,
    user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
    collection_id TEXT NOT NULL REFERENCES creator_collection(id) ON DELETE CASCADE,
    creator_id TEXT NOT NULL REFERENCES creator(id) ON DELETE CASCADE,
    added_at INTEGER NOT NULL DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)),
    CONSTRAINT collection_member_collection_owner_fk FOREIGN KEY (collection_id, user_id) REFERENCES creator_collection(id, user_id) ON DELETE CASCADE
  )`,
  "CREATE UNIQUE INDEX collection_member_collection_creator_uidx ON collection_member (collection_id, creator_id)",
  "CREATE INDEX collection_member_user_id_idx ON collection_member (user_id)",
  "CREATE INDEX collection_member_creator_id_idx ON collection_member (creator_id)",
];
