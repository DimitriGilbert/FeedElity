import { createDb } from "@FeedElity/db";
import * as schema from "@FeedElity/db/schema/auth";
import { env } from "@FeedElity/env/server";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";

// Cookie security must track whether the public base URL is served over HTTPS,
// not NODE_ENV. A self-hosted LAN stack runs production code over plain HTTP:
// forcing Secure cookies there makes the browser drop the session cookie, so
// sign-in returns 200 but the user stays logged out. HTTPS -> Secure + None
// (cross-site cookies need SameSite=None); HTTP -> lax, non-secure.
const secureCookies = env.BETTER_AUTH_URL.startsWith("https://");

export async function createAuth() {
  const db = await createDb();

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
      useSecureCookies: secureCookies,
      defaultCookieAttributes: {
        sameSite: secureCookies ? "none" : "lax",
        secure: secureCookies,
        httpOnly: true,
      },
    },
    plugins: [],
  });
}

export const auth = await createAuth();
