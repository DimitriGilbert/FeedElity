import { describe, expect, test } from "bun:test";

import { peertubeAdapter } from "./peertube";
import type { DetectedSourceInput, ResolvedSourceInput } from "./types";

const peertubeListFixture = {
  total: 1,
  data: [
    {
      id: 42,
      uuid: "9c9de5e8-0a1b-4c7a-9b4d-2b5b4a64f8f1",
      shortUUID: "pT9z7wTqVQ8mJ3U5aW6XyZ",
      name: "Fixture PeerTube Video",
      description: "Long PeerTube fixture description.",
      publishedAt: "2026-05-15T12:30:00.000Z",
      duration: 3723,
      thumbnailPath: "/static/thumbnails/fixture.jpg",
      embedPath: "/videos/embed/9c9de5e8-0a1b-4c7a-9b4d-2b5b4a64f8f1",
      url: "https://video.example.test/w/pT9z7wTqVQ8mJ3U5aW6XyZ",
      account: {
        name: "fixture",
        displayName: "Fixture Account",
        host: "video.example.test",
        url: "https://video.example.test/a/fixture",
        avatar: {
          path: "/lazy-static/avatars/account.png",
        },
      },
      channel: {
        name: "fixture_channel",
        displayName: "Fixture Channel",
        description: "Fixture channel description.",
        host: "video.example.test",
        url: "https://video.example.test/c/fixture_channel",
        avatar: {
          path: "/lazy-static/avatars/channel.png",
        },
      },
      files: [
        {
          fileUrl: "https://video.example.test/static/webseed/fixture-1080.mp4",
          resolution: { label: "1080p" },
          mimeType: "video/mp4",
        },
      ],
      streamingPlaylists: [
        {
          playlistUrl: "https://video.example.test/static/streaming-playlists/hls/fixture/master.m3u8",
          type: "hls",
        },
      ],
    },
  ],
};

describe("PeerTube source adapter detection", () => {
  test("detects video, account, channel, and instance URL forms", () => {
    const shortVideo = peertubeAdapter.detect("https://video.example.test/w/pT9z7wTqVQ8mJ3U5aW6XyZ");
    const uuidVideo = peertubeAdapter.detect("https://video.example.test/videos/watch/9c9de5e8-0a1b-4c7a-9b4d-2b5b4a64f8f1");
    const account = peertubeAdapter.detect("https://video.example.test/accounts/fixture");
    const channel = peertubeAdapter.detect("https://video.example.test/video-channels/fixture_channel");
    const instance = peertubeAdapter.detect("https://video.example.test/");

    expect(shortVideo.ok && shortVideo.value).toMatchObject({
      sourceType: "peertube",
      inputKind: "content-url",
      canonicalInput: "https://video.example.test/w/pT9z7wTqVQ8mJ3U5aW6XyZ",
    });
    expect(uuidVideo.ok && uuidVideo.value.canonicalInput).toBe(
      "https://video.example.test/w/9c9de5e8-0a1b-4c7a-9b4d-2b5b4a64f8f1",
    );
    expect(account.ok && account.value).toMatchObject({
      inputKind: "creator-url",
      canonicalInput: "https://video.example.test/a/fixture",
    });
    expect(channel.ok && channel.value).toMatchObject({
      inputKind: "creator-url",
      canonicalInput: "https://video.example.test/c/fixture_channel",
    });
    expect(instance.ok && instance.value).toMatchObject({
      inputKind: "unknown-url",
      canonicalInput: "https://video.example.test/",
    });
  });

  test("resolves detected URLs into PeerTube API resource hints without fetching", async () => {
    const detection = peertubeAdapter.detect("https://video.example.test/c/fixture_channel");
    if (!detection.ok) {
      throw new Error(detection.error.message);
    }
    if (!isPeerTubeDetection(detection.value)) {
      throw new Error(`Expected PeerTube detection, received ${detection.value.sourceType}.`);
    }

    const resolution = await peertubeAdapter.resolveInput(detection.value);

    expect(resolution.ok).toBe(true);
    if (!resolution.ok) {
      throw new Error(resolution.error.message);
    }
    expect(resolution.value).toEqual({
      sourceType: "peertube",
      sourceExternalId: "video.example.test/video-channels/fixture_channel",
      canonicalUrl: "https://video.example.test/api/v1/video-channels/fixture_channel/videos",
      title: "PeerTube channel fixture_channel",
    });
  });
});

