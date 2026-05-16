import { and, asc, desc, eq } from "drizzle-orm";

import * as schema from "@FeedElity/db/schema";

import type { ContentStatusKind } from "../domain/catalog";
import type {
  MigrationMapping,
  MigrationRun,
  MigrationRunStatus,
  MigrationSeverity,
  Playlist,
  PlaylistItem,
  PlaylistItemWithContent,
  PlaylistSortMode,
  UserContentStatus,
  UserContentStatusWithContent,
  UserSetting,
  UserSubscription,
  UserSubscriptionWithCreator,
} from "../domain/overlays";
import type { RepositoryDb } from "./catalog";

export interface SaveSubscriptionInput {
  readonly userId: string;
  readonly creatorId: string;
  readonly titleOverride?: string | null;
  readonly settingsJson?: string | null;
}

export interface SaveContentStatusInput {
  readonly userId: string;
  readonly contentItemId: string;
  readonly status: ContentStatusKind;
  readonly metadataJson?: string | null;
}

export interface CreatePlaylistInput {
  readonly userId: string;
  readonly name: string;
  readonly description?: string | null;
  readonly sortMode?: PlaylistSortMode;
  readonly position?: number;
}

export interface UpdatePlaylistInput {
  readonly userId: string;
  readonly playlistId: string;
  readonly name: string;
  readonly description?: string | null;
  readonly sortMode?: PlaylistSortMode;
  readonly position?: number;
}

export interface AddPlaylistItemInput {
  readonly userId: string;
  readonly playlistId: string;
  readonly contentItemId: string;
  readonly position: number;
  readonly addedAt?: Date;
}

export interface ReorderPlaylistItemsInput {
  readonly userId: string;
  readonly playlistId: string;
  readonly playlistItemIds: readonly string[];
}

export interface SaveUserSettingInput {
  readonly userId: string;
  readonly key: string;
  readonly valueJson: string;
}

export interface CreateMigrationRunInput {
  readonly sourceExportFingerprint: string;
  readonly sourceFilename?: string | null;
  readonly status: MigrationRunStatus;
  readonly startedAt?: Date;
  readonly completedAt?: Date | null;
  readonly usersImportedCount?: number;
  readonly creatorsImportedCount?: number;
  readonly feedsImportedCount?: number;
  readonly contentItemsImportedCount?: number;
  readonly subscriptionsImportedCount?: number;
  readonly playlistsImportedCount?: number;
  readonly warningsJson?: string | null;
  readonly failuresJson?: string | null;
}

export interface RecordMigrationMappingInput {
  readonly migrationRunId: string;
  readonly oldEntityType: string;
  readonly oldEntityId: string;
  readonly newEntityType: string;
  readonly newEntityId: string;
  readonly severity?: MigrationSeverity;
  readonly message?: string | null;
  readonly metadataJson?: string | null;
}

export async function findOrCreateSubscription(
  db: RepositoryDb,
  input: SaveSubscriptionInput,
): Promise<UserSubscription> {
  const id = crypto.randomUUID();

  await db
    .insert(schema.subscription)
    .values({
      id,
      userId: input.userId,
      creatorId: input.creatorId,
      titleOverride: input.titleOverride ?? null,
      settingsJson: input.settingsJson ?? null,
    })
    .onConflictDoNothing({ target: [schema.subscription.userId, schema.subscription.creatorId] });

  const row = await db.query.subscription.findFirst({
    where: and(eq(schema.subscription.userId, input.userId), eq(schema.subscription.creatorId, input.creatorId)),
  });

  if (row === undefined) {
    throw new Error("Subscription write did not produce a readable user overlay record.");
  }

  return toUserSubscription(row);
}

export async function listSubscriptionsForUser(db: RepositoryDb, userId: string): Promise<readonly UserSubscription[]> {
  const rows = await db.query.subscription.findMany({
    where: eq(schema.subscription.userId, userId),
    orderBy: (subscription, { asc }) => [asc(subscription.createdAt)],
  });

  return rows.map(toUserSubscription);
}

