import {
  findOrCreateContentItem,
  findOrCreateContentSource,
  findOrCreateCreator,
  findOrCreateFeed,
  linkFeedContent,
} from "../repositories/catalog";
import { recordMigrationMapping } from "../repositories/overlays";
import type { SourceType } from "../domain/catalog";
import type { MigrationMapping } from "../domain/overlays";
import type { RepositoryDb } from "../repositories/catalog";
import type { RecordMigrationMappingInput } from "../repositories/overlays";
import type {
  StrapiContentOption,
  StrapiCreator,
  StrapiCreatorContent,
  StrapiCreatorOption,
  StrapiExport,
  StrapiFeed,
  StrapiFeedContent,
  StrapiFeedOption,
} from "./strapi-export";

export type CatalogImportSeverity = "info" | "warning" | "error";

export interface CatalogImportReportedRecord {
  readonly oldEntityType: string;
  readonly oldEntityId: string;
  readonly severity: CatalogImportSeverity;
  readonly reason: string;
}

export interface CatalogImportCounts {
  readonly creators: number;
  readonly feeds: number;
  readonly contentItems: number;
  readonly contentSources: number;
  readonly feedContentLinks: number;
}

export interface CatalogImportResult {
  readonly counts: CatalogImportCounts;
  readonly reportedRecords: readonly CatalogImportReportedRecord[];
}

interface PeerTubeSourceExternalIdParts {
  readonly host: string;
  readonly resource: string;
  readonly id: string;
}

export interface ImportStrapiCatalogInput {
  readonly migrationRunId: string;
  readonly exportData: StrapiExport;
}

interface SupportedFeed {
  readonly oldFeed: StrapiFeed;
  readonly sourceType: SourceType;
}

/**
 * Source identity and playback URLs extracted from a content_option with
 * name="source". The legacy catalog stored each content item's source identity
 * here (not only in feed_content links), so this is what lets content without a
 * feed_content link still be imported.
 */
interface SourceIdentity {
  readonly sourceType: SourceType;
  readonly sourceExternalId: string;
  readonly canonicalUrl: string;
  readonly embedUrl: string | null;
  readonly nativeMediaUrl: string | null;
}

/**
 * Resolved source identity for a content item, preferring a feed_content link's
 * external id and falling back to the content's source option.
 */
interface ResolvedContentSource {
  readonly sourceType: SourceType;
  readonly sourceExternalId: string;
  readonly canonicalUrl: string;
  readonly embedUrl: string | null;
  readonly nativeMediaUrl: string | null;
}

/**
 * Anchor identity for a creator. Feed-backed creators anchor on their feed's
 * source identity; creators without a supported feed anchor on a stable legacy
 * identity derived from their content's source type.
 */
interface CreatorAnchor {
  readonly sourceType: SourceType;
  readonly sourceExternalId: string;
}

interface ContentOptionSummary {
  readonly thumbnailUrl: string | null;
  readonly durationSeconds: number | null;
  readonly thumbnailOption: StrapiContentOption | null;
  readonly durationOption: StrapiContentOption | null;
  readonly sourceOption: StrapiContentOption | null;
  readonly reportedRecords: readonly CatalogImportReportedRecord[];
}

interface CreatorOptionSummary {
  readonly imageUrl: string | null;
  readonly imageOption: StrapiCreatorOption | null;
  readonly reportedRecords: readonly CatalogImportReportedRecord[];
}

interface FeedOptionSummary {
  readonly refreshCadenceSeconds: number | null;
  readonly refreshCadenceOption: StrapiFeedOption | null;
  readonly reportedRecords: readonly CatalogImportReportedRecord[];
}

interface ContentSourceUrls {
  readonly canonicalUrl: string;
  readonly embedUrl: string | null;
  readonly nativeMediaUrl: string | null;
}

/**
 * Imports only global catalog data from a validated Strapi export.
 *
 * User-owned overlays are intentionally ignored until the user migration phase.
 */
