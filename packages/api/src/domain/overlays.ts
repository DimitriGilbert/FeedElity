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

/**
 * Per-creator unread overlay summary for one authenticated user (decision D4).
 * An item counts as unread when its effective publish time
 * (`coalesce(published_at, created_at)`) is newer than the creator's unread
 * threshold — the explicit `unread.threshold.<creatorId>` user setting when
 * present, otherwise the subscription's `created_at` — and the user has no
 * `opened`/`played` content_status row for it. `lastContentPublishedAt` is the
 * creator's denormalized latest-publish marker for badge freshness.
 */
export interface CreatorUnreadSummary {
  readonly creatorId: string;
  readonly unreadCount: number;
  readonly lastContentPublishedAt: Date | null;
}

/**
 * Playback resume position for a content item, stored under the `playback` key
 * inside `content_status.metadata_json` on the item's `opened` row (no separate
 * column — see qol-features-plan.md decision D1). `updatedAt` is a UTC ISO 8601
 * timestamp taken when the position was persisted.
 */
export interface PlaybackPositionMetadata {
  readonly positionSeconds: number;
  readonly durationSeconds: number | null;
  readonly updatedAt: string;
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

export interface CreatorCollection {
  readonly id: string;
  readonly userId: string;
  readonly name: string;
  readonly description: string | null;
  readonly position: number;
}

export interface CollectionMember {
  readonly id: string;
  readonly userId: string;
  readonly collectionId: string;
  readonly creatorId: string;
  readonly addedAt: Date;
}

export interface CollectionMemberWithCreator extends CollectionMember {
  readonly creator: CatalogCreatorSummary;
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
