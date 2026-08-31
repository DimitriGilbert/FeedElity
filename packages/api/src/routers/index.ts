import { ORPCError } from "@orpc/server";
import type { RouterClient } from "@orpc/server";
import { hashCredentialPassword } from "@FeedElity/auth/password";
import * as schema from "@FeedElity/db/schema";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import type { AuthenticatedSession } from "../context";
import { protectedProcedure, publicProcedure } from "../index";
import { runImportMigration } from "../migration/run-migration";
import type { RepositoryDb } from "../repositories/catalog";
import {
  getCatalogContentDetail,
  getCatalogContentItemById,
  getCatalogCreatorSummaryById,
  getCatalogFeedById,
  getRefreshRunById,
  listCatalogContentItems,
  listCatalogCreators,
  listCatalogFeedsForBrowsing,
  listRefreshFeedResultsWithFeedsForRun,
  listRefreshRuns,
} from "../repositories/catalog";
import {
  addCollectionMember,
  addPlaylistItem,
  createCollection,
  createPlaylist,
  deleteCollectionForUser,
  deletePlaylistForUser,
  deleteContentStatusForUser,
  deleteUserSettingForUser,
  findOrCreateContentStatus,
  getContentStatusForUser,
  getCollectionForUser,
  findOrCreateSubscription,
  getNextPlaylistItemPositionForUserPlaylist,
  getPlaylistForUser,
  getSubscriptionWithCreatorForUser,
  listCollectionMembersWithCreatorsForUserCollection,
  listCollectionsForUser,
  listCreatorUnreadForUser,
  listSubscribedContentItemsForUser,
  listContentStatusWithContentForUser,
  listContentStatusesForUser,
  listPlaylistItemsWithContentForUserPlaylist,
  listPlaylistsForUser,
  listSubscriptionsWithCreatorsForUser,
  listUserSettingsForUser,
  markAllCreatorsContentOpenedForUser,
  markCreatorContentOpenedForUser,
  removeCollectionMemberForUser,
  removePlaylistItemForUser,
  reorderPlaylistItemsForUser,
  saveUserSetting,
  toggleFavoriteContentStatusForUser,
  unsubscribeFromCreatorForUser,
  updateCollectionForUser,
  updatePlaylistForUser,
  upsertPlaybackPositionForUser,
} from "../repositories/overlays";
import {
  getCreatorMetadataRefreshStatus,
  startCreatorMetadataRefresh,
} from "../services/creator-metadata";
import { addSource, batchAddSources } from "../services/ingestion";
import { refreshAll, refreshCreator, refreshFeed, startRefreshAll } from "../services/refresh";

const playlistItemsInput = z.object({
  playlistId: z.string().min(1),
});

const playlistNameInput = z.string().trim().min(1).max(120);

const playlistDescriptionInput = z.string().trim().max(2_000).nullable().optional();

const playlistSortModeInput = z.enum(["manual", "published_at_desc", "published_at_asc", "added_at_desc", "added_at_asc"]);

const playlistPositionInput = z.number().int().min(0).max(1_000_000).optional();

const createPlaylistInput = z.object({
  name: playlistNameInput,
  description: playlistDescriptionInput,
  sortMode: playlistSortModeInput.optional(),
  position: playlistPositionInput,
});

const updatePlaylistInput = z.object({
  playlistId: z.string().min(1),
  name: playlistNameInput,
  description: playlistDescriptionInput,
  sortMode: playlistSortModeInput.optional(),
  position: playlistPositionInput,
});

const deletePlaylistInput = z.object({
  playlistId: z.string().min(1),
});

const addPlaylistItemInput = z.object({
  playlistId: z.string().min(1),
  contentItemId: z.string().min(1),
});

const removePlaylistItemInput = z.object({
  playlistId: z.string().min(1),
  playlistItemId: z.string().min(1),
});

const reorderPlaylistItemsInput = z.object({
  playlistId: z.string().min(1),
  playlistItemIds: z.array(z.string().min(1)).max(500),
});

const collectionNameInput = z.string().trim().min(1).max(120);

