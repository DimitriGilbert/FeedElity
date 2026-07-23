import { createDb } from "@FeedElity/db";
import * as schema from "@FeedElity/db/schema/auth";
import { env } from "@FeedElity/env/server";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";

export function createAuth() {
  const db = createDb();

  return betterAuth({
    database: drizzleAdapter(db, {
      provider: "sqlite",

      schema: schema,
    }),
    trustedOrigins: env.CORS_ORIGIN,
    emailAndPassword: {
      enabled: true,
    },
    secret: env.BETTER_AUTH_SECRET,
    baseURL: env.BETTER_AUTH_URL,
    advanced: {
      // Force the cookie secure-prefix + Secure attribute off over HTTP (dev/LAN).
      // better-auth auto-detects from baseURL protocol, but set it explicitly so
      // the dev server never emits Secure cookies that the browser drops.
      useSecureCookies: env.NODE_ENV === "production",
      defaultCookieAttributes: {
        // Over plain HTTP (local/LAN dev) the browser drops Secure cookies, so
        // login silently fails. Only enforce Secure + SameSite=None in production
        // (HTTPS). Dev runs cross-origin over HTTP and needs lax, non-secure cookies.
        sameSite: env.NODE_ENV === "production" ? "none" : "lax",
        secure: env.NODE_ENV === "production",
        httpOnly: true,
      },
    },
    plugins: [],
  });
}

export const auth = createAuth();
