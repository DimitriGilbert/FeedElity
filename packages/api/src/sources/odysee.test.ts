import { describe, expect, test } from "bun:test";

import { buildContentSources, odyseeAdapter } from "./odysee";
import type { CreatorMetadata, DetectedSourceInput, FetchCreatorMetadataInput, ResolvedSourceInput, SourceAdapterResult } from "./types";

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

// Same channel as odyseeRssFixture but the item carries no enclosure, which is
// how Odysee serves audio posts and some live replays.
const odyseeRssNoEnclosureFixture = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd" xmlns:content="http://purl.org/rss/1.0/modules/content/">
  <channel>
    <title>Fixture Odysee Channel</title>
    <link>https://odysee.com/@fixture:abc123</link>
    <description>Creator description.</description>
    <item>
      <guid isPermaLink="false">lbry://@fixture:abc123/fixture-embed:def789</guid>
      <title>Fixture Odysee Embed Video</title>
      <link>https://odysee.com/@fixture:abc123/fixture-embed:def789</link>
      <pubDate>Sat, 16 May 2026 12:30:00 GMT</pubDate>
      <description>Embed fallback description.</description>
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
      displayName: "Fixture Owner",
      description: "Creator description with & entity.",
      imageUrl: "https://thumbs.odycdn.com/channel.png",
      canonicalUrl: "https://odysee.com/@fixture:abc123",
    });
    expect(result.value.feeds).toEqual([
      {
        sourceType: "odysee",
        // The revision is stripped from the feed identity so two revisions of the
        // same channel share one feed; the fetch url keeps the resolved revision.
        sourceExternalId: "@fixture",
        url: "https://odysee.com/$/rss/@fixture:abc123",
        title: "Fixture Odysee Channel",
        description: "Creator description with & entity.",
        adapterMetadataJson: JSON.stringify({ format: "odysee-rss", channelClaim: "@fixture", resolvedClaim: "@fixture:abc123" }),
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

  test("canonicalizes the channel claim so two revisions share one feed identity", async () => {
    const revisionA = await resolveClaimPayload("@fixture:abc123");
    const revisionB = await resolveClaimPayload("@fixture:def456");
    // Two revisions of the same channel produce the same feed sourceExternalId,
    // so ingestion lands on one feed row instead of one per revision.
    expect(revisionA.feeds[0]?.sourceExternalId).toBe("@fixture");
    expect(revisionB.feeds[0]?.sourceExternalId).toBe("@fixture");
    // The fetch url keeps each resolved revision.
    expect(revisionA.feeds[0]?.url).toBe("https://odysee.com/$/rss/@fixture:abc123");
    expect(revisionB.feeds[0]?.url).toBe("https://odysee.com/$/rss/@fixture:def456");
  });

  test("normalizes an Odysee item without an enclosure into an embed playback source", async () => {
    const payload = await resolveClaimPayload("@fixture:abc123", odyseeRssNoEnclosureFixture);

    expect(payload.items).toHaveLength(1);
    const item = payload.items[0];
    if (item === undefined) {
      throw new Error("Expected one normalized Odysee item.");
    }
    expect(item.contentItem).toMatchObject({
      sourceType: "odysee",
      sourceExternalId: "def789",
      title: "Fixture Odysee Embed Video",
      canonicalUrl: "https://odysee.com/@fixture:abc123/fixture-embed:def789",
    });
    expect(item.sources).toEqual([
      {
        sourceType: "odysee",
        sourceExternalId: "def789",
        embedUrl: "https://odysee.com/$/embed/@fixture:abc123/fixture-embed:def789",
        canonicalUrl: "https://odysee.com/@fixture:abc123/fixture-embed:def789",
        priority: 0,
        metadataJson: JSON.stringify({ playback: "odysee-embed" }),
      },
    ]);
  });
});

describe("Odysee content source building", () => {
  test("keeps the native media source for items with an enclosure", () => {
    const sources = buildContentSources(
      "def456",
      "https://odysee.com/@fixture:abc123/fixture-video:def456",
      "https://player.odycdn.com/api/v4/streams/free/fixture-video/def456.mp4",
      "video/mp4",
    );

    expect(sources).toEqual([
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

  test("builds the odysee embed source from the canonical URL path when the enclosure is missing", () => {
    const sources = buildContentSources(
      "def789",
      "https://odysee.com/@fixture:abc123/fixture-embed:def789",
      null,
      null,
    );

    expect(sources).toEqual([
      {
        sourceType: "odysee",
        sourceExternalId: "def789",
        embedUrl: "https://odysee.com/$/embed/@fixture:abc123/fixture-embed:def789",
        canonicalUrl: "https://odysee.com/@fixture:abc123/fixture-embed:def789",
        priority: 0,
        metadataJson: JSON.stringify({ playback: "odysee-embed" }),
      },
    ]);
  });

  test("emits no source without throwing for a malformed canonical URL", () => {
    expect(buildContentSources("def789", "not a url", null, null)).toEqual([]);
  });

  test("emits no source without throwing for a non-odysee canonical URL", () => {
    expect(
      buildContentSources("def789", "https://mirror.example.test/@fixture/fixture-embed", null, null),
    ).toEqual([]);
  });

  test("emits no source without throwing for an http:// odysee canonical URL", () => {
    expect(
      buildContentSources("def012", "http://odysee.com/@fixture:abc123/fixture-embed:def012", null, null),
    ).toEqual([]);
  });
});

async function resolveClaimPayload(claim: string, payload: string = odyseeRssFixture) {
  const detection = odyseeAdapter.detect(`https://odysee.com/$/rss/${claim}`);
  if (!detection.ok || !isOdyseeDetection(detection.value)) {
    throw new Error(`Expected Odysee detection for ${claim}.`);
  }
  const resolution = await odyseeAdapter.resolveInput(detection.value);
  if (!resolution.ok || !isOdyseeResolution(resolution.value)) {
    throw new Error(`Expected Odysee resolution for ${claim}.`);
  }
  const result = odyseeAdapter.normalizeCatalogPayload(resolution.value, payload);
  if (!result.ok) {
    throw new Error(`Expected normalization to succeed for ${claim}.`);
  }
  return result.value;
}

function isOdyseeDetection(value: DetectedSourceInput): value is DetectedSourceInput & { readonly sourceType: "odysee" } {
  return value.sourceType === "odysee";
}

function isOdyseeResolution(value: ResolvedSourceInput): value is ResolvedSourceInput & { readonly sourceType: "odysee" } {
  return value.sourceType === "odysee";
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
  input: FetchCreatorMetadataInput & { readonly sourceType: "odysee" },
): Promise<SourceAdapterResult<CreatorMetadata>> {
  if (odyseeAdapter.fetchCreatorMetadata === undefined) {
    throw new Error("Odysee adapter does not implement fetchCreatorMetadata.");
  }
  return odyseeAdapter.fetchCreatorMetadata(input);
}

describe("Odysee source adapter creator metadata", () => {
  const odyseeMetadataFixture = `<?xml version="1.0" encoding="UTF-8"?>
<rss xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd" version="2.0">
  <channel>
    <title>Fixture Odysee Channel</title>
    <description>Fixture Odysee channel description.</description>
    <link>https://odysee.com/@fixture:5</link>
    <image>
      <url>https://broker.example.test/avatar/fixture.png</url>
    </image>
    <itunes:owner>
      <itunes:name>Fixture Odysee Owner</itunes:name>
    </itunes:owner>
    <item>
      <guid>lbry://@fixture:5/fixture-video:7</guid>
      <title>Fixture Video</title>
    </item>
  </channel>
</rss>`;

  test("re-fetches the feed and extracts channel image, owner name, and description", async () => {
    const stub = installFetchStub(() => new Response(odyseeMetadataFixture, { status: 200 }));
    try {
      const result = await callFetchCreatorMetadata({
        sourceType: "odysee",
        sourceExternalId: "@fixture",
        feedUrl: "https://odysee.com/$/rss/@fixture:5",
      });

      expect(result.ok).toBe(true);
      if (!result.ok) {
        throw new Error(result.error.message);
      }
      expect(stub.requestedUrls).toEqual(["https://odysee.com/$/rss/@fixture:5"]);
      expect(result.value).toEqual({
        displayName: "Fixture Odysee Owner",
        imageUrl: "https://broker.example.test/avatar/fixture.png",
        description: "Fixture Odysee channel description.",
        canonicalUrl: "https://odysee.com/@fixture:5",
      });
    } finally {
      stub.restore();
    }
  });

  test("returns unset fields on a failed feed fetch", async () => {
    const stub = installFetchStub(() => {
      throw new Error("network down");
    });
    try {
      const result = await callFetchCreatorMetadata({
        sourceType: "odysee",
        sourceExternalId: "@fixture",
        feedUrl: "https://odysee.com/$/rss/@fixture:5",
      });

      expect(result.ok).toBe(true);
      if (!result.ok) {
        throw new Error(result.error.message);
      }
      expect(result.value).toEqual({});
    } finally {
      stub.restore();
    }
  });

  test("returns unset fields when the payload is not valid RSS", async () => {
    const stub = installFetchStub(() => new Response("not xml", { status: 200 }));
    try {
      const result = await callFetchCreatorMetadata({
        sourceType: "odysee",
        sourceExternalId: "@fixture",
        feedUrl: "https://odysee.com/$/rss/@fixture:5",
      });

      expect(result.ok).toBe(true);
      if (!result.ok) {
        throw new Error(result.error.message);
      }
      expect(result.value).toEqual({});
    } finally {
      stub.restore();
    }
  });
});
