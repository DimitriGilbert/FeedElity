import { createContext, defaultSourceRegistry } from "@FeedElity/api/context";
import { appRouter } from "@FeedElity/api/routers/index";
import { recoverRunningRefreshRuns } from "@FeedElity/api/services/refresh";
import { auth } from "@FeedElity/auth";
import { db } from "@FeedElity/db";
import { env } from "@FeedElity/env/server";
import { OpenAPIHandler } from "@orpc/openapi/fetch";
import { OpenAPIReferencePlugin } from "@orpc/openapi/plugins";
import { onError } from "@orpc/server";
import { RPCHandler } from "@orpc/server/fetch";
import { ZodToJsonSchemaConverter } from "@orpc/zod/zod4";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";

export const app = new Hono();

export async function startRefreshRecovery(): Promise<void> {
  try {
    await recoverRunningRefreshRuns({
      db,
      sourceRegistry: defaultSourceRegistry,
      now: () => new Date(),
    });
  } catch (error: unknown) {
    console.error("Refresh recovery failed.", error);
  }
}

let refreshRecovery: Promise<void> | null = null;

export function ensureRefreshRecoveryStarted(): Promise<void> {
  if (refreshRecovery === null) {
    refreshRecovery = startRefreshRecovery();
  }

  return refreshRecovery;
}

app.use(logger());
app.use(
  "/*",
  cors({
    origin: env.CORS_ORIGIN,
    allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowHeaders: ["Content-Type", "Authorization"],
    credentials: true,
  }),
);

app.on(["POST", "GET"], "/api/auth/*", (c) => auth.handler(c.req.raw));

export const apiHandler = new OpenAPIHandler(appRouter, {
  plugins: [
    new OpenAPIReferencePlugin({
      schemaConverters: [new ZodToJsonSchemaConverter()],
    }),
  ],
  interceptors: [
    onError((error) => {
      console.error(error);
    }),
  ],
});

export const rpcHandler = new RPCHandler(appRouter, {
  interceptors: [
    onError((error) => {
      console.error(error);
    }),
  ],
});

app.use("/*", async (c, next) => {
  const context = await createContext({ context: c });

  const rpcResult = await rpcHandler.handle(c.req.raw, {
    prefix: "/rpc",
    context: context,
  });

  if (rpcResult.matched) {
    return c.newResponse(rpcResult.response.body, rpcResult.response);
  }

  const apiResult = await apiHandler.handle(c.req.raw, {
    prefix: "/api-reference",
    context: context,
  });

  if (apiResult.matched) {
    return c.newResponse(apiResult.response.body, apiResult.response);
  }

  await next();
});

app.get("/", (c) => {
  return c.text("OK");
});

export default {
  port: env.PORT,
  fetch: async (request: Request): Promise<Response> => {
    await ensureRefreshRecoveryStarted();
    return app.fetch(request);
  },
};
