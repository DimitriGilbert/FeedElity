import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";

import * as schema from "@FeedElity/db/schema";

import {
  addPlaylistItem,
  findOrCreateContentStatus,
  findOrCreateSubscription,
  listMigrationMappingsForRun,
  recordMigrationMapping,
} from "../repositories/overlays";
import type { ContentStatusKind } from "../domain/catalog";
import type { MigrationMapping } from "../domain/overlays";
import type { RepositoryDb } from "../repositories/catalog";
import type {
  StrapiExport,
  StrapiPlaylist,
  StrapiPlaylistContent,
  StrapiSubscription,
  StrapiSubscriptionContentOption,
  StrapiSubscriptionOption,
  StrapiUser,
} from "./strapi-export";

export type OverlayImportSeverity = "info" | "warning" | "error";

export interface OverlayImportReportedRecord {
  readonly oldEntityType: string;
  readonly oldEntityId: string;
  readonly severity: OverlayImportSeverity;
  readonly reason: string;
}

export interface OverlayImportCounts {
  readonly users: number;
  readonly subscriptions: number;
  readonly contentStatuses: number;
  readonly playlists: number;
  readonly playlistItems: number;
}

export interface OverlayImportResult {
  readonly counts: OverlayImportCounts;
  readonly reportedRecords: readonly OverlayImportReportedRecord[];
}

export interface ImportStrapiOverlaysInput {
  readonly migrationRunId: string;
  readonly exportData: StrapiExport;
}

interface ImportedSubscription {
  readonly id: string;
  readonly userId: string;
}

interface ImportedPlaylist {
  readonly id: string;
  readonly userId: string;
}

/**
 * Imports Strapi users and user-owned overlays after the global catalog mapper has
 * recorded old-to-new catalog mappings for the same migration run.
 */
