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

/**
 * Normalize a creator display name into a stable cross-source key. Two feeds
 * describe the same channel when their display names normalize to the same key:
 * case-insensitive, with a leading Odysee "@" handle prefix and any trailing
 * ":<claimId>" revision stripped, and all whitespace removed. This collapses
 * "@ScottManley", "@ScottManley:5", and "Scott Manley" onto one creator.
 */
export function creatorNameKey(displayName: string): string {
  const withoutHandle = displayName.trim().replace(/^@+/, "");
  const withoutClaimRevision = withoutHandle.includes(":")
    ? withoutHandle.slice(0, withoutHandle.indexOf(":"))
    : withoutHandle;
  return withoutClaimRevision.replace(/\s+/g, "").toLowerCase();
}

/**
 * Derive the deterministic cross-source mirror key for a content item:
 * `<creator name_key>:<title NFC-normalized, lowercased, with every character
 * that is not a Unicode letter or number stripped>`. NFC runs before the strip
 * so decomposed accents (e.g. "e" + U+0301) compose first and survive as
 * letters instead of being stripped, keeping both accent forms on one key. Two
 * items of the same creator whose titles normalize to the same value are
 * mirrors of one video across sources. Returns null when the title carries no
 * letters or numbers, so callers never persist a garbage key. Mirrored
 * (without importing this package) by packages/db/src/cross-source-key.ts for
 * the backfill migration; both implementations are pinned to the same case
 * table by parity tests.
 */
export function contentCrossSourceKey(nameKey: string, title: string): string | null {
  const normalizedTitle = title.normalize("NFC").toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
  if (normalizedTitle.length === 0) {
    return null;
  }
  return `${nameKey}:${normalizedTitle}`;
}

export interface CatalogCreator {
  readonly id: string;
  readonly nameKey: string;
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

/**
 * Slim catalog list row. Deliberately standalone and narrow: list pages render
 * only identity, ordering, and playback-summary fields, so rows stop carrying
 * the heavyweight `description` and `metadataJson` blobs. The detail endpoint
 * (`CatalogContentDetail`) keeps fetching them. Mirror counts stay catalog-
 * global data (source identity only), never user-owned overlay data.
 */
export interface CatalogContentListItem {
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
  readonly creator: CatalogCreatorSummary;
  readonly sourceCount: number;
  /**
   * Number of sibling catalog items sharing the same non-null cross-source
   * mirror key, excluding the item itself. 0 means "no mirrors" (or unknown,
   * for overlay mappers that do not compute it); never user-owned data.
   */
  readonly mirrorCount: number;
}

export interface CatalogCreatorSummary {
  readonly id: string;
  readonly displayName: string;
  readonly imageUrl: string | null;
  readonly canonicalUrl: string | null;
  readonly sourceTypes: readonly SourceType[];
}

export interface CatalogContentDetail extends CatalogContentItem {
  readonly creator: CatalogCreatorSummary;
  readonly feeds: readonly CatalogFeed[];
  readonly sources: readonly CatalogContentSource[];
  /**
   * Cross-source copies of the same video (same non-null mirror key), excluding
   * the detail item itself. Full list-item shape so clients can select a mirror
   * through their existing content-selection flow.
   */
  readonly mirrors: readonly CatalogContentListItem[];
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
