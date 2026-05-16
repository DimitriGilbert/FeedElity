import { describe, expect, test } from "bun:test";
import { getTableConfig } from "drizzle-orm/sqlite-core";

import { accountStateValues, user } from "./auth";

describe("auth schema", () => {
  test("users carry app-level account state for migrated password setup gating", () => {
    const columnNames = getTableConfig(user).columns.map((column) => column.name);

    expect(columnNames).toContain("account_state");
    expect(accountStateValues).toEqual(["active", "migrated_pending_password_setup"]);
  });
});
