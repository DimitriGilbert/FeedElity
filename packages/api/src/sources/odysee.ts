import type { SourceType } from "../domain/catalog";
import { parseHttpUrl } from "./registry";
import type {
  DetectedSourceInput,
  NormalizedCatalogContentItem,
  NormalizedCatalogPayload,
  NormalizedContentSourceInput,
  ResolvedSourceInput,
  SourceAdapter,
  SourceAdapterErrorCode,
  SourceAdapterFailure,
  SourceAdapterResult,
  SourceDetectionFailure,
  SourceDetectionResult,
  SourceDetectionSuccess,
} from "./types";
import { parseXmlPayload, xmlAttribute, xmlChild, xmlChildren, xmlText, type XmlElement } from "./xml";

const ODYSEE_SOURCE_TYPE = "odysee" satisfies SourceType;
const ODYSEE_ORIGIN = "https://odysee.com";
const ODYSEE_RSS_PREFIX = "/$/rss/";

export const odyseeAdapter: SourceAdapter<"odysee"> = {
  sourceType: ODYSEE_SOURCE_TYPE,

  detect(input) {
    return detectOdyseeInput(input);
  },

  async resolveInput(input) {
    return resolveOdyseeInput(input);
  },

  normalizeCatalogPayload(input, payload) {
    return normalizeOdyseeRssPayload(input, payload);
  },

  async fetchCatalog(input) {
    try {
      const response: unknown = await fetch(input.canonicalUrl);
      if (!isFetchTextResponse(response)) {
        return failure("remote-fetch-failed", `Odysee feed fetch returned an unreadable response from ${input.canonicalUrl}.`, input.canonicalUrl);
      }
      if (!response.ok) {
        return failure("remote-fetch-failed", `Odysee feed fetch failed with status ${response.status} from ${input.canonicalUrl}.`, input.canonicalUrl, undefined, response.status);
      }

      const payload = await response.text();
      return this.normalizeCatalogPayload(input, payload);
    } catch (error: unknown) {
      return failure("remote-fetch-failed", `Odysee feed fetch failed for ${input.canonicalUrl}: ${errorMessage(error)}.`, input.canonicalUrl, error);
    }
  },
};

function detectOdyseeInput(input: string): SourceDetectionResult {
  const urlResult = parseHttpUrl(input);
  if (!urlResult.ok) {
    return unsupported(input, "Input is not a valid Odysee URL.");
  }

  const url = urlResult.value;
  if (!isOdyseeHost(url.hostname)) {
    return unsupported(input, "URL host is not supported by the Odysee adapter.");
  }

  if (url.pathname.startsWith(ODYSEE_RSS_PREFIX)) {
    const channelClaim = odyseeRssChannelClaim(url);
    if (channelClaim === null) {
      return unsupported(input, "Odysee RSS URL is missing a creator claim path.");
    }
    return detected(input, "feed-url", canonicalRssFeedUrl(channelClaim));
  }

  const path = parseOdyseePath(url.pathname);
  if (path === null) {
    return unsupported(input, "Odysee URL shape is not supported.");
  }

  if (path.contentClaim !== null) {
    return detected(input, "content-url", canonicalContentUrl(path.creatorClaim, path.contentClaim));
  }

  return detected(input, "creator-url", canonicalCreatorUrl(path.creatorClaim));
}

function resolveOdyseeInput(
  input: DetectedSourceInput & { readonly sourceType: "odysee" },
): SourceAdapterResult<ResolvedSourceInput> {
  const urlResult = parseHttpUrl(input.canonicalInput);
  if (!urlResult.ok) {
    return failure("invalid-source-input", "Canonical Odysee input is not a valid URL.", input.canonicalInput, urlResult.error);
  }

  const url = urlResult.value;
  if (input.inputKind === "feed-url") {
    const channelClaim = odyseeRssChannelClaim(url);
    if (channelClaim !== null && hasClaimId(channelClaim)) {
      return resolved(channelClaim, canonicalRssFeedUrl(channelClaim));
    }
  }

  const path = parseOdyseePath(url.pathname);
  if (path !== null && input.inputKind === "creator-url" && hasClaimId(path.creatorClaim)) {
    return resolved(path.creatorClaim, canonicalRssFeedUrl(path.creatorClaim), canonicalCreatorUrl(path.creatorClaim));
  }

  if (path !== null && input.inputKind === "content-url" && path.contentClaim !== null && hasClaimId(path.contentClaim)) {
    return resolved(claimIdFromSegment(path.contentClaim), canonicalContentUrl(path.creatorClaim, path.contentClaim));
  }

  return failure(
    "unsupported-source-input",
    "This Odysee URL cannot be resolved to a stable claim ID without a network lookup.",
    input.originalInput,
  );
}

