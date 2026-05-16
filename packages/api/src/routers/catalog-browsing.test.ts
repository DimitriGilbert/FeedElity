import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { createClient } from "@libsql/client";
import type { Client } from "@libsql/client";
import { call } from "@orpc/server";
import { drizzle } from "drizzle-orm/libsql";

import * as schema from "@FeedElity/db/schema";

import type { Context } from "../context";
import type { RepositoryDb } from "../repositories/catalog";
import {
  findOrCreateContentItem,
  findOrCreateContentSource,
  findOrCreateCreator,
  findOrCreateFeed,
  linkFeedContent,
} from "../repositories/catalog";
import { findOrCreateContentStatus, findOrCreateSubscription } from "../repositories/overlays";
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

describe("catalog browsing router", () => {
  test("anonymous callers can list creators and bounded content items with filters", async () => {
    const firstCreator = await findOrCreateCreator(testDatabase.db, {
      sourceType: "youtube",
      sourceExternalId: "creator-alpha",
      displayName: "Alpha Creator",
    });
    const secondCreator = await findOrCreateCreator(testDatabase.db, {
      sourceType: "odysee",
      sourceExternalId: "creator-beta",
      displayName: "Beta Creator",
    });
    await findOrCreateContentItem(testDatabase.db, {
      creatorId: firstCreator.id,
      sourceType: "youtube",
      sourceExternalId: "alpha-video-older",
      title: "Alpha older update",
      publishedAt: new Date("2026-01-01T00:00:00.000Z"),
    });
    const newerItem = await findOrCreateContentItem(testDatabase.db, {
      creatorId: firstCreator.id,
      sourceType: "youtube",
      sourceExternalId: "alpha-video-newer",
      title: "Alpha Newer Update",
      publishedAt: new Date("2026-01-03T00:00:00.000Z"),
    });
    await findOrCreateContentItem(testDatabase.db, {
      creatorId: secondCreator.id,
      sourceType: "odysee",
      sourceExternalId: "beta-video",
      title: "Beta update",
      publishedAt: new Date("2026-01-04T00:00:00.000Z"),
    });

    const creators = await call(appRouter.catalog.creators, { search: "alpha", limit: 10 }, {
      context: anonymousContext(testDatabase.db),
    });
    const contentItems = await call(
      appRouter.catalog.contentItems,
      { search: "update", creatorId: firstCreator.id, sourceType: "youtube", limit: 1 },
      { context: anonymousContext(testDatabase.db) },
    );

    expect(creators).toHaveLength(1);
    expect(creators[0]).toMatchObject({ id: firstCreator.id, displayName: "Alpha Creator" });
    expect(contentItems).toHaveLength(1);
    expect(contentItems[0]).toMatchObject({ id: newerItem.id, title: "Alpha Newer Update" });
    expect(contentItems[0]?.creator).toMatchObject({ id: firstCreator.id, displayName: "Alpha Creator" });
  });

  test("anonymous content detail includes creator, feeds, and playable sources without overlay leakage", async () => {
    await insertUser(testDatabase.db, "user-a", "user-a@example.test");
    const creator = await findOrCreateCreator(testDatabase.db, {
      sourceType: "peertube",
      sourceExternalId: "account@example.test",
      displayName: "Peer Creator",
      imageUrl: "https://peertube.example.test/avatar.png",
    });
    const feed = await findOrCreateFeed(testDatabase.db, {
      creatorId: creator.id,
      sourceType: "peertube",
      sourceExternalId: "feed-account@example.test",
      url: "https://peertube.example.test/accounts/account/videos",
      title: "Peer videos",
    });
    const contentItem = await findOrCreateContentItem(testDatabase.db, {
      creatorId: creator.id,
      sourceType: "peertube",
      sourceExternalId: "video-123",
      title: "Playable catalog item",
      description: "A public video description.",
      canonicalUrl: "https://peertube.example.test/w/video-123",
      publishedAt: new Date("2026-02-01T00:00:00.000Z"),
    });
    await findOrCreateContentSource(testDatabase.db, {
      contentItemId: contentItem.id,
      sourceType: "peertube",
      sourceExternalId: "video-123",
      embedUrl: "https://peertube.example.test/videos/embed/video-123",
      nativeMediaUrl: "https://peertube.example.test/download/video-123.mp4",
      canonicalUrl: "https://peertube.example.test/w/video-123",
      priority: 0,
    });
    await linkFeedContent(testDatabase.db, {
      feedId: feed.id,
      contentItemId: contentItem.id,
      sourceExternalId: "video-123",
    });
    await findOrCreateSubscription(testDatabase.db, { userId: "user-a", creatorId: creator.id });
    await findOrCreateContentStatus(testDatabase.db, {
      userId: "user-a",
      contentItemId: contentItem.id,
      status: "favorite",
    });

    const detail = await call(appRouter.catalog.contentDetail, { id: contentItem.id }, {
      context: anonymousContext(testDatabase.db),
    });

    expect(detail).toMatchObject({ id: contentItem.id, title: "Playable catalog item" });
    expect(detail.creator).toMatchObject({ id: creator.id, displayName: "Peer Creator" });
    expect(detail.feeds).toHaveLength(1);
    expect(detail.sources).toHaveLength(1);
    expect(detail.sources[0]).toMatchObject({
      embedUrl: "https://peertube.example.test/videos/embed/video-123",
      nativeMediaUrl: "https://peertube.example.test/download/video-123.mp4",
    });
    expect(JSON.stringify(detail)).not.toContain("user-a");
    expect("favorite" in detail).toBe(false);
    expect("subscription" in detail).toBe(false);
    expect("playlist" in detail).toBe(false);
  });

  test("invalid catalog browsing input is rejected before repository access", async () => {
    await expect(
      call(appRouter.catalog.contentItems, { limit: 101 }, { context: anonymousContext(testDatabase.db) }),
    ).rejects.toBeDefined();
  });
});

function anonymousContext(db: RepositoryDb): Context {
  return {
    db,
    session: null,
  };
}

async function insertUser(db: RepositoryDb, id: string, email: string): Promise<void> {
  await db.insert(schema.user).values({
    id,
    name: id,
    email,
    emailVerified: true,
    accountState: "active",
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
];
