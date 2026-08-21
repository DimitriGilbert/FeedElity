import { describe, expect, test } from "bun:test";

import { youtubeAdapter } from "./youtube";
import type { CreatorMetadata, DetectedSourceInput, FetchCreatorMetadataInput, ResolvedSourceInput, SourceAdapterResult } from "./types";

const youtubeRssFixture = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns:yt="http://www.youtube.com/xml/schemas/2015" xmlns:media="http://search.yahoo.com/mrss/" xmlns="http://www.w3.org/2005/Atom">
  <link rel="self" href="http://www.youtube.com/feeds/videos.xml?channel_id=UC1234567890abcdef"/>
  <id>yt:channel:UC1234567890abcdef</id>
  <yt:channelId>UC1234567890abcdef</yt:channelId>
  <title>Fixture Channel</title>
  <author>
    <name>Fixture Creator</name>
    <uri>https://www.youtube.com/channel/UC1234567890abcdef</uri>
  </author>
  <entry>
    <id>yt:video:abc123XYZ09</id>
    <yt:videoId>abc123XYZ09</yt:videoId>
    <yt:channelId>UC1234567890abcdef</yt:channelId>
    <title>Plain title fallback</title>
    <link rel="alternate" href="https://www.youtube.com/watch?v=abc123XYZ09"/>
    <author>
      <name>Fixture Creator</name>
      <uri>https://www.youtube.com/channel/UC1234567890abcdef</uri>
    </author>
    <published>2026-05-15T12:30:00+00:00</published>
    <updated>2026-05-15T12:45:00+00:00</updated>
    <media:group>
      <media:title>Fixture Video &amp; Review</media:title>
      <media:description><![CDATA[Line one.
Line two.]]></media:description>
      <media:thumbnail url="https://i.ytimg.com/vi/abc123XYZ09/hqdefault.jpg" width="480" height="360"/>
    </media:group>
  </entry>
