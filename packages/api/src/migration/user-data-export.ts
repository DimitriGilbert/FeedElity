import { asc, eq } from "drizzle-orm";

import * as schema from "@FeedElity/db/schema";

import { USER_DATA_METADATA_JSON_MAX_CHARS, USER_DATA_SETTINGS_JSON_MAX_CHARS, USER_DATA_FINGERPRINT_SETTING_KEY } from "./user-data-schema";
import type {
  UserDataExport,
  UserDataExportCollection,
  UserDataExportCollectionMember,
  UserDataExportContentStatus,
  UserDataExportPlaylist,
  UserDataExportPlaylistItem,
  UserDataExportSetting,
  UserDataExportSubscription,
} from "./user-data-schema";
import type { RepositoryDb } from "../repositories/catalog";

/**
 * Reads every overlay row owned by the authenticated user and assembles the
 * portable user-data envelope (qol plan F4). Auth tables are never read;
 * attribution uses natural keys recovered from catalog joins
 * (`creator.name_key`, `content_item.(source_type, source_external_id)`) and
 * no user ids or internal row ids appear in the output. Every list is ordered
 * by its natural keys so repeated exports of unchanged data produce identical
 * payloads (stable fingerprints).
 */
export async function exportUserDataForUser(db: RepositoryDb, userId: string): Promise<UserDataExport> {
  const subscriptions = await listSubscriptionEntries(db, userId);
  const contentStatuses = await listContentStatusEntries(db, userId);
  const playlists = await listPlaylistEntries(db, userId);
  const collections = await listCollectionEntries(db, userId);
  const settings = await listSettingEntries(db, userId);

  return {
    format: "feedelity.user-data",
    version: 1,
    exportedAt: new Date().toISOString(),
    data: {
      subscriptions,
      contentStatuses,
      playlists,
      collections,
      settings,
    },
  };
}

async function listSubscriptionEntries(db: RepositoryDb, userId: string): Promise<UserDataExportSubscription[]> {
  const rows = await db
    .select({
      nameKey: schema.creator.nameKey,
      titleOverride: schema.subscription.titleOverride,
      settingsJson: schema.subscription.settingsJson,
    })
    .from(schema.subscription)
    .innerJoin(schema.creator, eq(schema.subscription.creatorId, schema.creator.id))
    .where(eq(schema.subscription.userId, userId))
    .orderBy(asc(schema.creator.nameKey));

  return rows.map((row) => ({
    creator: { nameKey: row.nameKey },
    titleOverride: row.titleOverride,
    // settings_json is a TEXT passthrough with no DB-side cap; a value over
    // the import schema's bound would export fine but get the whole envelope
    // REJECTED on re-import, so over-cap values are dropped (null) here. The
    // result is silent at export but always importable — a dropped passthrough
    // preference beats a failed round trip.
    settingsJson: withinSettingsJsonBound(row.settingsJson) ? row.settingsJson : null,
  }));
}

async function listContentStatusEntries(db: RepositoryDb, userId: string): Promise<UserDataExportContentStatus[]> {
  const rows = await db
    .select({
      sourceType: schema.contentItem.sourceType,
      sourceExternalId: schema.contentItem.sourceExternalId,
      status: schema.contentStatus.status,
      metadataJson: schema.contentStatus.metadataJson,
      createdAt: schema.contentStatus.createdAt,
      updatedAt: schema.contentStatus.updatedAt,
    })
    .from(schema.contentStatus)
    .innerJoin(schema.contentItem, eq(schema.contentStatus.contentItemId, schema.contentItem.id))
    .where(eq(schema.contentStatus.userId, userId))
    .orderBy(
      asc(schema.contentItem.sourceType),
      asc(schema.contentItem.sourceExternalId),
      asc(schema.contentStatus.status),
    );

  return rows.map((row) => ({
    content: { sourceType: row.sourceType, sourceExternalId: row.sourceExternalId },
    status: row.status,
    // metadata_json is carried verbatim (including the phase-2 `playback`
    // resume position) so re-import restores the exact stored payload. TEXT is
    // unbounded in the DB, so a value over the import schema's bound would
    // export fine but get the whole envelope REJECTED on re-import; over-cap
    // metadata is dropped (null) instead — silent at export but importable,
    // and no realistic payload (the small playback JSON) comes near the cap.
    metadataJson: withinMetadataJsonBound(row.metadataJson) ? row.metadataJson : null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }));
}

