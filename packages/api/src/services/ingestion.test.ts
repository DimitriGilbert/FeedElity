import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { createClient } from "@libsql/client";
import type { Client } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { eq } from "drizzle-orm";

import * as schema from "@FeedElity/db/schema";

import type { RepositoryDb } from "../repositories/catalog";
import { findFeedBySourceIdentity, listCatalogContentItems, listCatalogFeedsForCreator } from "../repositories/catalog";
import { listSubscriptionsForUser } from "../repositories/overlays";
import { createSourceAdapterRegistry, parseHttpUrl } from "../sources";
import type {
  DetectedSourceInput,
  NormalizedCatalogPayload,
  SourceAdapter,
  SourceDetectionFailure,
  SourceDetectionSuccess,
} from "../sources";
import { addSource, batchAddSources } from "./ingestion";

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

describe("source ingestion service", () => {
  test("adds a source into reusable global catalog records", async () => {
    const registry = createSourceAdapterRegistry([createFixtureAdapter()]);

    const result = await addSource(
      { db: testDatabase.db, sourceRegistry: registry },
      { sourceInput: "https://ingest.example.test/creator-one" },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error(result.error.message);
    }
    expect(result.value.creator).toMatchObject({ displayName: "Creator One" });
    expect(result.value.feeds).toHaveLength(1);
    expect(result.value.feeds.at(0)?.refreshCadenceSeconds).toBe(7200);
    expect(result.value.contentItems).toHaveLength(2);
    expect(result.value.contentSources).toHaveLength(2);
    expect(result.value.feedContents).toHaveLength(2);
    expect(result.value.subscription).toBeNull();
    expect(result.value.created).toEqual({ creators: 1, feeds: 1, contentItems: 2, contentSources: 2 });
  });

  test("applies source default cadence when adapter payload omits refresh cadence", async () => {
    const registry = createSourceAdapterRegistry([createFixtureAdapter()]);

    const result = await addSource(
      { db: testDatabase.db, sourceRegistry: registry },
      { sourceInput: "https://ingest.example.test/creator-one" },
    );

    expect(result.ok).toBe(true);
    const feed = await findFeedBySourceIdentity(testDatabase.db, { sourceType: "youtube", sourceExternalId: "creator-one-feed" });
    expect(feed?.refreshCadenceSeconds).toBe(7200);
  });

  test("repeating the same source input reuses existing records without duplicates", async () => {
    const registry = createSourceAdapterRegistry([createFixtureAdapter()]);
    const dependencies = { db: testDatabase.db, sourceRegistry: registry };

    const first = await addSource(dependencies, { sourceInput: "https://ingest.example.test/creator-one" });
    const second = await addSource(dependencies, { sourceInput: "https://ingest.example.test/creator-one" });

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    if (!first.ok) {
      throw new Error(first.error.message);
    }
    if (!second.ok) {
      throw new Error(second.error.message);
    }
    expect(second.value.creator.id).toBe(first.value.creator.id);
    expect(second.value.created).toEqual({ creators: 0, feeds: 0, contentItems: 0, contentSources: 0 });
    expect(await listCatalogContentItems(testDatabase.db)).toHaveLength(2);
  });

  test("a creator mirrored across sources is deduplicated by display name into one creator with multiple feeds", async () => {
    const registry = createSourceAdapterRegistry([createFixtureAdapter(), createOdyseeFixtureAdapter()]);
    const dependencies = { db: testDatabase.db, sourceRegistry: registry };

    const youtube = await addSource(dependencies, { sourceInput: "https://ingest.example.test/creator-one" });
    const odysee = await addSource(dependencies, { sourceInput: "https://odysee.ingest.example.test/@CreatorOne" });

    expect(youtube.ok).toBe(true);
    expect(odysee.ok).toBe(true);
    if (!youtube.ok || !odysee.ok) {
      throw new Error("Expected both source adds to succeed.");
    }
    // Same channel name from two sources collapses onto one cross-source creator.
    expect(odysee.value.creator.id).toBe(youtube.value.creator.id);
    expect(odysee.value.created.creators).toBe(0);
    // The creator now carries one feed per source.
    const creatorFeeds = await listCatalogFeedsForCreator(testDatabase.db, youtube.value.creator.id);
    expect(creatorFeeds.map((feed) => feed.sourceType).sort()).toEqual(["odysee", "youtube"]);
  });

  test("anonymous source add does not create user overlay records", async () => {
    const registry = createSourceAdapterRegistry([createFixtureAdapter()]);

    const result = await addSource(
      { db: testDatabase.db, sourceRegistry: registry },
      { sourceInput: "https://ingest.example.test/creator-one" },
    );

    expect(result.ok).toBe(true);
    expect(await listSubscriptionsForUser(testDatabase.db, "anonymous-user")).toHaveLength(0);
  });

  test("authenticated source add creates and reuses a subscription for the creator", async () => {
    await insertUser(testDatabase.db, "user-a", "user-a@example.test");
    const registry = createSourceAdapterRegistry([createFixtureAdapter()]);
    const dependencies = { db: testDatabase.db, sourceRegistry: registry };

    const first = await addSource(dependencies, {
      sourceInput: "https://ingest.example.test/creator-one",
      userId: "user-a",
    });
    const second = await addSource(dependencies, {
      sourceInput: "https://ingest.example.test/creator-one",
      userId: "user-a",
    });

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    if (!first.ok) {
      throw new Error(first.error.message);
    }
    if (!second.ok) {
      throw new Error(second.error.message);
    }
    expect(first.value.subscription?.creatorId).toBe(first.value.creator.id);
    expect(second.value.subscription?.id).toBe(first.value.subscription?.id);
    expect(await listSubscriptionsForUser(testDatabase.db, "user-a")).toHaveLength(1);
  });

  test("unsupported and unresolvable inputs return structured failures", async () => {
    const registry = createSourceAdapterRegistry([createFixtureAdapter()]);

    const unsupported = await addSource(
      { db: testDatabase.db, sourceRegistry: registry },
      { sourceInput: "https://unsupported.example.test/creator-one" },
    );
    const unresolvable = await addSource(
      { db: testDatabase.db, sourceRegistry: registry },
      { sourceInput: "https://ingest.example.test/unresolvable" },
    );

    expect(unsupported.ok).toBe(false);
    expect(unresolvable.ok).toBe(false);
    if (unsupported.ok) {
      throw new Error(`Expected unsupported failure, received ${unsupported.value.creator.id}.`);
    }
    if (unresolvable.ok) {
      throw new Error(`Expected unresolvable failure, received ${unresolvable.value.creator.id}.`);
    }
    expect(unsupported.error).toMatchObject({ code: "unsupported-source-input" });
    expect(unresolvable.error).toMatchObject({ code: "remote-fetch-failed" });
  });

  test("batch add reports partial failures without hiding successes", async () => {
    await insertUser(testDatabase.db, "user-a", "batch-a@example.test");
    const registry = createSourceAdapterRegistry([createFixtureAdapter()]);

    const result = await batchAddSources(
      { db: testDatabase.db, sourceRegistry: registry },
      {
        sourceInputs: [
          "https://ingest.example.test/creator-one",
          "https://unsupported.example.test/creator-two",
          "https://ingest.example.test/creator-two",
        ],
        userId: "user-a",
      },
    );

    expect(result.successesCount).toBe(2);
    expect(result.failuresCount).toBe(1);
    expect(result.results.map((item) => item.ok)).toEqual([true, false, true]);
    expect(await listCatalogContentItems(testDatabase.db)).toHaveLength(3);
    expect(await listSubscriptionsForUser(testDatabase.db, "user-a")).toHaveLength(2);
  });

  test("multi-feed payload items link only to their source feed", async () => {
    const registry = createSourceAdapterRegistry([createFixtureAdapter()]);

    const result = await addSource(
      { db: testDatabase.db, sourceRegistry: registry },
      { sourceInput: "https://ingest.example.test/multi-feed" },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error(result.error.message);
    }
    const feedContentRows = await testDatabase.db.select().from(schema.feedContent);
    expect(result.value.feeds).toHaveLength(2);
    expect(result.value.contentItems).toHaveLength(8);
    expect(result.value.feedContents).toHaveLength(8);
    expect(feedContentRows).toHaveLength(8);
  });

  test("ingestion maintains creator last content published at as a never-regressing max", async () => {
    const registry = createSourceAdapterRegistry([createFixtureAdapter(), createOdyseeFixtureAdapter()]);
    const dependencies = { db: testDatabase.db, sourceRegistry: registry };

    const youtube = await addSource(dependencies, { sourceInput: "https://ingest.example.test/creator-one" });
    expect(youtube.ok).toBe(true);
    if (!youtube.ok) {
      throw new Error(youtube.error.message);
    }
    // creator-one items: one published 2026-01-01, one with NULL published_at.
    expect(await readCreatorLastPublishedAt(testDatabase.db, youtube.value.creator.id)).toBe(
      Date.parse("2026-01-01T00:00:00.000Z"),
    );

    // The mirrored Odysee feed publishes a newer item (2026-01-02).
    const odysee = await addSource(dependencies, { sourceInput: "https://odysee.ingest.example.test/@CreatorOne" });
    expect(odysee.ok).toBe(true);
    if (!odysee.ok) {
      throw new Error(odysee.error.message);
    }
    expect(odysee.value.creator.id).toBe(youtube.value.creator.id);
    expect(await readCreatorLastPublishedAt(testDatabase.db, youtube.value.creator.id)).toBe(
      Date.parse("2026-01-02T00:00:00.000Z"),
    );

    // Re-ingesting the older YouTube payload must not regress the value.
    const again = await addSource(dependencies, { sourceInput: "https://ingest.example.test/creator-one" });
    expect(again.ok).toBe(true);
    expect(await readCreatorLastPublishedAt(testDatabase.db, youtube.value.creator.id)).toBe(
      Date.parse("2026-01-02T00:00:00.000Z"),
    );

    // A creator whose only item has NULL published_at stays NULL.
    const creatorTwo = await addSource(dependencies, { sourceInput: "https://ingest.example.test/creator-two" });
    expect(creatorTwo.ok).toBe(true);
    if (!creatorTwo.ok) {
      throw new Error(creatorTwo.error.message);
    }
    expect(await readCreatorLastPublishedAt(testDatabase.db, creatorTwo.value.creator.id)).toBeNull();
  });
});