export async function importStrapiOverlays(
  db: RepositoryDb,
  input: ImportStrapiOverlaysInput,
): Promise<OverlayImportResult> {
  const reportedRecords: OverlayImportReportedRecord[] = [];
  const existingMappings = await listMigrationMappingsForRun(db, input.migrationRunId);
  const creatorMappings = toMappingByOldId(existingMappings, "strapi-creator", "creator");
  const contentMappings = toMappingByOldId(existingMappings, "strapi-creator-content", "content-item");
  const userMappings = toMappingByOldId(existingMappings, "strapi-user", "user");
  const playlistMappings = toMappingByOldId(existingMappings, "strapi-playlist", "playlist");
  const importedSubscriptions = new Map<number, ImportedSubscription>();
  const importedPlaylists = new Map<number, ImportedPlaylist>();
  const subscriptionOptionsBySubscriptionId = groupByOldId(input.exportData.subscriptionOptions, (option) => option.subscriptionId);

  let usersImportedCount = 0;
  let subscriptionsImportedCount = 0;
  let contentStatusesImportedCount = 0;
  let playlistsImportedCount = 0;
  let playlistItemsImportedCount = 0;

  for (const user of input.exportData.users) {
    const importedUserId = await findOrCreateMigratedUser(db, user, userMappings.get(user.oldId));
    userMappings.set(user.oldId, importedUserId);
    usersImportedCount += 1;
    await recordMigrationMapping(db, {
      migrationRunId: input.migrationRunId,
      oldEntityType: "strapi-user",
      oldEntityId: String(user.oldId),
      newEntityType: "user",
      newEntityId: importedUserId,
    });
  }

  for (const subscription of input.exportData.subscriptions) {
    const userId = userMappings.get(subscription.userId);
    const creatorId = creatorMappings.get(subscription.creatorId);
    if (userId === undefined) {
      reportedRecords.push(toReport(subscription, "strapi-subscription", "Subscription references a user that was not imported into the new auth model."));
      continue;
    }
    if (creatorId === undefined) {
      reportedRecords.push(toReport(subscription, "strapi-subscription", "Subscription references a creator that was not imported into the new catalog."));
      continue;
    }

    const importedSubscription = await findOrCreateSubscription(db, {
      userId,
      creatorId,
      settingsJson: buildSubscriptionSettingsJson(subscriptionOptionsBySubscriptionId.get(subscription.oldId) ?? []),
    });
    importedSubscriptions.set(subscription.oldId, { id: importedSubscription.id, userId });
    subscriptionsImportedCount += 1;
    await recordMigrationMapping(db, {
      migrationRunId: input.migrationRunId,
      oldEntityType: "strapi-subscription",
      oldEntityId: String(subscription.oldId),
      newEntityType: "subscription",
      newEntityId: importedSubscription.id,
    });
    for (const option of subscriptionOptionsBySubscriptionId.get(subscription.oldId) ?? []) {
      await recordMigrationMapping(db, {
        migrationRunId: input.migrationRunId,
        oldEntityType: "strapi-subscription-option",
        oldEntityId: String(option.oldId),
        newEntityType: "subscription-setting",
        newEntityId: `${importedSubscription.id}:${option.oldId}`,
      });
    }
  }

  for (const option of input.exportData.subscriptionContentOptions) {
    const importedSubscription = importedSubscriptions.get(option.subscriptionId);
    const contentItemId = contentMappings.get(option.contentId);
    if (importedSubscription === undefined) {
      reportedRecords.push(
        toReport(option, "strapi-subscription-content-option", "Subscription content option references a subscription that was not imported."),
      );
      continue;
    }
    if (contentItemId === undefined) {
      reportedRecords.push(
        toReport(option, "strapi-subscription-content-option", "Subscription content option references content that was not imported into the new catalog."),
      );
      continue;
    }
    const status = toContentStatusKind(option.interpretedStatus.statusName);
    if (!option.interpretedStatus.active) {
      reportedRecords.push(toReport(option, "strapi-subscription-content-option", "Inactive content status option did not create a user overlay.", "info"));
      continue;
    }

    const importedStatus = await findOrCreateContentStatus(db, {
      userId: importedSubscription.userId,
      contentItemId,
      status,
      metadataJson: JSON.stringify({ strapiSubscriptionOldId: option.subscriptionId, strapiOptionOldId: option.oldId }),
    });
    contentStatusesImportedCount += 1;
    await recordMigrationMapping(db, {
      migrationRunId: input.migrationRunId,
      oldEntityType: "strapi-subscription-content-option",
      oldEntityId: String(option.oldId),
      newEntityType: "content-status",
      newEntityId: importedStatus.id,
    });
  }

  for (const playlist of input.exportData.playlists) {
    const userId = userMappings.get(playlist.userId);
    if (userId === undefined) {
      reportedRecords.push(toReport(playlist, "strapi-playlist", "Playlist references a user that was not imported into the new auth model."));
      continue;
    }
    const playlistId = playlistMappings.get(playlist.oldId);
    const importedPlaylist = playlistId === undefined
      ? await createMigratedPlaylist(db, input.migrationRunId, playlist, userId)
      : { id: playlistId, userId };
    playlistMappings.set(playlist.oldId, importedPlaylist.id);
    importedPlaylists.set(playlist.oldId, importedPlaylist);
    playlistsImportedCount += 1;
    await recordMigrationMapping(db, {
      migrationRunId: input.migrationRunId,
      oldEntityType: "strapi-playlist",
      oldEntityId: String(playlist.oldId),
      newEntityType: "playlist",
      newEntityId: importedPlaylist.id,
    });
  }

  for (const playlistContent of input.exportData.playlistContents) {
    const importedPlaylist = importedPlaylists.get(playlistContent.playlistId);
    const contentItemId = contentMappings.get(playlistContent.contentId);
    if (importedPlaylist === undefined) {
      reportedRecords.push(toReport(playlistContent, "strapi-playlist-content", "Playlist content references a playlist that was not imported."));
      continue;
    }
    if (contentItemId === undefined) {
      reportedRecords.push(toReport(playlistContent, "strapi-playlist-content", "Playlist content references content that was not imported into the new catalog."));
      continue;
    }
    const existingPlaylistItemId = toMappingByOldId(await listMigrationMappingsForRun(db, input.migrationRunId), "strapi-playlist-content", "playlist-item").get(
      playlistContent.oldId,
    );
    if (existingPlaylistItemId !== undefined) {
      playlistItemsImportedCount += 1;
      continue;
    }
    const importedPlaylistItem = await addPlaylistItem(db, {
      userId: importedPlaylist.userId,
      playlistId: importedPlaylist.id,
      contentItemId,
      position: playlistContent.position,
      addedAt: playlistContent.Added === null ? undefined : new Date(playlistContent.Added),
    });
    playlistItemsImportedCount += 1;
    await recordMigrationMapping(db, {
      migrationRunId: input.migrationRunId,
      oldEntityType: "strapi-playlist-content",
      oldEntityId: String(playlistContent.oldId),
      newEntityType: "playlist-item",
      newEntityId: importedPlaylistItem.id,
    });
  }

  return {
    counts: {
      users: usersImportedCount,
      subscriptions: subscriptionsImportedCount,
      contentStatuses: contentStatusesImportedCount,
      playlists: playlistsImportedCount,
      playlistItems: playlistItemsImportedCount,
    },
    reportedRecords,
  };
}