function normalizeOdyseeRssPayload(
  input: ResolvedSourceInput & { readonly sourceType: "odysee" },
  payload: string,
): SourceAdapterResult<NormalizedCatalogPayload> {
  const parsed = parseXmlPayload(payload);
  if (!parsed.ok) {
    return failure("remote-payload-invalid", "Odysee RSS payload is not valid XML.", input.canonicalUrl, parsed.error);
  }

  const channel = xmlChild(parsed.document.rss, "channel");
  if (channel === null) {
    return failure("remote-payload-invalid", "Odysee RSS payload is missing a channel element.", input.canonicalUrl);
  }

  const feedTitle = xmlText(channel, "title") ?? "Odysee channel";
  const description = xmlText(channel, "description");
  // Identity is the canonical creator claim resolved before fetching
  // (input.sourceExternalId). Only fall back to the served <link> when the
  // canonical claim is absent, so a malformed/garbled link cannot spawn a
  // duplicate creator row \u2014 same hardening as the YouTube adapter.
  const channelClaim = isNonEmptyText(input.sourceExternalId)
    ? input.sourceExternalId
    : claimSegmentFromUrl(xmlText(channel, "link"));
  if (!isNonEmptyText(channelClaim)) {
    return failure("normalization-failed", "Odysee RSS payload is missing a creator claim.", input.canonicalUrl);
  }

  const ownerBlock = xmlChild(channel, "itunes:owner");
  const ownerName = xmlText(ownerBlock ?? undefined, "itunes:name");
  const imageBlock = xmlChild(channel, "image");
  const channelImageUrl = xmlText(imageBlock ?? undefined, "url") ?? xmlAttribute(channel, "itunes:image", "href");
  const itemBlocks = xmlChildren(channel, "item");
  const items: NormalizedCatalogContentItem[] = [];

  for (const itemBlock of itemBlocks) {
    const item = normalizeItem(itemBlock, channelClaim);
    if (item !== null) {
      items.push(item);
    }
  }

  return {
    ok: true,
    value: {
      creator: {
        sourceType: ODYSEE_SOURCE_TYPE,
        sourceExternalId: channelClaim,
        displayName: ownerName ?? feedTitle,
        description,
        imageUrl: channelImageUrl,
        canonicalUrl: canonicalCreatorUrl(channelClaim),
        metadataJson: stableJson({ channelClaim, format: "odysee-rss" }),
      },
      feeds: [
        {
          sourceType: ODYSEE_SOURCE_TYPE,
          sourceExternalId: channelClaim,
          url: canonicalRssFeedUrl(channelClaim),
          title: feedTitle,
          description,
          adapterMetadataJson: stableJson({ format: "odysee-rss", channelClaim }),
        },
      ],
      items,
    },
  };
}

