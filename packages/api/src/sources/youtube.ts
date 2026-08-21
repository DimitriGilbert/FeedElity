import type { SourceType } from "../domain/catalog";
import { parseHttpUrl } from "./registry";
import type {
  CreatorMetadata,
  DetectedSourceInput,
  FetchCreatorMetadataInput,
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
const YOUTUBE_CHANNEL_PAGE_TIMEOUT_MS = 10_000;

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
        return failure("remote-fetch-failed", `YouTube feed fetch returned an unreadable response from ${feedUrl}.`, feedUrl);
      }
      if (!response.ok) {
        return failure("remote-fetch-failed", `YouTube feed fetch failed with status ${response.status} from ${feedUrl}.`, feedUrl, undefined, response.status);
      }

      const payload = await response.text();
      return this.normalizeCatalogPayload({ ...input, sourceExternalId: channelId, canonicalUrl: feedUrl }, payload);
    } catch (error: unknown) {
      return failure("remote-fetch-failed", `YouTube feed fetch failed for ${input.canonicalUrl}: ${errorMessage(error)}.`, input.canonicalUrl, error);
    }
  },

  async fetchCreatorMetadata(input) {
    return fetchYouTubeCreatorMetadata(input);
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

async function fetchYouTubeCreatorMetadata(
  input: FetchCreatorMetadataInput & { readonly sourceType: "youtube" },
): Promise<SourceAdapterResult<CreatorMetadata>> {
  // Channel RSS carries no avatar, so fetch the channel page HTML once and read
  // its Open Graph metadata. Any fetch/parse failure degrades to a result with
  // unset fields so a metadata refresh loop is never broken by it.
  const channelPageUrl = youTubeChannelPageUrl(input);
  if (channelPageUrl === null) {
    return { ok: true, value: {} };
  }
  try {
    const response: unknown = await fetch(channelPageUrl, { signal: AbortSignal.timeout(YOUTUBE_CHANNEL_PAGE_TIMEOUT_MS) });
    if (!isFetchTextResponse(response) || !response.ok) {
      return { ok: true, value: { canonicalUrl: channelPageUrl } };
    }
    const html = await response.text();
    return { ok: true, value: creatorMetadataFromChannelHtml(html, channelPageUrl) };
  } catch {
    return { ok: true, value: { canonicalUrl: channelPageUrl } };
  }
}

function youTubeChannelPageUrl(input: FetchCreatorMetadataInput): string | null {
  const channelId = isNonEmptyText(input.sourceExternalId) ? normalizeYouTubeChannelId(input.sourceExternalId) : null;
  if (channelId !== null && channelId.startsWith("UC")) {
    return canonicalChannelUrl(channelId);
  }

  const urlResult = parseHttpUrl(input.feedUrl);
  if (!urlResult.ok) {
    return null;
  }
  const url = urlResult.value;
  if (url.pathname !== "/feeds/videos.xml") {
    return null;
  }
  const feedChannelId = url.searchParams.get("channel_id");
  if (isNonEmptyText(feedChannelId)) {
    const normalized = normalizeYouTubeChannelId(feedChannelId);
    return normalized.startsWith("UC") ? canonicalChannelUrl(normalized) : null;
  }
  const userName = url.searchParams.get("user");
  if (isNonEmptyText(userName)) {
    return `https://www.youtube.com/user/${encodeURIComponent(userName)}`;
  }
  return null;
}

function creatorMetadataFromChannelHtml(html: string, channelPageUrl: string): CreatorMetadata {
  return {
    displayName: trimmedOrNull(extractMetaContent(html, "og:title")) ?? undefined,
    imageUrl: avatarUrlOrNull(extractMetaContent(html, "og:image")) ?? undefined,
    description: trimmedOrNull(extractMetaContent(html, "og:description")) ?? undefined,
    canonicalUrl: channelPageUrl,
  };
}

// Targeted meta-tag extraction only; a full HTML parser is not worth a new
// dependency for three attributes. The property name is a compile-time constant.
function extractMetaContent(html: string, property: string): string | null {
  const tagPattern = new RegExp(`<meta[^>]+(?:property|name)=["']${property}["'][^>]*>`, "i");
  const tag = html.match(tagPattern)?.[0];
  if (tag === undefined) {
    return null;
  }
  const content = tag.match(/\bcontent=["']([^"']*)["']/i)?.[1];
  return content === undefined ? null : decodeHtmlEntities(content);
}

/**
 * Normalize a YouTube-served avatar to a stable square thumbnail: googleusercontent
 * avatar URLs carry a sizing suffix segment ("=s46-c-k-…") that varies per page
 * render, so it is replaced with a fixed 176px square crop.
 */
function avatarUrlOrNull(url: string | null): string | null {
  if (url === null || !isNonEmptyText(url)) {
    return null;
  }
  const parsed = parseHttpUrl(url);
  if (!parsed.ok) {
    return null;
  }
  const host = normalizeHost(parsed.value.hostname);
  if ((host === "yt3.googleusercontent.com" || host === "yt4.ggpht.com") && parsed.value.pathname.includes("=")) {
    const basePath = parsed.value.pathname.slice(0, parsed.value.pathname.lastIndexOf("="));
    return `https://${host}${basePath}=s176-c-k-c0x00ffffff-no-rj`;
  }
  return parsed.value.toString();
}

function trimmedOrNull(value: string | null): string | null {
  if (value === null) {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&#(\d+);/g, (match, code: string) => {
      const codePoint = Number(code);
      return codePoint >= 0 && codePoint <= 0x10ffff ? String.fromCodePoint(codePoint) : match;
    })
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
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
 * Normalize a YouTube channel id to its canonical form. Modern channel ids start
 * with a two-letter prefix (UC for uploads, UU/FL/LL for playlists, etc.); older
 * imports carried the raw 22-char legacy id, which YouTube's RSS endpoint rejects
 * with a 404. Any 22-char id without a recognized prefix is treated as a legacy
 * channel id and prefixed with UC. Prefixes are matched case-insensitively and
 * uppercased, so a stray lowercase id ("uCkxo…") canonicalizes to its uppercase
 * twin instead of spawning a separate creator/feed.
 */
function normalizeYouTubeChannelId(channelId: string): string {
  const prefix = channelId.slice(0, 2).toUpperCase();
  if (YOUTUBE_ID_PREFIXES.has(prefix)) {
    // Recognised prefix (in any case): uppercase it so case variants collide.
    return channelId.slice(0, 2) === prefix ? channelId : `${prefix}${channelId.slice(2)}`;
  }
  // No recognised prefix on a 22-char id: treat as a legacy channel id.
  if (channelId.length === 22) {
    return `UC${channelId}`;
  }
  return channelId;
}

const YOUTUBE_ID_PREFIXES = new Set(["UC", "UU", "FL", "LL", "PL", "RD"]);

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
