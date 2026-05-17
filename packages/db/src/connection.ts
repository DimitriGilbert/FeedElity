import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";

import * as schema from "./schema";

export function createDbConnection(databaseUrl: string) {
  const client = createClient({
    url: databaseUrl,
  });

  return {
    client,
    db: drizzle({ client, schema }),
  };
}