export async function listSubscriptionsWithCreatorsForUser(
  db: RepositoryDb,
  userId: string,
): Promise<readonly UserSubscriptionWithCreator[]> {
  const rows = await db
    .select({ subscription: schema.subscription, creator: schema.creator })
    .from(schema.subscription)
    .innerJoin(schema.creator, eq(schema.subscription.creatorId, schema.creator.id))
    .where(eq(schema.subscription.userId, userId))
    .orderBy(asc(schema.subscription.createdAt));

  return rows.map((row) => ({
    ...toUserSubscription(row.subscription),
    creator: toCatalogCreatorSummary(row.creator),
  }));
}

export async function getSubscriptionWithCreatorForUser(
  db: RepositoryDb,
  userId: string,
  creatorId: string,
): Promise<UserSubscriptionWithCreator | null> {
  const rows = await db
    .select({ subscription: schema.subscription, creator: schema.creator })
    .from(schema.subscription)
    .innerJoin(schema.creator, eq(schema.subscription.creatorId, schema.creator.id))
    .where(and(eq(schema.subscription.userId, userId), eq(schema.subscription.creatorId, creatorId)))
    .limit(1);
  const row = rows.at(0);

  if (row === undefined) {
    return null;
  }

  return {
    ...toUserSubscription(row.subscription),
    creator: toCatalogCreatorSummary(row.creator),
  };
}

export async function unsubscribeFromCreatorForUser(
  db: RepositoryDb,
  userId: string,
  creatorId: string,
): Promise<boolean> {
  const existing = await db.query.subscription.findFirst({
    where: and(eq(schema.subscription.userId, userId), eq(schema.subscription.creatorId, creatorId)),
  });

  if (existing === undefined) {
    return false;
  }

  await db
    .delete(schema.subscription)
    .where(and(eq(schema.subscription.userId, userId), eq(schema.subscription.creatorId, creatorId)));

  return true;
}

export async function findOrCreateContentStatus(
  db: RepositoryDb,
  input: SaveContentStatusInput,
): Promise<UserContentStatus> {
  const id = crypto.randomUUID();

  await db
    .insert(schema.contentStatus)
    .values({
      id,
      userId: input.userId,
      contentItemId: input.contentItemId,
      status: input.status,
      metadataJson: input.metadataJson ?? null,
    })
    .onConflictDoNothing({
      target: [schema.contentStatus.userId, schema.contentStatus.contentItemId, schema.contentStatus.status],
    });

  const row = await db.query.contentStatus.findFirst({
    where: and(
      eq(schema.contentStatus.userId, input.userId),
      eq(schema.contentStatus.contentItemId, input.contentItemId),
      eq(schema.contentStatus.status, input.status),
    ),
  });

  if (row === undefined) {
    throw new Error("Content status write did not produce a readable user overlay record.");
  }

  return toUserContentStatus(row);
}

export async function listContentStatusesForUser(
  db: RepositoryDb,
  userId: string,
): Promise<readonly UserContentStatus[]> {
  const rows = await db.query.contentStatus.findMany({
    where: eq(schema.contentStatus.userId, userId),
    orderBy: (contentStatus, { asc }) => [asc(contentStatus.createdAt)],
  });

  return rows.map(toUserContentStatus);
}

export async function getContentStatusForUser(
  db: RepositoryDb,
  userId: string,
  contentItemId: string,
  status: ContentStatusKind,
): Promise<UserContentStatus | null> {
  const row = await db.query.contentStatus.findFirst({
    where: and(
      eq(schema.contentStatus.userId, userId),
      eq(schema.contentStatus.contentItemId, contentItemId),
      eq(schema.contentStatus.status, status),
    ),
  });

  return row === undefined ? null : toUserContentStatus(row);
}

export async function deleteContentStatusForUser(
  db: RepositoryDb,
  userId: string,
  contentItemId: string,
  status: ContentStatusKind,
): Promise<boolean> {
  const existing = await getContentStatusForUser(db, userId, contentItemId, status);
  if (existing === null) {
    return false;
  }

  await db
    .delete(schema.contentStatus)
    .where(
      and(
        eq(schema.contentStatus.userId, userId),
        eq(schema.contentStatus.contentItemId, contentItemId),
        eq(schema.contentStatus.status, status),
      ),
    );

  return true;
}

export async function toggleFavoriteContentStatusForUser(
  db: RepositoryDb,
  userId: string,
  contentItemId: string,
): Promise<{ readonly favorited: boolean; readonly status: UserContentStatus | null }> {
  const existing = await getContentStatusForUser(db, userId, contentItemId, "favorite");
  if (existing !== null) {
    await deleteContentStatusForUser(db, userId, contentItemId, "favorite");
    return { favorited: false, status: null };
  }

  const status = await findOrCreateContentStatus(db, {
    userId,
    contentItemId,
    status: "favorite",
  });

  return { favorited: true, status };
}

