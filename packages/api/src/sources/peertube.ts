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

const PEERTUBE_SOURCE_TYPE = "peertube" satisfies SourceType;

type PeerTubeResourceKind = "instance" | "account" | "channel" | "video";

interface PeerTubeResourceHint {
  readonly kind: PeerTubeResourceKind;
  readonly host: string;
  readonly origin: string;
  readonly nameOrId: string;
}

interface PeerTubeActor {
  readonly name: string;
  readonly displayName: string | null;
  readonly description: string | null;
  readonly host: string | null;
  readonly url: string | null;
  readonly avatarPath: string | null;
}

interface PeerTubeVideo {
  readonly uuid: string;
  readonly shortUUID: string | null;
  readonly name: string;
  readonly description: string | null;
  readonly publishedAt: Date | null;
  readonly durationSeconds: number | null;
  readonly thumbnailPath: string | null;
  readonly embedPath: string | null;
  readonly url: string | null;
  readonly account: PeerTubeActor | null;
  readonly channel: PeerTubeActor | null;
  readonly nativeMedia: PeerTubeNativeMedia | null;
}

interface PeerTubeNativeMedia {
  readonly url: string;
  readonly mediaType: string;
}

export const peertubeAdapter: SourceAdapter<"peertube"> = {
  sourceType: PEERTUBE_SOURCE_TYPE,

  detect(input) {
    return detectPeerTubeInput(input);
  },

  async resolveInput(input) {
    return resolvePeerTubeInput(input);
  },

  normalizeCatalogPayload(input, payload) {
    return normalizePeerTubeApiPayload(input, payload);
  },

  async fetchCatalog(input) {
    try {
      const response: unknown = await fetch(input.canonicalUrl);
      if (!isFetchTextResponse(response)) {
        return failure("remote-fetch-failed", `PeerTube API fetch returned an unreadable response from ${input.canonicalUrl}.`, input.canonicalUrl);
      }
      if (!response.ok) {
        return failure("remote-fetch-failed", `PeerTube API fetch failed with status ${response.status} from ${input.canonicalUrl}.`, input.canonicalUrl, undefined, response.status);
      }

      const payload = await response.text();
      return this.normalizeCatalogPayload(input, payload);
    } catch (error: unknown) {
      return failure("remote-fetch-failed", `PeerTube API fetch failed for ${input.canonicalUrl}: ${errorMessage(error)}.`, input.canonicalUrl, error);
    }
  },
};

function detectPeerTubeInput(input: string): SourceDetectionResult {
  const urlResult = parseHttpUrl(input);
  if (!urlResult.ok) {
    return unsupported(input, "Input is not a valid PeerTube URL.");
  }

  const url = urlResult.value;
  const segments = pathSegments(url);
  if (segments.length === 0) {
    return detected(input, "unknown-url", `${originFromUrl(url)}/`);
  }

  const first = segments[0];
  const second = segments[1];
  if (first === "w" && isNonEmptyText(second)) {
    return detected(input, "content-url", `${originFromUrl(url)}/w/${encodePathSegment(second)}`);
  }
  if (first === "videos" && second === "watch" && isNonEmptyText(segments[2])) {
    return detected(input, "content-url", `${originFromUrl(url)}/w/${encodePathSegment(segments[2])}`);
  }
  if ((first === "a" || first === "accounts") && isNonEmptyText(second)) {
    return detected(input, "creator-url", `${originFromUrl(url)}/a/${encodePathSegment(second)}`);
  }
  if ((first === "c" || first === "video-channels") && isNonEmptyText(second)) {
    return detected(input, "creator-url", `${originFromUrl(url)}/c/${encodePathSegment(second)}`);
  }

  return unsupported(input, "PeerTube URL shape is not supported.");
}

