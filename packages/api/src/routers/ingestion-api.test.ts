import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { createClient } from "@libsql/client";
import type { Client } from "@libsql/client";
import { call } from "@orpc/server";
import { drizzle } from "drizzle-orm/libsql";

import * as schema from "@FeedElity/db/schema";

import type { Context } from "../context";
import type { RepositoryDb } from "../repositories/catalog";
import { listCatalogContentItems } from "../repositories/catalog";
import { listSubscriptionsForUser } from "../repositories/overlays";
import { createSourceAdapterRegistry, parseHttpUrl } from "../sources";
import type {
  DetectedSourceInput,
  NormalizedCatalogPayload,
  SourceAdapter,
  SourceDetectionFailure,
  SourceDetectionSuccess,
} from "../sources";
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

describe("ingestion router", () => {
  test("protected add-source rejects anonymous callers", async () => {
    await expect(
      call(appRouter.ingestion.addSource, { sourceInput: "https://ingest.example.test/creator-one" }, {
        context: anonymousContext(testDatabase.db),
      }),
    ).rejects.toHaveProperty("code", "UNAUTHORIZED");
  });

  test("authenticated add-source trims input and creates a scoped subscription", async () => {
    await insertUser(testDatabase.db, "user-a", "user-a@example.test");

    const result = await call(appRouter.ingestion.addSource, { sourceInput: "  https://ingest.example.test/creator-one  " }, {
      context: authenticatedContext(testDatabase.db, "user-a"),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error(result.error.message);
    }
    expect(result.value.creator).toMatchObject({ displayName: "Creator One" });
    expect(result.value.subscription).toMatchObject({ userId: "user-a", creatorId: result.value.creator.id });
    expect(await listSubscriptionsForUser(testDatabase.db, "user-a")).toHaveLength(1);
  });

  test("batch add-source returns partial results without throwing for unsupported inputs", async () => {
    await insertUser(testDatabase.db, "user-a", "user-a@example.test");

    const result = await call(appRouter.ingestion.batchAddSources, {
      sourceInputs: [
        "https://ingest.example.test/creator-one",
        "https://unsupported.example.test/creator-two",
        "https://ingest.example.test/creator-two",
      ],
    }, {
      context: authenticatedContext(testDatabase.db, "user-a"),
    });

    expect(result.successesCount).toBe(2);
    expect(result.failuresCount).toBe(1);
    expect(result.results.map((item) => item.ok)).toEqual([true, false, true]);
    expect(result.results[1]).toMatchObject({
      ok: false,
      error: { code: "unsupported-source-input" },
    });
    expect(await listCatalogContentItems(testDatabase.db)).toHaveLength(3);
    expect(await listSubscriptionsForUser(testDatabase.db, "user-a")).toHaveLength(2);
  });
});

function anonymousContext(db: RepositoryDb): Context {
  return {
    db,
    session: null,
    sourceRegistry: createSourceAdapterRegistry([createFixtureAdapter()]),
  };
}

function authenticatedContext(db: RepositoryDb, userId: string): Context {
  const now = new Date("2026-01-01T00:00:00.000Z");
  return {
    db,
    sourceRegistry: createSourceAdapterRegistry([createFixtureAdapter()]),
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
        accountState: "active",
      },
    },
  };
}

function createFixtureAdapter(): SourceAdapter {
  return {
    sourceType: "youtube",
    detect(input) {
      const urlResult = parseHttpUrl(input);
      if (!urlResult.ok || urlResult.value.hostname !== "ingest.example.test") {
        return unsupported(input);
      }
      return detected({
        sourceType: "youtube",
        inputKind: "creator-url",
        originalInput: input,
        canonicalInput: urlResult.value.toString(),
      });
    },
    async resolveInput(input) {
      const url = new URL(input.canonicalInput);
      return {
        ok: true,
        value: {
          sourceType: "youtube",
          sourceExternalId: url.pathname.slice(1),
          canonicalUrl: input.canonicalInput,
        },
      };
    },
    normalizeCatalogPayload() {
      return { ok: true, value: creatorOnePayload };
    },
    async fetchCatalog(input) {
      return { ok: true, value: payloadForSource(input.sourceExternalId) };
    },
  };
}

