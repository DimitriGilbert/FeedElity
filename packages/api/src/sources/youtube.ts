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
      const response: unknown = await fetch(input.canonicalUrl);
      if (!isFetchTextResponse(response)) {
        return failure("remote-fetch-failed", "YouTube feed fetch returned an unreadable response.", input.canonicalUrl);
      }
      if (!response.ok) {
        return failure("remote-fetch-failed", `YouTube feed fetch failed with status ${response.status}.`, input.canonicalUrl, undefined, response.status);
      }

      const payload = await response.text();
      return this.normalizeCatalogPayload(input, payload);
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
    return resolved(feedChannelId, canonicalFeedUrl(feedChannelId));
  }

  const channelId = channelIdFromPath(url.pathname);
  if (input.inputKind === "creator-url" && channelId !== null) {
    return resolved(channelId, canonicalFeedUrl(channelId));
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
  const xmlStart = payload.indexOf("<");
  if (xmlStart === -1) {
    return failure("remote-payload-invalid", "YouTube RSS payload does not contain XML.", input.canonicalUrl);
  }

  const xml = payload.slice(xmlStart).replace("\uFEFF", "");
  const channelId = readElementText(xml, "yt:channelId") ?? input.sourceExternalId;
  if (!isNonEmptyText(channelId)) {
    return failure("normalization-failed", "YouTube RSS payload is missing yt:channelId.", input.canonicalUrl);
  }

  const feedTitle = readElementText(xml, "title") ?? "YouTube channel";
  const authorBlock = readElementBlock(xml, "author");
  const authorName = authorBlock === null ? null : readElementText(authorBlock, "name");
  const creatorName = authorName ?? feedTitle;
  const entries = readElementBlocks(xml, "entry");

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

function normalizeEntry(entry: string, fallbackChannelId: string): NormalizedCatalogContentItem | null {
  const videoId = readElementText(entry, "yt:videoId");
  if (!isNonEmptyText(videoId)) {
    return null;
  }

  const entryChannelId = readElementText(entry, "yt:channelId") ?? fallbackChannelId;
  const mediaGroup = readElementBlock(entry, "media:group");
  const title = (mediaGroup === null ? null : readElementText(mediaGroup, "media:title")) ?? readElementText(entry, "title");
  if (!isNonEmptyText(title)) {
    return null;
  }

  const description = mediaGroup === null ? null : readElementText(mediaGroup, "media:description");
  const thumbnailUrl = mediaGroup === null ? null : readAttribute(mediaGroup, "media:thumbnail", "url");
  const publishedAt = parseDate(readElementText(entry, "published"));
  const entryId = readElementText(entry, "id") ?? videoId;
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

function readElementText(xml: string, tagName: string): string | null {
  const block = readElementBlock(xml, tagName);
  if (block === null) {
    return null;
  }
  return decodeXmlText(stripCdata(block).replace(/<[^>]+>/g, "").trim());
}

function readElementBlock(xml: string, tagName: string): string | null {
  const blocks = readElementBlocks(xml, tagName);
  return blocks[0] ?? null;
}

function readElementBlocks(xml: string, tagName: string): readonly string[] {
  const escapedTagName = escapeRegExp(tagName);
  const pattern = new RegExp(`<${escapedTagName}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${escapedTagName}>`, "gi");
  return [...xml.matchAll(pattern)].map((match) => match[1]).filter(isNonEmptyText);
}

function readAttribute(xml: string, tagName: string, attributeName: string): string | null {
  const escapedTagName = escapeRegExp(tagName);
  const escapedAttributeName = escapeRegExp(attributeName);
  const pattern = new RegExp(`<${escapedTagName}\\b[^>]*\\s${escapedAttributeName}=(['"])(.*?)\\1`, "i");
  const value = pattern.exec(xml)?.[2];
  return isNonEmptyText(value) ? decodeXmlText(value) : null;
}

function stripCdata(value: string): string {
  return value.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1");
}

function decodeXmlText(value: string): string {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
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