export async function importStrapiCatalog(
  db: RepositoryDb,
  input: ImportStrapiCatalogInput,
): Promise<CatalogImportResult> {
  const reportedRecords: CatalogImportReportedRecord[] = [];
  const supportedFeeds = new Map<number, SupportedFeed>();
  const importedCreatorIds = new Map<number, string>();
  const importedFeedIds = new Map<number, string>();
  const importedContentIds = new Map<number, string>();
  const importedFeedContentIds = new Set<number>();
  const feedContentsByContentId = groupByOldId(input.exportData.feedContents, (feedContent) => feedContent.contentId);
  const feedOptionsByFeedId = groupByOldId(input.exportData.feedOptions, (feedOption) => feedOption.feedId);
  const contentOptionsByContentId = groupByOldId(input.exportData.contentOptions, (contentOption) => contentOption.contentId);
  const creatorOptionsByCreatorId = groupByOldId(input.exportData.creatorOptions, (creatorOption) => creatorOption.creatorId);
  // The legacy catalog stored each content item's source identity in a content_option
  // with name="source". Index it by content id so content without a feed_content link
  // can still be imported, and creators without a feed can still be anchored.
  const sourceOptionByContentId = indexSourceOptionByContentId(input.exportData.contentOptions);
  const creatorContentsByCreatorId = groupByOldId(input.exportData.creatorContents, (content) => content.creatorId);

  for (const feed of input.exportData.feeds) {
    const sourceType = toSupportedSourceType(feed.type);
    if (sourceType === null) {
      reportedRecords.push({
        oldEntityType: "strapi-feed",
        oldEntityId: String(feed.oldId),
        severity: "error",
        reason: `Feed source type ${feed.type} is not supported by the new catalog.`,
      });
      continue;
    }
    supportedFeeds.set(feed.oldId, { oldFeed: feed, sourceType });
  }

  for (const creator of input.exportData.creators) {
    const anchor = resolveCreatorAnchor(creator, supportedFeeds, creatorContentsByCreatorId, sourceOptionByContentId);
    if (anchor === null) {
      reportedRecords.push({
        oldEntityType: "strapi-creator",
        oldEntityId: String(creator.oldId),
        severity: "error",
        reason: "Creator has no supported feed source and no content with a supported source to anchor a global catalog identity.",
      });
      continue;
    }

    const creatorOptionSummary = summarizeCreatorOptions(creatorOptionsByCreatorId.get(creator.oldId) ?? []);
    reportedRecords.push(...creatorOptionSummary.reportedRecords);
    const importedCreator = await findOrCreateCreator(db, {
      sourceType: anchor.sourceType,
      sourceExternalId: anchor.sourceExternalId,
      displayName: creator.name,
      description: creator.description,
      imageUrl: creatorOptionSummary.imageUrl,
      canonicalUrl: null,
      metadataJson: JSON.stringify({ strapiOldId: creator.oldId }),
    });
    importedCreatorIds.set(creator.oldId, importedCreator.id);
    await recordMigrationMappingAndReport(db, reportedRecords, {
      migrationRunId: input.migrationRunId,
      oldEntityType: "strapi-creator",
      oldEntityId: String(creator.oldId),
      newEntityType: "creator",
      newEntityId: importedCreator.id,
    });
    if (creatorOptionSummary.imageOption !== null) {
      await recordMigrationMappingAndReport(db, reportedRecords, {
        migrationRunId: input.migrationRunId,
        oldEntityType: "strapi-creator-option",
        oldEntityId: String(creatorOptionSummary.imageOption.oldId),
        newEntityType: "creator-image",
        newEntityId: importedCreator.id,
      });
    }
  }

  for (const supportedFeed of supportedFeeds.values()) {
    const creatorId = importedCreatorIds.get(supportedFeed.oldFeed.creatorId);
    if (creatorId === undefined) {
      continue;
    }
    const feedOptionSummary = summarizeFeedOptions(feedOptionsByFeedId.get(supportedFeed.oldFeed.oldId) ?? []);
    reportedRecords.push(...feedOptionSummary.reportedRecords);
    const importedFeed = await findOrCreateFeed(db, {
      creatorId,
      sourceType: supportedFeed.sourceType,
      sourceExternalId: supportedFeed.oldFeed.externalId,
      url: supportedFeed.oldFeed.url,
      title: supportedFeed.oldFeed.name,
      description: null,
      refreshCadenceSeconds: feedOptionSummary.refreshCadenceSeconds,
      adapterMetadataJson: JSON.stringify({ strapiOldId: supportedFeed.oldFeed.oldId }),
    });
    importedFeedIds.set(supportedFeed.oldFeed.oldId, importedFeed.id);
    await recordMigrationMappingAndReport(db, reportedRecords, {
      migrationRunId: input.migrationRunId,
      oldEntityType: "strapi-feed",
      oldEntityId: String(supportedFeed.oldFeed.oldId),
      newEntityType: "feed",
      newEntityId: importedFeed.id,
    });
    if (feedOptionSummary.refreshCadenceOption !== null) {
      await recordMigrationMappingAndReport(db, reportedRecords, {
        migrationRunId: input.migrationRunId,
        oldEntityType: "strapi-feed-option",
        oldEntityId: String(feedOptionSummary.refreshCadenceOption.oldId),
        newEntityType: "feed-refresh-cadence",
        newEntityId: importedFeed.id,
      });
    }
  }

  for (const content of input.exportData.creatorContents) {
    const importableLinks = (feedContentsByContentId.get(content.oldId) ?? [])
      .map((feedContent) => ({ feedContent, feed: supportedFeeds.get(feedContent.feedId) ?? null }))
      .filter(isImportableFeedContentLink);
    const primaryLink = importableLinks[0];
    const creatorId = importedCreatorIds.get(content.creatorId);
    const optionSummary = summarizeContentOptions(contentOptionsByContentId.get(content.oldId) ?? []);

    const resolvedSource = resolveContentSource(primaryLink ?? null, optionSummary.sourceOption, sourceOptionByContentId.get(content.oldId) ?? null);

    if (resolvedSource === null || creatorId === undefined) {
      reportedRecords.push({
        oldEntityType: "strapi-creator-content",
        oldEntityId: String(content.oldId),
        severity: "error",
        reason: "Content has no importable feed content link and no supported source option to anchor a global catalog identity.",
      });
      reportedRecords.push(...optionSummary.reportedRecords);
      continue;
    }

    reportedRecords.push(...optionSummary.reportedRecords);
    const importedContent = await findOrCreateContentItem(db, {
      creatorId,
      sourceType: resolvedSource.sourceType,
      sourceExternalId: resolvedSource.sourceExternalId,
      title: content.title,
      description: content.data,
      publishedAt: content.publication === null ? null : new Date(content.publication),
      durationSeconds: optionSummary.durationSeconds,
      thumbnailUrl: optionSummary.thumbnailUrl,
      canonicalUrl: resolvedSource.canonicalUrl,
      metadataJson: JSON.stringify({ strapiOldId: content.oldId, strapiType: content.type }),
    });
    importedContentIds.set(content.oldId, importedContent.id);
    await recordMigrationMappingAndReport(db, reportedRecords, {
      migrationRunId: input.migrationRunId,
      oldEntityType: "strapi-creator-content",
      oldEntityId: String(content.oldId),
      newEntityType: "content-item",
      newEntityId: importedContent.id,
    });

    const importedSource = await findOrCreateContentSource(db, {
      contentItemId: importedContent.id,
      sourceType: resolvedSource.sourceType,
      sourceExternalId: resolvedSource.sourceExternalId,
      canonicalUrl: resolvedSource.canonicalUrl,
      embedUrl: resolvedSource.embedUrl,
      nativeMediaUrl: resolvedSource.nativeMediaUrl,
      priority: 0,
      metadataJson: JSON.stringify({ strapiContentOldId: content.oldId }),
    });
    if (optionSummary.sourceOption !== null) {
      await recordMigrationMappingAndReport(db, reportedRecords, {
        migrationRunId: input.migrationRunId,
        oldEntityType: "strapi-content-option",
        oldEntityId: String(optionSummary.sourceOption.oldId),
        newEntityType: "content-source",
        newEntityId: importedSource.id,
      });
    }
    if (optionSummary.thumbnailOption !== null) {
      await recordMigrationMappingAndReport(db, reportedRecords, {
        migrationRunId: input.migrationRunId,
        oldEntityType: "strapi-content-option",
        oldEntityId: String(optionSummary.thumbnailOption.oldId),
        newEntityType: "content-item-thumbnail",
        newEntityId: importedContent.id,
      });
    }
    if (optionSummary.durationOption !== null) {
      await recordMigrationMappingAndReport(db, reportedRecords, {
        migrationRunId: input.migrationRunId,
        oldEntityType: "strapi-content-option",
        oldEntityId: String(optionSummary.durationOption.oldId),
        newEntityType: "content-item-duration",
        newEntityId: importedContent.id,
      });
    }

    for (const importableLink of importableLinks) {
      const feedId = importedFeedIds.get(importableLink.feed.oldFeed.oldId);
      if (feedId === undefined) {
        continue;
      }
      await linkFeedContent(db, {
        feedId,
        contentItemId: importedContent.id,
        sourceExternalId: importableLink.feedContent.externalId,
        rawImportRef: importableLink.feedContent.raw,
      });
      await recordMigrationMappingAndReport(db, reportedRecords, {
        migrationRunId: input.migrationRunId,
        oldEntityType: "strapi-feed-content",
        oldEntityId: String(importableLink.feedContent.oldId),
        newEntityType: "feed-content",
        newEntityId: `${feedId}:${importedContent.id}`,
      });
      importedFeedContentIds.add(importableLink.feedContent.oldId);
    }
  }

  for (const feedContent of input.exportData.feedContents) {
    if (!importedFeedContentIds.has(feedContent.oldId)) {
      reportedRecords.push(toUnmappedFeedContentReport(feedContent, feedContentSkipReason(feedContent, supportedFeeds, importedContentIds)));
    }
  }

  return {
    counts: {
      creators: importedCreatorIds.size,
      feeds: importedFeedIds.size,
      contentItems: importedContentIds.size,
      contentSources: importedContentIds.size,
      feedContentLinks: importedFeedContentIds.size,
    },
    reportedRecords,
  };
}

