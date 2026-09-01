import { and, asc, desc, eq, inArray, ne, sql } from "drizzle-orm";
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
  ContentType,
  FeedHealthEntry,
  RefreshFeedResult,
  RefreshFeedResultWithFeed,
  RefreshRun,
  RefreshScope,
  RefreshStatus,
  FeedContentLink,
  SourceType,
} from "../domain/catalog";
import { creatorNameKey } from "../domain/catalog";

export type RepositoryDb = LibSQLDatabase<typeof schema>;

export interface SaveCreatorInput {
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
  readonly crossSourceKey?: string | null;
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

export interface UpdateCreatorMetadataInput {
  readonly creatorId: string;
  readonly imageUrl?: string | null;
  readonly description?: string | null;
  readonly canonicalUrl?: string | null;
}

export interface UpdateCreatorMetadataResult {
  readonly creator: CatalogCreator;
  readonly changed: boolean;
}

export type CreatorListSort = "name" | "lastUpdate";

export interface ListCatalogCreatorsInput {
  readonly search?: string;
  readonly sourceType?: SourceType;
  readonly limit: number;
  readonly offset?: number;
  readonly sort?: CreatorListSort;
}

export interface ListCatalogContentItemsInput {
  readonly search?: string;
  readonly creatorId?: string;
  readonly feedId?: string;
  readonly collectionId?: string;
  readonly collectionUserId?: string;
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

export interface ListFeedHealthInput {
  readonly limit?: number;
}

export async function findOrCreateCreator(db: RepositoryDb, input: SaveCreatorInput): Promise<CatalogCreator> {
  const nameKey = creatorNameKey(input.displayName);
  const id = crypto.randomUUID();

  await db
    .insert(schema.creator)
    .values({
      id,
      nameKey,
      displayName: input.displayName,
      description: input.description ?? null,
      imageUrl: input.imageUrl ?? null,
      canonicalUrl: input.canonicalUrl ?? null,
      metadataJson: input.metadataJson ?? null,
    })
    .onConflictDoNothing({ target: [schema.creator.nameKey] });

  const existing = await findCreatorByNameKey(db, nameKey);
  if (existing === null) {
    throw new Error("Creator write did not produce a readable catalog record.");
  }

  if (existing.imageUrl === null && input.imageUrl !== null && input.imageUrl !== undefined) {
    await db
      .update(schema.creator)
      .set({ imageUrl: input.imageUrl })
      .where(eq(schema.creator.id, existing.id));
    return { ...existing, imageUrl: input.imageUrl };
  }

  return existing;
}

export async function findCreatorByNameKey(db: RepositoryDb, nameKey: string): Promise<CatalogCreator | null> {
  const row = await db.query.creator.findFirst({
    where: eq(schema.creator.nameKey, nameKey),
  });

  return row === undefined ? null : toCatalogCreator(row);
}

/** Natural identity pair accepted by the bulk source-identity lookup. */
export type ContentSourceIdentity = Pick<SaveContentItemInput, "sourceType" | "sourceExternalId">;

/**
 * Chunk size for the bulk IN lookups below: one query per 500 keys keeps each
 * statement's bind-parameter count far inside SQLite's variable limit while
 * turning O(rows) sequential lookups into O(rows / 500) queries.
 */
const BULK_LOOKUP_CHUNK_SIZE = 500;

/**
 * Resolve catalog creator ids for many name keys in chunked IN queries — one
 * query per BULK_LOOKUP_CHUNK_SIZE keys instead of one per key. Name keys with
 * no catalog creator are absent from the returned map; callers decide how to
 * report them.
 */
export async function listCreatorIdsByNameKeys(
  db: RepositoryDb,
  nameKeys: readonly string[],
): Promise<Map<string, string>> {
  const idByNameKey = new Map<string, string>();
  for (let start = 0; start < nameKeys.length; start += BULK_LOOKUP_CHUNK_SIZE) {
    const chunk = nameKeys.slice(start, start + BULK_LOOKUP_CHUNK_SIZE);
    const rows = await db
      .select({ id: schema.creator.id, nameKey: schema.creator.nameKey })
      .from(schema.creator)
      .where(inArray(schema.creator.nameKey, chunk));
    for (const row of rows) {
      idByNameKey.set(row.nameKey, row.id);
    }
  }
  return idByNameKey;
}

/**
 * Resolve catalog content-item rows for many (source_type, source_external_id)
 * identities in chunked queries — one per (chunk, source type) pair instead of
 * one per identity, with the external ids of each chunk grouped by source type
 * so every statement stays one parameter per identity. Rows carry their natural
 * identity so callers can key the result themselves; identities with no
 * catalog content item are absent from the result.
 */
export async function listContentItemsBySourceIdentities(
  db: RepositoryDb,
  identities: readonly ContentSourceIdentity[],
): Promise<readonly { id: string; sourceType: SourceType; sourceExternalId: string }[]> {
  const rows: { id: string; sourceType: SourceType; sourceExternalId: string }[] = [];
  for (let start = 0; start < identities.length; start += BULK_LOOKUP_CHUNK_SIZE) {
    const chunk = identities.slice(start, start + BULK_LOOKUP_CHUNK_SIZE);
    const externalIdsByType = new Map<SourceType, string[]>();
    for (const identity of chunk) {
      const externalIds = externalIdsByType.get(identity.sourceType) ?? [];
      externalIds.push(identity.sourceExternalId);
      externalIdsByType.set(identity.sourceType, externalIds);
    }
    for (const [sourceType, sourceExternalIds] of externalIdsByType) {
      const matched = await db
        .select({
          id: schema.contentItem.id,
          sourceType: schema.contentItem.sourceType,
          sourceExternalId: schema.contentItem.sourceExternalId,
        })
        .from(schema.contentItem)
        .where(
          and(eq(schema.contentItem.sourceType, sourceType), inArray(schema.contentItem.sourceExternalId, sourceExternalIds)),
        );
      rows.push(...matched);
    }
  }
  return rows;
}

/**
 * Advance the creator's denormalized latest-publish marker to the given
 * timestamp, but never backwards and never back to NULL once set. Ingestion
 * calls this with the max published_at among the creator's persisted items.
 */
export async function advanceCreatorLastContentPublishedAt(
  db: RepositoryDb,
  input: { creatorId: string; publishedAt: Date },
): Promise<void> {
  await db
    .update(schema.creator)
    .set({
      lastContentPublishedAt: sql`max(coalesce(${schema.creator.lastContentPublishedAt}, 0), ${input.publishedAt.getTime()})`,
    })
    .where(eq(schema.creator.id, input.creatorId));
}

export async function getCatalogCreatorSummaryById(
  db: RepositoryDb,
  creatorId: string,
): Promise<CatalogCreatorSummary | null> {
  const row = await db.query.creator.findFirst({
    where: eq(schema.creator.id, creatorId),
  });

  if (row === undefined) {
    return null;
  }
  return toCatalogCreatorSummary(row, await loadSourceTypesForCreator(db, creatorId));
}

/**
 * Return the distinct source types a creator publishes on, derived from its
 * feeds. A creator is cross-source, so this is the only reliable source view.
 */
export async function loadSourceTypesForCreator(
  db: RepositoryDb,
  creatorId: string,
): Promise<readonly SourceType[]> {
  const rows = await db
    .selectDistinct({ sourceType: sql<SourceType>`source_type` })
    .from(
      sql`(select source_type from feed where creator_id = ${creatorId}
           union
           select source_type from content_item where creator_id = ${creatorId})`,
    );
  return rows.map((row) => row.sourceType);
}

export async function loadSourceTypesByCreatorId(
  db: RepositoryDb,
  creatorIds: readonly string[],
): Promise<Map<string, readonly SourceType[]>> {
  const map = new Map<string, readonly SourceType[]>();
  if (creatorIds.length === 0) {
    return map;
  }
  const ids = [...new Set(creatorIds)];
  const idList = ids.map((id) => sql`${id}`).reduce((acc, chunk) => sql`${acc}, ${chunk}`);
  const rows = await db
    .selectDistinct({ creatorId: sql<string>`creator_id`, sourceType: sql<SourceType>`source_type` })
    .from(
      sql`(select creator_id, source_type from feed where creator_id in (${idList})
           union
           select creator_id, source_type from content_item where creator_id in (${idList})) as creator_sources`,
    );
  for (const row of rows) {
    const list = map.get(row.creatorId);
    if (list === undefined) {
      map.set(row.creatorId, [row.sourceType]);
    } else if (!list.includes(row.sourceType)) {
      map.set(row.creatorId, [...list, row.sourceType]);
    }
  }
  return map;
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

  // Self-heal on conflict: a feed created before a creator merge (or by a race)
  // can point at a stale creator row. Re-point it onto the creator resolved in
  // this flow so split creator rows never re-form through ingestion or refresh.
  if (existing.creatorId !== input.creatorId) {
    await db
      .update(schema.feed)
      .set({ creatorId: input.creatorId })
      .where(eq(schema.feed.id, existing.id));
    return { ...existing, creatorId: input.creatorId };
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
      crossSourceKey: input.crossSourceKey ?? null,
    })
    .onConflictDoNothing({ target: [schema.contentItem.sourceType, schema.contentItem.sourceExternalId] });