</feed>`;

describe("YouTube source adapter detection", () => {
  test("detects canonical channel RSS feed URLs", () => {
    const result = youtubeAdapter.detect("https://www.youtube.com/feeds/videos.xml?channel_id=UC1234567890abcdef");

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error(result.error.message);
    }
    expect(result.value).toEqual({
      sourceType: "youtube",
      inputKind: "feed-url",
      originalInput: "https://www.youtube.com/feeds/videos.xml?channel_id=UC1234567890abcdef",
      canonicalInput: "https://www.youtube.com/feeds/videos.xml?channel_id=UC1234567890abcdef",
    });
  });

  test("detects common video URL forms without network access", () => {
    const watchResult = youtubeAdapter.detect("https://www.youtube.com/watch?v=abc123XYZ09&feature=share");
    const shortResult = youtubeAdapter.detect("https://youtu.be/abc123XYZ09");
    const shortsResult = youtubeAdapter.detect("https://www.youtube.com/shorts/abc123XYZ09");

    expect(watchResult.ok && watchResult.value.inputKind).toBe("content-url");
    expect(shortResult.ok && shortResult.value.canonicalInput).toBe("https://www.youtube.com/watch?v=abc123XYZ09");
    expect(shortsResult.ok && shortsResult.value.canonicalInput).toBe("https://www.youtube.com/watch?v=abc123XYZ09");
  });

  test("canonicalizes a lowercase-prefixed channel id so case variants share one feed", async () => {
    // Real channel ids are 24 chars: "UC" + 22.
    const lower = youtubeAdapter.detect("https://www.youtube.com/feeds/videos.xml?channel_id=uC1234567890abcdefghijkl");
    const upper = youtubeAdapter.detect("https://www.youtube.com/feeds/videos.xml?channel_id=UC1234567890abcdefghijkl");
    if (!lower.ok || !upper.ok) {
      throw new Error("Expected both detections to succeed.");
    }
    if (!isYouTubeDetection(lower.value) || !isYouTubeDetection(upper.value)) {
      throw new Error("Expected YouTube detections.");
    }

    const lowerResolution = await youtubeAdapter.resolveInput(lower.value);
    const upperResolution = await youtubeAdapter.resolveInput(upper.value);

    expect(lowerResolution.ok).toBe(true);
    expect(upperResolution.ok).toBe(true);
    if (!lowerResolution.ok || !upperResolution.ok) {
      throw new Error("Expected both resolutions to succeed.");
    }
    // Same channel regardless of the case of the "UC" prefix — no twin creator/feed.
    expect(lowerResolution.value.sourceExternalId).toBe("UC1234567890abcdefghijkl");
    expect(lowerResolution.value.sourceExternalId).toBe(upperResolution.value.sourceExternalId);
  });

  test("rejects individual video URLs during resolution", async () => {
    const detection = youtubeAdapter.detect("https://www.youtube.com/watch?v=abc123");

    expect(detection.ok).toBe(true);
    if (!detection.ok) {
      throw new Error(detection.error.message);
    }
    if (!isYouTubeDetection(detection.value)) {
      throw new Error(`Expected YouTube detection, received ${detection.value.sourceType}.`);
    }

    const resolution = await youtubeAdapter.resolveInput(detection.value);

    expect(resolution.ok).toBe(false);
    if (resolution.ok) {
      throw new Error(`Expected unsupported result, received ${resolution.value.sourceExternalId}.`);
    }
    expect(resolution.error).toMatchObject({
      code: "unsupported-source-input",
      sourceType: "youtube",
      input: "https://www.youtube.com/watch?v=abc123",
    });
  });

  test("returns a structured unresolvable result for handle channel URLs", async () => {
    const detection = youtubeAdapter.detect("https://www.youtube.com/@fixturecreator");

    expect(detection.ok).toBe(true);
    if (!detection.ok) {
      throw new Error(detection.error.message);
    }
    if (!isYouTubeDetection(detection.value)) {
      throw new Error(`Expected YouTube detection, received ${detection.value.sourceType}.`);
    }
    expect(detection.value.inputKind).toBe("creator-url");

    const resolution = await youtubeAdapter.resolveInput(detection.value);

    expect(resolution.ok).toBe(false);
    if (resolution.ok) {
      throw new Error(`Expected unresolvable result, received ${resolution.value.sourceExternalId}.`);
    }
    expect(resolution.error).toMatchObject({
      code: "unsupported-source-input",
      sourceType: "youtube",
      input: "https://www.youtube.com/@fixturecreator",
    });
  });
});

describe("YouTube source adapter normalization", () => {
  test("normalizes a YouTube RSS XML payload into catalog records with no-cookie embed playback", async () => {
    const detection = youtubeAdapter.detect("https://www.youtube.com/feeds/videos.xml?channel_id=UC1234567890abcdef");
    if (!detection.ok) {
      throw new Error(detection.error.message);
    }
    if (!isYouTubeDetection(detection.value)) {
      throw new Error(`Expected YouTube detection, received ${detection.value.sourceType}.`);
    }
    const resolution = await youtubeAdapter.resolveInput(detection.value);
    if (!resolution.ok) {
      throw new Error(resolution.error.message);
    }
    if (!isYouTubeResolution(resolution.value)) {
      throw new Error(`Expected YouTube resolution, received ${resolution.value.sourceType}.`);
    }

    const result = youtubeAdapter.normalizeCatalogPayload(resolution.value, youtubeRssFixture);

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error(result.error.message);
    }
    expect(result.value.creator).toMatchObject({
      displayName: "Fixture Creator",
      canonicalUrl: "https://www.youtube.com/channel/UC1234567890abcdef",
    });
    expect(result.value.feeds).toEqual([
      {
        sourceType: "youtube",
        sourceExternalId: "UC1234567890abcdef",
        url: "https://www.youtube.com/feeds/videos.xml?channel_id=UC1234567890abcdef",
        title: "Fixture Channel",
        adapterMetadataJson: JSON.stringify({ channelId: "UC1234567890abcdef", format: "youtube-rss" }),
      },
    ]);
    expect(result.value.items).toHaveLength(1);

    const item = result.value.items[0];
    if (item === undefined) {
      throw new Error("Expected one normalized YouTube item.");
    }
    expect(item.contentItem).toMatchObject({
      sourceType: "youtube",
      sourceExternalId: "abc123XYZ09",
      title: "Fixture Video & Review",
      description: "Line one.\nLine two.",
      contentType: "video",
      thumbnailUrl: "https://i.ytimg.com/vi/abc123XYZ09/hqdefault.jpg",
      canonicalUrl: "https://www.youtube.com/watch?v=abc123XYZ09",
    });
    expect(item.contentItem.publishedAt?.toISOString()).toBe("2026-05-15T12:30:00.000Z");
    expect(item.feedContent).toEqual({
      sourceExternalId: "abc123XYZ09",
      rawImportRef: "yt:video:abc123XYZ09",
    });
    expect(item.sources).toEqual([
      {
        sourceType: "youtube",
        sourceExternalId: "abc123XYZ09",
        embedUrl: "https://www.youtube-nocookie.com/embed/abc123XYZ09",
        canonicalUrl: "https://www.youtube.com/watch?v=abc123XYZ09",
        priority: 0,
        metadataJson: JSON.stringify({ playback: "youtube-nocookie-iframe", videoId: "abc123XYZ09" }),
      },
    ]);
  });
});

function isYouTubeDetection(value: DetectedSourceInput): value is DetectedSourceInput & { readonly sourceType: "youtube" } {
  return value.sourceType === "youtube";
}

function isYouTubeResolution(value: ResolvedSourceInput): value is ResolvedSourceInput & { readonly sourceType: "youtube" } {
  return value.sourceType === "youtube";
}

interface FetchStub {
  readonly requestedUrls: readonly string[];
  restore(): void;
}

function installFetchStub(handler: (url: string) => Response | Promise<Response>): FetchStub {
  const originalFetch = globalThis.fetch;
  const requestedUrls: string[] = [];
  const stub = Object.assign(
    (input: Parameters<typeof globalThis.fetch>[0]): Promise<Response> => {
      const url = input instanceof URL ? input.toString() : String(input);
      requestedUrls.push(url);
      return Promise.resolve(handler(url));
    },
    { preconnect: originalFetch.preconnect },
  );
  globalThis.fetch = stub;
  return {
    requestedUrls,
    restore() {
      globalThis.fetch = originalFetch;
    },
  };
}

function callFetchCreatorMetadata(
  input: FetchCreatorMetadataInput & { readonly sourceType: "youtube" },
): Promise<SourceAdapterResult<CreatorMetadata>> {
  if (youtubeAdapter.fetchCreatorMetadata === undefined) {
    throw new Error("Youtube adapter does not implement fetchCreatorMetadata.");
  }
  return youtubeAdapter.fetchCreatorMetadata(input);
}

describe("YouTube source adapter creator metadata", () => {
  test("fetches the channel page and extracts Open Graph metadata with a square avatar", async () => {
    const channelHtml = `<!doctype html>
