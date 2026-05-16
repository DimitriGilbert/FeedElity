import { and, eq } from "drizzle-orm";
import type { LibSQLDatabase } from "drizzle-orm/libsql";

import * as schema from "@FeedElity/db/schema";

import type {
  CatalogContentItem,
  CatalogContentSource,
  CatalogCreator,
  CatalogFeed,
  RefreshFeedResult,
  RefreshRun,
  RefreshScope,
  RefreshStatus,
  FeedContentLink,
  SourceType,
} from "../domain/catalog";

export type RepositoryDb = LibSQLDatabase<typeof schema>;

export interface SaveCreatorInput {
  readonly sourceType: SourceType;
  readonly sourceExternalId: string;
  readonly displayName: string;
  readonly description?: string | null;
  readonly imageUrl?: string | null;
  readonly canonicalUrl?: string | null;
  readonly metadataJson?: string | null;
}

export interface SaveFeedInput {
  readonly creatorId: string;
  readonly sourceType: SourceType;
  readonly sourceExternalId: string;
  readonly url: string;
  readonly title?: string | null;
  readonly description?: string | null;
  readonly refreshCadenceSeconds?: number | null;
  readonly adapterMetadataJson?: string | null;
}

export interface SaveContentItemInput {
  readonly creatorId: string;
  readonly sourceType: SourceType;
  readonly sourceExternalId: string;
  readonly title: string;
  readonly description?: string | null;
  readonly publishedAt?: Date | null;
  readonly durationSeconds?: number | null;
  readonly thumbnailUrl?: string | null;
  readonly canonicalUrl?: string | null;
  readonly metadataJson?: string | null;
}

export interface SaveContentSourceInput {
  readonly contentItemId: string;
  readonly sourceType: SourceType;
  readonly sourceExternalId?: string | null;
  readonly embedUrl?: string | null;
  readonly nativeMediaUrl?: string | null;
  readonly canonicalUrl: string;
  readonly priority: number;
  readonly metadataJson?: string | null;
}

export interface LinkFeedContentInput {
  readonly feedId: string;
  readonly contentItemId: string;
  readonly sourceExternalId: string;
  readonly rawImportRef?: string | null;
}

export interface CreateRefreshRunInput {
  readonly scope: RefreshScope;
  readonly force?: boolean;
  readonly status: RefreshStatus;
  readonly requestedCreatorId?: string | null;
  readonly requestedFeedId?: string | null;
  readonly feedsRequestedCount?: number;
  readonly feedsSucceededCount?: number;
  readonly feedsFailedCount?: number;
  readonly itemsDiscoveredCount?: number;
  readonly itemsCreatedCount?: number;
  readonly itemsUpdatedCount?: number;
  readonly startedAt?: Date;
  readonly completedAt?: Date | null;
  readonly errorSummaryJson?: string | null;
}

export interface RecordRefreshFeedResultInput {
  readonly refreshRunId: string;
  readonly feedId: string;
  readonly status: RefreshStatus;
  readonly itemsDiscoveredCount?: number;
  readonly itemsCreatedCount?: number;
  readonly itemsUpdatedCount?: number;
  readonly startedAt?: Date;
  readonly completedAt?: Date | null;
  readonly errorSummaryJson?: string | null;
}

export async function findOrCreateCreator(db: RepositoryDb, input: SaveCreatorInput): Promise<CatalogCreator> {
  const id = crypto.randomUUID();

  await db
    .insert(schema.creator)
    .values({
      id,
      sourceType: input.sourceType,
      sourceExternalId: input.sourceExternalId,
      displayName: input.displayName,
      description: input.description ?? null,
      imageUrl: input.imageUrl ?? null,
      canonicalUrl: input.canonicalUrl ?? null,
      metadataJson: input.metadataJson ?? null,
    })
    .onConflictDoNothing({ target: [schema.creator.sourceType, schema.creator.sourceExternalId] });

  const existing = await findCreatorBySourceIdentity(db, input);
  if (existing === null) {
    throw new Error("Creator write did not produce a readable catalog record.");
  }
  return existing;
}