describe("PeerTube source adapter normalization", () => {
  test("normalizes a PeerTube API list payload into catalog records with embed and native playback", async () => {
    const detection = peertubeAdapter.detect("https://video.example.test/c/fixture_channel");
    if (!detection.ok) {
      throw new Error(detection.error.message);
    }
    if (!isPeerTubeDetection(detection.value)) {
      throw new Error(`Expected PeerTube detection, received ${detection.value.sourceType}.`);
    }
    const resolution = await peertubeAdapter.resolveInput(detection.value);
    if (!resolution.ok) {
      throw new Error(resolution.error.message);
    }
    if (!isPeerTubeResolution(resolution.value)) {
      throw new Error(`Expected PeerTube resolution, received ${resolution.value.sourceType}.`);
    }

    const result = peertubeAdapter.normalizeCatalogPayload(resolution.value, JSON.stringify(peertubeListFixture));

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error(result.error.message);
    }
    expect(result.value.creator).toMatchObject({
      sourceType: "peertube",
      sourceExternalId: "video.example.test/video-channels/fixture_channel",
      displayName: "Fixture Channel",
      description: "Fixture channel description.",
      imageUrl: "https://video.example.test/lazy-static/avatars/channel.png",
      canonicalUrl: "https://video.example.test/c/fixture_channel",
    });
    expect(result.value.feeds).toEqual([
      {
        sourceType: "peertube",
        sourceExternalId: "video.example.test/video-channels/fixture_channel",
        url: "https://video.example.test/api/v1/video-channels/fixture_channel/videos",
        title: "Fixture Channel",
        description: "Fixture channel description.",
        adapterMetadataJson: JSON.stringify({ host: "video.example.test", resource: "video-channels", name: "fixture_channel" }),
      },
    ]);
    expect(result.value.items).toHaveLength(1);

    const item = result.value.items[0];
    if (item === undefined) {
      throw new Error("Expected one normalized PeerTube item.");
    }
    expect(item.contentItem).toMatchObject({
      sourceType: "peertube",
      sourceExternalId: "video.example.test/videos/9c9de5e8-0a1b-4c7a-9b4d-2b5b4a64f8f1",
      title: "Fixture PeerTube Video",
      description: "Long PeerTube fixture description.",
      contentType: "video",
      durationSeconds: 3723,
      thumbnailUrl: "https://video.example.test/static/thumbnails/fixture.jpg",
      canonicalUrl: "https://video.example.test/w/pT9z7wTqVQ8mJ3U5aW6XyZ",
    });
    expect(item.contentItem.publishedAt?.toISOString()).toBe("2026-05-15T12:30:00.000Z");
    expect(item.feedContent).toEqual({
      sourceExternalId: "video.example.test/videos/9c9de5e8-0a1b-4c7a-9b4d-2b5b4a64f8f1",
      rawImportRef: "https://video.example.test/api/v1/videos/9c9de5e8-0a1b-4c7a-9b4d-2b5b4a64f8f1",
    });
    expect(item.sources).toEqual([
      {
        sourceType: "peertube",
        sourceExternalId: "video.example.test/videos/9c9de5e8-0a1b-4c7a-9b4d-2b5b4a64f8f1",
        embedUrl: "https://video.example.test/videos/embed/9c9de5e8-0a1b-4c7a-9b4d-2b5b4a64f8f1",
        canonicalUrl: "https://video.example.test/w/pT9z7wTqVQ8mJ3U5aW6XyZ",
        priority: 0,
        metadataJson: JSON.stringify({ playback: "peertube-embed", host: "video.example.test" }),
      },
      {
        sourceType: "peertube",
        sourceExternalId: "video.example.test/videos/9c9de5e8-0a1b-4c7a-9b4d-2b5b4a64f8f1",
        nativeMediaUrl: "https://video.example.test/static/webseed/fixture-1080.mp4",
        canonicalUrl: "https://video.example.test/w/pT9z7wTqVQ8mJ3U5aW6XyZ",
        priority: 1,
        metadataJson: JSON.stringify({ playback: "peertube-native-media", mediaType: "video/mp4", host: "video.example.test" }),
      },
    ]);
  });
});

function isPeerTubeDetection(value: DetectedSourceInput): value is DetectedSourceInput & { readonly sourceType: "peertube" } {
  return value.sourceType === "peertube";
}

function isPeerTubeResolution(value: ResolvedSourceInput): value is ResolvedSourceInput & { readonly sourceType: "peertube" } {
  return value.sourceType === "peertube";
}
