export type SourceType = "youtube" | "odysee" | "peertube";

export type ContentType = "video";

export type ContentStatusKind = "opened" | "played" | "favorite";

export type RefreshScope = "all" | "creator" | "feed";

export type RefreshStatus = "running" | "succeeded" | "failed" | "partial";

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
  readonly feedsSucceededCount: number;
  readonly feedsFailedCount: number;
  readonly itemsDiscoveredCount: number;
  readonly itemsCreatedCount: number;
  readonly itemsUpdatedCount: number;
  readonly startedAt: Date;
  readonly completedAt: Date | null;
  readonly errorSummaryJson: string | null;
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