async function recordMigrationMappingAndReport(
  db: RepositoryDb,
  reportedRecords: CatalogImportReportedRecord[],
  input: RecordMigrationMappingInput,
): Promise<MigrationMapping> {
  const mapping = await recordMigrationMapping(db, input);
  if (
    mapping.oldEntityType !== input.oldEntityType ||
    mapping.oldEntityId !== input.oldEntityId ||
    mapping.newEntityType !== input.newEntityType ||
    mapping.newEntityId !== input.newEntityId
  ) {
    reportedRecords.push({
      oldEntityType: input.oldEntityType,
      oldEntityId: input.oldEntityId,
      severity: "warning",
      reason: `Migration mapping expected ${input.oldEntityType}:${input.oldEntityId} -> ${input.newEntityType}:${input.newEntityId} but found ${mapping.oldEntityType}:${mapping.oldEntityId} -> ${mapping.newEntityType}:${mapping.newEntityId}.`,
    });
  }
  return mapping;
}

function toSupportedSourceType(sourceType: StrapiFeed["type"]): SourceType | null {
  if (sourceType === "youtube" || sourceType === "odysee" || sourceType === "peertube") {
    return sourceType;
  }
  return null;
}

function toSupportedSourceTypeFromString(sourceType: string): SourceType | null {
  if (sourceType === "youtube" || sourceType === "odysee" || sourceType === "peertube") {
    return sourceType;
  }
  return null;
}