const collectionDescriptionInput = z.string().trim().max(2_000).nullable().optional();

const collectionPositionInput = z.number().int().min(0).max(1_000_000).optional();

const createCollectionInput = z.object({
  name: collectionNameInput,
  description: collectionDescriptionInput,
  position: collectionPositionInput,
});

const updateCollectionInput = z.object({
  collectionId: z.string().min(1),
  name: collectionNameInput,
  description: collectionDescriptionInput,
  position: collectionPositionInput,
});

const deleteCollectionInput = z.object({
  collectionId: z.string().min(1),
});

const collectionMembersInput = z.object({
  collectionId: z.string().min(1),
});

const addCollectionMemberInput = z.object({
  collectionId: z.string().min(1),
  creatorId: z.string().min(1),
});

const removeCollectionMemberInput = z.object({
  collectionId: z.string().min(1),
  memberId: z.string().min(1),
});

const sourceTypeInput = z.enum(["youtube", "odysee", "peertube"]);

const boundedSearchInput = z.string().trim().min(1).max(120);

const catalogLimitInput = z.number().int().min(1).max(100).default(50);

const creatorListLimitInput = z.number().int().min(1).max(100).default(100);

const catalogOffsetInput = z.number().int().min(0).max(100_000).default(0);

const creatorListSortInput = z.enum(["name", "lastUpdate"]).default("name");

const creatorListInput = z
  .object({
    search: boundedSearchInput.optional(),
    sourceType: sourceTypeInput.optional(),
    limit: creatorListLimitInput,
    offset: catalogOffsetInput,
    sort: creatorListSortInput,
  })
  .optional();

const feedListInput = z
  .object({
    creatorId: z.string().min(1).optional(),
    sourceType: sourceTypeInput.optional(),
    limit: catalogLimitInput,
    offset: catalogOffsetInput,
  })
  .optional();

const contentListInput = z
  .object({
    search: boundedSearchInput.optional(),
    creatorId: z.string().min(1).optional(),
    feedId: z.string().min(1).optional(),
    collectionId: z.string().min(1).optional(),
    sourceType: sourceTypeInput.optional(),
    limit: catalogLimitInput,
    offset: catalogOffsetInput,
  })
  .optional();

const contentDetailInput = z.object({
  id: z.string().min(1),
});

const contentStatusInput = z.object({
  contentItemId: z.string().min(1),
});

const playbackSecondsInput = z.number().int().min(0).max(86_400);

const savePlaybackPositionInput = z.object({
  contentItemId: z.string().min(1),
  positionSeconds: playbackSecondsInput,
  durationSeconds: playbackSecondsInput.optional(),
});

const contentHistoryInput = z.object({
  status: z.enum(["opened", "played"]),
  limit: catalogLimitInput,
});

const subscriptionCreatorInput = z.object({
  creatorId: z.string().min(1),
});

const settingKeyInput = z.string().trim().min(1).max(64).regex(/^[a-z][a-z0-9._-]*$/);

const settingValueInput = z.string().max(4_096);

const saveSettingInput = z.object({
  key: settingKeyInput,
  value: settingValueInput,
});

const migrationImportInput = z.object({
  exportData: z.unknown(),
  sourceFilename: z.string().trim().min(1).max(255).nullable().optional(),
});

const addSourceInputValue = z.string().trim().min(1).max(2_048);

const addSourceInput = z.object({
  sourceInput: addSourceInputValue,
});

const batchAddSourcesInput = z.object({
  sourceInputs: z.array(addSourceInputValue).min(1).max(100),
});

const refreshRunInput = z.object({
  force: z.boolean().optional(),
});

const refreshCreatorInput = z.object({
  creatorId: z.string().min(1),
  force: z.boolean().optional(),
});

const refreshFeedInput = z.object({
  feedId: z.string().min(1),
  force: z.boolean().optional(),
});

const refreshStatusInput = z
  .object({
    runId: z.string().min(1).optional(),
    limit: z.number().int().min(1).max(20).default(5),
    feedResultsLimit: z.number().int().min(1).max(50).default(3),
  })
  .optional();

