import { and, asc, desc, eq, sql } from "drizzle-orm";
import type { LibSQLDatabase } from "drizzle-orm/libsql";

import * as schema from "@FeedElity/db/schema";

import type {
  CatalogContentItem,
  CatalogContentDetail,
  CatalogContentListItem,
  CatalogContentSource,
  CatalogCreator,
  CatalogCreatorSummary,
  CatalogFeed,
  RefreshFeedResult,
  RefreshFeedResultWithFeed,
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
  readonly feedsSkippedCount?: number;
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

export interface CompleteRefreshRunInput {
  readonly id: string;
  readonly status: RefreshStatus;
  readonly feedsRequestedCount: number;
  readonly feedsSkippedCount: number;
  readonly feedsSucceededCount: number;
  readonly feedsFailedCount: number;
  readonly itemsDiscoveredCount: number;
  readonly itemsCreatedCount: number;
  readonly itemsUpdatedCount?: number;
  readonly completedAt: Date;
  readonly errorSummaryJson?: string | null;
}

export interface UpdateRefreshRunProgressInput {
  readonly id: string;
  readonly feedsSucceededCount: number;
  readonly feedsFailedCount: number;
  readonly itemsDiscoveredCount: number;
  readonly itemsCreatedCount: number;
  readonly itemsUpdatedCount?: number;
  readonly errorSummaryJson?: string | null;
}

export interface UpdateFeedRefreshMetadataInput {
  readonly feedId: string;
  readonly refreshedAt: Date;
  readonly nextRefreshAfter: Date | null;
}

export interface ListCatalogCreatorsInput {
  readonly search?: string;
  readonly sourceType?: SourceType;
  readonly limit: number;
  readonly offset?: number;
}

export interface ListCatalogContentItemsInput {
  readonly search?: string;
  readonly creatorId?: string;
  readonly feedId?: string;
  readonly sourceType?: SourceType;
  readonly limit: number;
  readonly offset?: number;
}

export interface ListCatalogFeedsInput {
  readonly creatorId?: string;
  readonly sourceType?: SourceType;
  readonly limit: number;
  readonly offset?: number;
}

export interface ListRefreshRunsInput {
  readonly limit: number;
}

export interface ListRunningRefreshRunsInput {
  readonly limit: number;
}

export interface ListRefreshFeedResultsForRunInput {
  readonly refreshRunId: string;
  readonly limit: number;
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

export async function getCatalogCreatorSummaryById(
  db: RepositoryDb,
  creatorId: string,
): Promise<CatalogCreatorSummary | null> {
  const row = await db.query.creator.findFirst({
    where: eq(schema.creator.id, creatorId),
  });

  return row === undefined ? null : toCatalogCreatorSummary(row);
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

export async function getCatalogFeedById(db: RepositoryDb, feedId: string): Promise<CatalogFeed | null> {
  const row = await db.query.feed.findFirst({
    where: eq(schema.feed.id, feedId),
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

export async function getCatalogContentItemById(
  db: RepositoryDb,
  contentItemId: string,
): Promise<CatalogContentItem | null> {
  const row = await db.query.contentItem.findFirst({
    where: eq(schema.contentItem.id, contentItemId),
  });

  return row === undefined ? null : toCatalogContentItem(row);
}

export async function findOrCreateContentSource(
  db: RepositoryDb,
  input: SaveContentSourceInput,
): Promise<CatalogContentSource> {
  const existingPriority = await db.query.contentSource.findFirst({
    where: and(eq(schema.contentSource.contentItemId, input.contentItemId), eq(schema.contentSource.priority, input.priority)),
  });
  if (existingPriority !== undefined) {
    return toCatalogContentSource(existingPriority);
  }

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
    .onConflictDoNothing();

  const existing =
    (await findContentSourceByCanonicalUrl(db, input.sourceType, input.canonicalUrl)) ??
    (await findContentSourceByItemPriority(db, input.contentItemId, input.priority));
  if (existing === null) {
    throw new Error("Content source write did not produce a readable catalog record.");
  }
  return existing;
}

async function findContentSourceByItemPriority(
  db: RepositoryDb,
  contentItemId: string,
  priority: number,
): Promise<CatalogContentSource | null> {
  const row = await db.query.contentSource.findFirst({
    where: and(eq(schema.contentSource.contentItemId, contentItemId), eq(schema.contentSource.priority, priority)),
  });

  return row === undefined ? null : toCatalogContentSource(row);
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

export async function listCatalogCreators(
  db: RepositoryDb,
  input: ListCatalogCreatorsInput,
): Promise<readonly CatalogCreator[]> {
  const conditions = [
    input.sourceType === undefined ? undefined : eq(schema.creator.sourceType, input.sourceType),
    input.search === undefined ? undefined : containsNormalized(schema.creator.displayName, input.search),
  ].filter(isDefined);
  const rows = await db.query.creator.findMany({
    where: conditions.length === 0 ? undefined : and(...conditions),
    orderBy: (creator, { asc }) => [asc(creator.displayName), asc(creator.createdAt), asc(creator.id)],
    limit: input.limit,
    offset: input.offset ?? 0,
  });

  return rows.map(toCatalogCreator);
}

export async function listCatalogContentItems(
  db: RepositoryDb,
  input: ListCatalogContentItemsInput = { limit: 50 },
): Promise<readonly CatalogContentListItem[]> {
  const conditions = [
    input.creatorId === undefined ? undefined : eq(schema.contentItem.creatorId, input.creatorId),
    input.feedId === undefined ? undefined : eq(schema.feedContent.feedId, input.feedId),
    input.sourceType === undefined ? undefined : eq(schema.contentItem.sourceType, input.sourceType),
    input.search === undefined ? undefined : containsNormalized(schema.contentItem.title, input.search),
  ].filter(isDefined);

  const contentQuery = db
    .select({
      contentItem: schema.contentItem,
      creator: schema.creator,
      sourceCount: sql<number>`(
        select count(*)
        from ${schema.contentSource}
        where ${schema.contentSource.contentItemId} = ${schema.contentItem.id}
      )`,
    })
    .from(schema.contentItem)
    .innerJoin(schema.creator, eq(schema.contentItem.creatorId, schema.creator.id));

  const rows = await (input.feedId === undefined
    ? contentQuery
    : contentQuery.innerJoin(schema.feedContent, eq(schema.feedContent.contentItemId, schema.contentItem.id)))
    .where(conditions.length === 0 ? undefined : and(...conditions))
    .orderBy(desc(schema.contentItem.publishedAt), desc(schema.contentItem.createdAt), desc(schema.contentItem.id))
    .limit(input.limit)
    .offset(input.offset ?? 0);

  return rows.map((row) => ({
    ...toCatalogContentItem(row.contentItem),
    creator: toCatalogCreatorSummary(row.creator),
    sourceCount: row.sourceCount,
  }));
}

export async function listCatalogFeeds(db: RepositoryDb): Promise<readonly CatalogFeed[]> {
  const rows = await db.query.feed.findMany({
    orderBy: (feed, { asc }) => [asc(feed.createdAt)],
  });

  return rows.map(toCatalogFeed);
}

export async function listCatalogFeedsForBrowsing(
  db: RepositoryDb,
  input: ListCatalogFeedsInput,
): Promise<readonly CatalogFeed[]> {
  const conditions = [
    input.creatorId === undefined ? undefined : eq(schema.feed.creatorId, input.creatorId),
    input.sourceType === undefined ? undefined : eq(schema.feed.sourceType, input.sourceType),
  ].filter(isDefined);
  const rows = await db.query.feed.findMany({
    where: conditions.length === 0 ? undefined : and(...conditions),
    orderBy: (feed, { asc }) => [asc(feed.createdAt), asc(feed.sourceType), asc(feed.sourceExternalId)],
    limit: input.limit,
    offset: input.offset ?? 0,
  });

  return rows.map(toCatalogFeed);
}

export async function getCatalogContentDetail(
  db: RepositoryDb,
  contentItemId: string,
): Promise<CatalogContentDetail | null> {
  const row = await db
    .select({
      contentItem: schema.contentItem,
      creator: schema.creator,
    })
    .from(schema.contentItem)
    .innerJoin(schema.creator, eq(schema.contentItem.creatorId, schema.creator.id))
    .where(eq(schema.contentItem.id, contentItemId))
    .limit(1);
  const firstRow = row.at(0);
  if (firstRow === undefined) {
    return null;
  }

  const sourceRows = await db.query.contentSource.findMany({
    where: eq(schema.contentSource.contentItemId, contentItemId),
    orderBy: (contentSource, { asc }) => [asc(contentSource.priority), asc(contentSource.createdAt)],
  });
  const feedRows = await db
    .select({ feed: schema.feed })
    .from(schema.feedContent)
    .innerJoin(schema.feed, eq(schema.feedContent.feedId, schema.feed.id))
    .where(eq(schema.feedContent.contentItemId, contentItemId))
    .orderBy(asc(schema.feed.createdAt));

  return {
    ...toCatalogContentItem(firstRow.contentItem),
    creator: toCatalogCreatorSummary(firstRow.creator),
    sources: sourceRows.map(toCatalogContentSource),
    feeds: feedRows.map((feedRow) => toCatalogFeed(feedRow.feed)),
  };
}

export async function listCatalogFeedsForCreator(db: RepositoryDb, creatorId: string): Promise<readonly CatalogFeed[]> {
  const rows = await db.query.feed.findMany({
    where: eq(schema.feed.creatorId, creatorId),
    orderBy: (feed, { asc }) => [asc(feed.createdAt)],
  });

  return rows.map(toCatalogFeed);
}

export async function listCatalogFeedById(db: RepositoryDb, feedId: string): Promise<readonly CatalogFeed[]> {
  const feed = await getCatalogFeedById(db, feedId);

  return feed === null ? [] : [feed];
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
    feedsSkippedCount: input.feedsSkippedCount ?? 0,
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

export async function listRefreshRuns(db: RepositoryDb, input: ListRefreshRunsInput): Promise<readonly RefreshRun[]> {
  const rows = await db.query.refreshRun.findMany({
    orderBy: (refreshRun, { desc }) => [desc(refreshRun.startedAt)],
    limit: input.limit,
  });

  return rows.map(toRefreshRun);
}

export async function listRunningRefreshRuns(db: RepositoryDb, input: ListRunningRefreshRunsInput): Promise<readonly RefreshRun[]> {
  const rows = await db.query.refreshRun.findMany({
    where: eq(schema.refreshRun.status, "running"),
    orderBy: (refreshRun, { asc }) => [asc(refreshRun.startedAt)],
    limit: input.limit,
  });

  return rows.map(toRefreshRun);
}

export async function getRefreshRunById(db: RepositoryDb, refreshRunId: string): Promise<RefreshRun | null> {
  const row = await db.query.refreshRun.findFirst({ where: eq(schema.refreshRun.id, refreshRunId) });
  return row === undefined ? null : toRefreshRun(row);
}

export async function updateRefreshRunProgress(db: RepositoryDb, input: UpdateRefreshRunProgressInput): Promise<RefreshRun> {
  await db
    .update(schema.refreshRun)
    .set({
      feedsSucceededCount: input.feedsSucceededCount,
      feedsFailedCount: input.feedsFailedCount,
      itemsDiscoveredCount: input.itemsDiscoveredCount,
      itemsCreatedCount: input.itemsCreatedCount,
      itemsUpdatedCount: input.itemsUpdatedCount ?? 0,
      errorSummaryJson: input.errorSummaryJson ?? null,
    })
    .where(eq(schema.refreshRun.id, input.id));

  const row = await db.query.refreshRun.findFirst({ where: eq(schema.refreshRun.id, input.id) });
  if (row === undefined) {
    throw new Error("Refresh run progress update did not produce a readable catalog record.");
  }
  return toRefreshRun(row);
}

export async function completeRefreshRun(db: RepositoryDb, input: CompleteRefreshRunInput): Promise<RefreshRun> {
  await db
    .update(schema.refreshRun)
    .set({
      status: input.status,
      feedsRequestedCount: input.feedsRequestedCount,
      feedsSkippedCount: input.feedsSkippedCount,
      feedsSucceededCount: input.feedsSucceededCount,
      feedsFailedCount: input.feedsFailedCount,
      itemsDiscoveredCount: input.itemsDiscoveredCount,
      itemsCreatedCount: input.itemsCreatedCount,
      itemsUpdatedCount: input.itemsUpdatedCount ?? 0,
      completedAt: input.completedAt,
      errorSummaryJson: input.errorSummaryJson ?? null,
    })
    .where(eq(schema.refreshRun.id, input.id));

  const row = await db.query.refreshRun.findFirst({ where: eq(schema.refreshRun.id, input.id) });
  if (row === undefined) {
    throw new Error("Refresh run completion did not produce a readable catalog record.");
  }
  return toRefreshRun(row);
}

export async function updateFeedRefreshMetadata(
  db: RepositoryDb,
  input: UpdateFeedRefreshMetadataInput,
): Promise<CatalogFeed> {
  await db
    .update(schema.feed)
    .set({
      lastNormalRefreshAt: input.refreshedAt,
      nextRefreshAfter: input.nextRefreshAfter,
    })
    .where(eq(schema.feed.id, input.feedId));

  const row = await db.query.feed.findFirst({ where: eq(schema.feed.id, input.feedId) });
  if (row === undefined) {
    throw new Error("Feed refresh metadata update did not produce a readable catalog record.");
  }
  return toCatalogFeed(row);
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
  input: ListRefreshFeedResultsForRunInput,
): Promise<readonly RefreshFeedResult[]> {
  const rows = await db.query.refreshFeedResult.findMany({
    where: eq(schema.refreshFeedResult.refreshRunId, input.refreshRunId),
    orderBy: (refreshFeedResult, { asc }) => [asc(refreshFeedResult.startedAt)],
    limit: input.limit,
  });

  return rows.map(toRefreshFeedResult);
}

export async function listRefreshFeedResultsWithFeedsForRun(
  db: RepositoryDb,
  input: ListRefreshFeedResultsForRunInput,
): Promise<readonly RefreshFeedResultWithFeed[]> {
  const rows = await db.query.refreshFeedResult.findMany({
    where: eq(schema.refreshFeedResult.refreshRunId, input.refreshRunId),
    orderBy: (refreshFeedResult, { asc }) => [asc(refreshFeedResult.startedAt)],
    limit: input.limit,
    with: {
      feed: true,
    },
  });

  return rows.map((row) => ({
    ...toRefreshFeedResult(row),
    feed: toCatalogFeed(row.feed),
  }));
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

function toCatalogCreatorSummary(row: typeof schema.creator.$inferSelect): CatalogCreatorSummary {
  return {
    id: row.id,
    sourceType: row.sourceType,
    sourceExternalId: row.sourceExternalId,
    displayName: row.displayName,
    imageUrl: row.imageUrl,
    canonicalUrl: row.canonicalUrl,
  };
}

function containsNormalized(column: typeof schema.creator.displayName | typeof schema.contentItem.title, value: string) {
  return sql`instr(lower(${column}), lower(${value})) > 0`;
}

function isDefined<T>(value: T | undefined): value is T {
  return value !== undefined;
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
    lastNormalRefreshAt: row.lastNormalRefreshAt,
    nextRefreshAfter: row.nextRefreshAfter,
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
    feedsSkippedCount: row.feedsSkippedCount,
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
