import { ORPCError, os } from "@orpc/server";

import type { Context } from "./context";

export type * from "./domain/catalog";
export type * from "./domain/overlays";
export * from "./repositories/catalog";
export * from "./repositories/overlays";
export * from "./services/ingestion";
export * from "./services/refresh";
export * from "./sources";

export const o = os.$context<Context>();

export const publicProcedure = o;

const requireAuth = o.middleware(async ({ context, next }) => {
  if (!context.session?.user) {
    throw new ORPCError("UNAUTHORIZED");
  }
  if (context.session.user.accountState !== "active") {
    throw new ORPCError("FORBIDDEN");
  }
  return next({
    context: {
      db: context.db,
      session: context.session,
    },
  });
});

export const protectedProcedure = publicProcedure.use(requireAuth);
