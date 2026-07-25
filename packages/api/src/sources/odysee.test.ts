import { describe, expect, test } from "bun:test";

import { odyseeAdapter } from "./odysee";
import type { DetectedSourceInput, ResolvedSourceInput } from "./types";

const odyseeRssFixture = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd" xmlns:content="http://purl.org/rss/1.0/modules/content/">
  <channel>
    <title>Fixture Odysee Channel</title>
    <link>https://odysee.com/@fixture:abc123</link>
    <description><![CDATA[Creator description with & entity.]]></description>
    <image>
      <url>https://thumbs.odycdn.com/channel.png</url>
    </image>
    <itunes:owner>
      <itunes:name>Fixture Owner</itunes:name>
    </itunes:owner>
    <itunes:image href="https://thumbs.odycdn.com/channel-itunes.png" />
    <item>
      <guid isPermaLink="false">lbry://@fixture:abc123/fixture-video:def456</guid>
      <title>Fixture Odysee Video</title>
      <link>https://odysee.com/@fixture:abc123/fixture-video:def456</link>
      <pubDate>Fri, 15 May 2026 12:30:00 GMT</pubDate>
      <isoDate>2026-05-15T12:30:00.000Z</isoDate>
      <description><![CDATA[Short item description.]]></description>
      <content:encoded><![CDATA[Long item description.
Second line.]]></content:encoded>
      <enclosure url="https://player.odycdn.com/api/v4/streams/free/fixture-video/def456.mp4" length="123456" type="video/mp4" />
      <itunes:image href="https://thumbs.odycdn.com/video.png" />
      <itunes:duration>01:02:03</itunes:duration>
    </item>
  </channel>
