import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import * as schema from "@FeedElity/db/schema";

import { findContentItemBySourceIdentity, findCreatorByNameKey } from "../repositories/catalog";
import type { RepositoryDb } from "../repositories/catalog";
import {
  addCollectionMember,
  addPlaylistItem,
  findOrCreateContentStatus,
  findOrCreateSubscription,
  saveUserSetting,
} from "../repositories/overlays";
import { USER_DATA_FINGERPRINT_SETTING_KEY, userDataExportSchema } from "./user-data-schema";
import type {
  UserDataExport,
  UserDataExportContentStatus,
  UserDataExportData,
} from "./user-data-schema";

export interface UserDataImportCounts {
  readonly subscriptions: number;
  readonly contentStatuses: number;
  readonly playlists: number;
  readonly playlistItems: number;
  readonly collections: number;
  readonly collectionMembers: number;
  readonly settings: number;
}

/**
 * Mutable working copy of the report counters; the finished object is exposed
 * through the readonly UserDataImportCounts report shape.
 */
interface MutableUserDataImportCounts {
  subscriptions: number;
  contentStatuses: number;
  playlists: number;
  playlistItems: number;
  collections: number;
  collectionMembers: number;
  settings: number;
}

export interface UserDataReportedRecord {
  readonly entityType: string;
  readonly entityKey: string;
  readonly severity: "warning" | "error";
  readonly reason: string;
}

export interface UserDataImportReport {
  readonly counts: UserDataImportCounts;
  readonly warnings: readonly UserDataReportedRecord[];
  readonly failures: readonly UserDataReportedRecord[];
}

export interface UserDataImportResult {
  readonly skipped: boolean;
  readonly report: UserDataImportReport;
}

export interface ImportUserDataInput {
  readonly userId: string;
  readonly exportData: unknown;
}

/**
 * Imports a portable user-data envelope into the authenticated user's overlays
 * (qol plan F4, phase 9.1). Every write is scoped by the caller-supplied
 * userId and idempotent: subscriptions/statuses/settings go through the
 * find-or-create/upsert repository helpers, playlists and collections use
 * deterministic ids derived from the requesting user plus the payload's
 * natural key with onConflictDoNothing. Records whose content identity is not
 * in the catalog are skipped with a warning, never a failure; only payloads
 * rejected by the schema produce failures, and those reject before any write.
 */
export async function importUserDataForUser(db: RepositoryDb, input: ImportUserDataInput): Promise<UserDataImportResult> {
  const parsedExport = userDataExportSchema.safeParse(input.exportData);
  if (!parsedExport.success) {
    return {
      skipped: false,
      report: {
        counts: zeroCounts(),
        warnings: [],
        failures: parsedExport.error.issues.map(toValidationFailure),
      },
    };
  }

  const fingerprint = fingerprintUserData(parsedExport.data);
  const storedFingerprint = await readStoredFingerprint(db, input.userId);
  if (storedFingerprint === fingerprint) {
    return { skipped: true, report: { counts: zeroCounts(), warnings: [], failures: [] } };
  }

  const data = parsedExport.data.data;
  const creatorIdsByNameKey = await resolveCreatorsByNameKeys(db, collectCreatorNameKeys(data));
  const contentItemIdsByIdentity = await resolveContentItemsByIdentities(db, collectContentIdentities(data));

  const warnings: UserDataReportedRecord[] = [];
  const counts: MutableUserDataImportCounts = zeroCounts();

  for (const entry of data.subscriptions) {
    const creatorId = creatorIdsByNameKey.get(entry.creator.nameKey);
    if (creatorId === undefined) {
      warnings.push({
        entityType: "subscription",
        entityKey: entry.creator.nameKey,
        severity: "warning",
        reason: "Subscription references a creator that is not in the catalog.",
      });
      continue;
    }

    await findOrCreateSubscription(db, {
      userId: input.userId,
      creatorId,
      titleOverride: entry.titleOverride,
      settingsJson: entry.settingsJson,
    });
    counts.subscriptions += 1;
  }

  for (const entry of data.contentStatuses) {
    const contentItemId = contentItemIdsByIdentity.get(contentIdentityKey(entry.content));
    if (contentItemId === undefined) {
      warnings.push(unresolvedContentRecord("content-status", entry.content));
      continue;
    }

    const statusRow = await findOrCreateContentStatus(db, {
      userId: input.userId,
      contentItemId,
      status: entry.status,
      metadataJson: entry.metadataJson,
    });
    await restoreContentStatusTimestamps(db, input.userId, statusRow.id, entry);
    counts.contentStatuses += 1;
  }

  await importPlaylists(db, input.userId, data, contentItemIdsByIdentity, counts, warnings);
  await importCollections(db, input.userId, data, creatorIdsByNameKey, counts, warnings);

  for (const entry of data.settings) {
    await saveUserSetting(db, {
      userId: input.userId,
      key: entry.key,
      valueJson: entry.valueJson,
    });
    counts.settings += 1;
  }

  // Stored last so the fingerprint always reflects this payload, even when the
  // file itself carried a stale fingerprint setting from another device.
  await saveUserSetting(db, {
    userId: input.userId,
    key: USER_DATA_FINGERPRINT_SETTING_KEY,
    valueJson: JSON.stringify(fingerprint),
  });

  return { skipped: false, report: { counts, warnings, failures: [] } };
}