function payloadForSource(sourceExternalId: string): NormalizedCatalogPayload {
  if (sourceExternalId === "creator-two") {
    return creatorTwoPayload;
  }
  return creatorOnePayload;
}

const creatorOnePayload: NormalizedCatalogPayload = {
  creator: {
    displayName: "Creator One",
    canonicalUrl: "https://ingest.example.test/creator-one",
  },
  feeds: [
    {
      sourceType: "youtube",
      sourceExternalId: "creator-one-feed",
      url: "https://ingest.example.test/creator-one/feed.xml",
      title: "Creator One uploads",
    },
  ],
  items: [
    {
      contentItem: {
        sourceType: "youtube",
        sourceExternalId: "creator-one-video-1",
        title: "Creator One First Video",
        canonicalUrl: "https://ingest.example.test/watch/creator-one-video-1",
      },
      feedContent: { sourceExternalId: "creator-one-video-1" },
      sources: [
        {
          sourceType: "youtube",
          sourceExternalId: "creator-one-video-1",
          canonicalUrl: "https://ingest.example.test/watch/creator-one-video-1",
          embedUrl: "https://ingest.example.test/embed/creator-one-video-1",
          priority: 0,
        },
      ],
    },
    {
      contentItem: {
        sourceType: "youtube",
        sourceExternalId: "creator-one-video-2",
        title: "Creator One Second Video",
        canonicalUrl: "https://ingest.example.test/watch/creator-one-video-2",
      },
      feedContent: { sourceExternalId: "creator-one-video-2" },
      sources: [
        {
          sourceType: "youtube",
          sourceExternalId: "creator-one-video-2",
          canonicalUrl: "https://ingest.example.test/watch/creator-one-video-2",
          embedUrl: "https://ingest.example.test/embed/creator-one-video-2",
          priority: 0,
        },
      ],
    },
  ],
};

const creatorTwoPayload: NormalizedCatalogPayload = {
  creator: {
    displayName: "Creator Two",
    canonicalUrl: "https://ingest.example.test/creator-two",
  },
  feeds: [
    {
      sourceType: "youtube",
      sourceExternalId: "creator-two-feed",
      url: "https://ingest.example.test/creator-two/feed.xml",
      title: "Creator Two uploads",
    },
  ],
  items: [
    {
      contentItem: {
        sourceType: "youtube",
        sourceExternalId: "creator-two-video-1",
        title: "Creator Two First Video",
        canonicalUrl: "https://ingest.example.test/watch/creator-two-video-1",
      },
      feedContent: { sourceExternalId: "creator-two-video-1" },
      sources: [
        {
          sourceType: "youtube",
          sourceExternalId: "creator-two-video-1",
          canonicalUrl: "https://ingest.example.test/watch/creator-two-video-1",
          embedUrl: "https://ingest.example.test/embed/creator-two-video-1",
          priority: 0,
        },
      ],
    },
  ],
};

function detected(value: DetectedSourceInput): SourceDetectionSuccess {
  return { ok: true, value };
}

function unsupported(input: string): SourceDetectionFailure {
  return {
    ok: false,
    error: {
      code: "unsupported-source-input",
      message: "Fixture adapter does not support this input.",
      input,
    },
  };
}

async function insertUser(db: RepositoryDb, id: string, email: string): Promise<void> {
  await db.insert(schema.user).values({
    id,
    name: id,
    email,
    emailVerified: true,
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
  "CREATE UNIQUE INDEX feed_content_source_identity_uidx ON feed_content (feed_id, source_external_id)",
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
