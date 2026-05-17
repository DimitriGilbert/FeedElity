export type SourceType = "youtube" | "odysee" | "peertube";

export type ContentType = "video";

export type ContentStatusKind = "opened" | "played" | "favorite";

export type RefreshScope = "all" | "creator" | "feed";

export type RefreshStatus = "running" | "succeeded" | "failed" | "partial";

export type RefreshFeedReportStatus = RefreshStatus | "skipped";

export type RefreshFeedSkipReason = "cadence-disabled" | "not-due" | "provider-paused";

export interface SourceIdentity {
  readonly sourceType: SourceType;
  readonly sourceExternalId: string;
}

export interface CatalogCreator extends SourceIdentity {
  readonly id: string;
  readonly displayName: string;
  readonly description: string | null;
  readonly imageUrl: string | null;
  readonly canonicalUrl: string | null;
  readonly metadataJson: string | null;
}

export interface CatalogFeed extends SourceIdentity {
  readonly id: string;
  readonly creatorId: string;
  readonly url: string;
  readonly title: string | null;
  readonly description: string | null;
  readonly refreshCadenceSeconds: number | null;
  readonly lastNormalRefreshAt: Date | null;
  readonly nextRefreshAfter: Date | null;
  readonly adapterMetadataJson: string | null;
}

export interface CatalogContentItem extends SourceIdentity {
  readonly id: string;
  readonly creatorId: string;
  readonly title: string;
  readonly description: string | null;
  readonly publishedAt: Date | null;
  readonly contentType: ContentType;
  readonly durationSeconds: number | null;
  readonly thumbnailUrl: string | null;
  readonly canonicalUrl: string | null;
  readonly metadataJson: string | null;
}

export interface CatalogContentSource {
  readonly id: string;
  readonly contentItemId: string;
  readonly sourceType: SourceType;
  readonly sourceExternalId: string | null;
  readonly embedUrl: string | null;
  readonly nativeMediaUrl: string | null;
  readonly canonicalUrl: string;
  readonly priority: number;
  readonly metadataJson: string | null;
}

export interface CatalogContentListItem extends CatalogContentItem {
  readonly creator: CatalogCreatorSummary;
  readonly sourceCount: number;
}

export interface CatalogCreatorSummary {
  readonly id: string;
  readonly sourceType: SourceType;
  readonly sourceExternalId: string;
  readonly displayName: string;
  readonly imageUrl: string | null;
  readonly canonicalUrl: string | null;
}

export interface CatalogContentDetail extends CatalogContentItem {
  readonly creator: CatalogCreatorSummary;
  readonly feeds: readonly CatalogFeed[];
  readonly sources: readonly CatalogContentSource[];
}

export interface FeedContentLink {
  readonly feedId: string;
  readonly contentItemId: string;
  readonly sourceExternalId: string;
  readonly rawImportRef: string | null;
}

export interface RefreshRun {
  readonly id: string;
  readonly scope: RefreshScope;
  readonly force: boolean;
  readonly status: RefreshStatus;
  readonly requestedCreatorId: string | null;
  readonly requestedFeedId: string | null;
  readonly feedsRequestedCount: number;
  readonly feedsSkippedCount: number;
  readonly feedsSucceededCount: number;
  readonly feedsFailedCount: number;
  readonly itemsDiscoveredCount: number;
  readonly itemsCreatedCount: number;
  readonly itemsUpdatedCount: number;
  readonly startedAt: Date;
  readonly completedAt: Date | null;
  readonly errorSummaryJson: string | null;
}

export interface RefreshFeedErrorSummary {
  readonly feedId: string;
  readonly code: string;
  readonly message: string;
}

export interface RefreshFeedReport {
  readonly feedId: string;
  readonly feedTitle: string | null;
  readonly feedUrl: string;
  readonly sourceType: SourceType;
  readonly status: RefreshFeedReportStatus;
  readonly skipReason: RefreshFeedSkipReason | null;
  readonly itemsDiscoveredCount: number;
  readonly itemsCreatedCount: number;
  readonly itemsUpdatedCount: number;
  readonly error: RefreshFeedErrorSummary | null;
  readonly startedAt: Date | null;
  readonly completedAt: Date | null;
}

export interface RefreshRunReport {
  readonly runId: string;
  readonly scope: RefreshScope;
  readonly force: boolean;
  readonly status: RefreshStatus;
  readonly selectedFeedCount: number;
  readonly skippedFeedCount: number;
  readonly feedsSucceededCount: number;
  readonly feedsFailedCount: number;
  readonly itemsDiscoveredCount: number;
  readonly itemsCreatedCount: number;
  readonly itemsUpdatedCount: number;
  readonly startedAt: Date;
  readonly completedAt: Date | null;
  readonly feeds: readonly RefreshFeedReport[];
}

export interface RefreshFeedResult {
  readonly id: string;
  readonly refreshRunId: string;
  readonly feedId: string;
  readonly status: RefreshStatus;
  readonly itemsDiscoveredCount: number;
  readonly itemsCreatedCount: number;
  readonly itemsUpdatedCount: number;
  readonly startedAt: Date;
  readonly completedAt: Date | null;
  readonly errorSummaryJson: string | null;
}

export interface RefreshFeedResultWithFeed extends RefreshFeedResult {
  readonly feed: CatalogFeed;
}