async function importPlaylists(
  db: RepositoryDb,
  userId: string,
  data: UserDataExportData,
  contentItemIdsByIdentity: ReadonlyMap<string, string>,
  counts: MutableUserDataImportCounts,
  warnings: UserDataReportedRecord[],
): Promise<void> {
  const occurrenceByName = new Map<string, number>();
  for (const entry of data.playlists) {
    const occurrence = occurrenceByName.get(entry.name) ?? 0;
    occurrenceByName.set(entry.name, occurrence + 1);
    const playlistId = buildDeterministicRowId("playlist", `${userId}:${entry.name}:${occurrence}`);

    await db
      .insert(schema.playlist)
      .values({
        id: playlistId,
        userId,
        name: entry.name,
        description: entry.description,
        sortMode: entry.sortMode,
        position: entry.position,
      })
      .onConflictDoNothing({ target: schema.playlist.id });

    const playlistRow = await db.query.playlist.findFirst({ where: eq(schema.playlist.id, playlistId) });
    if (playlistRow === undefined) {
      throw new Error("User data playlist write did not produce a readable user overlay record.");
    }
    if (playlistRow.userId !== userId) {
      throw new Error("User data playlist retry resolved to a playlist owned by a different user.");
    }
    counts.playlists += 1;

    for (const item of entry.items) {
      const contentItemId = contentItemIdsByIdentity.get(contentIdentityKey(item.content));
      if (contentItemId === undefined) {
        warnings.push({
          entityType: "playlist-item",
          entityKey: `${entry.name}:${item.content.sourceType}:${item.content.sourceExternalId}`,
          severity: "warning",
          reason: "Playlist item references content that is not in the catalog.",
        });
        continue;
      }

      const playlistItem = await addPlaylistItem(db, {
        userId,
        playlistId,
        contentItemId,
        position: item.position,
        addedAt: new Date(item.addedAt),
      });
      if (playlistItem === null) {
        warnings.push({
          entityType: "playlist-item",
          entityKey: `${entry.name}:${item.content.sourceType}:${item.content.sourceExternalId}`,
          severity: "warning",
          reason: "Playlist item position is already occupied.",
        });
        continue;
      }
      counts.playlistItems += 1;
    }
  }
}

async function importCollections(
  db: RepositoryDb,
  userId: string,
  data: UserDataExportData,
  creatorIdsByNameKey: ReadonlyMap<string, string>,
  counts: MutableUserDataImportCounts,
  warnings: UserDataReportedRecord[],
): Promise<void> {
  const occurrenceByName = new Map<string, number>();
  for (const entry of data.collections) {
    const occurrence = occurrenceByName.get(entry.name) ?? 0;
    occurrenceByName.set(entry.name, occurrence + 1);
    const collectionId = buildDeterministicRowId("collection", `${userId}:${entry.name}:${occurrence}`);

    await db
      .insert(schema.creatorCollection)
      .values({
        id: collectionId,
        userId,
        name: entry.name,
        description: entry.description,
        position: entry.position,
      })
      .onConflictDoNothing({ target: schema.creatorCollection.id });

    const collectionRow = await db.query.creatorCollection.findFirst({
      where: eq(schema.creatorCollection.id, collectionId),
    });
    if (collectionRow === undefined) {
      throw new Error("User data collection write did not produce a readable user overlay record.");
    }
    if (collectionRow.userId !== userId) {
      throw new Error("User data collection retry resolved to a collection owned by a different user.");
    }
    counts.collections += 1;

    for (const member of entry.members) {
      const creatorId = creatorIdsByNameKey.get(member.creator.nameKey);
      if (creatorId === undefined) {
        warnings.push({
          entityType: "collection-member",
          entityKey: `${entry.name}:${member.creator.nameKey}`,
          severity: "warning",
          reason: "Collection member references a creator that is not in the catalog.",
        });
        continue;
      }

      await addCollectionMember(db, {
        userId,
        collectionId,
        creatorId,
      });
      counts.collectionMembers += 1;
    }
  }
}

/**
 * Re-applies the exported created/updated timestamps to an imported content
 * status row. findOrCreateContentStatus stamps fresh defaults, but timestamps
 * are part of the portable payload (history ordering), so they are restored on
 * the just-written row, scoped by owner. Re-imports write the same values and
 * stay idempotent.
 */
