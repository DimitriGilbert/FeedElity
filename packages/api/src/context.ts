import { auth } from "@FeedElity/auth";
import { db as appDb } from "@FeedElity/db";
import * as schema from "@FeedElity/db/schema";
import { eq } from "drizzle-orm";
import type { Context as HonoContext } from "hono";

import type { RepositoryDb } from "./repositories/catalog";

export type AccountState = (typeof schema.accountStateValues)[number];

export interface ContextUser {
  readonly id: string;
  readonly name: string;
  readonly email: string;
  readonly emailVerified: boolean;
  readonly image: string | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly accountState: AccountState;
}

export interface ContextSessionRecord {
  readonly id: string;
  readonly userId: string;
  readonly expiresAt: Date;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly ipAddress?: string | null;
  readonly userAgent?: string | null;
}

export interface AuthenticatedSession {
  readonly session: ContextSessionRecord;
  readonly user: ContextUser;
}

export interface Context {
  readonly db: RepositoryDb;
  readonly session: AuthenticatedSession | null;
}

export type CreateContextOptions = {
  context: HonoContext;
  db?: RepositoryDb;
};

export async function createContext({ context, db = appDb }: CreateContextOptions): Promise<Context> {
  const rawSession = await auth.api.getSession({
    headers: context.req.raw.headers,
  });

  if (rawSession === null) {
    return {
      db,
      session: null,
    };
  }

  const userRecord = await db.query.user.findFirst({
    where: eq(schema.user.id, rawSession.user.id),
  });

  if (userRecord === undefined) {
    return {
      db,
      session: null,
    };
  }

  return {
    db,
    session: {
      session: {
        id: rawSession.session.id,
        userId: rawSession.session.userId,
        expiresAt: rawSession.session.expiresAt,
        createdAt: rawSession.session.createdAt,
        updatedAt: rawSession.session.updatedAt,
        ipAddress: rawSession.session.ipAddress,
        userAgent: rawSession.session.userAgent,
      },
      user: {
        id: rawSession.user.id,
        name: rawSession.user.name,
        email: rawSession.user.email,
        emailVerified: rawSession.user.emailVerified,
        image: rawSession.user.image ?? null,
        createdAt: rawSession.user.createdAt,
        updatedAt: rawSession.user.updatedAt,
        accountState: userRecord.accountState,
      },
    },
  };
}
