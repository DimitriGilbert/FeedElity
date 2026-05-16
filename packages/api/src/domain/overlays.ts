import type { CatalogContentListItem, CatalogCreatorSummary, ContentStatusKind } from "./catalog";

export type PlaylistSortMode = "manual" | "published_at_desc" | "published_at_asc" | "added_at_desc" | "added_at_asc";

export type MigrationRunStatus = "running" | "succeeded" | "failed" | "partial";

export type MigrationSeverity = "info" | "warning" | "error";

export interface UserSubscription {
  readonly id: string;
  readonly userId: string;
  readonly creatorId: string;
  readonly titleOverride: string | null;
  readonly settingsJson: string | null;
}

export interface UserSubscriptionWithCreator extends UserSubscription {
  readonly creator: CatalogCreatorSummary;
}

export interface UserContentStatus {
  readonly id: string;
  readonly userId: string;
  readonly contentItemId: string;
  readonly status: ContentStatusKind;
  readonly metadataJson: string | null;
}

export interface UserContentStatusWithContent extends UserContentStatus {
  readonly content: CatalogContentListItem;
}

export interface Playlist {
  readonly id: string;
  readonly userId: string;
  readonly name: string;
  readonly description: string | null;
  readonly sortMode: PlaylistSortMode;
  readonly position: number;
}

export interface PlaylistItem {
  readonly id: string;
  readonly userId: string;
  readonly playlistId: string;
  readonly contentItemId: string;
  readonly position: number;
  readonly addedAt: Date;
}

export interface PlaylistItemWithContent extends PlaylistItem {
  readonly content: CatalogContentListItem;
}

export interface UserSetting {
  readonly id: string;
  readonly userId: string;
  readonly key: string;
  readonly valueJson: string;
}

export interface MigrationRun {
  readonly id: string;
  readonly sourceExportFingerprint: string;
  readonly sourceFilename: string | null;
  readonly status: MigrationRunStatus;
  readonly startedAt: Date;
  readonly completedAt: Date | null;
  readonly usersImportedCount: number;
  readonly creatorsImportedCount: number;
  readonly feedsImportedCount: number;
  readonly contentItemsImportedCount: number;
  readonly subscriptionsImportedCount: number;
  readonly playlistsImportedCount: number;
  readonly warningsJson: string | null;
  readonly failuresJson: string | null;
}

export interface MigrationMapping {
  readonly id: string;
  readonly migrationRunId: string;
  readonly oldEntityType: string;
  readonly oldEntityId: string;
  readonly newEntityType: string;
  readonly newEntityId: string;
  readonly severity: MigrationSeverity;
  readonly message: string | null;
  readonly metadataJson: string | null;
  readonly createdAt: Date;
}