const deleteSettingInput = z.object({
  key: settingKeyInput,
});

type RefreshStatusRun = Awaited<ReturnType<typeof listRefreshRuns>>[number];

const migratedPasswordSetupInput = z.object({
  email: z.email().transform((email) => email.toLowerCase()),
  password: z.string().min(8).max(128),
  name: z.string().trim().min(2).max(120).optional(),
});

interface PublicSessionView {
  readonly session: {
    readonly id: string;
    readonly expiresAt: Date;
  };
  readonly user: {
    readonly id: string;
    readonly name: string;
    readonly email: string;
    readonly emailVerified: boolean;
    readonly image: string | null;
    readonly accountState: AuthenticatedSession["user"]["accountState"];
  };
}

function toPublicSessionView(session: AuthenticatedSession): PublicSessionView {
  return {
    session: {
      id: session.session.id,
      expiresAt: session.session.expiresAt,
    },
    user: {
      id: session.user.id,
      name: session.user.name,
      email: session.user.email,
      emailVerified: session.user.emailVerified,
      image: session.user.image,
      accountState: session.user.accountState,
    },
  };
}

async function setupMigratedPassword(
  db: RepositoryDb,
  input: z.infer<typeof migratedPasswordSetupInput>,
): Promise<{ readonly email: string }> {
  const user = await db.query.user.findFirst({ where: eq(schema.user.email, input.email) });
  if (user === undefined || user.accountState !== "migrated_pending_password_setup") {
    throw new ORPCError("NOT_FOUND");
  }

  const password = await hashCredentialPassword(input.password);
  const now = new Date();
  const existingCredentialAccount = await db.query.account.findFirst({
    where: and(eq(schema.account.providerId, "credential"), eq(schema.account.accountId, user.id)),
  });
  if (existingCredentialAccount === undefined) {
    await db
      .insert(schema.account)
      .values({
        id: crypto.randomUUID(),
        accountId: user.id,
        providerId: "credential",
        userId: user.id,
        password,
        createdAt: now,
        updatedAt: now,
      });
  } else {
    await db
      .update(schema.account)
      .set({ password, updatedAt: now })
      .where(eq(schema.account.id, existingCredentialAccount.id));
  }
  await db
    .update(schema.user)
    .set({
      accountState: "active",
      ...(input.name === undefined ? {} : { name: input.name }),
      updatedAt: now,
    })
    .where(eq(schema.user.id, user.id));

  return { email: input.email };
}

