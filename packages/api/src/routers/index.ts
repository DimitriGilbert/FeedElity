import { ORPCError } from "@orpc/server";
import type { RouterClient } from "@orpc/server";
import { z } from "zod";

import type { AuthenticatedSession } from "../context";
import { protectedProcedure, publicProcedure } from "../index";
import { runImportMigration } from "../migration/run-migration";
import {
  getCatalogContentDetail,
  getCatalogContentItemById,
  getCatalogCreatorSummaryById,
  getCatalogFeedById,
  listCatalogContentItems,
  listCatalogCreators,
  listCatalogFeedsForBrowsing,
  listRefreshFeedResultsWithFeedsForRun,
  listRefreshRuns,
} from "../repositories/catalog";
import {
  addPlaylistItem,
  createPlaylist,
  deletePlaylistForUser,
  deleteUserSettingForUser,
  findOrCreateContentStatus,
  findOrCreateSubscription,
  getNextPlaylistItemPositionForUserPlaylist,
  getPlaylistForUser,
  getSubscriptionWithCreatorForUser,
  listSubscribedContentItemsForUser,
  listContentStatusWithContentForUser,
  listContentStatusesForUser,
  listPlaylistItemsWithContentForUserPlaylist,
  listPlaylistsForUser,
  listSubscriptionsWithCreatorsForUser,
  listUserSettingsForUser,
  removePlaylistItemForUser,
  reorderPlaylistItemsForUser,
  saveUserSetting,
  toggleFavoriteContentStatusForUser,
  unsubscribeFromCreatorForUser,
  updatePlaylistForUser,
} from "../repositories/overlays";
import { addSource, batchAddSources } from "../services/ingestion";
import { refreshAll, refreshCreator, refreshFeed } from "../services/refresh";
import { createSourceAdapterRegistry } from "../sources";

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

const sourceTypeInput = z.enum(["youtube", "odysee", "peertube"]);

const boundedSearchInput = z.string().trim().min(1).max(120);

const catalogLimitInput = z.number().int().min(1).max(100).default(50);

const catalogOffsetInput = z.number().int().min(0).max(100_000).default(0);

const creatorListInput = z
  .object({
    search: boundedSearchInput.optional(),
    sourceType: sourceTypeInput.optional(),
    limit: catalogLimitInput,
    offset: catalogOffsetInput,
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

const contentHistoryInput = z.object({
  status: z.enum(["opened", "played"]),
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
    limit: z.number().int().min(1).max(20).default(5),
    feedResultsLimit: z.number().int().min(1).max(50).default(3),
  })
  .optional();

const deleteSettingInput = z.object({
  key: settingKeyInput,
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
  catalog: {
    creators: publicProcedure.input(creatorListInput).handler(({ input, context }) => {
      return listCatalogCreators(context.db, input ?? { limit: 50 });
    }),
    feeds: publicProcedure.input(feedListInput).handler(({ input, context }) => {
      return listCatalogFeedsForBrowsing(context.db, input ?? { limit: 50 });
    }),
    contentItems: publicProcedure.input(contentListInput).handler(({ input, context }) => {
      return listCatalogContentItems(context.db, input ?? { limit: 50 });
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
      const runs = await listRefreshRuns(context.db, { limit: runLimit });
      const latestRun = runs.at(0) ?? null;
      return {
        latestRun,
        recentRuns: runs,
        latestFeedResults:
          latestRun === null
            ? []
            : await listRefreshFeedResultsWithFeedsForRun(context.db, { refreshRunId: latestRun.id, limit: feedResultsLimit }),
      };
    }),
    runAll: protectedProcedure.input(refreshRunInput).handler(({ input, context }) => {
      return refreshAll(
        {
          db: context.db,
          sourceRegistry: context.sourceRegistry ?? createSourceAdapterRegistry(),
          now: () => new Date(),
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
          sourceRegistry: context.sourceRegistry ?? createSourceAdapterRegistry(),
          now: () => new Date(),
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
          sourceRegistry: context.sourceRegistry ?? createSourceAdapterRegistry(),
          now: () => new Date(),
        },
        { feedId: input.feedId, force: input.force ?? false },
      );
    }),
  },
  ingestion: {
    addSource: protectedProcedure.input(addSourceInput).handler(({ input, context }) => {
      return addSource(
        {
          db: context.db,
          sourceRegistry: context.sourceRegistry ?? createSourceAdapterRegistry(),
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
          sourceRegistry: context.sourceRegistry ?? createSourceAdapterRegistry(),
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
    toggleContentFavorite: protectedProcedure.input(contentStatusInput).handler(async ({ input, context }) => {
      if ((await getCatalogContentItemById(context.db, input.contentItemId)) === null) {
        throw new ORPCError("NOT_FOUND");
      }

      return toggleFavoriteContentStatusForUser(context.db, context.session.user.id, input.contentItemId);
    }),
    favoriteContentItems: protectedProcedure.handler(async ({ context }) => {
      const favorites = await listContentStatusWithContentForUser(context.db, context.session.user.id, "favorite");
      return favorites.map((favorite) => favorite.content);
    }),
    contentHistory: protectedProcedure.input(contentHistoryInput).handler(({ input, context }) => {
      return listContentStatusWithContentForUser(context.db, context.session.user.id, input.status);
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

      return addPlaylistItem(context.db, {
        userId: context.session.user.id,
        playlistId: input.playlistId,
        contentItemId: input.contentItemId,
        position,
      });
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
