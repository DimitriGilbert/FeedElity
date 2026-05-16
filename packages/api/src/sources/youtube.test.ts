import { describe, expect, test } from "bun:test";

import { youtubeAdapter } from "./youtube";
import type { DetectedSourceInput, ResolvedSourceInput } from "./types";

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
      sourceType: "youtube",
      sourceExternalId: "UC1234567890abcdef",
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