</rss>`;

describe("Odysee source adapter detection", () => {
  test("detects Odysee RSS feed URLs", () => {
    const result = odyseeAdapter.detect("https://odysee.com/$/rss/@fixture:abc123");

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error(result.error.message);
    }
    expect(result.value).toEqual({
      sourceType: "odysee",
      inputKind: "feed-url",
      originalInput: "https://odysee.com/$/rss/@fixture:abc123",
      canonicalInput: "https://odysee.com/$/rss/@fixture:abc123",
    });
  });

  test("detects Odysee RSS feed URLs with trailing slashes without encoding the slash", () => {
    const result = odyseeAdapter.detect("https://odysee.com/$/rss/@fixture:abc123/");

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error(result.error.message);
    }
    expect(result.value).toEqual({
      sourceType: "odysee",
      inputKind: "feed-url",
      originalInput: "https://odysee.com/$/rss/@fixture:abc123/",
      canonicalInput: "https://odysee.com/$/rss/@fixture:abc123",
    });
    expect(result.value.canonicalInput).not.toContain("%2F");
  });

  test("detects Odysee RSS feed URLs with extra path segments from the channel claim", () => {
    const result = odyseeAdapter.detect("https://odysee.com/$/rss/@fixture:abc123/extra");

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error(result.error.message);
    }
    expect(result.value).toEqual({
      sourceType: "odysee",
      inputKind: "feed-url",
      originalInput: "https://odysee.com/$/rss/@fixture:abc123/extra",
      canonicalInput: "https://odysee.com/$/rss/@fixture:abc123",
    });
    expect(result.value.canonicalInput).not.toContain("%2F");
  });

  test("detects canonical creator and content URLs with claim IDs", () => {
    const creatorResult = odyseeAdapter.detect("https://odysee.com/@fixture:abc123");
    const contentResult = odyseeAdapter.detect("https://odysee.com/@fixture:abc123/fixture-video:def456?src=share");

    expect(creatorResult.ok && creatorResult.value.inputKind).toBe("creator-url");
    expect(contentResult.ok && contentResult.value).toMatchObject({
      inputKind: "content-url",
      canonicalInput: "https://odysee.com/@fixture:abc123/fixture-video:def456",
    });
  });

  test("returns a structured unresolvable result for creator URLs without claim IDs", async () => {
    const detection = odyseeAdapter.detect("https://odysee.com/@fixture");

    expect(detection.ok).toBe(true);
    if (!detection.ok) {
      throw new Error(detection.error.message);
    }
    if (!isOdyseeDetection(detection.value)) {
      throw new Error(`Expected Odysee detection, received ${detection.value.sourceType}.`);
    }

    const resolution = await odyseeAdapter.resolveInput(detection.value);

    expect(resolution.ok).toBe(false);
    if (resolution.ok) {
      throw new Error(`Expected unresolvable result, received ${resolution.value.sourceExternalId}.`);
    }
    expect(resolution.error).toMatchObject({
      code: "unsupported-source-input",
      sourceType: "odysee",
      input: "https://odysee.com/@fixture",
    });
  });
});

describe("Odysee source adapter normalization", () => {
  test("normalizes an Odysee RSS XML payload into catalog records with native media playback", async () => {
    const detection = odyseeAdapter.detect("https://odysee.com/$/rss/@fixture:abc123");
    if (!detection.ok) {
      throw new Error(detection.error.message);
    }
    if (!isOdyseeDetection(detection.value)) {
      throw new Error(`Expected Odysee detection, received ${detection.value.sourceType}.`);
    }
    const resolution = await odyseeAdapter.resolveInput(detection.value);
    if (!resolution.ok) {
      throw new Error(resolution.error.message);
    }
    if (!isOdyseeResolution(resolution.value)) {
      throw new Error(`Expected Odysee resolution, received ${resolution.value.sourceType}.`);
    }

    const result = odyseeAdapter.normalizeCatalogPayload(resolution.value, odyseeRssFixture);

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error(result.error.message);
    }
    expect(result.value.creator).toMatchObject({
      sourceType: "odysee",
      sourceExternalId: "@fixture:abc123",
      displayName: "Fixture Owner",
      description: "Creator description with & entity.",
      imageUrl: "https://thumbs.odycdn.com/channel.png",
      canonicalUrl: "https://odysee.com/@fixture:abc123",
    });
    expect(result.value.feeds).toEqual([
      {
        sourceType: "odysee",
        sourceExternalId: "@fixture:abc123",
        url: "https://odysee.com/$/rss/@fixture:abc123",
        title: "Fixture Odysee Channel",
        description: "Creator description with & entity.",
        adapterMetadataJson: JSON.stringify({ format: "odysee-rss", channelClaim: "@fixture:abc123" }),
      },
    ]);
    expect(result.value.items).toHaveLength(1);

    const item = result.value.items[0];
    if (item === undefined) {
      throw new Error("Expected one normalized Odysee item.");
    }
    expect(item.contentItem).toMatchObject({
      sourceType: "odysee",
      sourceExternalId: "def456",
      title: "Fixture Odysee Video",
      description: "Long item description.\nSecond line.",
      contentType: "video",
      durationSeconds: 3723,
      thumbnailUrl: "https://thumbs.odycdn.com/video.png",
      canonicalUrl: "https://odysee.com/@fixture:abc123/fixture-video:def456",
    });
    expect(item.contentItem.publishedAt?.toISOString()).toBe("2026-05-15T12:30:00.000Z");
    expect(item.feedContent).toEqual({
      sourceExternalId: "def456",
      rawImportRef: "lbry://@fixture:abc123/fixture-video:def456",
    });
    expect(item.sources).toEqual([
      {
        sourceType: "odysee",
        sourceExternalId: "def456",
        nativeMediaUrl: "https://player.odycdn.com/api/v4/streams/free/fixture-video/def456.mp4",
        canonicalUrl: "https://odysee.com/@fixture:abc123/fixture-video:def456",
        priority: 0,
        metadataJson: JSON.stringify({ playback: "odysee-native-media", mediaType: "video/mp4" }),
      },
    ]);
  });
});

function isOdyseeDetection(value: DetectedSourceInput): value is DetectedSourceInput & { readonly sourceType: "odysee" } {
  return value.sourceType === "odysee";
}

function isOdyseeResolution(value: ResolvedSourceInput): value is ResolvedSourceInput & { readonly sourceType: "odysee" } {
  return value.sourceType === "odysee";
}