export async function findCreatorBySourceIdentity(
  db: RepositoryDb,
  identity: Pick<SaveCreatorInput, "sourceType" | "sourceExternalId">,
): Promise<CatalogCreator | null> {
  const row = await db.query.creator.findFirst({
    where: and(
      eq(schema.creator.sourceType, identity.sourceType),
      eq(schema.creator.sourceExternalId, identity.sourceExternalId),
    ),
  });

  return row === undefined ? null : toCatalogCreator(row);
}

export async function findOrCreateFeed(db: RepositoryDb, input: SaveFeedInput): Promise<CatalogFeed> {
  const id = crypto.randomUUID();

  await db
    .insert(schema.feed)
    .values({
      id,
      creatorId: input.creatorId,
      sourceType: input.sourceType,
      sourceExternalId: input.sourceExternalId,
      url: input.url,
      title: input.title ?? null,
      description: input.description ?? null,
      refreshCadenceSeconds: input.refreshCadenceSeconds ?? null,
      adapterMetadataJson: input.adapterMetadataJson ?? null,
    })
    .onConflictDoNothing({ target: [schema.feed.sourceType, schema.feed.sourceExternalId] });

  const existing = await findFeedBySourceIdentity(db, input);
  if (existing === null) {
    throw new Error("Feed write did not produce a readable catalog record.");
  }
  return existing;
}

export async function findFeedBySourceIdentity(
  db: RepositoryDb,
  identity: Pick<SaveFeedInput, "sourceType" | "sourceExternalId">,
): Promise<CatalogFeed | null> {
  const row = await db.query.feed.findFirst({
    where: and(eq(schema.feed.sourceType, identity.sourceType), eq(schema.feed.sourceExternalId, identity.sourceExternalId)),
  });

  return row === undefined ? null : toCatalogFeed(row);
}

export async function findOrCreateContentItem(
  db: RepositoryDb,
  input: SaveContentItemInput,
): Promise<CatalogContentItem> {
  const id = crypto.randomUUID();

  await db
    .insert(schema.contentItem)
    .values({
      id,
      creatorId: input.creatorId,
      sourceType: input.sourceType,
      sourceExternalId: input.sourceExternalId,
      title: input.title,
      description: input.description ?? null,
      publishedAt: input.publishedAt ?? null,
      durationSeconds: input.durationSeconds ?? null,
      thumbnailUrl: input.thumbnailUrl ?? null,
      canonicalUrl: input.canonicalUrl ?? null,
      metadataJson: input.metadataJson ?? null,
    })
    .onConflictDoNothing({ target: [schema.contentItem.sourceType, schema.contentItem.sourceExternalId] });

  const existing = await findContentItemBySourceIdentity(db, input);
  if (existing === null) {
    throw new Error("Content item write did not produce a readable catalog record.");
  }
  return existing;
}

export async function findContentItemBySourceIdentity(
  db: RepositoryDb,
  identity: Pick<SaveContentItemInput, "sourceType" | "sourceExternalId">,
): Promise<CatalogContentItem | null> {
  const row = await db.query.contentItem.findFirst({
    where: and(
      eq(schema.contentItem.sourceType, identity.sourceType),
      eq(schema.contentItem.sourceExternalId, identity.sourceExternalId),
    ),
  });

  return row === undefined ? null : toCatalogContentItem(row);
}

export async function findOrCreateContentSource(
  db: RepositoryDb,
  input: SaveContentSourceInput,
): Promise<CatalogContentSource> {
  const id = crypto.randomUUID();

  await db
    .insert(schema.contentSource)
    .values({
      id,
      contentItemId: input.contentItemId,
      sourceType: input.sourceType,
      sourceExternalId: input.sourceExternalId ?? null,
      embedUrl: input.embedUrl ?? null,
      nativeMediaUrl: input.nativeMediaUrl ?? null,
      canonicalUrl: input.canonicalUrl,
      priority: input.priority,
      metadataJson: input.metadataJson ?? null,
    })
    .onConflictDoNothing({ target: [schema.contentSource.sourceType, schema.contentSource.canonicalUrl] });

  const existing = await findContentSourceByCanonicalUrl(db, input.sourceType, input.canonicalUrl);
  if (existing === null) {
    throw new Error("Content source write did not produce a readable catalog record.");
  }
  return existing;
}