async function listPlaylistEntries(db: RepositoryDb, userId: string): Promise<UserDataExportPlaylist[]> {
  const playlistRows = await db.query.playlist.findMany({
    where: eq(schema.playlist.userId, userId),
    orderBy: (playlist, { asc }) => [asc(playlist.position), asc(playlist.name), asc(playlist.createdAt), asc(playlist.id)],
  });

  const itemRows = await db
    .select({
      playlistId: schema.playlistItem.playlistId,
      sourceType: schema.contentItem.sourceType,
      sourceExternalId: schema.contentItem.sourceExternalId,
      position: schema.playlistItem.position,
      addedAt: schema.playlistItem.addedAt,
    })
    .from(schema.playlistItem)
    .innerJoin(schema.contentItem, eq(schema.playlistItem.contentItemId, schema.contentItem.id))
    .where(eq(schema.playlistItem.userId, userId))
    .orderBy(
      asc(schema.playlistItem.playlistId),
      asc(schema.playlistItem.position),
      asc(schema.playlistItem.addedAt),
      asc(schema.contentItem.sourceType),
      asc(schema.contentItem.sourceExternalId),
    );

  const itemsByPlaylistId = new Map<string, UserDataExportPlaylistItem[]>();
  for (const row of itemRows) {
    const items = itemsByPlaylistId.get(row.playlistId) ?? [];
    items.push({
      content: { sourceType: row.sourceType, sourceExternalId: row.sourceExternalId },
      position: row.position,
      addedAt: row.addedAt.toISOString(),
    });
    itemsByPlaylistId.set(row.playlistId, items);
  }

  return playlistRows.map((row) => ({
    name: row.name,
    description: row.description,
    sortMode: row.sortMode,
    position: row.position,
    items: itemsByPlaylistId.get(row.id) ?? [],
  }));
}

async function listCollectionEntries(db: RepositoryDb, userId: string): Promise<UserDataExportCollection[]> {
  const collectionRows = await db.query.creatorCollection.findMany({
    where: eq(schema.creatorCollection.userId, userId),
    orderBy: (collection, { asc }) => [
      asc(collection.position),
      asc(collection.name),
      asc(collection.createdAt),
      asc(collection.id),
    ],
  });

  const memberRows = await db
    .select({
      collectionId: schema.collectionMember.collectionId,
      nameKey: schema.creator.nameKey,
    })
    .from(schema.collectionMember)
    .innerJoin(schema.creator, eq(schema.collectionMember.creatorId, schema.creator.id))
    .where(eq(schema.collectionMember.userId, userId))
    .orderBy(asc(schema.collectionMember.collectionId), asc(schema.creator.nameKey));

  const membersByCollectionId = new Map<string, UserDataExportCollectionMember[]>();
  for (const row of memberRows) {
    const members = membersByCollectionId.get(row.collectionId) ?? [];
    members.push({ creator: { nameKey: row.nameKey } });
    membersByCollectionId.set(row.collectionId, members);
  }

  return collectionRows.map((row) => ({
    name: row.name,
    description: row.description,
    position: row.position,
    members: membersByCollectionId.get(row.id) ?? [],
  }));
}

async function listSettingEntries(db: RepositoryDb, userId: string): Promise<UserDataExportSetting[]> {
  const rows = await db.query.userSetting.findMany({
    where: eq(schema.userSetting.userId, userId),
    orderBy: (userSetting, { asc }) => [asc(userSetting.key)],
  });

  // The import-fingerprint key is machine state written by user-data-import;
  // skipping it keeps export -> wipe -> import -> export round trips stable
  // (each import re-stores the fingerprint of the payload it imported).
  // value_json is a TEXT passthrough with no DB-side cap; entries over the
  // import schema's bound are dropped entirely (the field is not nullable) so
  // the emitted envelope always re-imports — silent at export but importable
  // beats a rejected envelope.
  return rows
    .filter((row) => row.key !== USER_DATA_FINGERPRINT_SETTING_KEY)
    .filter((row) => withinSettingsJsonBound(row.valueJson))
    .map((row) => ({
      key: row.key,
      valueJson: row.valueJson,
    }));
}

function withinMetadataJsonBound(metadataJson: string | null): boolean {
  return metadataJson === null || metadataJson.length <= USER_DATA_METADATA_JSON_MAX_CHARS;
}

function withinSettingsJsonBound(settingsJson: string | null): boolean {
  return settingsJson === null || settingsJson.length <= USER_DATA_SETTINGS_JSON_MAX_CHARS;
}