<html>
<head>
<meta property="og:image" content="https://yt3.googleusercontent.com/ytc/AAA(fixture)=s46-c-k-c0x00ffffff-no-rj">
<meta property="og:title" content="Fixture &amp; Channel">
<meta property="og:description" content="Fixture channel description.">
</head>
<body></body>
</html>`;
    const stub = installFetchStub(() => new Response(channelHtml, { status: 200 }));
    try {
      const result = await callFetchCreatorMetadata({
        sourceType: "youtube",
        sourceExternalId: "UC1234567890abcdef",
        feedUrl: "https://www.youtube.com/feeds/videos.xml?channel_id=UC1234567890abcdef",
      });

      expect(result.ok).toBe(true);
      if (!result.ok) {
        throw new Error(result.error.message);
      }
      expect(stub.requestedUrls).toEqual(["https://www.youtube.com/channel/UC1234567890abcdef"]);
      expect(result.value).toEqual({
        displayName: "Fixture & Channel",
        imageUrl: "https://yt3.googleusercontent.com/ytc/AAA(fixture)=s176-c-k-c0x00ffffff-no-rj",
        description: "Fixture channel description.",
        canonicalUrl: "https://www.youtube.com/channel/UC1234567890abcdef",
      });
    } finally {
      stub.restore();
    }
  });

  test("derives the user page URL for legacy user feeds", async () => {
    const stub = installFetchStub(() => new Response("<html><head></head><body></body></html>", { status: 200 }));
    try {
      const result = await callFetchCreatorMetadata({
        sourceType: "youtube",
        sourceExternalId: "legacy-user-feed",
        feedUrl: "https://www.youtube.com/feeds/videos.xml?user=fixtureuser",
      });

      expect(result.ok).toBe(true);
      if (!result.ok) {
        throw new Error(result.error.message);
      }
      expect(stub.requestedUrls).toEqual(["https://www.youtube.com/user/fixtureuser"]);
      expect(result.value).toEqual({ canonicalUrl: "https://www.youtube.com/user/fixtureuser" });
    } finally {
      stub.restore();
    }
  });

  test("returns unset fields on a failed channel page fetch", async () => {
    const stub = installFetchStub(() => new Response("Not Found", { status: 404 }));
    try {
      const result = await callFetchCreatorMetadata({
        sourceType: "youtube",
        sourceExternalId: "UC1234567890abcdef",
        feedUrl: "https://www.youtube.com/feeds/videos.xml?channel_id=UC1234567890abcdef",
      });

      expect(result.ok).toBe(true);
      if (!result.ok) {
        throw new Error(result.error.message);
      }
      expect(result.value).toEqual({
        canonicalUrl: "https://www.youtube.com/channel/UC1234567890abcdef",
      });
    } finally {
      stub.restore();
    }
  });

  test("returns unset fields when the fetch throws", async () => {
    const stub = installFetchStub(() => {
      throw new Error("network down");
    });
    try {
      const result = await callFetchCreatorMetadata({
        sourceType: "youtube",
        sourceExternalId: "UC1234567890abcdef",
        feedUrl: "https://www.youtube.com/feeds/videos.xml?channel_id=UC1234567890abcdef",
      });

      expect(result.ok).toBe(true);
      if (!result.ok) {
        throw new Error(result.error.message);
      }
      expect(result.value).toEqual({
        canonicalUrl: "https://www.youtube.com/channel/UC1234567890abcdef",
      });
    } finally {
      stub.restore();
    }
  });
});
