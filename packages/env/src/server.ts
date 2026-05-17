import "dotenv/config";
import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";

import { absoluteHttpUrlSchema, serverRuntimeModeSchema } from "./runtime";

export const env = createEnv({
  server: {
    RUNTIME_MODE: serverRuntimeModeSchema.default("local"),
    DATABASE_URL: z.string().min(1),
    BETTER_AUTH_SECRET: z.string().min(32),
    BETTER_AUTH_URL: absoluteHttpUrlSchema,
    CORS_ORIGIN: z
      .string()
      .min(1)
      .transform((val) => val.split(",").map((s) => s.trim())),
    PORT: z.coerce.number().int().positive().default(3002),
    NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  },
  runtimeEnv: process.env,
  emptyStringAsUndefined: true,
});