  // Read the raw row so self-heal can inspect cross_source_key, which the
  // CatalogContentItem domain shape does not carry.
  const existingRow = await db.query.contentItem.findFirst({
    where: and(
      eq(schema.contentItem.sourceType, input.sourceType),
      eq(schema.contentItem.sourceExternalId, input.sourceExternalId),
    ),
  });
  if (existingRow === undefined) {
    throw new Error("Content item write did not produce a readable catalog record.");
  }

  // Self-heal on conflict: re-point rows created before a creator merge (or by
  // a race) onto the resolved creator, backfill a missing thumbnail, and
  // backfill the cross-source mirror key for rows created before keys existed.
  // All repairs fold into one UPDATE so repeated ingestion of the same video
  // stays a no-op apart from these backfills.
  const updates: Partial<
    Pick<typeof schema.contentItem.$inferInsert, "creatorId" | "thumbnailUrl" | "crossSourceKey">
  > = {};
  if (existingRow.creatorId !== input.creatorId) {
    updates.creatorId = input.creatorId;
  }
  if (existingRow.thumbnailUrl === null && input.thumbnailUrl !== null && input.thumbnailUrl !== undefined) {
    updates.thumbnailUrl = input.thumbnailUrl;
  }
  if (existingRow.crossSourceKey === null && input.crossSourceKey !== null && input.crossSourceKey !== undefined) {
    updates.crossSourceKey = input.crossSourceKey;
  }

