import { env } from "@FeedElity/env/server";

import { createDbConnection } from "./connection";

export { createDbConnection } from "./connection";

export function createDb() {
  return createDbConnection(env.DATABASE_URL).db;
}

export const db = createDb();
