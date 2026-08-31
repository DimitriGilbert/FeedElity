import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { createClient } from "@libsql/client";
import type { Client } from "@libsql/client";
import { call } from "@orpc/server";
import { drizzle } from "drizzle-orm/libsql";

import * as schema from "@FeedElity/db/schema";

import type { AccountState, Context } from "../context";
import {
  createRefreshRun,
  findOrCreateCreator,
  findOrCreateFeed,
  recordRefreshFeedResult,
  type RepositoryDb,
} from "../repositories/catalog";
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

describe("feed health API", () => {
  test("feedHealth rejects anonymous callers", async () => {
    await expect(
      call(appRouter.overlays.feedHealth, undefined, { context: anonymousContext(testDatabase.db) }),
    ).rejects.toHaveProperty("code", "UNAUTHORIZED");
    await expect(
      call(appRouter.overlays.feedHealth, { limit: 5 }, { context: anonymousContext(testDatabase.db) }),
    ).rejects.toHaveProperty("code", "UNAUTHORIZED");
  });

  test("feedHealth returns catalog-global health entries computed from refresh results", async () => {
    const creator = await findOrCreateCreator(testDatabase.db, {
      displayName: "Health API Creator",
    });
    const failingFeed = await findOrCreateFeed(testDatabase.db, {
      creatorId: creator.id,
      sourceType: "odysee",
      sourceExternalId: "health-api-failing",
      url: "https://health-api.example.test/failing",
      title: "Health API Failing Feed",
    });
    const idleFeed = await findOrCreateFeed(testDatabase.db, {
      creatorId: creator.id,
      sourceType: "youtube",
      sourceExternalId: "health-api-idle",
      url: "https://health-api.example.test/idle",
      title: "Health API Idle Feed",
    });
    await seedFeedHealthAttempt(testDatabase.db, {
      feedId: failingFeed.id,
      status: "succeeded",
      startedAt: new Date("2026-06-01T10:00:00.000Z"),
      completedAt: new Date("2026-06-01T10:01:00.000Z"),
      itemsCreatedCount: 2,
    });
    const newestFailureJson = JSON.stringify({
      feedId: failingFeed.id,
      code: "provider-refresh-paused",
      message: "Health API fixture rate limited.",
    });
    await seedFeedHealthAttempt(testDatabase.db, {
      feedId: failingFeed.id,
      status: "failed",
      startedAt: new Date("2026-06-02T10:00:00.000Z"),
      completedAt: new Date("2026-06-02T10:00:05.000Z"),
      errorSummaryJson: JSON.stringify({
        feedId: failingFeed.id,
        code: "remote-fetch-failed",
        message: "Health API fixture timeout.",
      }),
    });
    await seedFeedHealthAttempt(testDatabase.db, {
      feedId: failingFeed.id,
      status: "failed",
      startedAt: new Date("2026-06-03T10:00:00.000Z"),
      completedAt: new Date("2026-06-03T10:00:05.000Z"),
      errorSummaryJson: newestFailureJson,
    });

    const entries = await call(appRouter.overlays.feedHealth, undefined, {
      context: authenticatedContext(testDatabase.db, "user-a", "active"),
    });

    expect(entries.map((entry) => entry.feedUrl)).toEqual([
      "https://health-api.example.test/failing",
      "https://health-api.example.test/idle",
    ]);

    // Exact shape: catalog + refresh data only, never user overlay fields.
    expect(entries[0]).toEqual({
      feedId: failingFeed.id,
      feedTitle: "Health API Failing Feed",
      feedUrl: "https://health-api.example.test/failing",
      sourceType: "odysee",
      creatorId: creator.id,
      creatorDisplayName: "Health API Creator",
      nextRefreshAfter: null,
      lastAttemptAt: new Date("2026-06-03T10:00:00.000Z"),
      lastSuccessAt: new Date("2026-06-01T10:01:00.000Z"),
      consecutiveFailureCount: 2,
      // The raw error summary passes through un-parsed; the web feeds it to
      // parseRefreshErrorSummaries.
      lastErrorSummaryJson: newestFailureJson,
      itemsCreatedTotal: 2,
    });
    expect(entries[1]).toMatchObject({
      feedId: idleFeed.id,
      lastAttemptAt: null,
      lastSuccessAt: null,
      consecutiveFailureCount: 0,
      lastErrorSummaryJson: null,
      itemsCreatedTotal: 0,
    });
  });

  test("feedHealth applies the requested limit", async () => {
    const creator = await findOrCreateCreator(testDatabase.db, {
      displayName: "Health API Limit Creator",
    });
    for (const externalId of ["limit-a", "limit-b", "limit-c"]) {
      await findOrCreateFeed(testDatabase.db, {
        creatorId: creator.id,
        sourceType: "youtube",
        sourceExternalId: `health-api-${externalId}`,
        url: `https://health-api.example.test/${externalId}`,
      });
    }

    const entries = await call(appRouter.overlays.feedHealth, { limit: 2 }, {
      context: authenticatedContext(testDatabase.db, "user-a", "active"),
    });

    expect(entries.map((entry) => entry.feedUrl)).toEqual([
      "https://health-api.example.test/limit-a",
      "https://health-api.example.test/limit-b",
    ]);
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

/**
 * Seed one feed refresh attempt through the real repository writes, wrapped in
 * its own refresh run (refresh_feed_result is unique per (run, feed)).
 */
async function seedFeedHealthAttempt(
  db: RepositoryDb,
  input: {
    readonly feedId: string;
    readonly status: "succeeded" | "failed";
    readonly startedAt: Date;
    readonly completedAt: Date;
    readonly itemsCreatedCount?: number;
    readonly errorSummaryJson?: string;
  },
): Promise<void> {
  const run = await createRefreshRun(db, { scope: "all", status: "succeeded", startedAt: input.startedAt });
  await recordRefreshFeedResult(db, {
    refreshRunId: run.id,
    feedId: input.feedId,
    status: input.status,
    itemsCreatedCount: input.itemsCreatedCount ?? 0,
    startedAt: input.startedAt,
    completedAt: input.completedAt,
    errorSummaryJson: input.errorSummaryJson ?? null,
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
  `CREATE TABLE refresh_run (
    id TEXT PRIMARY KEY NOT NULL,
    scope TEXT NOT NULL,
    force INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL,
    requested_creator_id TEXT REFERENCES creator(id) ON DELETE SET NULL,
    requested_feed_id TEXT REFERENCES feed(id) ON DELETE SET NULL,
    feeds_requested_count INTEGER NOT NULL DEFAULT 0,
    feeds_skipped_count INTEGER NOT NULL DEFAULT 0,
    feeds_succeeded_count INTEGER NOT NULL DEFAULT 0,
    feeds_failed_count INTEGER NOT NULL DEFAULT 0,
    items_discovered_count INTEGER NOT NULL DEFAULT 0,
    items_created_count INTEGER NOT NULL DEFAULT 0,
    items_updated_count INTEGER NOT NULL DEFAULT 0,
    started_at INTEGER NOT NULL DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)),
    completed_at INTEGER,
    error_summary_json TEXT
  )`,
  `CREATE TABLE refresh_feed_result (
    id TEXT PRIMARY KEY NOT NULL,
    refresh_run_id TEXT NOT NULL REFERENCES refresh_run(id) ON DELETE CASCADE,
    feed_id TEXT NOT NULL REFERENCES feed(id) ON DELETE CASCADE,
    status TEXT NOT NULL,
    items_discovered_count INTEGER NOT NULL DEFAULT 0,
    items_created_count INTEGER NOT NULL DEFAULT 0,
    items_updated_count INTEGER NOT NULL DEFAULT 0,
    started_at INTEGER NOT NULL DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)),
    completed_at INTEGER,
    error_summary_json TEXT
  )`,
  "CREATE INDEX refresh_feed_result_feed_id_idx ON refresh_feed_result (feed_id)",
  "CREATE UNIQUE INDEX refresh_feed_result_run_feed_uidx ON refresh_feed_result (refresh_run_id, feed_id)",
];