function normalizeItem(item: XmlElement, fallbackChannelClaim: string): NormalizedCatalogContentItem | null {
  const guid = xmlText(item, "guid");
  const link = xmlText(item, "link");
  const itemClaim = itemClaimFromGuid(guid) ?? itemClaimFromCanonicalUrl(link);
  if (itemClaim === null) {
    return null;
  }

  const title = xmlText(item, "title");
  if (!isNonEmptyText(title)) {
    return null;
  }

  const channelClaim = channelClaimFromGuid(guid) ?? creatorClaimFromUrl(link) ?? fallbackChannelClaim;
  const contentExternalId = claimIdFromSegment(itemClaim);
  const canonicalUrl = canonicalContentUrl(channelClaim, itemClaim);
  const enclosureUrl = xmlAttribute(item, "enclosure", "url");
  const enclosureType = xmlAttribute(item, "enclosure", "type");
  const description = xmlText(item, "content:encoded") ?? xmlText(item, "description");
  const thumbnailUrl = xmlAttribute(item, "itunes:image", "href");
  const publishedAt = parseDate(xmlText(item, "isoDate") ?? xmlText(item, "pubDate"));
  const durationSeconds = parseDurationSeconds(xmlText(item, "itunes:duration"));
  const sources = buildContentSources(contentExternalId, canonicalUrl, enclosureUrl, enclosureType);

  return {
    feedSourceExternalId: channelClaim,
    contentItem: {
      sourceType: ODYSEE_SOURCE_TYPE,
      sourceExternalId: contentExternalId,
      title,
      description,
      publishedAt,
      contentType: "video",
      durationSeconds,
      thumbnailUrl,
      canonicalUrl,
      metadataJson: stableJson({ channelClaim, itemClaim, source: "odysee-rss" }),
    },
    feedContent: {
      sourceExternalId: contentExternalId,
      rawImportRef: guid ?? canonicalUrl,
    },
    sources,
  };
}

function buildContentSources(
  contentExternalId: string,
  canonicalUrl: string,
  enclosureUrl: string | null,
  enclosureType: string | null,
): readonly NormalizedContentSourceInput[] {
  if (enclosureUrl === null) {
    return [];
  }

  return [
    {
      sourceType: ODYSEE_SOURCE_TYPE,
      sourceExternalId: contentExternalId,
      nativeMediaUrl: enclosureUrl,
      canonicalUrl,
      priority: 0,
      metadataJson: stableJson({ playback: "odysee-native-media", mediaType: enclosureType ?? "unknown" }),
    },
  ];
}

function detected(
  originalInput: string,
  inputKind: DetectedSourceInput["inputKind"],
  canonicalInput: string,
): SourceDetectionSuccess {
  return {
    ok: true,
    value: {
      sourceType: ODYSEE_SOURCE_TYPE,
      inputKind,
      originalInput,
      canonicalInput,
    },
  };
}

function resolved(sourceExternalId: string, canonicalUrl: string, title?: string): SourceAdapterResult<ResolvedSourceInput> {
  return {
    ok: true,
    value: {
      sourceType: ODYSEE_SOURCE_TYPE,
      sourceExternalId,
      canonicalUrl,
      title,
    },
  };
}

function unsupported(input: string, message: string): SourceDetectionFailure {
  return {
    ok: false,
    error: {
      code: "unsupported-source-input",
      message,
      input,
      sourceType: ODYSEE_SOURCE_TYPE,
    },
  };
}

function failure(
  code: SourceAdapterErrorCode,
  message: string,
  input?: string,
  cause?: unknown,
  httpStatus?: number,
): SourceAdapterFailure {
  return {
    ok: false,
    error: {
      code,
      message,
      input,
      sourceType: ODYSEE_SOURCE_TYPE,
      httpStatus,
      cause,
    },
  };
}

function canonicalRssFeedUrl(channelClaim: string): string {
  return `${ODYSEE_ORIGIN}${ODYSEE_RSS_PREFIX}${encodePathSegment(channelClaim)}`;
}

function canonicalCreatorUrl(channelClaim: string): string {
  return `${ODYSEE_ORIGIN}/${encodePathSegment(channelClaim)}`;
}

function canonicalContentUrl(channelClaim: string, itemClaim: string): string {
  return `${canonicalCreatorUrl(channelClaim)}/${encodePathSegment(itemClaim)}`;
}

function isOdyseeHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^www\./, "");
  return host === "odysee.com";
}

function odyseeRssChannelClaim(url: URL): string | null {
  if (!url.pathname.startsWith(ODYSEE_RSS_PREFIX)) {
    return null;
  }
  const rawClaim = url.pathname.slice(ODYSEE_RSS_PREFIX.length).split("/").filter(isNonEmptyText)[0];
  const channelClaim = isNonEmptyText(rawClaim) ? decodePathSegment(rawClaim) : null;
  return isNonEmptyText(channelClaim) ? channelClaim : null;
}

