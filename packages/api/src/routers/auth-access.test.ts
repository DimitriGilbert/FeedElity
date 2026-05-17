import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { createClient } from "@libsql/client";
import type { Client } from "@libsql/client";
import { call } from "@orpc/server";
import { drizzle } from "drizzle-orm/libsql";

import { verifyCredentialPassword } from "@FeedElity/auth/password";
import * as schema from "@FeedElity/db/schema";

import type { AccountState, Context } from "../context";
import type { RepositoryDb } from "../repositories/catalog";
import { findOrCreateContentItem, findOrCreateCreator } from "../repositories/catalog";
import { createPlaylist, findOrCreateSubscription } from "../repositories/overlays";
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
    await expect(
      call(appRouter.overlays.favoriteContentItems, undefined, { context: anonymousContext(testDatabase.db) }),
    ).rejects.toHaveProperty("code", "UNAUTHORIZED");
    await expect(
      call(appRouter.overlays.contentHistory, { status: "opened" }, { context: anonymousContext(testDatabase.db) }),
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
    const subscriptions = await call(appRouter.overlays.subscriptions, undefined, {
      context: authenticatedContext(testDatabase.db, "user-a", "active"),
    });
    const playlists = await call(appRouter.overlays.playlists, undefined, {
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

  test("migrated pending users can set an initial credential password", async () => {
    await insertUser(
      testDatabase.db,
      "migrated-user",
      "migrated@example.test",
      "migrated_pending_password_setup",
    );

    const result = await call(appRouter.auth.setupMigratedPassword, {
      email: "MIGRATED@example.test",
      password: "new-password-123",
      name: "Migrated Owner",
    }, { context: anonymousContext(testDatabase.db) });

    const users = await testDatabase.db.select().from(schema.user);
    const accounts = await testDatabase.db.select().from(schema.account);

    expect(result).toEqual({ email: "migrated@example.test" });
    expect(users[0]).toMatchObject({
      id: "migrated-user",
      name: "Migrated Owner",
      accountState: "active",
    });
    expect(accounts).toHaveLength(1);
    expect(accounts[0]).toMatchObject({
      accountId: "migrated-user",
      providerId: "credential",
      userId: "migrated-user",
    });
    const passwordHash = accounts[0]?.password;
    if (passwordHash === null || passwordHash === undefined) {
      throw new Error("Expected migrated credential account to store a password hash.");
    }
    expect(passwordHash).not.toBe("new-password-123");
    expect(await verifyCredentialPassword(passwordHash, "new-password-123")).toBe(true);
  });

  test("active users cannot be claimed through migrated password setup", async () => {
    await insertUser(testDatabase.db, "active-user", "active@example.test", "active");

    await expect(
      call(appRouter.auth.setupMigratedPassword, {
        email: "active@example.test",
        password: "new-password-123",
      }, { context: anonymousContext(testDatabase.db) }),
    ).rejects.toHaveProperty("code", "NOT_FOUND");
  });

  test("authenticated users can idempotently subscribe to an existing catalog creator", async () => {
    await insertUser(testDatabase.db, "user-a", "user-a@example.test", "active");
    const creator = await findOrCreateCreator(testDatabase.db, {
      sourceType: "youtube",
      sourceExternalId: "idempotent-channel",
      displayName: "Idempotent Creator",
      imageUrl: "https://example.test/avatar.png",
      canonicalUrl: "https://example.test/channel",
    });

    const firstResult = await call(appRouter.overlays.subscribeToCreator, { creatorId: creator.id }, {
      context: authenticatedContext(testDatabase.db, "user-a", "active"),
    });
    const secondResult = await call(appRouter.overlays.subscribeToCreator, { creatorId: creator.id }, {
      context: authenticatedContext(testDatabase.db, "user-a", "active"),
    });
    const subscriptions = await call(appRouter.overlays.subscriptions, undefined, {
      context: authenticatedContext(testDatabase.db, "user-a", "active"),
    });

    expect(firstResult.subscription.id).toBe(secondResult.subscription.id);
    expect(firstResult.subscription).toMatchObject({
      userId: "user-a",
      creatorId: creator.id,
      creator: {
        id: creator.id,
        sourceType: "youtube",
        sourceExternalId: "idempotent-channel",
        displayName: "Idempotent Creator",
        imageUrl: "https://example.test/avatar.png",
        canonicalUrl: "https://example.test/channel",
      },
    });
    expect(subscriptions).toHaveLength(1);
  });

  test("authenticated users can toggle favorite content without leaking other users favorites", async () => {
    await insertUser(testDatabase.db, "user-a", "user-a@example.test", "active");
    await insertUser(testDatabase.db, "user-b", "user-b@example.test", "active");
    const creator = await findOrCreateCreator(testDatabase.db, {
      sourceType: "youtube",
      sourceExternalId: "favorite-channel",
      displayName: "Favorite Creator",
      imageUrl: "https://example.test/favorite.png",
    });
    const firstContentItem = await findOrCreateContentItem(testDatabase.db, {
      creatorId: creator.id,
      sourceType: "youtube",
      sourceExternalId: "favorite-video-a",
      title: "User A favorite",
    });
    const secondContentItem = await findOrCreateContentItem(testDatabase.db, {
      creatorId: creator.id,
      sourceType: "youtube",
      sourceExternalId: "favorite-video-b",
      title: "User B favorite",
    });

    const enabled = await call(appRouter.overlays.toggleContentFavorite, { contentItemId: firstContentItem.id }, {
      context: authenticatedContext(testDatabase.db, "user-a", "active"),
    });
    await call(appRouter.overlays.toggleContentFavorite, { contentItemId: secondContentItem.id }, {
      context: authenticatedContext(testDatabase.db, "user-b", "active"),
    });
    const userAFavorites = await call(appRouter.overlays.favoriteContentItems, undefined, {
      context: authenticatedContext(testDatabase.db, "user-a", "active"),
    });
    const disabled = await call(appRouter.overlays.toggleContentFavorite, { contentItemId: firstContentItem.id }, {
      context: authenticatedContext(testDatabase.db, "user-a", "active"),
    });
    const userAFavoritesAfterToggle = await call(appRouter.overlays.favoriteContentItems, undefined, {
      context: authenticatedContext(testDatabase.db, "user-a", "active"),
    });
    const userBFavorites = await call(appRouter.overlays.favoriteContentItems, undefined, {
      context: authenticatedContext(testDatabase.db, "user-b", "active"),
    });

    expect(enabled).toMatchObject({
      favorited: true,
      status: { userId: "user-a", contentItemId: firstContentItem.id, status: "favorite" },
    });
    expect(userAFavorites).toHaveLength(1);
    expect(userAFavorites[0]).toMatchObject({
      id: firstContentItem.id,
      title: "User A favorite",
      creator: { id: creator.id, displayName: "Favorite Creator" },
    });
    expect(JSON.stringify(userAFavorites)).not.toContain("user-b");
    expect(disabled).toEqual({ favorited: false, status: null });
    expect(userAFavoritesAfterToggle).toHaveLength(0);
    expect(userBFavorites).toHaveLength(1);
    expect(userBFavorites[0]).toMatchObject({ id: secondContentItem.id, title: "User B favorite" });
  });

  test("opened and played status writes are idempotent and exposed through explicit history filters", async () => {
    await insertUser(testDatabase.db, "user-a", "user-a@example.test", "active");
    await insertUser(testDatabase.db, "user-b", "user-b@example.test", "active");
    const creator = await findOrCreateCreator(testDatabase.db, {
      sourceType: "odysee",
      sourceExternalId: "history-channel",
      displayName: "History Creator",
    });
    const contentItem = await findOrCreateContentItem(testDatabase.db, {
      creatorId: creator.id,
      sourceType: "odysee",
      sourceExternalId: "history-video-a",
      title: "History video",
    });
    const otherContentItem = await findOrCreateContentItem(testDatabase.db, {
      creatorId: creator.id,
      sourceType: "odysee",
      sourceExternalId: "history-video-b",
      title: "Other user history video",
    });

    const firstOpened = await call(appRouter.overlays.markContentOpened, { contentItemId: contentItem.id }, {
      context: authenticatedContext(testDatabase.db, "user-a", "active"),
    });
    const secondOpened = await call(appRouter.overlays.markContentOpened, { contentItemId: contentItem.id }, {
      context: authenticatedContext(testDatabase.db, "user-a", "active"),
    });
    const firstPlayed = await call(appRouter.overlays.markContentPlayed, { contentItemId: contentItem.id }, {
      context: authenticatedContext(testDatabase.db, "user-a", "active"),
    });
    const secondPlayed = await call(appRouter.overlays.markContentPlayed, { contentItemId: contentItem.id }, {
      context: authenticatedContext(testDatabase.db, "user-a", "active"),
    });
    await call(appRouter.overlays.markContentOpened, { contentItemId: otherContentItem.id }, {
      context: authenticatedContext(testDatabase.db, "user-b", "active"),
    });

    const openedHistory = await call(appRouter.overlays.contentHistory, { status: "opened" }, {
      context: authenticatedContext(testDatabase.db, "user-a", "active"),
    });
    const playedHistory = await call(appRouter.overlays.contentHistory, { status: "played" }, {
      context: authenticatedContext(testDatabase.db, "user-a", "active"),
    });
    const allStatuses = await call(appRouter.overlays.contentStatuses, undefined, {
      context: authenticatedContext(testDatabase.db, "user-a", "active"),
    });

    expect(firstOpened.status.id).toBe(secondOpened.status.id);
    expect(firstPlayed.status.id).toBe(secondPlayed.status.id);
    expect(openedHistory).toHaveLength(1);
    expect(openedHistory[0]).toMatchObject({
      userId: "user-a",
      status: "opened",
      content: { id: contentItem.id, title: "History video", creator: { displayName: "History Creator" } },
    });
    expect(playedHistory).toHaveLength(1);
    expect(playedHistory[0]).toMatchObject({ userId: "user-a", status: "played", contentItemId: contentItem.id });
    expect(allStatuses).toHaveLength(2);
    expect(JSON.stringify(openedHistory)).not.toContain("Other user history video");
  });

  test("status operations require an existing catalog content item", async () => {
    await insertUser(testDatabase.db, "user-a", "user-a@example.test", "active");

    await expect(
      call(appRouter.overlays.markContentOpened, { contentItemId: "missing-content" }, {
        context: authenticatedContext(testDatabase.db, "user-a", "active"),
      }),
    ).rejects.toHaveProperty("code", "NOT_FOUND");
    await expect(
      call(appRouter.overlays.markContentPlayed, { contentItemId: "missing-content" }, {
        context: authenticatedContext(testDatabase.db, "user-a", "active"),
      }),
    ).rejects.toHaveProperty("code", "NOT_FOUND");
    await expect(
      call(appRouter.overlays.toggleContentFavorite, { contentItemId: "missing-content" }, {
        context: authenticatedContext(testDatabase.db, "user-a", "active"),
      }),
    ).rejects.toHaveProperty("code", "NOT_FOUND");
  });

  test("subscription list and unsubscribe are scoped to the authenticated user", async () => {
    await insertUser(testDatabase.db, "user-a", "user-a@example.test", "active");
    await insertUser(testDatabase.db, "user-b", "user-b@example.test", "active");
    const sharedCreator = await findOrCreateCreator(testDatabase.db, {
      sourceType: "peertube",
      sourceExternalId: "shared-channel",
      displayName: "Shared Creator",
    });
    const userBCreator = await findOrCreateCreator(testDatabase.db, {
      sourceType: "odysee",
      sourceExternalId: "user-b-channel",
      displayName: "User B Creator",
    });
    await call(appRouter.overlays.subscribeToCreator, { creatorId: sharedCreator.id }, {
      context: authenticatedContext(testDatabase.db, "user-a", "active"),
    });
    await call(appRouter.overlays.subscribeToCreator, { creatorId: sharedCreator.id }, {
      context: authenticatedContext(testDatabase.db, "user-b", "active"),
    });
    await call(appRouter.overlays.subscribeToCreator, { creatorId: userBCreator.id }, {
      context: authenticatedContext(testDatabase.db, "user-b", "active"),
    });

    const userAList = await call(appRouter.overlays.subscriptions, undefined, {
      context: authenticatedContext(testDatabase.db, "user-a", "active"),
    });
    const userBListBeforeUnsubscribe = await call(appRouter.overlays.subscriptions, undefined, {
      context: authenticatedContext(testDatabase.db, "user-b", "active"),
    });
    const unsubscribeResult = await call(appRouter.overlays.unsubscribeFromCreator, { creatorId: sharedCreator.id }, {
      context: authenticatedContext(testDatabase.db, "user-a", "active"),
    });
    const userAListAfterUnsubscribe = await call(appRouter.overlays.subscriptions, undefined, {
      context: authenticatedContext(testDatabase.db, "user-a", "active"),
    });
    const userBListAfterUnsubscribe = await call(appRouter.overlays.subscriptions, undefined, {
      context: authenticatedContext(testDatabase.db, "user-b", "active"),
    });
    const catalogCreators = await call(appRouter.catalog.creators, undefined, { context: anonymousContext(testDatabase.db) });

    expect(userAList).toHaveLength(1);
    expect(userAList.at(0)).toMatchObject({ userId: "user-a", creatorId: sharedCreator.id });
    expect(userBListBeforeUnsubscribe).toHaveLength(2);
    expect(unsubscribeResult).toEqual({
      creator: {
        id: sharedCreator.id,
        sourceType: "peertube",
        sourceExternalId: "shared-channel",
        displayName: "Shared Creator",
        imageUrl: null,
        canonicalUrl: null,
      },
      unsubscribed: true,
    });
    expect(userAListAfterUnsubscribe).toHaveLength(0);
    expect(userBListAfterUnsubscribe).toHaveLength(2);
    expect(catalogCreators.map((creator) => creator.id).sort()).toEqual([sharedCreator.id, userBCreator.id].sort());
  });

  test("anonymous users cannot call subscription mutation procedures", async () => {
    const creator = await findOrCreateCreator(testDatabase.db, {
      sourceType: "youtube",
      sourceExternalId: "anonymous-rejected-channel",
      displayName: "Anonymous Rejected Creator",
    });

    await expect(
      call(appRouter.overlays.subscribeToCreator, { creatorId: creator.id }, { context: anonymousContext(testDatabase.db) }),
    ).rejects.toHaveProperty("code", "UNAUTHORIZED");
    await expect(
      call(appRouter.overlays.unsubscribeFromCreator, { creatorId: creator.id }, { context: anonymousContext(testDatabase.db) }),
    ).rejects.toHaveProperty("code", "UNAUTHORIZED");
    await expect(
      call(appRouter.overlays.markContentOpened, { contentItemId: "content" }, { context: anonymousContext(testDatabase.db) }),
    ).rejects.toHaveProperty("code", "UNAUTHORIZED");
    await expect(
      call(appRouter.overlays.markContentPlayed, { contentItemId: "content" }, { context: anonymousContext(testDatabase.db) }),
    ).rejects.toHaveProperty("code", "UNAUTHORIZED");
    await expect(
      call(appRouter.overlays.toggleContentFavorite, { contentItemId: "content" }, { context: anonymousContext(testDatabase.db) }),
    ).rejects.toHaveProperty("code", "UNAUTHORIZED");
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
  "CREATE INDEX account_userId_idx ON account (user_id)",
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
  "CREATE INDEX content_source_content_item_id_idx ON content_source (content_item_id)",
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