export async function listContentStatusWithContentForUser(
  db: RepositoryDb,
  userId: string,
  status: ContentStatusKind,
): Promise<readonly UserContentStatusWithContent[]> {
  const rows = await db
    .select({
      contentStatus: schema.contentStatus,
      contentItem: schema.contentItem,
      creator: schema.creator,
    })
    .from(schema.contentStatus)
    .innerJoin(schema.contentItem, eq(schema.contentStatus.contentItemId, schema.contentItem.id))
    .innerJoin(schema.creator, eq(schema.contentItem.creatorId, schema.creator.id))
    .where(and(eq(schema.contentStatus.userId, userId), eq(schema.contentStatus.status, status)))
    .orderBy(desc(schema.contentStatus.createdAt));

  return rows.map((row) => ({
    ...toUserContentStatus(row.contentStatus),
    content: {
      ...toCatalogContentItem(row.contentItem),
      creator: toCatalogCreatorSummary(row.creator),
    },
  }));
}

export async function createPlaylist(db: RepositoryDb, input: CreatePlaylistInput): Promise<Playlist> {
  const id = crypto.randomUUID();

  await db.insert(schema.playlist).values({
    id,
    userId: input.userId,
    name: input.name,
    description: input.description ?? null,
    sortMode: input.sortMode ?? "manual",
    position: input.position ?? 0,
  });

  const row = await db.query.playlist.findFirst({ where: eq(schema.playlist.id, id) });
  if (row === undefined) {
    throw new Error("Playlist write did not produce a readable user overlay record.");
  }
  return toPlaylist(row);
}

export async function listPlaylistsForUser(db: RepositoryDb, userId: string): Promise<readonly Playlist[]> {
  const rows = await db.query.playlist.findMany({
    where: eq(schema.playlist.userId, userId),
    orderBy: (playlist, { asc }) => [asc(playlist.position), asc(playlist.createdAt)],
  });

  return rows.map(toPlaylist);
}

export async function getPlaylistForUser(db: RepositoryDb, userId: string, playlistId: string): Promise<Playlist | null> {
  const row = await db.query.playlist.findFirst({
    where: and(eq(schema.playlist.userId, userId), eq(schema.playlist.id, playlistId)),
  });

  return row === undefined ? null : toPlaylist(row);
}

export async function updatePlaylistForUser(db: RepositoryDb, input: UpdatePlaylistInput): Promise<Playlist | null> {
  const existing = await getPlaylistForUser(db, input.userId, input.playlistId);
  if (existing === null) {
    return null;
  }

  await db
    .update(schema.playlist)
    .set({
      name: input.name,
      description: input.description ?? null,
      sortMode: input.sortMode ?? existing.sortMode,
      position: input.position ?? existing.position,
    })
    .where(and(eq(schema.playlist.userId, input.userId), eq(schema.playlist.id, input.playlistId)));

  return getPlaylistForUser(db, input.userId, input.playlistId);
}

export async function deletePlaylistForUser(db: RepositoryDb, userId: string, playlistId: string): Promise<boolean> {
  const playlist = await getPlaylistForUser(db, userId, playlistId);
  if (playlist === null) {
    return false;
  }

  await db.delete(schema.playlist).where(and(eq(schema.playlist.userId, userId), eq(schema.playlist.id, playlistId)));
  return true;
}

export async function getNextPlaylistItemPositionForUserPlaylist(
  db: RepositoryDb,
  userId: string,
  playlistId: string,
): Promise<number | null> {
  const playlist = await getPlaylistForUser(db, userId, playlistId);
  if (playlist === null) {
    return null;
  }

  const rows = await db.query.playlistItem.findMany({
    where: and(eq(schema.playlistItem.userId, userId), eq(schema.playlistItem.playlistId, playlistId)),
    orderBy: (playlistItem, { desc }) => [desc(playlistItem.position)],
    limit: 1,
  });
  const lastItem = rows.at(0);

  return lastItem === undefined ? 0 : lastItem.position + 10;
}

