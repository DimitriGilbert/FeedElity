import { env } from "@FeedElity/env/server";

import { createDbConnection } from "./connection";

export { createDbConnection } from "./connection";

export async function createDb() {
  const connection = await createDbConnection(env.DATABASE_URL);

  return connection.db;
}

export const db = await createDb();
