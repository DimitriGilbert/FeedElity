import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { createClient } from "@libsql/client";
import type { Client } from "@libsql/client";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/libsql";

import * as schema from "@FeedElity/db/schema";

import type { SourceType } from "../domain/catalog";
import { findCreatorByNameKey, findOrCreateCreator, findOrCreateFeed, type RepositoryDb } from "../repositories/catalog";
import { createSourceAdapterRegistry, parseHttpUrl } from "../sources";
import type { SourceAdapter } from "../sources";
import type { CreatorMetadata } from "../sources/types";
import {
  getCreatorMetadataRefreshStatus,
  refreshCreatorMetadata,
  startCreatorMetadataRefresh,
  type CreatorMetadataRefreshStatus,
} from "./creator-metadata";

interface TestDatabase {
  readonly client: Client;
  readonly db: RepositoryDb;
}

interface MetadataOutcome {
  readonly metadata?: CreatorMetadata;
  readonly failWith?: { readonly code: "remote-fetch-failed"; readonly message: string };
}

interface MetadataAdapterConfig {
  readonly sourceType?: SourceType;
  readonly withCreatorMetadata: boolean;
  readonly outcomes: Readonly<Record<string, MetadataOutcome>>;
}

let testDatabase: TestDatabase;

beforeEach(async () => {
  testDatabase = await createTestDatabase();
});

afterEach(() => {
  testDatabase.client.close();
});

describe("creator metadata refresh", () => {
  test("summarizes updated, unchanged, and failed feeds and applies fresh metadata per creator", async () => {
    const seeded = await seedCreatorFeeds(testDatabase.db);
    const registry = createSourceAdapterRegistry([
      createMetadataAdapter({
        withCreatorMetadata: true,
        outcomes: {
          "updated-feed": { metadata: { imageUrl: "https://icons.example.test/fresh.png", description: "Fresh description" } },
          "unchanged-feed": { metadata: { imageUrl: "https://icons.example.test/stored.png" } },
          "failing-feed": { failWith: { code: "remote-fetch-failed", message: "Fixture metadata fetch failed." } },
        },
      }),
    ]);

    const status = await refreshCreatorMetadata(metadataDependencies(registry));

    expect(status.status).toBe("partial");
    expect(status.feedsTotal).toBe(3);
    expect(status.feedsProcessed).toBe(3);
    expect(status.feedsSkippedCount).toBe(0);
    expect(status.creatorsUpdatedCount).toBe(1);
    expect(status.creatorsUnchangedCount).toBe(1);
    expect(status.feedsFailedCount).toBe(1);
    expect(status.failures).toHaveLength(1);
    expect(status.failures[0]).toMatchObject({
      feedId: seeded.failingFeedId,
      sourceType: "youtube",
      code: "remote-fetch-failed",
      message: "Fixture metadata fetch failed.",
    });

    const updatedCreator = await findCreatorByNameKey(testDatabase.db, "updatedcreator");
    expect(updatedCreator).toMatchObject({
      imageUrl: "https://icons.example.test/fresh.png",
      description: "Fresh description",
      canonicalUrl: "https://canonical.example.test/stored",
    });
    const unchangedCreator = await findCreatorByNameKey(testDatabase.db, "unchangedcreator");
    expect(unchangedCreator).toMatchObject({
      imageUrl: "https://icons.example.test/stored.png",
      description: "Unchanged stored description",
    });

    const refreshedFeed = await requireFeed(testDatabase.db, "updated-feed");
    expect(refreshedFeed.lastNormalRefreshAt?.toISOString()).toBe("2026-05-16T11:00:00.000Z");
    expect(refreshedFeed.nextRefreshAfter?.toISOString()).toBe("2026-05-16T13:00:00.000Z");
  });

  test("skips feeds whose adapter does not implement fetchCreatorMetadata", async () => {
    await seedCreatorFeeds(testDatabase.db);
    const registry = createSourceAdapterRegistry([createMetadataAdapter({ withCreatorMetadata: false, outcomes: {} })]);

    const status = await refreshCreatorMetadata(metadataDependencies(registry));

    expect(status).toMatchObject({
      status: "succeeded",
      feedsTotal: 3,
      feedsProcessed: 0,
      feedsSkippedCount: 3,
      creatorsUpdatedCount: 0,
      creatorsUnchangedCount: 0,
      feedsFailedCount: 0,
      failures: [],
    });
  });

  test("startCreatorMetadataRefresh rejects a concurrent second run and exposes pollable status", async () => {
    await seedCreatorFeeds(testDatabase.db);
    const registry = createSourceAdapterRegistry([
      createMetadataAdapter({
        withCreatorMetadata: true,
        outcomes: {
          "updated-feed": { metadata: { imageUrl: "https://icons.example.test/fresh.png" } },
          "unchanged-feed": { metadata: {} },
          "failing-feed": { failWith: { code: "remote-fetch-failed", message: "Fixture metadata fetch failed." } },
        },
      }),
    ]);

    const started = startCreatorMetadataRefresh(metadataDependencies(registry));
    expect(started.started).toBe(true);
    expect(started.status.status).toBe("running");
    expect(getCreatorMetadataRefreshStatus()?.status).toBe("running");

    const concurrent = startCreatorMetadataRefresh(metadataDependencies(registry));
    expect(concurrent.started).toBe(false);
    expect(concurrent.status.id).toBe(started.status.id);

    const completed = await waitForCompletedStatus();
    expect(completed.status).toBe("partial");
    expect(completed.creatorsUpdatedCount).toBe(1);
    expect(completed.feedsFailedCount).toBe(1);

    const afterCompletion = getCreatorMetadataRefreshStatus();
    expect(afterCompletion?.id).toBe(completed.id);
    expect(afterCompletion?.status).toBe("partial");

    const restarted = startCreatorMetadataRefresh(metadataDependencies(registry));
    expect(restarted.started).toBe(true);
    await waitForCompletedStatus();
  });
});