  if (Object.keys(updates).length === 0) {
    return toCatalogContentItem(existingRow);
  }

  await db.update(schema.contentItem).set(updates).where(eq(schema.contentItem.id, existingRow.id));

  return toCatalogContentItem({
    ...existingRow,
    creatorId: updates.creatorId ?? existingRow.creatorId,
    thumbnailUrl: updates.thumbnailUrl ?? existingRow.thumbnailUrl,
    crossSourceKey: updates.crossSourceKey ?? existingRow.crossSourceKey,
  });
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
): Promise<readonly CatalogCreatorSummary[]> {
  // Creators are cross-source, so the optional source-type filter selects
  // creators that publish on that source via their feeds.
  const conditions = [
    input.sourceType === undefined
      ? undefined
      : inArray(schema.creator.id, db.select({ id: schema.feed.creatorId }).from(schema.feed).where(eq(schema.feed.sourceType, input.sourceType))),
    input.search === undefined ? undefined : containsNormalized(schema.creator.displayName, input.search),
  ].filter(isDefined);
  const rows = await db.query.creator.findMany({
    where: conditions.length === 0 ? undefined : and(...conditions),
    orderBy: (creator, { asc }) =>
      input.sort === "lastUpdate"
        ? [
            sql`${creator.lastContentPublishedAt} desc nulls last`,
            asc(creator.displayName),
            asc(creator.id),
          ]
        : [asc(creator.displayName), asc(creator.createdAt), asc(creator.id)],
    limit: input.limit,
    offset: input.offset ?? 0,
  });

  const sourceTypesByCreator = await loadSourceTypesByCreatorId(db, rows.map((row) => row.id));

  return rows.map((row) => toCatalogCreatorSummary(row, sourceTypesByCreator.get(row.id) ?? []));
}

export async function listCatalogContentItems(
  db: RepositoryDb,
  input: ListCatalogContentItemsInput = { limit: 50 },
): Promise<readonly CatalogContentListItem[]> {
  // A collection is a user-owned overlay, so the collection filter only applies
  // when both an owning userId and a collectionId are present. Anonymous callers
  // (no userId) ignore it and browse the public catalog unscoped.
  const collectionScoped = input.collectionId !== undefined && input.collectionUserId !== undefined;

  const conditions = [
    input.creatorId === undefined ? undefined : eq(schema.contentItem.creatorId, input.creatorId),
    input.feedId === undefined ? undefined : eq(schema.feedContent.feedId, input.feedId),
    !collectionScoped
      ? undefined
      : and(
          eq(schema.collectionMember.collectionId, input.collectionId as string),
          eq(schema.collectionMember.userId, input.collectionUserId as string),
        ),
    input.sourceType === undefined ? undefined : eq(schema.contentItem.sourceType, input.sourceType),
    input.search === undefined ? undefined : containsNormalized(schema.contentItem.title, input.search),
  ].filter(isDefined);

  const joinedQuery = selectCatalogContentListItemRows(db);
  let filteredQuery = joinedQuery;
  if (input.feedId !== undefined) {
    filteredQuery = filteredQuery.innerJoin(
      schema.feedContent,
      eq(schema.feedContent.contentItemId, schema.contentItem.id),
    );
  }
  if (collectionScoped) {
    filteredQuery = filteredQuery.innerJoin(
      schema.collectionMember,
      eq(schema.collectionMember.creatorId, schema.contentItem.creatorId),
    );
  }

  const rows = await filteredQuery
    .where(conditions.length === 0 ? undefined : and(...conditions))
    .orderBy(desc(schema.contentItem.publishedAt), desc(schema.contentItem.createdAt), desc(schema.contentItem.id))
    .limit(input.limit)
    .offset(input.offset ?? 0);

  return toCatalogContentListItems(db, rows);
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

  const mirrorKey = firstRow.contentItem.crossSourceKey;
  const mirrors = mirrorKey === null
    ? []
    : await listCatalogContentListItemsByMirrorKey(db, mirrorKey, contentItemId, firstRow.contentItem.sourceType);

  return {
    ...toCatalogContentItem(firstRow.contentItem),
    creator: toCatalogCreatorSummary(firstRow.creator, await loadSourceTypesForCreator(db, firstRow.creator.id)),
    sources: sourceRows.map(toCatalogContentSource),
    feeds: feedRows.map((feedRow) => toCatalogFeed(feedRow.feed)),
    mirrors,
  };
}

/**
 * Sibling catalog items sharing the given non-null cross-source mirror key,
 * excluding the item the viewer is looking at and any same-source duplicate
 * (a mirror is only ever on a DIFFERENT source). Mirrors are catalog-global
 * data (source identity + counts only), never user-owned overlay data.
 */
async function listCatalogContentListItemsByMirrorKey(
  db: RepositoryDb,
  crossSourceKey: string,
  excludedContentItemId: string,
  drivingSourceType: SourceType,
): Promise<readonly CatalogContentListItem[]> {
  const rows = await selectCatalogContentListItemRows(db)
    .where(
      and(
        eq(schema.contentItem.crossSourceKey, crossSourceKey),
        ne(schema.contentItem.id, excludedContentItemId),
        ne(schema.contentItem.sourceType, drivingSourceType),
      ),
    )
    .orderBy(asc(schema.contentItem.sourceType), desc(schema.contentItem.publishedAt), desc(schema.contentItem.id));

  return toCatalogContentListItems(db, rows);
}

/**
 * Slim catalog list row: the narrow content_item columns the list pages render
 * (description and metadata_json are intentionally omitted — the detail
 * endpoint fetches them), plus the creator row, source count, and cross-source
 * mirror count.
 */
interface CatalogContentListItemRow {
  readonly id: string;
  readonly creatorId: string;
  readonly sourceType: SourceType;
  readonly sourceExternalId: string;
  readonly title: string;
  readonly publishedAt: Date | null;
  readonly contentType: ContentType;
  readonly durationSeconds: number | null;
  readonly thumbnailUrl: string | null;
  readonly canonicalUrl: string | null;
  readonly creator: typeof schema.creator.$inferSelect;
  readonly sourceCount: number;
  readonly mirrorCount: number;
}

/**
 * Shared projection for catalog content list rows: the slim item columns, its
 * creator, how many playback sources the item has, and how many CROSS-SOURCE
 * mirror siblings share its non-null cross_source_key (excluding itself and
 * same-source duplicates; 0 when the key is null). The mirror count subselect
 * aliases the inner table so the qualified outer columns correlate against
 * the driving row.
 */
function selectCatalogContentListItemRows(db: RepositoryDb) {
  return db
    .select({
      id: schema.contentItem.id,
      creatorId: schema.contentItem.creatorId,
      sourceType: schema.contentItem.sourceType,
      sourceExternalId: schema.contentItem.sourceExternalId,
      title: schema.contentItem.title,
      publishedAt: schema.contentItem.publishedAt,
      contentType: schema.contentItem.contentType,
      durationSeconds: schema.contentItem.durationSeconds,
      thumbnailUrl: schema.contentItem.thumbnailUrl,
      canonicalUrl: schema.contentItem.canonicalUrl,
      creator: schema.creator,
      sourceCount: sql<number>`(
        select count(*)
        from ${schema.contentSource}
        where ${schema.contentSource.contentItemId} = ${schema.contentItem.id}
      )`,
      mirrorCount: sql<number>`(
        select count(*)
        from ${schema.contentItem} as mirror_item
        where mirror_item.cross_source_key is not null
          and mirror_item.cross_source_key = ${schema.contentItem.crossSourceKey}
          and mirror_item.id <> ${schema.contentItem.id}
          and mirror_item.source_type <> ${schema.contentItem.sourceType}
      )`,
    })
    .from(schema.contentItem)
    .innerJoin(schema.creator, eq(schema.contentItem.creatorId, schema.creator.id));
}

function toCatalogContentListItem(
  row: CatalogContentListItemRow,
  sourceTypes: readonly SourceType[],
): CatalogContentListItem {
  return {
    id: row.id,
    creatorId: row.creatorId,
    sourceType: row.sourceType,
    sourceExternalId: row.sourceExternalId,
    title: row.title,
    publishedAt: row.publishedAt,
    contentType: row.contentType,
    durationSeconds: row.durationSeconds,
    thumbnailUrl: row.thumbnailUrl,
    canonicalUrl: row.canonicalUrl,
    creator: toCatalogCreatorSummary(row.creator, sourceTypes),
    sourceCount: row.sourceCount,
    mirrorCount: row.mirrorCount,
  };
}

async function toCatalogContentListItems(
  db: RepositoryDb,
  rows: readonly CatalogContentListItemRow[],
): Promise<readonly CatalogContentListItem[]> {
  const sourceTypesByCreator = await loadSourceTypesByCreatorId(db, rows.map((row) => row.creator.id));

  return rows.map((row) => toCatalogContentListItem(row, sourceTypesByCreator.get(row.creator.id) ?? []));
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

/**
 * Overwrite creator presentation metadata with freshly fetched values. Only
 * fields the caller supplied (non-null, non-undefined) are written; unsupplied
 * fields keep their stored value and `name_key` / `display_name` are never
 * touched. Returns whether any column actually changed so callers can
 * distinguish updated from unchanged creators.
 */
export async function updateCreatorMetadata(
  db: RepositoryDb,
  input: UpdateCreatorMetadataInput,
): Promise<UpdateCreatorMetadataResult> {
  const row = await db.query.creator.findFirst({ where: eq(schema.creator.id, input.creatorId) });
  if (row === undefined) {
    throw new Error("Creator metadata update referenced an unknown creator.");
  }

  const updates: Partial<Pick<typeof schema.creator.$inferInsert, "imageUrl" | "description" | "canonicalUrl">> = {};
  if (isSuppliedValue(input.imageUrl) && input.imageUrl !== row.imageUrl) {
    updates.imageUrl = input.imageUrl;
  }
  if (isSuppliedValue(input.description) && input.description !== row.description) {
    updates.description = input.description;
  }
  if (isSuppliedValue(input.canonicalUrl) && input.canonicalUrl !== row.canonicalUrl) {
    updates.canonicalUrl = input.canonicalUrl;
  }
  if (Object.keys(updates).length === 0) {
    return { creator: toCatalogCreator(row), changed: false };
  }

  await db.update(schema.creator).set(updates).where(eq(schema.creator.id, input.creatorId));
  const updatedRow = await db.query.creator.findFirst({ where: eq(schema.creator.id, input.creatorId) });
  if (updatedRow === undefined) {
    throw new Error("Creator metadata update did not produce a readable catalog record.");
  }
  return { creator: toCatalogCreator(updatedRow), changed: true };
}

function isSuppliedValue(value: string | null | undefined): value is string {
  return value !== null && value !== undefined;
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

const feedHealthDefaultLimit = 200;
const feedHealthMaxLimit = 500;
/** Per-feed metric window: only the latest N refresh attempts feed the health metrics. */
const feedHealthWindowPerFeed = 10;

interface FeedHealthFeedRow {
  readonly feedId: string;
  readonly feedTitle: string | null;
  readonly feedUrl: string;
  readonly sourceType: SourceType;
  readonly nextRefreshAfter: Date | null;
  readonly creatorId: string;
  readonly creatorDisplayName: string;
}

interface FeedHealthResultRow {
  readonly feedId: string;
  readonly status: RefreshStatus;
  readonly itemsCreatedCount: number;
  readonly startedAt: Date;
  readonly completedAt: Date | null;
  readonly errorSummaryJson: string | null;
}

/**
 * Feed health metrics for the dashboard, over catalog-global data only (never
 * user-owned overlay rows). Every feed joined to its creator, with metrics
 * computed in the mapper from a bounded window of the latest
 * `refresh_feed_result` rows per feed (correlated subselect on started_at,
 * served by refresh_feed_result_feed_id_idx):
 *
 * - lastAttemptAt = max started_at in the window;
 * - lastSuccessAt = max completed_at among succeeded rows (null-safe: a feed
 *   with no successes stays null);
 * - consecutiveFailureCount = trailing run of failed rows, scanned newest to
 *   oldest in TS (the first non-failed row stops the count; a success inside
 *   the window therefore resets it, and the window bounds the count);
 * - lastErrorSummaryJson = the RAW error_summary_json of the newest row when
 *   that row failed, else null. It is deliberately NOT parsed server-side —
 *   the web parses it with parseRefreshErrorSummaries;
 * - itemsCreatedTotal = SUM(items_created_count) over the window.
 *
 * Ordering: by feed.url (feed.id tie-break) for determinism; the client
 * re-sorts by staleness/failures for display.
 */
export async function listFeedHealth(
  db: RepositoryDb,
  input: ListFeedHealthInput = {},
): Promise<readonly FeedHealthEntry[]> {
  // The API boundary already validates 1..500 with a 200 default; the clamp
  // keeps the repository contract safe if it is ever called directly.
  const limit = Math.min(Math.max(input.limit ?? feedHealthDefaultLimit, 1), feedHealthMaxLimit);

  const feedRows = await db
    .select({
      feedId: schema.feed.id,
      feedTitle: schema.feed.title,
      feedUrl: schema.feed.url,
      sourceType: schema.feed.sourceType,
      nextRefreshAfter: schema.feed.nextRefreshAfter,
      creatorId: schema.creator.id,
      creatorDisplayName: schema.creator.displayName,
    })
    .from(schema.feed)
    .innerJoin(schema.creator, eq(schema.feed.creatorId, schema.creator.id))
    .orderBy(asc(schema.feed.url), asc(schema.feed.id))
    .limit(limit);

  if (feedRows.length === 0) {
    return [];
  }

  const resultRows = await db
    .select({
      feedId: schema.refreshFeedResult.feedId,
      status: schema.refreshFeedResult.status,
      itemsCreatedCount: schema.refreshFeedResult.itemsCreatedCount,
      startedAt: schema.refreshFeedResult.startedAt,
      completedAt: schema.refreshFeedResult.completedAt,
      errorSummaryJson: schema.refreshFeedResult.errorSummaryJson,
    })
    .from(schema.refreshFeedResult)
    .where(
      and(
        inArray(
          schema.refreshFeedResult.feedId,
          feedRows.map((row) => row.feedId),
        ),
        // Latest N rows per feed; the inner alias makes the outer feed_id
        // reference correlate. id breaks started_at ties deterministically.
        sql`${schema.refreshFeedResult.id} in (
          select recent.id from ${schema.refreshFeedResult} as recent
          where recent.feed_id = ${schema.refreshFeedResult.feedId}
          order by recent.started_at desc, recent.id desc
          limit ${feedHealthWindowPerFeed}
        )`,
      ),
    )
    .orderBy(
      asc(schema.refreshFeedResult.feedId),
      asc(schema.refreshFeedResult.startedAt),
      asc(schema.refreshFeedResult.id),
    );

  const windowByFeed = new Map<string, FeedHealthResultRow[]>();
  for (const row of resultRows) {
    const window = windowByFeed.get(row.feedId);
    if (window === undefined) {
      windowByFeed.set(row.feedId, [row]);
    } else {
      window.push(row);
    }
  }

  return feedRows.map((feedRow) => toFeedHealthEntry(feedRow, windowByFeed.get(feedRow.feedId) ?? []));
}

/**
 * Map one feed plus its result window (ordered oldest -> newest) to the health
 * entry. All metric decisions are documented on {@link listFeedHealth}.
 */
function toFeedHealthEntry(
  feedRow: FeedHealthFeedRow,
  window: readonly FeedHealthResultRow[],
): FeedHealthEntry {
  const newest = window.at(-1) ?? null;

  let lastSuccessAt: Date | null = null;
  let itemsCreatedTotal = 0;
  for (const row of window) {
    if (row.status === "succeeded" && row.completedAt !== null && (lastSuccessAt === null || row.completedAt > lastSuccessAt)) {
      lastSuccessAt = row.completedAt;
    }
    itemsCreatedTotal += row.itemsCreatedCount;
  }

  let consecutiveFailureCount = 0;
  for (let index = window.length - 1; index >= 0; index -= 1) {
    const row = window[index];
    if (row === undefined || row.status !== "failed") {
      break;
    }
    consecutiveFailureCount += 1;
  }

  return {
    feedId: feedRow.feedId,
    feedTitle: feedRow.feedTitle,
    feedUrl: feedRow.feedUrl,
    sourceType: feedRow.sourceType,
    creatorId: feedRow.creatorId,
    creatorDisplayName: feedRow.creatorDisplayName,
    nextRefreshAfter: feedRow.nextRefreshAfter,
    lastAttemptAt: newest?.startedAt ?? null,
    lastSuccessAt,
    consecutiveFailureCount,
    lastErrorSummaryJson: newest !== null && newest.status === "failed" ? newest.errorSummaryJson : null,
    itemsCreatedTotal,
  };
}

function toCatalogCreator(row: typeof schema.creator.$inferSelect): CatalogCreator {
  return {
    id: row.id,
    nameKey: row.nameKey,
    displayName: row.displayName,
    description: row.description,
    imageUrl: row.imageUrl,
    canonicalUrl: row.canonicalUrl,
    metadataJson: row.metadataJson,
  };
}

function toCatalogCreatorSummary(
  row: typeof schema.creator.$inferSelect,
  sourceTypes: readonly SourceType[],
): CatalogCreatorSummary {
  return {
    id: row.id,
    displayName: row.displayName,
    imageUrl: row.imageUrl,
    canonicalUrl: row.canonicalUrl,
    sourceTypes,
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
