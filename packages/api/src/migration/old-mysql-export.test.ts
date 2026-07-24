import { describe, expect, test } from "bun:test";

import { strapiExportSchema } from "./strapi-export";
import { buildStrapiExportFromOldMysqlRows, buildUnvalidatedStrapiExportFromOldMysqlRows, type OldStrapiMysqlRows } from "./old-mysql-export";

const oldMysqlRowsFixture: OldStrapiMysqlRows = {
  users: [
    {
      id: 1,
      username: "fixture-user",
      email: "fixture@example.com",
      provider: "local",
      confirmed: true,
      blocked: false,
      created_at: "2024-01-01T00:00:00.000Z",
      updated_at: "2024-01-02T00:00:00.000Z",
    },
  ],
  creators: [
    {
      id: 10,
      name: "Fixture Creator",
      description: "Creator imported from the old Strapi catalog.",
      created_at: "2024-02-01T00:00:00.000Z",
      updated_at: "2024-02-02T00:00:00.000Z",
    },
  ],
  creatorOptions: [{ id: 11, name: "avatar", type: "image:url", value: "https://example.com/creator.png" }],
  creatorOptionCreatorLinks: [{ creator_option_id: 11, creator_id: 10 }],
  feeds: [
    {
      id: 20,
      name: "Fixture YouTube Feed",
      url: "https://www.youtube.com/feeds/videos.xml?channel_id=UCfixture0000000000",
      type: "youtube",
      external_id: "UCfixture0000000000",
      refreshed_at: "2026-05-15T08:30:00.000Z",
    },
  ],
  feedCreatorLinks: [{ feed_id: 20, creator_id: 10 }],
  feedOptions: [{ id: 21, name: "refreshDelayMinutes", type: "number", value: "120" }],
  feedOptionFeedLinks: [{ feed_option_id: 21, feed_id: 20 }],
  feedContents: [{ id: 30, external_id: "yt-fixture-video-1", raw: '{"id":"yt:video:yt-fixture-video-1"}' }],
  feedContentFeedLinks: [{ feed_content_id: 30, feed_id: 20 }],
  feedContentContentLinks: [{ feed_content_id: 30, content_id: 40 }],
  creatorContents: [
    {
      id: 40,
      title: "Fixture Video",
      type: "video:embed",
      publication: "2024-04-01T09:00:00.000Z",
      data: "Fixture description body.",
    },
  ],
  creatorContentCreatorLinks: [{ creator_content_id: 40, creator_id: 10 }],
  contentOptions: [
    { id: 41, name: "thumb", type: "image:url", value: "https://i.ytimg.com/vi/yt-fixture-video-1/hqdefault.jpg" },
    { id: 42, name: "source", type: "video:embed", value: "https://www.youtube-nocookie.com/embed/yt-fixture-video-1" },
    { id: 43, name: "duration", type: "number:seconds", value: "321" },
  ],
  contentOptionContentLinks: [
    { content_option_id: 41, content_id: 40 },
    { content_option_id: 42, content_id: 40 },
    { content_option_id: 43, content_id: 40 },
  ],
  subscriptions: [{ id: 50 }],
  subscriptionUserLinks: [{ subscription_id: 50, user_id: 1 }],
  subscriptionCreatorLinks: [{ subscription_id: 50, creator_id: 10 }],
  subscriptionOptions: [{ id: 51, name: "notify", type: "boolean", value: "1" }],
  subscriptionOptionSubscriptionLinks: [{ subscription_option_id: 51, subscription_id: 50 }],
  subscriptionContentOptions: [
    { id: 60, name: "open", type: "status", value: "1" },
    { id: 61, name: "played", type: "status", value: "1" },
    { id: 62, name: "favorite", type: "status", value: "1" },
  ],
  subscriptionContentOptionSubscriptionLinks: [
    { subscription_content_option_id: 60, subscription_id: 50 },
    { subscription_content_option_id: 61, subscription_id: 50 },
    { subscription_content_option_id: 62, subscription_id: 50 },
  ],
  subscriptionContentOptionContentLinks: [
    { subscription_content_option_id: 60, content_id: 40 },
    { subscription_content_option_id: 61, content_id: 40 },
    { subscription_content_option_id: 62, content_id: 40 },
  ],
  playlists: [{ id: 70, name: "Watch Later", description: "Old Strapi playlist fixture." }],
  playlistUserLinks: [{ playlist_id: 70, user_id: 1 }],
  playlistContents: [{ id: 71, Added: "2024-07-01T00:30:00.000Z", position: 0 }],
  playlistContentPlaylistLinks: [{ playlist_content_id: 71, playlist_id: 70 }],
  playlistContentContentLinks: [{ playlist_content_id: 71, content_id: 40 }],
};