interface OdyseePathParts {
  readonly creatorClaim: string;
  readonly contentClaim: string | null;
}

function parseOdyseePath(pathname: string): OdyseePathParts | null {
  const segments = pathname.split("/").filter(isNonEmptyText).map(decodePathSegment);
  const creatorClaim = segments[0];
  if (!isNonEmptyText(creatorClaim) || !creatorClaim.startsWith("@")) {
    return null;
  }

  const contentClaim = segments[1];
  return {
    creatorClaim,
    contentClaim: isNonEmptyText(contentClaim) ? contentClaim : null,
  };
}

function claimSegmentFromUrl(value: string | null): string | null {
  const path = pathFromUrl(value);
  if (path === null) {
    return null;
  }
  return parseOdyseePath(path)?.creatorClaim ?? null;
}

function creatorClaimFromUrl(value: string | null): string | null {
  return claimSegmentFromUrl(value);
}

function itemClaimFromCanonicalUrl(value: string | null): string | null {
  const path = pathFromUrl(value);
  if (path === null) {
    return null;
  }
  return parseOdyseePath(path)?.contentClaim ?? null;
}

function pathFromUrl(value: string | null): string | null {
  if (value === null) {
    return null;
  }
  try {
    return new URL(value).pathname;
  } catch {
    return null;
  }
}

function channelClaimFromGuid(value: string | null): string | null {
  if (value === null || !value.startsWith("lbry://")) {
    return null;
  }
  const firstSegment = value.slice("lbry://".length).split("/")[0];
  return isNonEmptyText(firstSegment) && firstSegment.startsWith("@") ? firstSegment : null;
}

function itemClaimFromGuid(value: string | null): string | null {
  if (value === null || !value.startsWith("lbry://")) {
    return null;
  }
  const segments = value.slice("lbry://".length).split("/");
  const itemClaim = segments[1];
  return isNonEmptyText(itemClaim) ? itemClaim : null;
}

function hasClaimId(claimSegment: string): boolean {
  const parts = claimSegment.split(":");
  const claimId = parts[1];
  return isNonEmptyText(parts[0]) && isNonEmptyText(claimId);
}

function claimIdFromSegment(claimSegment: string): string {
  const claimId = claimSegment.split(":")[1];
  return isNonEmptyText(claimId) ? claimId : claimSegment;
}

function encodePathSegment(value: string): string {
  return encodeURIComponent(value).replace(/%40/g, "@").replace(/%3A/gi, ":");
}

function decodePathSegment(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function parseDate(value: string | null): Date | null {
  if (value === null) {
    return null;
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function parseDurationSeconds(value: string | null): number | null {
  if (value === null) {
    return null;
  }

  const trimmed = value.trim();
  if (/^\d+$/.test(trimmed)) {
    return Number(trimmed);
  }

  const parts = trimmed.split(":").map((part) => Number(part));
  if (parts.length < 2 || parts.length > 3 || parts.some((part) => !Number.isInteger(part) || part < 0)) {
    return null;
  }

  if (parts.length === 2) {
    const minutes = parts[0];
    const seconds = parts[1];
    return minutes === undefined || seconds === undefined ? null : minutes * 60 + seconds;
  }

  const hours = parts[0];
  const minutes = parts[1];
  const seconds = parts[2];
  return hours === undefined || minutes === undefined || seconds === undefined
    ? null
    : hours * 3600 + minutes * 60 + seconds;
}

function stableJson(value: Record<string, string>): string {
  return JSON.stringify(value);
}

function isNonEmptyText(value: string | null | undefined): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function errorMessage(error: unknown): string {
  return error instanceof Error && error.message.trim().length > 0 ? error.message : "unknown error";
}

interface FetchTextResponse {
  readonly ok: boolean;
  readonly status: number;
  text(): Promise<string>;
}

function isFetchTextResponse(value: unknown): value is FetchTextResponse {
  return (
    typeof value === "object" &&
    value !== null &&
    "ok" in value &&
    typeof value.ok === "boolean" &&
    "status" in value &&
    typeof value.status === "number" &&
    "text" in value &&
    typeof value.text === "function"
  );
}