/**
 * Indexes the first content_option with name="source" per content id. The legacy
 * catalog stored source identity here, so this is the fallback identity for content
 * without a feed_content link and the anchor for creators without a feed.
 */
function indexSourceOptionByContentId(
  contentOptions: readonly StrapiContentOption[],
): Map<number, StrapiContentOption> {
  const byContentId = new Map<number, StrapiContentOption>();
  for (const option of contentOptions) {
    if (option.name === "source" && !byContentId.has(option.contentId)) {
      byContentId.set(option.contentId, option);
    }
  }
  return byContentId;
}

/**
 * Extracts a stable source identity and playback URLs from a source content_option.
 * The option's type may carry the platform directly (e.g. "youtube") or be a Strapi
 * media type (e.g. "video:embed"); in the latter case the platform is inferred from
 * the URL host. Returns null for unsupported or unparseable sources.
 */
function extractSourceIdentity(sourceOption: StrapiContentOption): SourceIdentity | null {
  const explicitType = toSupportedSourceTypeFromString(sourceOption.type);
  const url = parseAbsoluteUrl(sourceOption.value);
  if (url === null) {
    return null;
  }

  const sourceType = explicitType ?? inferSourceTypeFromUrl(url);
  if (sourceType === null) {
    return null;
  }

  if (sourceType === "youtube") {
    const videoId = extractYouTubeVideoId(url, sourceOption.value);
    if (videoId === null) {
      return null;
    }
    return {
      sourceType,
      sourceExternalId: videoId,
      canonicalUrl: `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`,
      embedUrl: `https://www.youtube-nocookie.com/embed/${encodeURIComponent(videoId)}`,
      nativeMediaUrl: null,
    };
  }

  if (sourceType === "odysee") {
    const claimHash = extractOdyseeClaimHash(sourceOption.value);
    if (claimHash === null) {
      return null;
    }
    return {
      sourceType,
      sourceExternalId: claimHash,
      canonicalUrl: `https://odysee.com/$/embed/${claimHash}`,
      embedUrl: `https://odysee.com/$/embed/${claimHash}`,
      nativeMediaUrl: sourceOption.value,
    };
  }

  // PeerTube: the source URL is the best canonical identity available.
  return {
    sourceType,
    sourceExternalId: sourceOption.value,
    canonicalUrl: sourceOption.value,
    embedUrl: null,
    nativeMediaUrl: null,
  };
}