export async function addPlaylistItem(db: RepositoryDb, input: AddPlaylistItemInput): Promise<PlaylistItem> {
  const id = crypto.randomUUID();

  await db
    .insert(schema.playlistItem)
    .values({
      id,
      userId: input.userId,
      playlistId: input.playlistId,
      contentItemId: input.contentItemId,
      position: input.position,
      addedAt: input.addedAt ?? new Date(),
    })
    .onConflictDoNothing({ target: [schema.playlistItem.playlistId, schema.playlistItem.contentItemId] });

  const row = await db.query.playlistItem.findFirst({
    where: and(
      eq(schema.playlistItem.userId, input.userId),
      eq(schema.playlistItem.playlistId, input.playlistId),
      eq(schema.playlistItem.contentItemId, input.contentItemId),
    ),
  });
  if (row === undefined) {
    throw new Error("Playlist item write did not produce a readable user overlay record.");
  }
  return toPlaylistItem(row);
}

export async function listPlaylistItemsForUserPlaylist(
  db: RepositoryDb,
  userId: string,
  playlistId: string,
): Promise<readonly PlaylistItem[]> {
  const rows = await db.query.playlistItem.findMany({
    where: and(eq(schema.playlistItem.userId, userId), eq(schema.playlistItem.playlistId, playlistId)),
    orderBy: (playlistItem, { asc }) => [asc(playlistItem.position), asc(playlistItem.addedAt)],
  });

  return rows.map(toPlaylistItem);
}

export async function listPlaylistItemsWithContentForUserPlaylist(
  db: RepositoryDb,
  userId: string,
  playlistId: string,
): Promise<readonly PlaylistItemWithContent[]> {
  const rows = await db
    .select({
      playlistItem: schema.playlistItem,
      contentItem: schema.contentItem,
      creator: schema.creator,
    })
    .from(schema.playlistItem)
    .innerJoin(schema.contentItem, eq(schema.playlistItem.contentItemId, schema.contentItem.id))
    .innerJoin(schema.creator, eq(schema.contentItem.creatorId, schema.creator.id))
    .where(and(eq(schema.playlistItem.userId, userId), eq(schema.playlistItem.playlistId, playlistId)))
    .orderBy(asc(schema.playlistItem.position), asc(schema.playlistItem.addedAt));

  return rows.map((row) => ({
    ...toPlaylistItem(row.playlistItem),
    content: {
      ...toCatalogContentItem(row.contentItem),
      creator: toCatalogCreatorSummary(row.creator),
    },
  }));
}

export async function removePlaylistItemForUser(
  db: RepositoryDb,
  userId: string,
  playlistId: string,
  playlistItemId: string,
): Promise<boolean> {
  const row = await db.query.playlistItem.findFirst({
    where: and(
      eq(schema.playlistItem.userId, userId),
      eq(schema.playlistItem.playlistId, playlistId),
      eq(schema.playlistItem.id, playlistItemId),
    ),
  });
  if (row === undefined) {
    return false;
  }

  await db
    .delete(schema.playlistItem)
    .where(
      and(
        eq(schema.playlistItem.userId, userId),
        eq(schema.playlistItem.playlistId, playlistId),
        eq(schema.playlistItem.id, playlistItemId),
      ),
    );
  return true;
}

export async function reorderPlaylistItemsForUser(
  db: RepositoryDb,
  input: ReorderPlaylistItemsInput,
): Promise<readonly PlaylistItemWithContent[] | null> {
  const playlist = await getPlaylistForUser(db, input.userId, input.playlistId);
  if (playlist === null) {
    return null;
  }

  const existingItems = await listPlaylistItemsForUserPlaylist(db, input.userId, input.playlistId);
  if (existingItems.length !== input.playlistItemIds.length) {
    return null;
  }

  const existingIds = new Set(existingItems.map((item) => item.id));
  const requestedIds = new Set(input.playlistItemIds);
  if (existingIds.size !== requestedIds.size || input.playlistItemIds.some((id) => !existingIds.has(id))) {
    return null;
  }

  for (const [index, playlistItemId] of input.playlistItemIds.entries()) {
    await db
      .update(schema.playlistItem)
      .set({ position: -1_000_000 - index })
      .where(
        and(
          eq(schema.playlistItem.userId, input.userId),
          eq(schema.playlistItem.playlistId, input.playlistId),
          eq(schema.playlistItem.id, playlistItemId),
        ),
      );
  }

  for (const [index, playlistItemId] of input.playlistItemIds.entries()) {
    await db
      .update(schema.playlistItem)
      .set({ position: index * 10 })
      .where(
        and(
          eq(schema.playlistItem.userId, input.userId),
          eq(schema.playlistItem.playlistId, input.playlistId),
          eq(schema.playlistItem.id, playlistItemId),
        ),
      );
  }

  return listPlaylistItemsWithContentForUserPlaylist(db, input.userId, input.playlistId);
}