async function restoreContentStatusTimestamps(
  db: RepositoryDb,
  userId: string,
  statusRowId: string,
  entry: UserDataExportContentStatus,
): Promise<void> {
  await db
    .update(schema.contentStatus)
    .set({ createdAt: new Date(entry.createdAt), updatedAt: new Date(entry.updatedAt) })
    .where(and(eq(schema.contentStatus.id, statusRowId), eq(schema.contentStatus.userId, userId)));
}

async function resolveCreatorsByNameKeys(
  db: RepositoryDb,
  nameKeys: readonly string[],
): Promise<Map<string, string>> {
  const resolved = new Map<string, string>();
  for (const nameKey of nameKeys) {
    const creator = await findCreatorByNameKey(db, nameKey);
    if (creator !== null) {
      resolved.set(nameKey, creator.id);
    }
  }
  return resolved;
}

async function resolveContentItemsByIdentities(
  db: RepositoryDb,
  identities: readonly { sourceType: "youtube" | "odysee" | "peertube"; sourceExternalId: string }[],
): Promise<Map<string, string>> {
  const resolved = new Map<string, string>();
  for (const identity of identities) {
    const contentItem = await findContentItemBySourceIdentity(db, identity);
    if (contentItem !== null) {
      resolved.set(contentIdentityKey(identity), contentItem.id);
    }
  }
  return resolved;
}

function collectCreatorNameKeys(data: UserDataExportData): string[] {
  const nameKeys = new Set<string>();
  for (const entry of data.subscriptions) {
    nameKeys.add(entry.creator.nameKey);
  }
  for (const entry of data.collections) {
    for (const member of entry.members) {
      nameKeys.add(member.creator.nameKey);
    }
  }
  return [...nameKeys];
}

function collectContentIdentities(
  data: UserDataExportData,
): { sourceType: "youtube" | "odysee" | "peertube"; sourceExternalId: string }[] {
  const identities = new Map<string, { sourceType: "youtube" | "odysee" | "peertube"; sourceExternalId: string }>();
  for (const entry of data.contentStatuses) {
    identities.set(contentIdentityKey(entry.content), entry.content);
  }
  for (const playlist of data.playlists) {
    for (const item of playlist.items) {
      identities.set(contentIdentityKey(item.content), item.content);
    }
  }
  return [...identities.values()];
}

function contentIdentityKey(identity: { sourceType: string; sourceExternalId: string }): string {
  return `${identity.sourceType}:${identity.sourceExternalId}`;
}

function unresolvedContentRecord(
  entityType: string,
  content: { sourceType: string; sourceExternalId: string },
): UserDataReportedRecord {
  return {
    entityType,
    entityKey: contentIdentityKey(content),
    severity: "warning",
    reason: "Content status references content that is not in the catalog.",
  };
}

/**
 * Deterministic overlay row id (pattern: createMigratedPlaylist). Stable for
 * the same user + payload across runs, so re-imported playlists and
 * collections collide on their id and onConflictDoNothing keeps the retry a
 * no-op even without the fingerprint short-circuit.
 */
function buildDeterministicRowId(kind: string, naturalKey: string): string {
  const digest = createHash("sha256")
    .update(`user-data:${kind}:${naturalKey}`)
    .digest("hex")
    .slice(0, 32);
  return `user-data-${kind}-${digest}`;
}

function fingerprintUserData(exportData: UserDataExport): string {
  return createHash("sha256").update(stableStringify(exportData)).digest("hex");
}

// Canonical JSON over sorted object keys, so a payload and its re-serialized
// forms hash identically regardless of key order (mirrors run-migration).
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }
  return `{${Object.entries(value)
    .sort()
    .map(([key, entryValue]) => `${JSON.stringify(key)}:${stableStringify(entryValue)}`)
    .join(",")}}`;
}

async function readStoredFingerprint(db: RepositoryDb, userId: string): Promise<string | null> {
  const row = await db.query.userSetting.findFirst({
    where: and(eq(schema.userSetting.userId, userId), eq(schema.userSetting.key, USER_DATA_FINGERPRINT_SETTING_KEY)),
  });
  if (row === undefined) {
    return null;
  }

  try {
    const parsed: unknown = JSON.parse(row.valueJson);
    return typeof parsed === "string" ? parsed : null;
  } catch {
    // A tampered fingerprint value degrades to "no prior import" so the next
    // import proceeds; the fingerprint is re-stored from the live payload.
    return null;
  }
}

function toValidationFailure(issue: z.ZodIssue): UserDataReportedRecord {
  return {
    entityType: "user-data-export",
    entityKey: issue.path.join(".") || "root",
    severity: "error",
    reason: issue.message,
  };
}

function zeroCounts(): MutableUserDataImportCounts {
  return {
    subscriptions: 0,
    contentStatuses: 0,
    playlists: 0,
    playlistItems: 0,
    collections: 0,
    collectionMembers: 0,
    settings: 0,
  };
}