function inferSourceTypeFromUrl(url: URL): SourceType | null {
  const host = url.hostname;
  if (host === "www.youtube-nocookie.com" || host === "www.youtube.com" || host === "youtube.com" || host === "youtu.be") {
    return "youtube";
  }
  if (host === "odysee.com" || host === "player.odycdn.com") {
    return "odysee";
  }
  return null;
}

function extractYouTubeVideoId(url: URL, rawValue: string): string | null {
  if (url.pathname.startsWith("/embed/")) {
    const segment = url.pathname.slice("/embed/".length).split("/")[0];
    if (isNonEmptyText(segment)) {
      return segment;
    }
  }
  const queryVideoId = url.searchParams.get("v");
  if (queryVideoId !== null && isNonEmptyText(queryVideoId)) {
    return queryVideoId;
  }
  if (url.hostname === "youtu.be") {
    const segment = url.pathname.slice(1).split("/")[0];
    if (isNonEmptyText(segment)) {
      return segment;
    }
  }
  const shortIdMatch = rawValue.match(/[?&]([A-Za-z0-9_-]{6,})$/);
  return shortIdMatch === null ? null : shortIdMatch[1] ?? null;
}

function extractOdyseeClaimHash(rawValue: string): string | null {
  const match = rawValue.match(/([0-9a-fA-F]{40})/);
  return match === null || match[1] === undefined ? null : match[1].toLowerCase();
}

function parseAbsoluteUrl(value: string): URL | null {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" && url.protocol !== "http:") {
      return null;
    }
    return url;
  } catch (error: unknown) {
    if (error instanceof TypeError) {
      return null;
    }
    throw error;
  }
}

/**
 * Resolves a creator's anchor identity. Creators with a supported feed anchor on
 * that feed's source identity (unchanged behavior). Creators without a feed anchor
 * on the source type of their first content item that carries a supported source
 * option, using a stable legacy identity so the import stays idempotent.
 */
function resolveCreatorAnchor(
  creator: StrapiCreator,
  supportedFeeds: ReadonlyMap<number, SupportedFeed>,
  creatorContentsByCreatorId: ReadonlyMap<number, readonly StrapiCreatorContent[]>,
  sourceOptionByContentId: ReadonlyMap<number, StrapiContentOption>,
): CreatorAnchor | null {
  for (const supportedFeed of supportedFeeds.values()) {
    if (supportedFeed.oldFeed.creatorId === creator.oldId) {
      return { sourceType: supportedFeed.sourceType, sourceExternalId: supportedFeed.oldFeed.externalId };
    }
  }

  const contents = creatorContentsByCreatorId.get(creator.oldId) ?? [];
  for (const content of contents) {
    const sourceOption = sourceOptionByContentId.get(content.oldId);
    if (sourceOption === undefined) {
      continue;
    }
    const identity = extractSourceIdentity(sourceOption);
    if (identity !== null) {
      return {
        sourceType: identity.sourceType,
        sourceExternalId: `legacy-creator:${creator.oldId}`,
      };
    }
  }
  return null;
}

/**
 * Resolves a content item's source identity, preferring a feed_content link's
 * external id (with URLs built from the feed's source type) and falling back to
 * the source content_option when no feed_content link is importable.
 */