interface SeededCreatorFeeds {
  readonly updatedFeedId: string;
  readonly unchangedFeedId: string;
  readonly failingFeedId: string;
}

async function seedCreatorFeeds(db: RepositoryDb): Promise<SeededCreatorFeeds> {
  const updatedCreator = await findOrCreateCreator(db, {
    displayName: "Updated Creator",
    imageUrl: "https://icons.example.test/stale.png",
    canonicalUrl: "https://canonical.example.test/stored",
  });
  const unchangedCreator = await findOrCreateCreator(db, {
    displayName: "Unchanged Creator",
    imageUrl: "https://icons.example.test/stored.png",
    description: "Unchanged stored description",
  });
  const failingCreator = await findOrCreateCreator(db, {
    displayName: "Failing Creator",
  });

  const updatedFeed = await findOrCreateFeed(db, {
    creatorId: updatedCreator.id,
    sourceType: "youtube",
    sourceExternalId: "updated-feed",
    url: "https://metadata.example.test/updated-feed",
    title: "Updated Feed",
    refreshCadenceSeconds: 900,
  });
  const unchangedFeed = await findOrCreateFeed(db, {
    creatorId: unchangedCreator.id,
    sourceType: "youtube",
    sourceExternalId: "unchanged-feed",
    url: "https://metadata.example.test/unchanged-feed",
    title: "Unchanged Feed",
    refreshCadenceSeconds: 900,
  });
  const failingFeed = await findOrCreateFeed(db, {
    creatorId: failingCreator.id,
    sourceType: "youtube",
    sourceExternalId: "failing-feed",
    url: "https://metadata.example.test/failing-feed",
    title: "Failing Feed",
    refreshCadenceSeconds: 900,
  });

  const lastNormalRefreshAt = new Date("2026-05-16T11:00:00.000Z");
  const nextRefreshAfter = new Date("2026-05-16T13:00:00.000Z");
  for (const feed of [updatedFeed, unchangedFeed, failingFeed]) {
    await db.update(schema.feed).set({ lastNormalRefreshAt, nextRefreshAfter }).where(eq(schema.feed.id, feed.id));
  }

  return { updatedFeedId: updatedFeed.id, unchangedFeedId: unchangedFeed.id, failingFeedId: failingFeed.id };
}

function metadataDependencies(
  registry: ReturnType<typeof createSourceAdapterRegistry>,
): { db: RepositoryDb; sourceRegistry: ReturnType<typeof createSourceAdapterRegistry>; now: () => Date } {
  return { db: testDatabase.db, sourceRegistry: registry, now: fixedNow };
}

function fixedNow(): Date {
  return new Date("2026-05-16T12:00:00.000Z");
}

async function requireFeed(db: RepositoryDb, sourceExternalId: string) {
  const feed = await db.query.feed.findFirst({
    where: eq(schema.feed.sourceExternalId, sourceExternalId),
  });
  if (feed === undefined) {
    throw new Error(`Expected feed ${sourceExternalId} to exist.`);
  }
  return feed;
}

async function waitForCompletedStatus(): Promise<CreatorMetadataRefreshStatus> {
  for (let attempt = 0; attempt < 500; attempt += 1) {
    const status = getCreatorMetadataRefreshStatus();
    if (status !== null && status.status !== "running") {
      return status;
    }
    await sleep(5);
  }
  throw new Error("Creator metadata refresh did not complete in time.");
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

function createMetadataAdapter(config: MetadataAdapterConfig): SourceAdapter {
  const sourceType = config.sourceType ?? "youtube";
  const base: SourceAdapter = {
    sourceType,
    detect(input) {
      const urlResult = parseHttpUrl(input);
      if (!urlResult.ok || urlResult.value.hostname !== "metadata.example.test") {
        return {
          ok: false,
          error: {
            code: "unsupported-source-input",
            message: "Fixture adapter does not support this input.",
            input,
          },
        };
      }
      return {
        ok: true,
        value: {
          sourceType,
          inputKind: "feed-url",
          originalInput: input,
          canonicalInput: urlResult.value.toString(),
        },
      };
    },
    async resolveInput(input) {
      return {
        ok: true,
        value: {
          sourceType: input.sourceType,
          sourceExternalId: new URL(input.canonicalInput).pathname.slice(1),
          canonicalUrl: input.canonicalInput,
        },
      };
    },
    normalizeCatalogPayload(input) {
      return {
        ok: false,
        error: {
          code: "normalization-failed",
          message: "Fixture metadata adapter never normalizes catalog payloads.",
          sourceType: input.sourceType,
        },
      };
    },
    async fetchCatalog(input) {
      return {
        ok: false,
        error: {
          code: "remote-fetch-failed",
          message: "Fixture metadata adapter never fetches catalogs.",
          sourceType: input.sourceType,
        },
      };
    },
  };
  if (!config.withCreatorMetadata) {
    return base;
  }
  return {
    ...base,
    async fetchCreatorMetadata(input) {
      const outcome = config.outcomes[input.sourceExternalId];
      if (outcome === undefined) {
        return { ok: true, value: {} };
      }
      if (outcome.failWith !== undefined) {
        return { ok: false, error: { ...outcome.failWith, sourceType: input.sourceType } };
      }
      return { ok: true, value: outcome.metadata ?? {} };
    },
  };
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
];