function createFixtureAdapter(): SourceAdapter {
  return {
    sourceType: "youtube",
    detect(input) {
      const urlResult = parseHttpUrl(input);
      if (!urlResult.ok) {
        return unsupported(input);
      }
      if (urlResult.value.hostname !== "ingest.example.test") {
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
      if (url.pathname === "/unresolvable") {
        return {
          ok: false,
          error: {
            code: "remote-fetch-failed",
            message: "Fixture source cannot be resolved.",
            input: input.originalInput,
            sourceType: "youtube",
          },
        };
      }
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

function createOdyseeFixtureAdapter(): SourceAdapter {
  return {
    sourceType: "odysee",
    detect(input) {
      const urlResult = parseHttpUrl(input);
      if (!urlResult.ok || urlResult.value.hostname !== "odysee.ingest.example.test") {
        return unsupported(input);
      }
      return detected({
        sourceType: "odysee",
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
          sourceType: "odysee",
          sourceExternalId: url.pathname.slice(1),
          canonicalUrl: input.canonicalInput,
        },
      };
    },
    normalizeCatalogPayload() {
      return { ok: true, value: odyseeCreatorOnePayload };
    },
    async fetchCatalog() {
      return { ok: true, value: odyseeCreatorOnePayload };
    },
  };
}

const odyseeCreatorOnePayload: NormalizedCatalogPayload = {
  creator: {
    // Same channel name as the YouTube fixture, so ingestion must merge them.
    displayName: "Creator One",
    canonicalUrl: "https://odysee.ingest.example.test/@CreatorOne",
  },
  feeds: [
    {
      sourceType: "odysee",
      sourceExternalId: "@CreatorOne",
      url: "https://odysee.ingest.example.test/$/rss/@CreatorOne",
      title: "Creator One uploads",
    },
  ],
  items: [
    {
      contentItem: {
        sourceType: "odysee",
        sourceExternalId: "creator-one-odysee-video-1",
        title: "Creator One Odysee Video",
        publishedAt: new Date("2026-01-02T00:00:00.000Z"),
        canonicalUrl: "https://odysee.ingest.example.test/@CreatorOne:1",
      },
      feedContent: { sourceExternalId: "creator-one-odysee-video-1" },
      sources: [
        {
          sourceType: "odysee",
          sourceExternalId: "creator-one-odysee-video-1",
          canonicalUrl: "https://odysee.ingest.example.test/@CreatorOne:1",
          nativeMediaUrl: "https://odysee.ingest.example.test/stream/1.mp4",
          priority: 0,
        },
      ],
    },
  ],
};

function payloadForSource(sourceExternalId: string): NormalizedCatalogPayload {
  if (sourceExternalId === "multi-feed") {
    return multiFeedPayload;
  }
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
        publishedAt: new Date("2026-01-01T00:00:00.000Z"),
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

const multiFeedPayload: NormalizedCatalogPayload = {
  creator: {
    displayName: "Multi Feed Creator",
    canonicalUrl: "https://ingest.example.test/multi-feed",
  },
  feeds: [
    {
      sourceType: "youtube",
      sourceExternalId: "multi-feed-a",
      url: "https://ingest.example.test/multi-feed/a.xml",
      title: "Multi Feed A",
    },
    {
      sourceType: "youtube",
      sourceExternalId: "multi-feed-b",
      url: "https://ingest.example.test/multi-feed/b.xml",
      title: "Multi Feed B",
    },
  ],
  items: [
    ...buildMultiFeedItems("multi-feed-a", 5),
    ...buildMultiFeedItems("multi-feed-b", 3),
  ],
};

function buildMultiFeedItems(feedSourceExternalId: string, count: number): NormalizedCatalogPayload["items"] {
  return Array.from({ length: count }, (_, index) => {
    const itemNumber = index + 1;
    const sourceExternalId = `${feedSourceExternalId}-video-${itemNumber}`;
    return {
      feedSourceExternalId,
      contentItem: {
        sourceType: "youtube",
        sourceExternalId,
        title: `Multi feed video ${itemNumber}`,
        canonicalUrl: `https://ingest.example.test/watch/${sourceExternalId}`,
      },
      feedContent: { sourceExternalId },
      sources: [
        {
          sourceType: "youtube",
          sourceExternalId,
          canonicalUrl: `https://ingest.example.test/watch/${sourceExternalId}`,
          embedUrl: `https://ingest.example.test/embed/${sourceExternalId}`,
          priority: 0,
        },
      ],
    };
  });
}

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

async function readCreatorLastPublishedAt(db: RepositoryDb, creatorId: string): Promise<number | null> {
  const row = await db.query.creator.findFirst({ where: eq(schema.creator.id, creatorId) });
  return row === undefined || row.lastContentPublishedAt === null ? null : row.lastContentPublishedAt.getTime();
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