describe("old Strapi MySQL row export helper", () => {
  test("transforms old table-shaped rows into the validated deterministic Strapi export shape", () => {
    const exportData = buildStrapiExportFromOldMysqlRows(oldMysqlRowsFixture, {
      exportedAt: "2026-05-16T12:00:00.000Z",
      sourceInstanceId: "fixture-old-feedlity-local",
      strapiVersion: "4.25.0",
    });

    const result = strapiExportSchema.safeParse(exportData);

    expect(result.success).toBe(true);
    if (!result.success) {
      throw new Error(result.error.message);
    }
    expect(result.data.metadata.fingerprintInputs.collectionNames).toEqual([
      "users",
      "creators",
      "creator_options",
      "feeds",
      "feed_options",
      "feed_contents",
      "creator_contents",
      "content_options",
      "subscriptions",
      "subscription_options",
      "subscription_content_options",
      "playlists",
      "playlist_contents",
    ]);
    expect(result.data.feeds[0]?.creatorId).toBe(10);
    expect(result.data.feedContents[0]).toEqual(
      expect.objectContaining({ oldId: 30, feedId: 20, contentId: 40, externalId: "yt-fixture-video-1" }),
    );
    expect(result.data.subscriptionContentOptions.map((option) => option.interpretedStatus)).toEqual([
      { statusName: "open", active: true },
      { statusName: "played", active: true },
      { statusName: "favorite", active: true },
    ]);
  });

  test("rejects malformed old relationship rows before an export can be imported", () => {
    const malformedRows: OldStrapiMysqlRows = {
      ...oldMysqlRowsFixture,
      feedContentContentLinks: [{ feed_content_id: 30, content_id: 999 }],
    };

    expect(() =>
      buildStrapiExportFromOldMysqlRows(malformedRows, {
        exportedAt: "2026-05-16T12:00:00.000Z",
        sourceInstanceId: "fixture-old-feedlity-local",
        strapiVersion: "4.25.0",
      }),
    ).toThrow("feedContentContentLinks.content_id references missing creatorContents oldId 999.");
  });

  test("rejects dangling source ids in old relationship rows", () => {
    const malformedRows: OldStrapiMysqlRows = {
      ...oldMysqlRowsFixture,
      feedCreatorLinks: [{ feed_id: 999, creator_id: 10 }],
    };

    expect(() =>
      buildStrapiExportFromOldMysqlRows(malformedRows, {
        exportedAt: "2026-05-16T12:00:00.000Z",
        sourceInstanceId: "fixture-old-feedlity-local",
        strapiVersion: "4.25.0",
      }),
    ).toThrow("feedCreatorLinks.feed_id references missing feeds oldId 999.");
  });

  test("rejects dangling target ids in old relationship rows", () => {
    const malformedRows: OldStrapiMysqlRows = {
      ...oldMysqlRowsFixture,
      feedCreatorLinks: [{ feed_id: 20, creator_id: 999 }],
    };

    expect(() =>
      buildStrapiExportFromOldMysqlRows(malformedRows, {
        exportedAt: "2026-05-16T12:00:00.000Z",
        sourceInstanceId: "fixture-old-feedlity-local",
        strapiVersion: "4.25.0",
      }),
    ).toThrow("feedCreatorLinks.creator_id references missing creators oldId 999.");
  });

  test("recovers the YouTube channel id from feeds.url when external_id is empty", () => {
    // The old Strapi catalog stored 274 YouTube feeds with an empty external_id
    // even though feeds.url held the full RSS URL. The shaper must recover the
    // channel id from the URL so these feeds are not dropped.
    const rowsWithEmptyExternalId: OldStrapiMysqlRows = {
      ...oldMysqlRowsFixture,
      feeds: [
        {
          id: 20,
          name: "youtube",
          url: "https://www.youtube.com/feeds/videos.xml?channel_id=UCBa659QWEk1AI4Tg--mrJ2A",
          type: "youtube",
          external_id: "",
          refreshed_at: "2026-05-15T08:30:00.000Z",
        },
      ],
    };

    const exportData = buildStrapiExportFromOldMysqlRows(rowsWithEmptyExternalId, {
      exportedAt: "2026-05-16T12:00:00.000Z",
      sourceInstanceId: "fixture-old-feedlity-local",
      strapiVersion: "4.25.0",
    });

    expect(exportData.feeds[0]?.externalId).toBe("UCBa659QWEk1AI4Tg--mrJ2A");
    expect(exportData.feeds[0]?.url).toBe("https://www.youtube.com/feeds/videos.xml?channel_id=UCBa659QWEk1AI4Tg--mrJ2A");
  });

  test("recovers the Odysee channel claim from feeds.url when external_id is empty", () => {
    const rowsWithEmptyExternalId: OldStrapiMysqlRows = {
      ...oldMysqlRowsFixture,
      feeds: [
        {
          id: 20,
          name: "odysee",
          url: "https://odysee.com/$/rss/@AlphaNerd:8",
          type: "odysee",
          external_id: "",
          refreshed_at: "2026-05-15T08:30:00.000Z",
        },
      ],
    };

    const exportData = buildStrapiExportFromOldMysqlRows(rowsWithEmptyExternalId, {
      exportedAt: "2026-05-16T12:00:00.000Z",
      sourceInstanceId: "fixture-old-feedlity-local",
      strapiVersion: "4.25.0",
    });

    expect(exportData.feeds[0]?.externalId).toBe("@AlphaNerd:8");
  });

  test("leaves external_id empty when the url carries no recoverable channel identity", () => {
    // A feed with neither an external_id nor a recognizable RSS url cannot be
    // recovered from MySQL alone; the shaped export leaves externalId empty,
    // which the export schema rejects, surfacing the feed as unimportable.
    const rowsWithUnrecoverableFeed: OldStrapiMysqlRows = {
      ...oldMysqlRowsFixture,
      feeds: [
        {
          id: 20,
          name: "youtube",
          url: "https://www.youtube.com/channel/unknown",
          type: "youtube",
          external_id: "",
          refreshed_at: "2026-05-15T08:30:00.000Z",
        },
      ],
    };

    const exportData = buildUnvalidatedStrapiExportFromOldMysqlRows(rowsWithUnrecoverableFeed, {
      exportedAt: "2026-05-16T12:00:00.000Z",
      sourceInstanceId: "fixture-old-feedlity-local",
      strapiVersion: "4.25.0",
    });

    expect(exportData.feeds[0]?.externalId).toBe("");
    expect(strapiExportSchema.safeParse(exportData).success).toBe(false);
  });

  test("does not alter a non-empty external_id even when the url looks recoverable", () => {
    const rowsWithExplicitExternalId: OldStrapiMysqlRows = {
      ...oldMysqlRowsFixture,
      feeds: [
        {
          id: 20,
          name: "youtube",
          url: "https://www.youtube.com/feeds/videos.xml?channel_id=UCBa659QWEk1AI4Tg--mrJ2A",
          type: "youtube",
          external_id: "@TomScott:1",
          refreshed_at: "2026-05-15T08:30:00.000Z",
        },
      ],
    };

    const exportData = buildStrapiExportFromOldMysqlRows(rowsWithExplicitExternalId, {
      exportedAt: "2026-05-16T12:00:00.000Z",
      sourceInstanceId: "fixture-old-feedlity-local",
      strapiVersion: "4.25.0",
    });

    expect(exportData.feeds[0]?.externalId).toBe("@TomScott:1");
  });
});