async function findOrCreateMigratedUser(db: RepositoryDb, user: StrapiUser, mappedUserId: string | undefined): Promise<string> {
  if (mappedUserId !== undefined) {
    await db
      .update(schema.user)
      .set({
        name: user.username,
        email: user.email,
        emailVerified: user.confirmed,
        accountState: "migrated_pending_password_setup",
      })
      .where(eq(schema.user.id, mappedUserId));
    return mappedUserId;
  }

  const id = crypto.randomUUID();
  await db
    .insert(schema.user)
    .values({
      id,
      name: user.username,
      email: user.email,
      emailVerified: user.confirmed,
      accountState: "migrated_pending_password_setup",
      createdAt: user.createdAt === undefined ? undefined : new Date(user.createdAt),
      updatedAt: user.updatedAt === undefined ? undefined : new Date(user.updatedAt),
    })
    .onConflictDoUpdate({
      target: schema.user.email,
      set: {
        name: user.username,
        emailVerified: user.confirmed,
        accountState: "migrated_pending_password_setup",
      },
    });

  const row = await db.query.user.findFirst({ where: eq(schema.user.email, user.email) });
  if (row === undefined) {
    throw new Error("Migrated user write did not produce a readable auth record.");
  }
  return row.id;
}

async function createMigratedPlaylist(
  db: RepositoryDb,
  migrationRunId: string,
  playlist: StrapiPlaylist,
  userId: string,
): Promise<ImportedPlaylist> {
  const id = buildMigratedPlaylistId(migrationRunId, playlist.oldId);

  await db
    .insert(schema.playlist)
    .values({
      id,
      userId,
      name: playlist.name,
      description: playlist.description,
      sortMode: "manual",
      position: playlist.oldId,
    })
    .onConflictDoUpdate({
      target: schema.playlist.id,
      set: {
        name: playlist.name,
        description: playlist.description,
        sortMode: "manual",
        position: playlist.oldId,
      },
    });

  const importedPlaylist = await db.query.playlist.findFirst({ where: eq(schema.playlist.id, id) });
  if (importedPlaylist === undefined) {
    throw new Error("Migrated playlist write did not produce a readable user overlay record.");
  }
  if (importedPlaylist.userId !== userId) {
    throw new Error("Migrated playlist retry resolved to a playlist owned by a different user.");
  }
  return { id: importedPlaylist.id, userId };
}

function buildMigratedPlaylistId(migrationRunId: string, oldPlaylistId: number): string {
  const digest = createHash("sha256").update(`${migrationRunId}:strapi-playlist:${oldPlaylistId}`).digest("hex").slice(0, 32);
  return `migration-playlist-${digest}`;
}

function toContentStatusKind(statusName: StrapiSubscriptionContentOption["interpretedStatus"]["statusName"]): ContentStatusKind {
  if (statusName === "open") {
    return "opened";
  }
  return statusName;
}

function buildSubscriptionSettingsJson(options: readonly StrapiSubscriptionOption[]): string | null {
  if (options.length === 0) {
    return null;
  }
  return JSON.stringify(
    options.map((option) => ({
      oldId: option.oldId,
      name: option.name,
      type: option.type,
      value: option.value,
    })),
  );
}

function toMappingByOldId(
  mappings: readonly MigrationMapping[],
  oldEntityType: string,
  newEntityType: string,
): Map<number, string> {
  const result = new Map<number, string>();
  for (const mapping of mappings) {
    if (mapping.oldEntityType !== oldEntityType || mapping.newEntityType !== newEntityType) {
      continue;
    }
    const oldId = Number(mapping.oldEntityId);
    if (Number.isSafeInteger(oldId)) {
      result.set(oldId, mapping.newEntityId);
    }
  }
  return result;
}

function groupByOldId<RecordType>(
  records: readonly RecordType[],
  selectId: (record: RecordType) => number,
): Map<number, RecordType[]> {
  const grouped = new Map<number, RecordType[]>();
  for (const record of records) {
    const id = selectId(record);
    const existingRecords = grouped.get(id);
    if (existingRecords === undefined) {
      grouped.set(id, [record]);
      continue;
    }
    existingRecords.push(record);
  }
  return grouped;
}

function toReport(
  record: StrapiSubscription | StrapiSubscriptionContentOption | StrapiPlaylist | StrapiPlaylistContent,
  oldEntityType: string,
  reason: string,
  severity: OverlayImportSeverity = "error",
): OverlayImportReportedRecord {
  return {
    oldEntityType,
    oldEntityId: String(record.oldId),
    severity,
    reason,
  };
}