function resolveContentSource(
  primaryLink: { readonly feed: SupportedFeed; readonly feedContent: StrapiFeedContent } | null,
  summarySourceOption: StrapiContentOption | null,
  indexedSourceOption: StrapiContentOption | null,
): ResolvedContentSource | null {
  if (primaryLink !== null) {
    const sourceUrls = buildContentSourceUrls(primaryLink.feed.sourceType, primaryLink.feedContent.externalId, summarySourceOption);
    return {
      sourceType: primaryLink.feed.sourceType,
      sourceExternalId: primaryLink.feedContent.externalId,
      canonicalUrl: sourceUrls.canonicalUrl,
      embedUrl: sourceUrls.embedUrl,
      nativeMediaUrl: sourceUrls.nativeMediaUrl,
    };
  }

  const sourceOption = indexedSourceOption ?? summarySourceOption;
  if (sourceOption === null) {
    return null;
  }
  const identity = extractSourceIdentity(sourceOption);
  if (identity === null) {
    return null;
  }
  return identity;
}

function summarizeCreatorOptions(options: readonly StrapiCreatorOption[]): CreatorOptionSummary {
  let imageUrl: string | null = null;
  let imageOption: StrapiCreatorOption | null = null;
  const reportedRecords: CatalogImportReportedRecord[] = [];

  for (const option of options) {
    if (imageUrl === null && isImageOption(option.name, option.type)) {
      if (isAbsoluteUrl(option.value)) {
        imageUrl = option.value;
        imageOption = option;
      } else {
        reportedRecords.push(toUnmappedCreatorOptionReport(option, "Creator image option value is not an absolute URL."));
      }
      continue;
    }
    reportedRecords.push(
      toUnmappedCreatorOptionReport(option, `Creator option ${option.name} with type ${option.type} is not mapped to the new catalog.`),
    );
  }

  return { imageUrl, imageOption, reportedRecords };
}

function summarizeFeedOptions(options: readonly StrapiFeedOption[]): FeedOptionSummary {
  let refreshCadenceSeconds: number | null = null;
  let refreshCadenceOption: StrapiFeedOption | null = null;
  const reportedRecords: CatalogImportReportedRecord[] = [];

  for (const option of options) {
    if (refreshCadenceSeconds === null && option.name === "refreshDelayMinutes" && option.type === "number") {
      const minutes = parseNonnegativeInteger(option.value);
      if (minutes !== null && Number.isSafeInteger(minutes * 60)) {
        refreshCadenceSeconds = minutes * 60;
        refreshCadenceOption = option;
      } else {
        reportedRecords.push(toUnmappedFeedOptionReport(option, "Refresh cadence option value is not a nonnegative integer."));
      }
      continue;
    }
    reportedRecords.push(
      toUnmappedFeedOptionReport(option, `Feed option ${option.name} with type ${option.type} is not mapped to the new catalog.`),
    );
  }

  return { refreshCadenceSeconds, refreshCadenceOption, reportedRecords };
}

function summarizeContentOptions(options: readonly StrapiContentOption[]): ContentOptionSummary {
  let thumbnailUrl: string | null = null;
  let durationSeconds: number | null = null;
  let thumbnailOption: StrapiContentOption | null = null;
  let durationOption: StrapiContentOption | null = null;
  let sourceOption: StrapiContentOption | null = null;
  const reportedRecords: CatalogImportReportedRecord[] = [];

  for (const option of options) {
    if (thumbnailUrl === null && isImageOption(option.name, option.type)) {
      if (isAbsoluteUrl(option.value)) {
        thumbnailUrl = option.value;
        thumbnailOption = option;
      } else {
        reportedRecords.push(toUnmappedOptionReport(option, "Thumbnail option value is not an absolute URL."));
      }
      continue;
    }
    if (durationSeconds === null && option.name === "duration") {
      const parsedDuration = parseNonnegativeInteger(option.value);
      if (parsedDuration !== null) {
        durationSeconds = parsedDuration;
        durationOption = option;
      } else {
        reportedRecords.push(toUnmappedOptionReport(option, "Duration option value is not a nonnegative integer."));
      }
      continue;
    }
    if (sourceOption === null && option.name === "source" && isAbsoluteUrl(option.value)) {
      sourceOption = option;
      continue;
    }
    reportedRecords.push(
      toUnmappedOptionReport(option, `Content option ${option.name} with type ${option.type} is not mapped to the new catalog.`),
    );
  }

  return { thumbnailUrl, durationSeconds, thumbnailOption, durationOption, sourceOption, reportedRecords };
}

