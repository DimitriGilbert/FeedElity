import dotenv from "dotenv";
import { defineConfig } from "drizzle-kit";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

dotenv.config({
  path: resolve(dirname(fileURLToPath(import.meta.url)), "../../apps/server/.env"),
});

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error("DATABASE_URL must be set before running Drizzle database commands.");
}

export default defineConfig({
  schema: "./src/schema/index.ts",
  out: "./src/migrations",
  dialect: "turso",
  dbCredentials: {
    url: databaseUrl,
  },
});