function resolvePeerTubeInput(
  input: DetectedSourceInput & { readonly sourceType: "peertube" },
): SourceAdapterResult<ResolvedSourceInput> {
  const hint = resourceHintFromDetectedInput(input);
  if (hint === null) {
    return failure("invalid-source-input", "Canonical PeerTube input is not a valid URL.", input.canonicalInput);
  }

  if (hint.kind === "video") {
    return resolved(
      sourceExternalId(hint.host, "videos", hint.nameOrId),
      `${hint.origin}/api/v1/videos/${encodePathSegment(hint.nameOrId)}`,
      `PeerTube video ${hint.nameOrId}`,
    );
  }
  if (hint.kind === "account") {
    return resolved(
      sourceExternalId(hint.host, "accounts", hint.nameOrId),
      `${hint.origin}/api/v1/accounts/${encodePathSegment(hint.nameOrId)}/videos`,
      `PeerTube account ${hint.nameOrId}`,
    );
  }
  if (hint.kind === "channel") {
    return resolved(
      sourceExternalId(hint.host, "video-channels", hint.nameOrId),
      `${hint.origin}/api/v1/video-channels/${encodePathSegment(hint.nameOrId)}/videos`,
      `PeerTube channel ${hint.nameOrId}`,
    );
  }

  return resolved(sourceExternalId(hint.host, "instance", hint.nameOrId), `${hint.origin}/api/v1/videos`, `PeerTube instance ${hint.host}`);
}

function normalizePeerTubeApiPayload(
  input: ResolvedSourceInput & { readonly sourceType: "peertube" },
  payload: string,
): SourceAdapterResult<NormalizedCatalogPayload> {
  const parsed = parseJsonPayload(payload);
  if (!parsed.ok) {
    return failure("remote-payload-invalid", "PeerTube API payload is not valid JSON.", input.canonicalUrl, parsed.error.cause);
  }

  const hint = resourceHintFromApiUrl(input.canonicalUrl);
  if (hint === null) {
    return failure("normalization-failed", "PeerTube API URL cannot be mapped to a resource hint.", input.canonicalUrl);
  }

  const videos = extractVideos(parsed.value);
  if (videos.length === 0) {
    return failure("remote-payload-invalid", "PeerTube API payload does not contain normalizable videos.", input.canonicalUrl);
  }

  const creatorActor = creatorActorFromHint(hint, videos);
  if (creatorActor === null) {
    return failure("normalization-failed", "PeerTube API payload is missing channel or account metadata.", input.canonicalUrl);
  }

  const creatorHost = creatorActor.host ?? hint.host;
  const creatorResource = creatorResourceFromHint(hint);
  const creatorExternalId = sourceExternalId(creatorHost, creatorResource, creatorActor.name);
  const creatorCanonicalUrl = creatorActor.url ?? webCreatorUrl(hint.origin, creatorResource, creatorActor.name);
  const items: NormalizedCatalogContentItem[] = [];
  for (const video of videos) {
    const item = normalizeVideo(video, hint.host, hint.origin, creatorExternalId);
    if (item !== null) {
      items.push(item);
    }
  }

  return {
    ok: true,
    value: {
      creator: {
        sourceType: PEERTUBE_SOURCE_TYPE,
        sourceExternalId: creatorExternalId,
        displayName: creatorActor.displayName ?? creatorActor.name,
        description: creatorActor.description,
        imageUrl: absolutePeerTubeUrl(hint.origin, creatorActor.avatarPath),
        canonicalUrl: creatorCanonicalUrl,
        metadataJson: stableJson({ host: creatorHost, resource: creatorResource, name: creatorActor.name }),
      },
      feeds: [
        {
          sourceType: PEERTUBE_SOURCE_TYPE,
          sourceExternalId: creatorExternalId,
          url: input.canonicalUrl,
          title: creatorActor.displayName ?? creatorActor.name,
          description: creatorActor.description,
          adapterMetadataJson: stableJson({ host: creatorHost, resource: creatorResource, name: creatorActor.name }),
        },
      ],
      items,
    },
  };
}

