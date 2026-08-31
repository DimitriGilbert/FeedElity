import { z } from "zod";

/**
 * Portable envelope for per-user overlay export/import (qol plan F4, phase 9.1).
 * Attribution uses natural keys only — creators by `creator.name_key`, content
 * by the ingestion identity `(source_type, source_external_id)` — so an export
 * never carries user ids or internal row ids and re-imports onto any catalog
 * that contains the referenced records.
 */

/**
 * user_setting key holding the sha-256 fingerprint of the last successful
 * user-data import. It is import machinery state rather than user preference:
 * the export skips it (see user-data-export.ts) so export -> wipe -> import ->
 * export round trips stay stable, and each successful import re-stores the
 * current payload's fingerprint. The fingerprint covers only the payload's
 * `data` section (data identity, see user-data-import.ts), so re-exporting
 * unchanged data — at any `exportedAt` — re-imports as a skip.
 */
export const USER_DATA_FINGERPRINT_SETTING_KEY = "import.user-data.fingerprint";

const timestampSchema = z.string().refine((value) => !Number.isNaN(Date.parse(value)), {
  message: "Expected a parseable timestamp string.",
});

const sourceTypeSchema = z.enum(["youtube", "odysee", "peertube"]);

const contentStatusKindSchema = z.enum(["opened", "played", "favorite"]);

const playlistSortModeSchema = z.enum(["manual", "published_at_desc", "published_at_asc", "added_at_desc", "added_at_asc"]);

// Bounds mirror the equivalent router inputs: creator name keys are normalized
// display names, playlist/collection names follow playlistNameInput, positions
// follow playlistPositionInput.
const creatorNameKeySchema = z.string().trim().min(1).max(200);

const sourceExternalIdSchema = z.string().min(1).max(2_048);

const overlayNameSchema = z.string().trim().min(1).max(120);

const overlayDescriptionSchema = z.string().max(2_000).nullable();

const overlayPositionSchema = z.number().int().min(0).max(1_000_000);

/**
 * JSON passthrough bounds for columns whose TEXT storage is unbounded in the
 * DB, so any cap is conventional. They are generous enough for realistic data
 * (the only current metadataJson writer is the small phase-2 playback payload;
 * settings values are bounded to 4_096 at the write API) while keeping a
 * hostile envelope from allocating unbounded strings — and, together with the
 * export-side filtering in user-data-export.ts, they keep round trips
 * importable: every value the exporter emits fits these bounds.
 */
export const USER_DATA_METADATA_JSON_MAX_CHARS = 65_536;
export const USER_DATA_SETTINGS_JSON_MAX_CHARS = 16_384;

const metadataJsonTextSchema = z.string().max(USER_DATA_METADATA_JSON_MAX_CHARS);

const settingsJsonTextSchema = z.string().max(USER_DATA_SETTINGS_JSON_MAX_CHARS);

const settingKeySchema = z.string().trim().min(1).max(64).regex(/^[a-z][a-z0-9._-]*$/);

const contentIdentitySchema = z
  .object({
    sourceType: sourceTypeSchema,
    sourceExternalId: sourceExternalIdSchema,
  })
  .strict();

const creatorReferenceSchema = z
  .object({
    nameKey: creatorNameKeySchema,
  })
  .strict();

const subscriptionEntrySchema = z
  .object({
    creator: creatorReferenceSchema,
    titleOverride: z.string().max(200).nullable(),
    settingsJson: settingsJsonTextSchema.nullable(),
  })
  .strict();

const contentStatusEntrySchema = z
  .object({
    content: contentIdentitySchema,
    status: contentStatusKindSchema,
    metadataJson: metadataJsonTextSchema.nullable(),
    createdAt: timestampSchema,
    updatedAt: timestampSchema,
  })
  .strict();

const playlistItemEntrySchema = z
  .object({
    content: contentIdentitySchema,
    position: overlayPositionSchema,
    addedAt: timestampSchema,
  })
  .strict();

const playlistEntrySchema = z
  .object({
    name: overlayNameSchema,
    description: overlayDescriptionSchema,
    sortMode: playlistSortModeSchema,
    position: overlayPositionSchema,
    items: z.array(playlistItemEntrySchema).max(1_000),
  })
  .strict();

const collectionMemberEntrySchema = z
  .object({
    creator: creatorReferenceSchema,
  })
  .strict();

const collectionEntrySchema = z
  .object({
    name: overlayNameSchema,
    description: overlayDescriptionSchema,
    position: overlayPositionSchema,
    members: z.array(collectionMemberEntrySchema).max(500),
  })
  .strict();

const settingEntrySchema = z
  .object({
    key: settingKeySchema,
    valueJson: settingsJsonTextSchema,
  })
  .strict();

export const userDataExportSchema = z
  .object({
    format: z.literal("feedelity.user-data"),
    version: z.literal(1),
    exportedAt: timestampSchema,
    data: z
      .object({
        subscriptions: z.array(subscriptionEntrySchema).max(2_000),
        contentStatuses: z.array(contentStatusEntrySchema).max(20_000),
        playlists: z.array(playlistEntrySchema).max(200),
        collections: z.array(collectionEntrySchema).max(200),
        settings: z.array(settingEntrySchema).max(200),
      })
      .strict(),
  })
  .strict();

export type UserDataExport = z.infer<typeof userDataExportSchema>;
export type UserDataExportData = UserDataExport["data"];
export type UserDataExportSubscription = UserDataExportData["subscriptions"][number];
export type UserDataExportContentStatus = UserDataExportData["contentStatuses"][number];
export type UserDataExportPlaylist = UserDataExportData["playlists"][number];
export type UserDataExportPlaylistItem = UserDataExportPlaylist["items"][number];
export type UserDataExportCollection = UserDataExportData["collections"][number];
export type UserDataExportCollectionMember = UserDataExportCollection["members"][number];
export type UserDataExportSetting = UserDataExportData["settings"][number];
