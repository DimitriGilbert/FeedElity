import { describe, expect, test } from "bun:test";

import { validStrapiExportFixture } from "./strapi-export.fixtures";
import { strapiExportSchema } from "./strapi-export";
import type { StrapiExport } from "./strapi-export";

describe("Strapi export schema", () => {
  test("parses the deterministic fixture with every old collection needed by migration", () => {
    const result = strapiExportSchema.safeParse(validStrapiExportFixture);

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
    expect(result.data.subscriptionContentOptions.map((option) => option.interpretedStatus)).toEqual([
      { statusName: "open", active: true },
      { statusName: "played", active: true },
      { statusName: "favorite", active: true },
    ]);
  });

  test("rejects malformed exports before any write-capable migration stage receives them", () => {
    const subscription = validStrapiExportFixture.subscriptions[0];
    if (subscription === undefined) {
      throw new Error("Fixture must include one subscription for malformed reference testing.");
    }

    const malformedExport = {
      ...validStrapiExportFixture,
      subscriptions: [
        {
          ...subscription,
          userId: 999,
        },
      ],
    } satisfies StrapiExport;

    const result = strapiExportSchema.safeParse(malformedExport);

    expect(result.success).toBe(false);
    if (result.success) {
      throw new Error("Expected missing old user reference to fail validation.");
    }
    expect(result.error.issues).toContainEqual(
      expect.objectContaining({
        message: "subscriptions.userId references missing oldId 999.",
        path: ["subscriptions", 0, "userId"],
      }),
    );
  });

  test("rejects missing required export collections", () => {
    const exportWithoutPlaylists = {
      metadata: validStrapiExportFixture.metadata,
      users: validStrapiExportFixture.users,
      creators: validStrapiExportFixture.creators,
      creatorOptions: validStrapiExportFixture.creatorOptions,
      feeds: validStrapiExportFixture.feeds,
      feedOptions: validStrapiExportFixture.feedOptions,
      feedContents: validStrapiExportFixture.feedContents,
      creatorContents: validStrapiExportFixture.creatorContents,
      contentOptions: validStrapiExportFixture.contentOptions,
      subscriptions: validStrapiExportFixture.subscriptions,
      subscriptionOptions: validStrapiExportFixture.subscriptionOptions,
      subscriptionContentOptions: validStrapiExportFixture.subscriptionContentOptions,
      playlistContents: validStrapiExportFixture.playlistContents,
    };

    const result = strapiExportSchema.safeParse(exportWithoutPlaylists);

    expect(result.success).toBe(false);
    if (result.success) {
      throw new Error("Expected missing playlists collection to fail validation.");
    }
    expect(result.error.issues).toContainEqual(
      expect.objectContaining({
        path: ["playlists"],
      }),
    );
  });

  test("rejects duplicate playlist content positions with old record ids", () => {
    const playlistContent = validStrapiExportFixture.playlistContents[0];
    if (playlistContent === undefined) {
      throw new Error("Fixture must include one playlist content for duplicate position testing.");
    }
    const exportWithDuplicatePlaylistPosition: StrapiExport = {
      ...validStrapiExportFixture,
      playlistContents: [
        ...validStrapiExportFixture.playlistContents,
        { ...playlistContent, oldId: 72 },
      ],
    };

    const result = strapiExportSchema.safeParse(exportWithDuplicatePlaylistPosition);

    expect(result.success).toBe(false);
    if (result.success) {
      throw new Error("Expected duplicate playlist content position to fail validation.");
    }
    expect(result.error.issues).toContainEqual(
      expect.objectContaining({
        message: "playlistContents contains duplicate playlistId 70 position 0 for oldIds 71 and 72.",
        path: ["playlistContents", 1, "position"],
      }),
    );
  });
});