export async function saveUserSetting(db: RepositoryDb, input: SaveUserSettingInput): Promise<UserSetting> {
  const id = crypto.randomUUID();

  await db
    .insert(schema.userSetting)
    .values({ id, userId: input.userId, key: input.key, valueJson: input.valueJson })
    .onConflictDoUpdate({
      target: [schema.userSetting.userId, schema.userSetting.key],
      set: { valueJson: input.valueJson },
    });

  const row = await db.query.userSetting.findFirst({
    where: and(eq(schema.userSetting.userId, input.userId), eq(schema.userSetting.key, input.key)),
  });
  if (row === undefined) {
    throw new Error("User setting write did not produce a readable user overlay record.");
  }
  return toUserSetting(row);
}

export async function listUserSettingsForUser(db: RepositoryDb, userId: string): Promise<readonly UserSetting[]> {
  const rows = await db.query.userSetting.findMany({
    where: eq(schema.userSetting.userId, userId),
    orderBy: (userSetting, { asc }) => [asc(userSetting.key)],
  });

  return rows.map(toUserSetting);
}

export async function deleteUserSettingForUser(db: RepositoryDb, userId: string, key: string): Promise<boolean> {
  const existing = await db.query.userSetting.findFirst({
    where: and(eq(schema.userSetting.userId, userId), eq(schema.userSetting.key, key)),
  });

  if (existing === undefined) {
    return false;
  }

  await db.delete(schema.userSetting).where(and(eq(schema.userSetting.userId, userId), eq(schema.userSetting.key, key)));

  return true;
}

export async function findOrCreateMigrationRun(
  db: RepositoryDb,
  input: CreateMigrationRunInput,
): Promise<MigrationRun> {
  const id = crypto.randomUUID();

  await db
    .insert(schema.migrationRun)
    .values({
      id,
      sourceExportFingerprint: input.sourceExportFingerprint,
      sourceFilename: input.sourceFilename ?? null,
      status: input.status,
      startedAt: input.startedAt ?? new Date(),
      completedAt: input.completedAt ?? null,
      usersImportedCount: input.usersImportedCount ?? 0,
      creatorsImportedCount: input.creatorsImportedCount ?? 0,
      feedsImportedCount: input.feedsImportedCount ?? 0,
      contentItemsImportedCount: input.contentItemsImportedCount ?? 0,
      subscriptionsImportedCount: input.subscriptionsImportedCount ?? 0,
      playlistsImportedCount: input.playlistsImportedCount ?? 0,
      warningsJson: input.warningsJson ?? null,
      failuresJson: input.failuresJson ?? null,
    })
    .onConflictDoNothing({ target: schema.migrationRun.sourceExportFingerprint });

  const row = await db.query.migrationRun.findFirst({
    where: eq(schema.migrationRun.sourceExportFingerprint, input.sourceExportFingerprint),
  });
  if (row === undefined) {
    throw new Error("Migration run write did not produce a readable user overlay record.");
  }
  return toMigrationRun(row);
}

export async function listMigrationRuns(db: RepositoryDb): Promise<readonly MigrationRun[]> {
  const rows = await db.query.migrationRun.findMany({
    orderBy: (migrationRun, { desc }) => [desc(migrationRun.startedAt)],
  });

  return rows.map(toMigrationRun);
}