function normalizeVideo(
  video: PeerTubeVideo,
  fallbackHost: string,
  origin: string,
  feedSourceExternalId: string,
): NormalizedCatalogContentItem | null {
  const canonicalUrl = video.url ?? `${origin}/w/${encodePathSegment(video.shortUUID ?? video.uuid)}`;
  const contentExternalId = sourceExternalId(fallbackHost, "videos", video.uuid);
  const sources = buildContentSources(contentExternalId, canonicalUrl, video, origin, fallbackHost);

  return {
    feedSourceExternalId,
    contentItem: {
      sourceType: PEERTUBE_SOURCE_TYPE,
      sourceExternalId: contentExternalId,
      title: video.name,
      description: video.description,
      publishedAt: video.publishedAt,
      contentType: "video",
      durationSeconds: video.durationSeconds,
      thumbnailUrl: absolutePeerTubeUrl(origin, video.thumbnailPath),
      canonicalUrl,
      metadataJson: stableJson({ host: fallbackHost, uuid: video.uuid, shortUUID: video.shortUUID }),
    },
    feedContent: {
      sourceExternalId: contentExternalId,
      rawImportRef: `${origin}/api/v1/videos/${encodePathSegment(video.uuid)}`,
    },
    sources,
  };
}

function buildContentSources(
  contentExternalId: string,
  canonicalUrl: string,
  video: PeerTubeVideo,
  origin: string,
  host: string,
): readonly NormalizedContentSourceInput[] {
  const sources: NormalizedContentSourceInput[] = [];
  const embedUrl = absolutePeerTubeUrl(origin, video.embedPath);
  if (embedUrl !== null) {
    sources.push({
      sourceType: PEERTUBE_SOURCE_TYPE,
      sourceExternalId: contentExternalId,
      embedUrl,
      canonicalUrl,
      priority: 0,
      metadataJson: stableJson({ playback: "peertube-embed", host }),
    });
  }
  if (video.nativeMedia !== null) {
    sources.push({
      sourceType: PEERTUBE_SOURCE_TYPE,
      sourceExternalId: contentExternalId,
      nativeMediaUrl: video.nativeMedia.url,
      canonicalUrl,
      priority: sources.length,
      metadataJson: stableJson({ playback: "peertube-native-media", mediaType: video.nativeMedia.mediaType, host }),
    });
  }
  return sources;
}

function extractVideos(payload: unknown): readonly PeerTubeVideo[] {
  if (Array.isArray(payload)) {
    return payload.map(parsePeerTubeVideo).filter(isPeerTubeVideo);
  }
  if (!isRecord(payload)) {
    return [];
  }
  const data = payload["data"];
  if (Array.isArray(data)) {
    return data.map(parsePeerTubeVideo).filter(isPeerTubeVideo);
  }
  const single = parsePeerTubeVideo(payload);
  return single === null ? [] : [single];
}

function parsePeerTubeVideo(value: unknown): PeerTubeVideo | null {
  if (!isRecord(value)) {
    return null;
  }
  const uuid = getString(value, "uuid");
  const name = getString(value, "name");
  if (uuid === null || name === null) {
    return null;
  }

  return {
    uuid,
    shortUUID: getString(value, "shortUUID"),
    name,
    description: getString(value, "description"),
    publishedAt: parseDate(getString(value, "publishedAt")),
    durationSeconds: getNumber(value, "duration"),
    thumbnailPath: getString(value, "thumbnailPath"),
    embedPath: getString(value, "embedPath"),
    url: getString(value, "url"),
    account: parseActor(value["account"]),
    channel: parseActor(value["channel"]),
    nativeMedia: parseNativeMedia(value),
  };
}

function parseActor(value: unknown): PeerTubeActor | null {
  if (!isRecord(value)) {
    return null;
  }
  const name = getString(value, "name");
  if (name === null) {
    return null;
  }
  return {
    name,
    displayName: getString(value, "displayName"),
    description: getString(value, "description"),
    host: getString(value, "host"),
    url: getString(value, "url"),
    avatarPath: avatarPath(value["avatar"]),
  };
}