export const appRouter = {
  healthCheck: publicProcedure.handler(() => {
    return "OK";
  }),
  session: {
    current: publicProcedure.handler(({ context }) => {
      if (context.session === null) {
        return null;
      }
      return toPublicSessionView(context.session);
    }),
  },
  auth: {
    setupMigratedPassword: publicProcedure.input(migratedPasswordSetupInput).handler(({ input, context }) => {
      return setupMigratedPassword(context.db, input);
    }),
  },
  catalog: {
    creators: publicProcedure.input(creatorListInput).handler(({ input, context }) => {
      return listCatalogCreators(context.db, input ?? { limit: 100 });
    }),
    feeds: publicProcedure.input(feedListInput).handler(({ input, context }) => {
      return listCatalogFeedsForBrowsing(context.db, input ?? { limit: 50 });
    }),
    contentItems: publicProcedure.input(contentListInput).handler(({ input, context }) => {
      const collectionId = input?.collectionId;
      return listCatalogContentItems(context.db, {
        ...(input ?? { limit: 50 }),
        collectionUserId: collectionId === undefined ? undefined : context.session?.user.id,
      });
    }),
    contentDetail: publicProcedure.input(contentDetailInput).handler(async ({ input, context }) => {
      const detail = await getCatalogContentDetail(context.db, input.id);
      if (detail === null) {
        throw new ORPCError("NOT_FOUND");
      }
      return detail;
    }),
  },
  refresh: {
    status: publicProcedure.input(refreshStatusInput).handler(async ({ input, context }) => {
      const runLimit = input?.limit ?? 5;
      const feedResultsLimit = input?.feedResultsLimit ?? 3;
      let latestRun: RefreshStatusRun | null;
      let runs: readonly RefreshStatusRun[];

      if (input?.runId === undefined) {
        runs = await listRefreshRuns(context.db, { limit: runLimit });
        latestRun = runs.at(0) ?? null;
      } else {
        latestRun = await getRefreshRunById(context.db, input.runId);
        runs = latestRun === null ? [] : [latestRun];
      }

      return {
        latestRun,
        recentRuns: runs,
        latestFeedResults:
          latestRun === null
            ? []
            : await listRefreshFeedResultsWithFeedsForRun(context.db, { refreshRunId: latestRun.id, limit: feedResultsLimit }),
      };
    }),
    startAll: protectedProcedure.input(refreshRunInput).handler(async ({ input, context }) => {
      const started = await startRefreshAll(
        {
          db: context.db,
          sourceRegistry: context.sourceRegistry,
          now: () => new Date(),
          wait: sleep,
        },
        { force: input.force ?? false },
      );
      scheduleBackgroundRefresh(started.process);
      return { run: started.run, report: started.report };
    }),
    runAll: protectedProcedure.input(refreshRunInput).handler(({ input, context }) => {
      return refreshAll(
        {
          db: context.db,
          sourceRegistry: context.sourceRegistry,
          now: () => new Date(),
          wait: sleep,
        },
        { force: input.force ?? false },
      );
    }),
    runCreator: protectedProcedure.input(refreshCreatorInput).handler(async ({ input, context }) => {
      if ((await getCatalogCreatorSummaryById(context.db, input.creatorId)) === null) {
        throw new ORPCError("NOT_FOUND");
      }

      return refreshCreator(
        {
          db: context.db,
          sourceRegistry: context.sourceRegistry,
          now: () => new Date(),
          wait: sleep,
        },
        { creatorId: input.creatorId, force: input.force ?? false },
      );
    }),
    runFeed: protectedProcedure.input(refreshFeedInput).handler(async ({ input, context }) => {
      if ((await getCatalogFeedById(context.db, input.feedId)) === null) {
        throw new ORPCError("NOT_FOUND");
      }

      return refreshFeed(
        {
          db: context.db,
          sourceRegistry: context.sourceRegistry,
          now: () => new Date(),
          wait: sleep,
        },
        { feedId: input.feedId, force: input.force ?? false },
      );
    }),
  },
  creatorMetadata: {
    start: protectedProcedure.handler(({ context }) => {
      return startCreatorMetadataRefresh({
        db: context.db,
        sourceRegistry: context.sourceRegistry,
        now: () => new Date(),
      });
    }),
    status: protectedProcedure.handler(() => {
      return { run: getCreatorMetadataRefreshStatus() };
    }),
  },
  ingestion: {
    addSource: protectedProcedure.input(addSourceInput).handler(({ input, context }) => {
      return addSource(
        {
          db: context.db,
          sourceRegistry: context.sourceRegistry,
        },
        {
          sourceInput: input.sourceInput,
          userId: context.session.user.id,
        },
      );
    }),
    batchAddSources: protectedProcedure.input(batchAddSourcesInput).handler(({ input, context }) => {
      return batchAddSources(
        {
          db: context.db,
          sourceRegistry: context.sourceRegistry,
        },
        {
          sourceInputs: input.sourceInputs,
          userId: context.session.user.id,
        },
      );
    }),
  },
  overlays: {
    subscriptions: protectedProcedure.handler(({ context }) => {
      return listSubscriptionsWithCreatorsForUser(context.db, context.session.user.id);
    }),
    subscribedContentItems: protectedProcedure.input(contentListInput).handler(({ input, context }) => {
      return listSubscribedContentItemsForUser(context.db, {
        ...(input ?? { limit: 50 }),
        userId: context.session.user.id,
      });
    }),
    subscribeToCreator: protectedProcedure.input(subscriptionCreatorInput).handler(async ({ input, context }) => {
      if ((await getCatalogCreatorSummaryById(context.db, input.creatorId)) === null) {
        throw new ORPCError("NOT_FOUND");
      }

      await findOrCreateSubscription(context.db, {
        userId: context.session.user.id,
        creatorId: input.creatorId,
      });

      const subscription = await getSubscriptionWithCreatorForUser(
        context.db,
        context.session.user.id,
        input.creatorId,
      );
      if (subscription === null) {
        throw new ORPCError("INTERNAL_SERVER_ERROR");
      }

      return {
        subscription,
      };
    }),
    unsubscribeFromCreator: protectedProcedure.input(subscriptionCreatorInput).handler(async ({ input, context }) => {
      const creator = await getCatalogCreatorSummaryById(context.db, input.creatorId);
      if (creator === null) {
        throw new ORPCError("NOT_FOUND");
      }

      const unsubscribed = await unsubscribeFromCreatorForUser(context.db, context.session.user.id, input.creatorId);

      return {
        creator,
        unsubscribed,
      };
    }),
    unreadCounts: protectedProcedure.handler(({ context }) => {
      return listCreatorUnreadForUser(context.db, context.session.user.id);
    }),
    markCreatorContentOpened: protectedProcedure.input(subscriptionCreatorInput).handler(async ({ input, context }) => {
      if ((await getCatalogCreatorSummaryById(context.db, input.creatorId)) === null) {
        throw new ORPCError("NOT_FOUND");
      }
      if (
        (await getSubscriptionWithCreatorForUser(context.db, context.session.user.id, input.creatorId)) === null
      ) {
        throw new ORPCError("NOT_FOUND");
      }

      return markCreatorContentOpenedForUser(context.db, {
        userId: context.session.user.id,
        creatorId: input.creatorId,
        markedBeforeMs: Date.now(),
      });
    }),
    markAllContentOpened: protectedProcedure.handler(({ context }) => {
      return markAllCreatorsContentOpenedForUser(context.db, {
        userId: context.session.user.id,
        markedBeforeMs: Date.now(),
      });
    }),
    contentStatuses: protectedProcedure.handler(({ context }) => {
      return listContentStatusesForUser(context.db, context.session.user.id);
    }),
    markContentOpened: protectedProcedure.input(contentStatusInput).handler(async ({ input, context }) => {
      if ((await getCatalogContentItemById(context.db, input.contentItemId)) === null) {
        throw new ORPCError("NOT_FOUND");
      }

      const status = await findOrCreateContentStatus(context.db, {
        userId: context.session.user.id,
        contentItemId: input.contentItemId,
        status: "opened",
      });

      return { status };
    }),
    markContentPlayed: protectedProcedure.input(contentStatusInput).handler(async ({ input, context }) => {
      if ((await getCatalogContentItemById(context.db, input.contentItemId)) === null) {
        throw new ORPCError("NOT_FOUND");
      }

      const status = await findOrCreateContentStatus(context.db, {
        userId: context.session.user.id,
        contentItemId: input.contentItemId,
        status: "played",
      });

      return { status };
    }),
    savePlaybackPosition: protectedProcedure.input(savePlaybackPositionInput).handler(async ({ input, context }) => {
      if ((await getCatalogContentItemById(context.db, input.contentItemId)) === null) {
        throw new ORPCError("NOT_FOUND");
      }

      const status = await upsertPlaybackPositionForUser(context.db, {
        userId: context.session.user.id,
        contentItemId: input.contentItemId,
        positionSeconds: input.positionSeconds,
        durationSeconds: input.durationSeconds,
      });

      return { status };
    }),
    toggleContentOpened: protectedProcedure.input(contentStatusInput).handler(async ({ input, context }) => {
      if ((await getCatalogContentItemById(context.db, input.contentItemId)) === null) {
        throw new ORPCError("NOT_FOUND");
      }

      const existing = await getContentStatusForUser(context.db, context.session.user.id, input.contentItemId, "opened");
      if (existing !== null) {
        await deleteContentStatusForUser(context.db, context.session.user.id, input.contentItemId, "opened");
        return { opened: false, status: null };
      }

      const status = await findOrCreateContentStatus(context.db, {
        userId: context.session.user.id,
        contentItemId: input.contentItemId,
        status: "opened",
      });

      return { opened: true, status };
    }),
    toggleContentPlayed: protectedProcedure.input(contentStatusInput).handler(async ({ input, context }) => {
      if ((await getCatalogContentItemById(context.db, input.contentItemId)) === null) {
        throw new ORPCError("NOT_FOUND");
      }

      const existing = await getContentStatusForUser(context.db, context.session.user.id, input.contentItemId, "played");
      if (existing !== null) {
        await deleteContentStatusForUser(context.db, context.session.user.id, input.contentItemId, "played");
        return { played: false, status: null };
      }

      const status = await findOrCreateContentStatus(context.db, {
        userId: context.session.user.id,
        contentItemId: input.contentItemId,
        status: "played",
      });

      return { played: true, status };
    }),
    toggleContentFavorite: protectedProcedure.input(contentStatusInput).handler(async ({ input, context }) => {
      if ((await getCatalogContentItemById(context.db, input.contentItemId)) === null) {
        throw new ORPCError("NOT_FOUND");
      }

      return toggleFavoriteContentStatusForUser(context.db, context.session.user.id, input.contentItemId);
    }),
    favoriteContentItems: protectedProcedure.handler(async ({ context }) => {
      const favorites = await listContentStatusWithContentForUser(context.db, {
        userId: context.session.user.id,
        status: "favorite",
      });
      return favorites.map((favorite) => favorite.content);
    }),
    contentHistory: protectedProcedure.input(contentHistoryInput).handler(({ input, context }) => {
      return listContentStatusWithContentForUser(context.db, {
        userId: context.session.user.id,
        status: input.status,
        limit: input.limit,
      });
    }),
    playlists: protectedProcedure.handler(({ context }) => {
      return listPlaylistsForUser(context.db, context.session.user.id);
    }),
    createPlaylist: protectedProcedure.input(createPlaylistInput).handler(({ input, context }) => {
      return createPlaylist(context.db, {
        userId: context.session.user.id,
        name: input.name,
        description: input.description,
        sortMode: input.sortMode,
        position: input.position,
      });
    }),
    updatePlaylist: protectedProcedure.input(updatePlaylistInput).handler(async ({ input, context }) => {
      const playlist = await updatePlaylistForUser(context.db, {
        userId: context.session.user.id,
        playlistId: input.playlistId,
        name: input.name,
        description: input.description,
        sortMode: input.sortMode,
        position: input.position,
      });
      if (playlist === null) {
        throw new ORPCError("NOT_FOUND");
      }
      return playlist;
    }),
    deletePlaylist: protectedProcedure.input(deletePlaylistInput).handler(async ({ input, context }) => {
      return { deleted: await deletePlaylistForUser(context.db, context.session.user.id, input.playlistId) };
    }),
    playlistItems: protectedProcedure.input(playlistItemsInput).handler(({ input, context }) => {
      return listPlaylistItemsWithContentForUserPlaylist(context.db, context.session.user.id, input.playlistId);
    }),
    addPlaylistItem: protectedProcedure.input(addPlaylistItemInput).handler(async ({ input, context }) => {
      if ((await getPlaylistForUser(context.db, context.session.user.id, input.playlistId)) === null) {
        throw new ORPCError("NOT_FOUND");
      }
      if ((await getCatalogContentItemById(context.db, input.contentItemId)) === null) {
        throw new ORPCError("NOT_FOUND");
      }

      const position = await getNextPlaylistItemPositionForUserPlaylist(
        context.db,
        context.session.user.id,
        input.playlistId,
      );
      if (position === null) {
        throw new ORPCError("NOT_FOUND");
      }

      const playlistItem = await addPlaylistItem(context.db, {
        userId: context.session.user.id,
        playlistId: input.playlistId,
        contentItemId: input.contentItemId,
        position,
      });
      if (playlistItem === null) {
        throw new ORPCError("CONFLICT", { message: "Position already occupied in playlist" });
      }
      return playlistItem;
    }),
    removePlaylistItem: protectedProcedure.input(removePlaylistItemInput).handler(async ({ input, context }) => {
      return {
        removed: await removePlaylistItemForUser(
          context.db,
          context.session.user.id,
          input.playlistId,
          input.playlistItemId,
        ),
      };
    }),
    reorderPlaylistItems: protectedProcedure.input(reorderPlaylistItemsInput).handler(async ({ input, context }) => {
      const items = await reorderPlaylistItemsForUser(context.db, {
        userId: context.session.user.id,
        playlistId: input.playlistId,
        playlistItemIds: input.playlistItemIds,
      });
      if (items === null) {
        throw new ORPCError("NOT_FOUND");
      }
      return items;
    }),
    settings: protectedProcedure.handler(({ context }) => {
      return listUserSettingsForUser(context.db, context.session.user.id);
    }),
    saveSetting: protectedProcedure.input(saveSettingInput).handler(({ input, context }) => {
      return saveUserSetting(context.db, {
        userId: context.session.user.id,
        key: input.key,
        valueJson: JSON.stringify(input.value),
      });
    }),
    deleteSetting: protectedProcedure.input(deleteSettingInput).handler(async ({ input, context }) => {
      return { deleted: await deleteUserSettingForUser(context.db, context.session.user.id, input.key) };
    }),
    collections: protectedProcedure.handler(({ context }) => {
      return listCollectionsForUser(context.db, context.session.user.id);
    }),
    createCollection: protectedProcedure.input(createCollectionInput).handler(({ input, context }) => {
      return createCollection(context.db, {
        userId: context.session.user.id,
        name: input.name,
        description: input.description,
        position: input.position,
      });
    }),
    updateCollection: protectedProcedure.input(updateCollectionInput).handler(async ({ input, context }) => {
      const collection = await updateCollectionForUser(context.db, {
        userId: context.session.user.id,
        collectionId: input.collectionId,
        name: input.name,
        description: input.description,
        position: input.position,
      });
      if (collection === null) {
        throw new ORPCError("NOT_FOUND");
      }
      return collection;
    }),
    deleteCollection: protectedProcedure.input(deleteCollectionInput).handler(async ({ input, context }) => {
      return { deleted: await deleteCollectionForUser(context.db, context.session.user.id, input.collectionId) };
    }),
    collectionMembers: protectedProcedure.input(collectionMembersInput).handler(({ input, context }) => {
      return listCollectionMembersWithCreatorsForUserCollection(
        context.db,
        context.session.user.id,
        input.collectionId,
      );
    }),
    addCollectionMember: protectedProcedure.input(addCollectionMemberInput).handler(async ({ input, context }) => {
      if ((await getCollectionForUser(context.db, context.session.user.id, input.collectionId)) === null) {
        throw new ORPCError("NOT_FOUND");
      }
      if ((await getCatalogCreatorSummaryById(context.db, input.creatorId)) === null) {
        throw new ORPCError("NOT_FOUND");
      }

      return addCollectionMember(context.db, {
        userId: context.session.user.id,
        collectionId: input.collectionId,
        creatorId: input.creatorId,
      });
    }),
    removeCollectionMember: protectedProcedure.input(removeCollectionMemberInput).handler(async ({ input, context }) => {
      return {
        removed: await removeCollectionMemberForUser(
          context.db,
          context.session.user.id,
          input.collectionId,
          input.memberId,
        ),
      };
    }),
  },
  migration: {
    runImport: protectedProcedure.input(migrationImportInput).handler(({ input, context }) => {
      return runImportMigration(context.db, {
        exportData: input.exportData,
        sourceFilename: input.sourceFilename,
      });
    }),
  },
};
export type AppRouter = typeof appRouter;
export type AppRouterClient = RouterClient<typeof appRouter>;

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

function scheduleBackgroundRefresh(processRefresh: () => Promise<unknown>): void {
  setTimeout(() => {
    processRefresh().catch((error: unknown) => {
      console.error("Background refresh run failed.", error);
    });
  }, 0);
}