export async function recordMigrationMapping(
  db: RepositoryDb,
  input: RecordMigrationMappingInput,
): Promise<MigrationMapping> {
  const id = crypto.randomUUID();

  await db
    .insert(schema.migrationMapping)
    .values({
      id,
      migrationRunId: input.migrationRunId,
      oldEntityType: input.oldEntityType,
      oldEntityId: input.oldEntityId,
      newEntityType: input.newEntityType,
      newEntityId: input.newEntityId,
      severity: input.severity ?? "info",
      message: input.message ?? null,
      metadataJson: input.metadataJson ?? null,
    })
    .onConflictDoNothing({
      target: [
        schema.migrationMapping.migrationRunId,
        schema.migrationMapping.oldEntityType,
        schema.migrationMapping.oldEntityId,
      ],
    });

  const row = await db.query.migrationMapping.findFirst({
    where: and(
      eq(schema.migrationMapping.migrationRunId, input.migrationRunId),
      eq(schema.migrationMapping.oldEntityType, input.oldEntityType),
      eq(schema.migrationMapping.oldEntityId, input.oldEntityId),
    ),
  });
  if (row === undefined) {
    throw new Error("Migration mapping write did not produce a readable user overlay record.");
  }
  return toMigrationMapping(row);
}

export async function listMigrationMappingsForRun(
  db: RepositoryDb,
  migrationRunId: string,
): Promise<readonly MigrationMapping[]> {
  const rows = await db.query.migrationMapping.findMany({
    where: eq(schema.migrationMapping.migrationRunId, migrationRunId),
    orderBy: (migrationMapping, { asc }) => [asc(migrationMapping.createdAt)],
  });

  return rows.map(toMigrationMapping);
}

function toUserSubscription(row: typeof schema.subscription.$inferSelect): UserSubscription {
  return {
    id: row.id,
    userId: row.userId,
    creatorId: row.creatorId,
    titleOverride: row.titleOverride,
    settingsJson: row.settingsJson,
  };
}

function toCatalogCreatorSummary(row: typeof schema.creator.$inferSelect): UserSubscriptionWithCreator["creator"] {
  return {
    id: row.id,
    sourceType: row.sourceType,
    sourceExternalId: row.sourceExternalId,
    displayName: row.displayName,
    imageUrl: row.imageUrl,
    canonicalUrl: row.canonicalUrl,
  };
}

function toUserContentStatus(row: typeof schema.contentStatus.$inferSelect): UserContentStatus {
  return {
    id: row.id,
    userId: row.userId,
    contentItemId: row.contentItemId,
    status: row.status,
    metadataJson: row.metadataJson,
  };
}

function toCatalogContentItem(
  row: typeof schema.contentItem.$inferSelect,
): Omit<UserContentStatusWithContent["content"], "creator"> {
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

function toPlaylist(row: typeof schema.playlist.$inferSelect): Playlist {
  return {
    id: row.id,
    userId: row.userId,
    name: row.name,
    description: row.description,
    sortMode: row.sortMode,
    position: row.position,
  };
}

function toPlaylistItem(row: typeof schema.playlistItem.$inferSelect): PlaylistItem {
  return {
    id: row.id,
    userId: row.userId,
    playlistId: row.playlistId,
    contentItemId: row.contentItemId,
    position: row.position,
    addedAt: row.addedAt,
  };
}

function toUserSetting(row: typeof schema.userSetting.$inferSelect): UserSetting {
  return {
    id: row.id,
    userId: row.userId,
    key: row.key,
    valueJson: row.valueJson,
  };
}

function toMigrationRun(row: typeof schema.migrationRun.$inferSelect): MigrationRun {
  return {
    id: row.id,
    sourceExportFingerprint: row.sourceExportFingerprint,
    sourceFilename: row.sourceFilename,
    status: row.status,
    startedAt: row.startedAt,
    completedAt: row.completedAt,
    usersImportedCount: row.usersImportedCount,
    creatorsImportedCount: row.creatorsImportedCount,
    feedsImportedCount: row.feedsImportedCount,
    contentItemsImportedCount: row.contentItemsImportedCount,
    subscriptionsImportedCount: row.subscriptionsImportedCount,
    playlistsImportedCount: row.playlistsImportedCount,
    warningsJson: row.warningsJson,
    failuresJson: row.failuresJson,
  };
}

function toMigrationMapping(row: typeof schema.migrationMapping.$inferSelect): MigrationMapping {
  return {
    id: row.id,
    migrationRunId: row.migrationRunId,
    oldEntityType: row.oldEntityType,
    oldEntityId: row.oldEntityId,
    newEntityType: row.newEntityType,
    newEntityId: row.newEntityId,
    severity: row.severity,
    message: row.message,
    metadataJson: row.metadataJson,
    createdAt: row.createdAt,
  };
}