function parseNativeMedia(video: Readonly<Record<string, unknown>>): PeerTubeNativeMedia | null {
  const files = video["files"];
  if (Array.isArray(files)) {
    for (const file of files) {
      if (!isRecord(file)) {
        continue;
      }
      const fileUrl = getString(file, "fileUrl");
      if (fileUrl !== null) {
        return { url: fileUrl, mediaType: getString(file, "mimeType") ?? "unknown" };
      }
    }
  }

  const streamingPlaylists = video["streamingPlaylists"];
  if (Array.isArray(streamingPlaylists)) {
    for (const playlist of streamingPlaylists) {
      if (!isRecord(playlist)) {
        continue;
      }
      const playlistUrl = getString(playlist, "playlistUrl");
      if (playlistUrl !== null) {
        return { url: playlistUrl, mediaType: getString(playlist, "type") ?? "application/vnd.apple.mpegurl" };
      }
    }
  }

  return null;
}

function creatorActorFromHint(hint: PeerTubeResourceHint, videos: readonly PeerTubeVideo[]): PeerTubeActor | null {
  if (hint.kind === "instance") {
    return {
      name: hint.host,
      displayName: hint.host,
      description: null,
      host: hint.host,
      url: `${hint.origin}/`,
      avatarPath: null,
    };
  }

  if (hint.kind === "account") {
    for (const video of videos) {
      if (video.account !== null) {
        return video.account;
      }
    }
    return null;
  }

  for (const video of videos) {
    if (video.channel !== null) {
      return video.channel;
    }
    if (video.account !== null) {
      return video.account;
    }
  }
  return null;
}

function creatorResourceFromHint(hint: PeerTubeResourceHint): "instance" | "accounts" | "video-channels" {
  if (hint.kind === "instance") {
    return "instance";
  }
  return hint.kind === "account" ? "accounts" : "video-channels";
}

function resourceHintFromDetectedInput(input: DetectedSourceInput & { readonly sourceType: "peertube" }): PeerTubeResourceHint | null {
  const urlResult = parseHttpUrl(input.canonicalInput);
  if (!urlResult.ok) {
    return null;
  }
  const url = urlResult.value;
  const segments = pathSegments(url);
  const host = normalizeHost(url.hostname);
  const origin = originFromUrl(url);

  if (segments.length === 0) {
    return { kind: "instance", host, origin, nameOrId: host };
  }
  if (segments[0] === "w" && isNonEmptyText(segments[1])) {
    return { kind: "video", host, origin, nameOrId: segments[1] };
  }
  if (segments[0] === "a" && isNonEmptyText(segments[1])) {
    return { kind: "account", host, origin, nameOrId: segments[1] };
  }
  if (segments[0] === "c" && isNonEmptyText(segments[1])) {
    return { kind: "channel", host, origin, nameOrId: segments[1] };
  }
  return null;
}

function resourceHintFromApiUrl(input: string): PeerTubeResourceHint | null {
  const urlResult = parseHttpUrl(input);
  if (!urlResult.ok) {
    return null;
  }
  const url = urlResult.value;
  const segments = pathSegments(url);
  const host = normalizeHost(url.hostname);
  const origin = originFromUrl(url);

  if (segments[0] !== "api" || segments[1] !== "v1") {
    return null;
  }
  if (segments[2] === "videos" && isNonEmptyText(segments[3])) {
    return { kind: "video", host, origin, nameOrId: segments[3] };
  }
  if (segments[2] === "accounts" && isNonEmptyText(segments[3])) {
    return { kind: "account", host, origin, nameOrId: segments[3] };
  }
  if (segments[2] === "video-channels" && isNonEmptyText(segments[3])) {
    return { kind: "channel", host, origin, nameOrId: segments[3] };
  }
  if (segments[2] === "videos") {
    return { kind: "instance", host, origin, nameOrId: host };
  }
  return null;
}

