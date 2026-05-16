import type { RouterClient } from "@orpc/server";
import { z } from "zod";

import type { AuthenticatedSession } from "../context";
import { protectedProcedure, publicProcedure } from "../index";
import { listCatalogContentItems } from "../repositories/catalog";
import {
  listContentStatusesForUser,
  listPlaylistItemsForUserPlaylist,
  listPlaylistsForUser,
  listSubscriptionsForUser,
  listUserSettingsForUser,
} from "../repositories/overlays";

const playlistItemsInput = z.object({
  playlistId: z.string().min(1),
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
    contentItems: publicProcedure.handler(({ context }) => {
      return listCatalogContentItems(context.db);
    }),
  },
  overlays: {
    subscriptions: protectedProcedure.handler(({ context }) => {
      return listSubscriptionsForUser(context.db, context.session.user.id);
    }),
    contentStatuses: protectedProcedure.handler(({ context }) => {
      return listContentStatusesForUser(context.db, context.session.user.id);
    }),
    playlists: protectedProcedure.handler(({ context }) => {
      return listPlaylistsForUser(context.db, context.session.user.id);
    }),
    playlistItems: protectedProcedure.input(playlistItemsInput).handler(({ input, context }) => {
      return listPlaylistItemsForUserPlaylist(context.db, context.session.user.id, input.playlistId);
    }),
    settings: protectedProcedure.handler(({ context }) => {
      return listUserSettingsForUser(context.db, context.session.user.id);
    }),
  },
};
export type AppRouter = typeof appRouter;
export type AppRouterClient = RouterClient<typeof appRouter>;
