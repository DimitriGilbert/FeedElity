import type { SourceType } from "../domain/catalog";
import { parseHttpUrl } from "./registry";
import type {
  DetectedSourceInput,
  NormalizedCatalogContentItem,
  NormalizedCatalogPayload,
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

const YOUTUBE_SOURCE_TYPE = "youtube" satisfies SourceType;
const YOUTUBE_WATCH_BASE_URL = "https://www.youtube.com/watch";
const YOUTUBE_FEED_BASE_URL = "https://www.youtube.com/feeds/videos.xml";
const YOUTUBE_NOCOOKIE_EMBED_BASE_URL = "https://www.youtube-nocookie.com/embed/";

export const youtubeAdapter: SourceAdapter<"youtube"> = {
  sourceType: YOUTUBE_SOURCE_TYPE,

  detect(input) {
    return detectYouTubeInput(input);
  },

  async resolveInput(input) {
    return resolveYouTubeInput(input);
  },

  normalizeCatalogPayload(input, payload) {
    return normalizeYouTubeRssPayload(input, payload);
  },

  async fetchCatalog(input) {
    try {
      // Normalize legacy channel ids (no "UC" prefix) so the feed URL targets a
      // valid modern channel — YouTube's RSS endpoint 404s on the raw legacy id.
      const channelId = normalizeYouTubeChannelId(input.sourceExternalId);
      const feedUrl = channelId === input.sourceExternalId ? input.canonicalUrl : canonicalFeedUrl(channelId);
      const response: unknown = await fetch(feedUrl);
      if (!isFetchTextResponse(response)) {
        return failure("remote-fetch-failed", "YouTube feed fetch returned an unreadable response.", feedUrl);
      }
      if (!response.ok) {
        return failure("remote-fetch-failed", `YouTube feed fetch failed with status ${response.status}.`, feedUrl, undefined, response.status);
      }

      const payload = await response.text();
      return this.normalizeCatalogPayload({ ...input, sourceExternalId: channelId, canonicalUrl: feedUrl }, payload);
    } catch (error: unknown) {
      return failure("remote-fetch-failed", "YouTube feed fetch failed.", input.canonicalUrl, error);
    }
  },
};

function detectYouTubeInput(input: string): SourceDetectionResult {
  const urlResult = parseHttpUrl(input);
  if (!urlResult.ok) {
    return unsupported(input, "Input is not a valid YouTube URL.");
  }

  const url = urlResult.value;
  const host = normalizeHost(url.hostname);

  if (host === "youtu.be") {
    const videoId = firstPathSegment(url);
    if (videoId === null) {
      return unsupported(input, "YouTube short URL is missing a video ID.");
    }
    return detected(input, "content-url", canonicalVideoUrl(videoId));
  }

  if (!isYouTubeHost(host)) {
    return unsupported(input, "URL host is not supported by the YouTube adapter.");
  }

  if (url.pathname === "/feeds/videos.xml") {
    const channelId = url.searchParams.get("channel_id");
    if (isNonEmptyText(channelId)) {
      return detected(input, "feed-url", canonicalFeedUrl(channelId));
    }
    return unsupported(input, "YouTube feed URL must include a channel_id query parameter.");
  }

  const channelId = channelIdFromPath(url.pathname);
  if (channelId !== null) {
    return detected(input, "creator-url", canonicalChannelUrl(channelId));
  }

  const videoId = videoIdFromUrl(url);
  if (videoId !== null) {
    return detected(input, "content-url", canonicalVideoUrl(videoId));
  }

  if (isUnresolvableCreatorPath(url.pathname)) {
    return detected(input, "creator-url", canonicalYouTubeUrl(url));
  }

  return unsupported(input, "YouTube URL shape is not supported.");
}

function resolveYouTubeInput(
  input: DetectedSourceInput & { readonly sourceType: "youtube" },
): SourceAdapterResult<ResolvedSourceInput> {
  const urlResult = parseHttpUrl(input.canonicalInput);
  if (!urlResult.ok) {
    return failure("invalid-source-input", "Canonical YouTube input is not a valid URL.", input.canonicalInput, urlResult.error);
  }

  const url = urlResult.value;
  const feedChannelId = url.pathname === "/feeds/videos.xml" ? url.searchParams.get("channel_id") : null;
  if (input.inputKind === "feed-url" && isNonEmptyText(feedChannelId)) {
    const normalized = normalizeYouTubeChannelId(feedChannelId);
    return resolved(normalized, canonicalFeedUrl(normalized));
  }

  const channelId = channelIdFromPath(url.pathname);
  if (input.inputKind === "creator-url" && channelId !== null) {
    const normalized = normalizeYouTubeChannelId(channelId);
    return resolved(normalized, canonicalFeedUrl(normalized));
  }

  if (input.inputKind === "content-url") {
    return failure(
      "unsupported-source-input",
      "Individual video URLs cannot be added as sources. Use a channel or feed URL.",
      input.originalInput,
    );
  }

  return failure(
    "unsupported-source-input",
    "This YouTube URL cannot be resolved to a stable channel or video ID without a network lookup.",
    input.originalInput,
  );
}

function normalizeYouTubeRssPayload(
  input: ResolvedSourceInput & { readonly sourceType: "youtube" },
  payload: string,
): SourceAdapterResult<NormalizedCatalogPayload> {
  const parsed = parseXmlPayload(payload);
  if (!parsed.ok) {
    return failure("remote-payload-invalid", "YouTube RSS payload is not valid XML.", input.canonicalUrl, parsed.error);
  }

  const feed = parsed.document.feed;
  if (feed === undefined) {
    return failure("remote-payload-invalid", "YouTube RSS payload is missing a feed element.", input.canonicalUrl);
  }

  // The creator/feed identity is the canonical channel id we resolved before
  // fetching (input.sourceExternalId). We deliberately do NOT trust the
  // feed-served <yt:channelId> for identity: YouTube occasionally serves a
  // malformed/truncated value there, and trusting it spawned duplicate creator
  // rows with content orphaned from the real subscription.
  const channelId = input.sourceExternalId;
  if (!isNonEmptyText(channelId)) {
    return failure("normalization-failed", "YouTube RSS payload is missing a resolved channel id.", input.canonicalUrl);
  }

  const feedTitle = xmlText(feed, "title") ?? "YouTube channel";
  const authorBlock = xmlChild(feed, "author");
  const authorName = xmlText(authorBlock ?? undefined, "name");
  const creatorName = authorName ?? feedTitle;
  const entries = xmlChildren(feed, "entry");

  const items: NormalizedCatalogContentItem[] = [];
  for (const entry of entries) {
    const normalizedItem = normalizeEntry(entry, channelId);
    if (normalizedItem !== null) {
      items.push(normalizedItem);
    }
  }

  return {
    ok: true,
    value: {
      creator: {
        sourceType: YOUTUBE_SOURCE_TYPE,
        sourceExternalId: channelId,
        displayName: creatorName,
        canonicalUrl: canonicalChannelUrl(channelId),
        metadataJson: stableJson({ channelId, feedTitle }),
      },
      feeds: [
        {
          sourceType: YOUTUBE_SOURCE_TYPE,
          sourceExternalId: channelId,
          url: canonicalFeedUrl(channelId),
          title: feedTitle,
          adapterMetadataJson: stableJson({ channelId, format: "youtube-rss" }),
        },
      ],
      items,
    },
  };
}

function normalizeEntry(entry: XmlElement, fallbackChannelId: string): NormalizedCatalogContentItem | null {
  const videoId = xmlText(entry, "yt:videoId");
  if (!isNonEmptyText(videoId)) {
    return null;
  }

  // Per-entry feed link falls back to the canonical channel id when the served
  // value is missing or malformed, so items always link to the real feed row.
  const entryChannelId = sanitizeChannelId(xmlText(entry, "yt:channelId"), fallbackChannelId);
  const mediaGroup = xmlChild(entry, "media:group");
  const title = (mediaGroup === null ? null : xmlText(mediaGroup, "media:title")) ?? xmlText(entry, "title");
  if (!isNonEmptyText(title)) {
    return null;
  }

  const description = mediaGroup === null ? null : xmlText(mediaGroup, "media:description");
  const thumbnailUrl = mediaGroup === null ? null : xmlAttribute(mediaGroup, "media:thumbnail", "url");
  const publishedAt = parseDate(xmlText(entry, "published"));
  const entryId = xmlText(entry, "id") ?? videoId;
  const canonicalUrl = canonicalVideoUrl(videoId);

  return {
    feedSourceExternalId: entryChannelId,
    contentItem: {
      sourceType: YOUTUBE_SOURCE_TYPE,
      sourceExternalId: videoId,
      title,
      description,
      publishedAt,
      contentType: "video",
      thumbnailUrl,
      canonicalUrl,
      metadataJson: stableJson({ channelId: entryChannelId, videoId, source: "youtube-rss" }),
    },
    feedContent: {
      sourceExternalId: videoId,
      rawImportRef: entryId,
    },
    sources: [
      {
        sourceType: YOUTUBE_SOURCE_TYPE,
        sourceExternalId: videoId,
        embedUrl: `${YOUTUBE_NOCOOKIE_EMBED_BASE_URL}${encodeURIComponent(videoId)}`,
        canonicalUrl,
        priority: 0,
        metadataJson: stableJson({ playback: "youtube-nocookie-iframe", videoId }),
      },
    ],
  };
}

// A YouTube channel id always starts with "UC". Treat anything else served by
// the feed (truncated/garbled) as unusable and fall back to the canonical id.
function sanitizeChannelId(value: string | null, fallbackChannelId: string): string {
  if (value !== null && value.startsWith("UC")) {
    return value;
  }
  return fallbackChannelId;
}

function detected(
  originalInput: string,
  inputKind: DetectedSourceInput["inputKind"],
  canonicalInput: string,
): SourceDetectionSuccess {
  return {
    ok: true,
    value: {
      sourceType: YOUTUBE_SOURCE_TYPE,
      inputKind,
      originalInput,
      canonicalInput,
    },
  };
}

function resolved(sourceExternalId: string, canonicalUrl: string): SourceAdapterResult<ResolvedSourceInput> {
  return {
    ok: true,
    value: {
      sourceType: YOUTUBE_SOURCE_TYPE,
      sourceExternalId,
      canonicalUrl,
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
      sourceType: YOUTUBE_SOURCE_TYPE,
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
      sourceType: YOUTUBE_SOURCE_TYPE,
      httpStatus,
      cause,
    },
  };
}

function canonicalFeedUrl(channelId: string): string {
  return `${YOUTUBE_FEED_BASE_URL}?channel_id=${encodeURIComponent(channelId)}`;
}

/**
 * Normalize a YouTube channel id to its modern "UC"-prefixed form. Modern
 * channel ids start with "UC"; older imports carried the raw 22-char legacy id,
 * which YouTube's RSS endpoint rejects with a 404. Any 22-char id without a
 * recognized playlist-prefix (UC/UU/FL/LL/PL/RD etc.) is treated as a legacy
 * channel id and prefixed. Returns the input unchanged when already canonical or
 * when the shape is not a recognisable legacy channel id.
 */
function normalizeYouTubeChannelId(channelId: string): string {
  if (channelId.startsWith("UC") || channelId.length !== 22) {
    return channelId;
  }
  return `UC${channelId}`;
}

function canonicalChannelUrl(channelId: string): string {
  return `https://www.youtube.com/channel/${encodeURIComponent(channelId)}`;
}

function canonicalVideoUrl(videoId: string): string {
  const url = new URL(YOUTUBE_WATCH_BASE_URL);
  url.searchParams.set("v", videoId);
  return url.toString();
}

function canonicalYouTubeUrl(url: URL): string {
  const canonicalUrl = new URL(url.pathname, "https://www.youtube.com");
  return canonicalUrl.toString();
}

function normalizeHost(hostname: string): string {
  return hostname.toLowerCase().replace(/^www\./, "");
}

function isYouTubeHost(host: string): boolean {
  return host === "youtube.com" || host === "m.youtube.com" || host === "music.youtube.com";
}

function firstPathSegment(url: URL): string | null {
  const segment = url.pathname.split("/").filter(Boolean)[0];
  return isNonEmptyText(segment) ? segment : null;
}

function channelIdFromPath(pathname: string): string | null {
  const segments = pathname.split("/").filter(Boolean);
  if (segments[0] !== "channel") {
    return null;
  }
  const channelId = segments[1];
  return isNonEmptyText(channelId) ? channelId : null;
}

function videoIdFromUrl(url: URL): string | null {
  if (normalizeHost(url.hostname) === "youtu.be") {
    return firstPathSegment(url);
  }

  if (url.pathname === "/watch") {
    const videoId = url.searchParams.get("v");
    return isNonEmptyText(videoId) ? videoId : null;
  }

  const segments = url.pathname.split("/").filter(Boolean);
  if ((segments[0] === "embed" || segments[0] === "shorts") && isNonEmptyText(segments[1])) {
    return segments[1];
  }

  return null;
}

function isUnresolvableCreatorPath(pathname: string): boolean {
  const firstSegment = pathname.split("/").filter(Boolean)[0];
  return firstSegment === "c" || firstSegment === "user" || firstSegment?.startsWith("@") === true;
}

function parseDate(value: string | null): Date | null {
  if (value === null) {
    return null;
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function stableJson(value: Record<string, string>): string {
  return JSON.stringify(value);
}

function isNonEmptyText(value: string | null | undefined): value is string {
  return typeof value === "string" && value.trim().length > 0;
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