export async function findContentSourceByCanonicalUrl(
  db: RepositoryDb,
  sourceType: SourceType,
  canonicalUrl: string,
): Promise<CatalogContentSource | null> {
  const row = await db.query.contentSource.findFirst({
    where: and(eq(schema.contentSource.sourceType, sourceType), eq(schema.contentSource.canonicalUrl, canonicalUrl)),
  });

  return row === undefined ? null : toCatalogContentSource(row);
}

export async function linkFeedContent(db: RepositoryDb, input: LinkFeedContentInput): Promise<FeedContentLink> {
  await db
    .insert(schema.feedContent)
    .values({
      feedId: input.feedId,
      contentItemId: input.contentItemId,
      sourceExternalId: input.sourceExternalId,
      rawImportRef: input.rawImportRef ?? null,
    })
    .onConflictDoNothing({ target: [schema.feedContent.feedId, schema.feedContent.contentItemId] });

  const row = await db.query.feedContent.findFirst({
    where: and(
      eq(schema.feedContent.feedId, input.feedId),
      eq(schema.feedContent.contentItemId, input.contentItemId),
    ),
  });

  if (row === undefined) {
    throw new Error("Feed content link write did not produce a readable catalog record.");
  }

  return {
    feedId: row.feedId,
    contentItemId: row.contentItemId,
    sourceExternalId: row.sourceExternalId,
    rawImportRef: row.rawImportRef,
  };
}

export async function listCatalogContentItems(db: RepositoryDb): Promise<readonly CatalogContentItem[]> {
  const rows = await db.query.contentItem.findMany({
    orderBy: (contentItem, { desc }) => [desc(contentItem.publishedAt), desc(contentItem.createdAt)],
  });

  return rows.map(toCatalogContentItem);
}

export async function createRefreshRun(db: RepositoryDb, input: CreateRefreshRunInput): Promise<RefreshRun> {
  const id = crypto.randomUUID();

  await db.insert(schema.refreshRun).values({
    id,
    scope: input.scope,
    force: input.force ?? false,
    status: input.status,
    requestedCreatorId: input.requestedCreatorId ?? null,
    requestedFeedId: input.requestedFeedId ?? null,
    feedsRequestedCount: input.feedsRequestedCount ?? 0,
    feedsSucceededCount: input.feedsSucceededCount ?? 0,
    feedsFailedCount: input.feedsFailedCount ?? 0,
    itemsDiscoveredCount: input.itemsDiscoveredCount ?? 0,
    itemsCreatedCount: input.itemsCreatedCount ?? 0,
    itemsUpdatedCount: input.itemsUpdatedCount ?? 0,
    startedAt: input.startedAt ?? new Date(),
    completedAt: input.completedAt ?? null,
    errorSummaryJson: input.errorSummaryJson ?? null,
  });

  const row = await db.query.refreshRun.findFirst({ where: eq(schema.refreshRun.id, id) });
  if (row === undefined) {
    throw new Error("Refresh run write did not produce a readable catalog record.");
  }
  return toRefreshRun(row);
}

export async function listRefreshRuns(db: RepositoryDb): Promise<readonly RefreshRun[]> {
  const rows = await db.query.refreshRun.findMany({
    orderBy: (refreshRun, { desc }) => [desc(refreshRun.startedAt)],
  });

  return rows.map(toRefreshRun);
}

export async function recordRefreshFeedResult(
  db: RepositoryDb,
  input: RecordRefreshFeedResultInput,
): Promise<RefreshFeedResult> {
  const id = crypto.randomUUID();

  await db
    .insert(schema.refreshFeedResult)
    .values({
      id,
      refreshRunId: input.refreshRunId,
      feedId: input.feedId,
      status: input.status,
      itemsDiscoveredCount: input.itemsDiscoveredCount ?? 0,
      itemsCreatedCount: input.itemsCreatedCount ?? 0,
      itemsUpdatedCount: input.itemsUpdatedCount ?? 0,
      startedAt: input.startedAt ?? new Date(),
      completedAt: input.completedAt ?? null,
      errorSummaryJson: input.errorSummaryJson ?? null,
    })
    .onConflictDoNothing({ target: [schema.refreshFeedResult.refreshRunId, schema.refreshFeedResult.feedId] });

  const row = await db.query.refreshFeedResult.findFirst({
    where: and(
      eq(schema.refreshFeedResult.refreshRunId, input.refreshRunId),
      eq(schema.refreshFeedResult.feedId, input.feedId),
    ),
  });
  if (row === undefined) {
    throw new Error("Refresh feed result write did not produce a readable catalog record.");
  }
  return toRefreshFeedResult(row);
}