function detected(
  originalInput: string,
  inputKind: DetectedSourceInput["inputKind"],
  canonicalInput: string,
): SourceDetectionSuccess {
  return {
    ok: true,
    value: {
      sourceType: PEERTUBE_SOURCE_TYPE,
      inputKind,
      originalInput,
      canonicalInput,
    },
  };
}

function resolved(sourceExternalIdValue: string, canonicalUrl: string, title: string): SourceAdapterResult<ResolvedSourceInput> {
  return {
    ok: true,
    value: {
      sourceType: PEERTUBE_SOURCE_TYPE,
      sourceExternalId: sourceExternalIdValue,
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
      sourceType: PEERTUBE_SOURCE_TYPE,
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
      sourceType: PEERTUBE_SOURCE_TYPE,
      httpStatus,
      cause,
    },
  };
}

function parseJsonPayload(payload: string): SourceAdapterResult<unknown> {
  try {
    return { ok: true, value: JSON.parse(payload) as unknown };
  } catch (error: unknown) {
    return failure("remote-payload-invalid", "Payload is not valid JSON.", undefined, error);
  }
}

function pathSegments(url: URL): readonly string[] {
  return url.pathname.split("/").filter(isNonEmptyText).map(decodeURIComponent);
}

function sourceExternalId(host: string, resource: string, id: string): string {
  return `${host}/${resource}/${id}`;
}

function webCreatorUrl(origin: string, resource: "instance" | "accounts" | "video-channels", name: string): string {
  if (resource === "instance") {
    return `${origin}/`;
  }
  const prefix = resource === "accounts" ? "a" : "c";
  return `${origin}/${prefix}/${encodePathSegment(name)}`;
}

function absolutePeerTubeUrl(origin: string, pathOrUrl: string | null): string | null {
  if (pathOrUrl === null) {
    return null;
  }
  const urlResult = parseHttpUrl(pathOrUrl);
  if (urlResult.ok) {
    return urlResult.value.toString();
  }
  if (!pathOrUrl.startsWith("/")) {
    return null;
  }
  return `${origin}${pathOrUrl}`;
}

function avatarPath(value: unknown): string | null {
  if (!isRecord(value)) {
    return null;
  }
  return getString(value, "path");
}

function parseDate(value: string | null): Date | null {
  if (value === null) {
    return null;
  }
  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp)) {
    return null;
  }
  return new Date(timestamp);
}

function getString(record: Readonly<Record<string, unknown>>, key: string): string | null {
  const value = record[key];
  return isNonEmptyText(value) ? value : null;
}

function getNumber(record: Readonly<Record<string, unknown>>, key: string): number | null {
  const value = record[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isPeerTubeVideo(value: PeerTubeVideo | null): value is PeerTubeVideo {
  return value !== null;
}

function isNonEmptyText(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function errorMessage(error: unknown): string {
  return error instanceof Error && error.message.trim().length > 0 ? error.message : "unknown error";
}

function normalizeHost(hostname: string): string {
  return hostname.toLowerCase();
}

function originFromUrl(url: URL): string {
  return `${url.protocol}//${normalizeHost(url.hostname)}${url.port === "" ? "" : `:${url.port}`}`;
}

function encodePathSegment(value: string): string {
  return encodeURIComponent(value);
}

function stableJson(value: unknown): string {
  return JSON.stringify(value);
}

function isFetchTextResponse(value: unknown): value is { readonly ok: boolean; readonly status: number; text(): Promise<string> } {
  return (
    typeof value === "object" &&
    value !== null &&
    "ok" in value &&
    "status" in value &&
    "text" in value &&
    typeof value.ok === "boolean" &&
    typeof value.status === "number" &&
    typeof value.text === "function"
  );
}