function buildContentSourceUrls(
  sourceType: SourceType,
  sourceExternalId: string,
  sourceOption: StrapiContentOption | null,
): ContentSourceUrls {
  if (sourceType === "youtube") {
    return {
      canonicalUrl: `https://www.youtube.com/watch?v=${encodeURIComponent(sourceExternalId)}`,
      embedUrl: sourceOption?.value ?? `https://www.youtube-nocookie.com/embed/${encodeURIComponent(sourceExternalId)}`,
      nativeMediaUrl: null,
    };
  }
  if (sourceType === "odysee") {
    return {
      canonicalUrl: sourceOption?.value ?? `https://odysee.com/${encodeURIComponent(sourceExternalId)}`,
      embedUrl: null,
      nativeMediaUrl: sourceOption?.value ?? null,
    };
  }
  return {
    canonicalUrl: sourceOption?.value ?? peertubeCanonicalFallback(sourceExternalId),
    embedUrl: sourceOption?.value ?? null,
    nativeMediaUrl: null,
  };
}

function peertubeCanonicalFallback(sourceExternalId: string): string {
  const parts = parsePeerTubeSourceExternalId(sourceExternalId);
  if (parts !== null && parts.resource === "videos") {
    return `https://${parts.host}/w/${encodeURIComponent(parts.id)}`;
  }
  return `https://invalid.local/peertube/${encodeURIComponent(sourceExternalId)}`;
}

function parsePeerTubeSourceExternalId(sourceExternalId: string): PeerTubeSourceExternalIdParts | null {
  const [host, resource, ...idParts] = sourceExternalId.split("/");
  const id = idParts.join("/");
  if (!isNonEmptyText(host) || !isNonEmptyText(resource) || !isNonEmptyText(id)) {
    return null;
  }
  return { host, resource, id };
}

function isImageOption(name: string, type: string): boolean {
  return (name === "thumb" || name === "thumbnail" || name === "avatar" || name === "image") && type.startsWith("image:");
}

function isAbsoluteUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch (error: unknown) {
    if (error instanceof TypeError) {
      return false;
    }
    throw error;
  }
}

function isNonEmptyText(value: string | undefined): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function parseNonnegativeInteger(value: string): number | null {
  if (!/^(0|[1-9]\d*)$/.test(value)) {
    return null;
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) {
    return null;
  }
  return parsed;
}

function toUnmappedOptionReport(option: StrapiContentOption, reason: string): CatalogImportReportedRecord {
  return {
    oldEntityType: "strapi-content-option",
    oldEntityId: String(option.oldId),
    severity: "warning",
    reason,
  };
}

function toUnmappedCreatorOptionReport(option: StrapiCreatorOption, reason: string): CatalogImportReportedRecord {
  return {
    oldEntityType: "strapi-creator-option",
    oldEntityId: String(option.oldId),
    severity: "warning",
    reason,
  };
}

function toUnmappedFeedOptionReport(option: StrapiFeedOption, reason: string): CatalogImportReportedRecord {
  return {
    oldEntityType: "strapi-feed-option",
    oldEntityId: String(option.oldId),
    severity: "warning",
    reason,
  };
}

function toUnmappedFeedContentReport(feedContent: StrapiFeedContent, reason: string): CatalogImportReportedRecord {
  return {
    oldEntityType: "strapi-feed-content",
    oldEntityId: String(feedContent.oldId),
    severity: "warning",
    reason,
  };
}

function feedContentSkipReason(
  feedContent: StrapiFeedContent,
  supportedFeeds: ReadonlyMap<number, SupportedFeed>,
  importedContentIds: ReadonlyMap<number, string>,
): string {
  if (!supportedFeeds.has(feedContent.feedId)) {
    return "Feed content row references a feed source that is not supported by the new catalog.";
  }
  if (!importedContentIds.has(feedContent.contentId)) {
    return "Feed content row references content that was not imported into the new catalog.";
  }
  return "Feed content row was not linked to the new catalog.";
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

function isImportableFeedContentLink(
  link: { readonly feedContent: StrapiFeedContent; readonly feed: SupportedFeed | null },
): link is { readonly feedContent: StrapiFeedContent; readonly feed: SupportedFeed } {
  return link.feed !== null;
}
