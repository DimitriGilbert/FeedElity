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

describe("playback API", () => {
  test("authenticated users save playback positions that round-trip through contentStatuses", async () => {
    await insertUser(testDatabase.db, "user-a", "playback-api-a@example.test", "active");
    const creator = await findOrCreateCreator(testDatabase.db, {
      displayName: "Playback API Creator",
    });
    const contentItem = await findOrCreateContentItem(testDatabase.db, {
      creatorId: creator.id,
      sourceType: "youtube",
      sourceExternalId: "playback-api-video",
      title: "Playback API video",
    });

    const firstSave = await call(appRouter.overlays.savePlaybackPosition, {
      contentItemId: contentItem.id,
      positionSeconds: 95,
      durationSeconds: 1_200,
    }, { context: authenticatedContext(testDatabase.db, "user-a", "active") });
    const secondSave = await call(appRouter.overlays.savePlaybackPosition, {
      contentItemId: contentItem.id,
      positionSeconds: 130,
    }, { context: authenticatedContext(testDatabase.db, "user-a", "active") });
    const statuses = await call(appRouter.overlays.contentStatuses, undefined, {
      context: authenticatedContext(testDatabase.db, "user-a", "active"),
    });

    expect(firstSave.status).toMatchObject({
      userId: "user-a",
      contentItemId: contentItem.id,
      status: "opened",
    });
    expect(secondSave.status.id).toBe(firstSave.status.id);
    // Insert-with-update: repeated saves keep exactly one opened row and the
    // last write wins for the playback metadata.
    expect(statuses).toHaveLength(1);
    expect(statuses[0]).toMatchObject({ status: "opened" });
    const storedMetadata: unknown = JSON.parse(requireMetadataJson(statuses[0]?.metadataJson));
    expect(storedMetadata).toMatchObject({
      playback: { positionSeconds: 130, durationSeconds: null },
    });
  });

  test("saving a playback position for an unknown content item is not found", async () => {
    await insertUser(testDatabase.db, "user-a", "playback-api-missing@example.test", "active");

    await expect(
      call(appRouter.overlays.savePlaybackPosition, {
        contentItemId: "missing-content-item",
        positionSeconds: 10,
      }, { context: authenticatedContext(testDatabase.db, "user-a", "active") }),
    ).rejects.toHaveProperty("code", "NOT_FOUND");
  });

  test("playback position saves reject anonymous callers and invalid bounded input", async () => {
    await insertUser(testDatabase.db, "user-a", "playback-api-validation@example.test", "active");
    const creator = await findOrCreateCreator(testDatabase.db, {
      displayName: "Playback Validation Creator",
    });
    const contentItem = await findOrCreateContentItem(testDatabase.db, {
      creatorId: creator.id,
      sourceType: "odysee",
      sourceExternalId: "playback-validation-video",
      title: "Playback validation video",
    });

    await expect(
      call(appRouter.overlays.savePlaybackPosition, {
        contentItemId: contentItem.id,
        positionSeconds: 10,
      }, { context: anonymousContext(testDatabase.db) }),
    ).rejects.toHaveProperty("code", "UNAUTHORIZED");
    await expect(
      call(appRouter.overlays.savePlaybackPosition, {
        contentItemId: "",
        positionSeconds: 10,
      }, { context: authenticatedContext(testDatabase.db, "user-a", "active") }),
    ).rejects.toBeDefined();
    await expect(
      call(appRouter.overlays.savePlaybackPosition, {
        contentItemId: contentItem.id,
        positionSeconds: -1,
      }, { context: authenticatedContext(testDatabase.db, "user-a", "active") }),
    ).rejects.toBeDefined();
    await expect(
      call(appRouter.overlays.savePlaybackPosition, {
        contentItemId: contentItem.id,
        positionSeconds: 1.5,
      }, { context: authenticatedContext(testDatabase.db, "user-a", "active") }),
    ).rejects.toBeDefined();
    await expect(
      call(appRouter.overlays.savePlaybackPosition, {
        contentItemId: contentItem.id,
        positionSeconds: 86_401,
      }, { context: authenticatedContext(testDatabase.db, "user-a", "active") }),
    ).rejects.toBeDefined();
    await expect(
      call(appRouter.overlays.savePlaybackPosition, {
        contentItemId: contentItem.id,
        positionSeconds: 10,
        durationSeconds: 86_401,
      }, { context: authenticatedContext(testDatabase.db, "user-a", "active") }),
    ).rejects.toBeDefined();
  });

  test("one user's playback positions stay invisible to other users", async () => {
    await insertUser(testDatabase.db, "user-a", "playback-api-iso-a@example.test", "active");
    await insertUser(testDatabase.db, "user-b", "playback-api-iso-b@example.test", "active");
    const creator = await findOrCreateCreator(testDatabase.db, {
      displayName: "Playback Isolation Creator",
    });
    const contentItem = await findOrCreateContentItem(testDatabase.db, {
      creatorId: creator.id,
      sourceType: "peertube",
      sourceExternalId: "playback-isolation-video",
      title: "Playback isolation video",
    });

    await call(appRouter.overlays.savePlaybackPosition, {
      contentItemId: contentItem.id,
      positionSeconds: 60,
    }, { context: authenticatedContext(testDatabase.db, "user-a", "active") });

    const userBStatuses = await call(appRouter.overlays.contentStatuses, undefined, {
      context: authenticatedContext(testDatabase.db, "user-b", "active"),
    });
    expect(userBStatuses).toEqual([]);
  });
});

function requireMetadataJson(metadataJson: string | null | undefined): string {
  if (metadataJson === null || metadataJson === undefined) {
    throw new Error("Expected playback metadata to be persisted on the opened row.");
  }
  return metadataJson;
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