export async function listRefreshFeedResultsForRun(
  db: RepositoryDb,
  refreshRunId: string,
): Promise<readonly RefreshFeedResult[]> {
  const rows = await db.query.refreshFeedResult.findMany({
    where: eq(schema.refreshFeedResult.refreshRunId, refreshRunId),
    orderBy: (refreshFeedResult, { asc }) => [asc(refreshFeedResult.startedAt)],
  });

  return rows.map(toRefreshFeedResult);
}

function toCatalogCreator(row: typeof schema.creator.$inferSelect): CatalogCreator {
  return {
    id: row.id,
    sourceType: row.sourceType,
    sourceExternalId: row.sourceExternalId,
    displayName: row.displayName,
    description: row.description,
    imageUrl: row.imageUrl,
    canonicalUrl: row.canonicalUrl,
    metadataJson: row.metadataJson,
  };
}

function toCatalogFeed(row: typeof schema.feed.$inferSelect): CatalogFeed {
  return {
    id: row.id,
    creatorId: row.creatorId,
    sourceType: row.sourceType,
    sourceExternalId: row.sourceExternalId,
    url: row.url,
    title: row.title,
    description: row.description,
    refreshCadenceSeconds: row.refreshCadenceSeconds,
    adapterMetadataJson: row.adapterMetadataJson,
  };
}

function toCatalogContentItem(row: typeof schema.contentItem.$inferSelect): CatalogContentItem {
  return {
    id: row.id,
    creatorId: row.creatorId,
    sourceType: row.sourceType,
    sourceExternalId: row.sourceExternalId,
    title: row.title,
    description: row.description,
    publishedAt: row.publishedAt,
    contentType: row.contentType,
    durationSeconds: row.durationSeconds,
    thumbnailUrl: row.thumbnailUrl,
    canonicalUrl: row.canonicalUrl,
    metadataJson: row.metadataJson,
  };
}

function toCatalogContentSource(row: typeof schema.contentSource.$inferSelect): CatalogContentSource {
  return {
    id: row.id,
    contentItemId: row.contentItemId,
    sourceType: row.sourceType,
    sourceExternalId: row.sourceExternalId,
    embedUrl: row.embedUrl,
    nativeMediaUrl: row.nativeMediaUrl,
    canonicalUrl: row.canonicalUrl,
    priority: row.priority,
    metadataJson: row.metadataJson,
  };
}

function toRefreshRun(row: typeof schema.refreshRun.$inferSelect): RefreshRun {
  return {
    id: row.id,
    scope: row.scope,
    force: row.force,
    status: row.status,
    requestedCreatorId: row.requestedCreatorId,
    requestedFeedId: row.requestedFeedId,
    feedsRequestedCount: row.feedsRequestedCount,
    feedsSucceededCount: row.feedsSucceededCount,
    feedsFailedCount: row.feedsFailedCount,
    itemsDiscoveredCount: row.itemsDiscoveredCount,
    itemsCreatedCount: row.itemsCreatedCount,
    itemsUpdatedCount: row.itemsUpdatedCount,
    startedAt: row.startedAt,
    completedAt: row.completedAt,
    errorSummaryJson: row.errorSummaryJson,
  };
}

function toRefreshFeedResult(row: typeof schema.refreshFeedResult.$inferSelect): RefreshFeedResult {
  return {
    id: row.id,
    refreshRunId: row.refreshRunId,
    feedId: row.feedId,
    status: row.status,
    itemsDiscoveredCount: row.itemsDiscoveredCount,
    itemsCreatedCount: row.itemsCreatedCount,
    itemsUpdatedCount: row.itemsUpdatedCount,
    startedAt: row.startedAt,
    completedAt: row.completedAt,
    errorSummaryJson: row.errorSummaryJson,
  };
}
