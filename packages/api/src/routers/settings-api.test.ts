import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { createClient } from "@libsql/client";
import type { Client } from "@libsql/client";
import { call } from "@orpc/server";
import { drizzle } from "drizzle-orm/libsql";

import * as schema from "@FeedElity/db/schema";

import type { AccountState, Context } from "../context";
import type { RepositoryDb } from "../repositories/catalog";
import { saveUserSetting } from "../repositories/overlays";
import { createSourceAdapterRegistry } from "../sources";
import { appRouter } from "./index";

const testSourceRegistry = createSourceAdapterRegistry();

interface TestDatabase {
  readonly client: Client;
  readonly db: RepositoryDb;
}

let testDatabase: TestDatabase;

beforeEach(async () => {
  testDatabase = await createTestDatabase();
});

afterEach(() => {
  testDatabase.client.close();
});

describe("settings API", () => {
  test("authenticated users can list and upsert their persisted settings", async () => {
    await insertUser(testDatabase.db, "user-a", "user-a@example.test", "active");
    await insertUser(testDatabase.db, "user-b", "user-b@example.test", "active");
    await saveUserSetting(testDatabase.db, {
      userId: "user-b",
      key: "reader.layout",
      valueJson: JSON.stringify("spacious"),
    });

    const initialSettings = await call(appRouter.overlays.settings, undefined, {
      context: authenticatedContext(testDatabase.db, "user-a", "active"),
    });
    const originalSetting = await call(appRouter.overlays.saveSetting, {
      key: "reader.layout",
      value: "compact",
    }, { context: authenticatedContext(testDatabase.db, "user-a", "active") });
    const updatedSetting = await call(appRouter.overlays.saveSetting, {
      key: "reader.layout",
      value: "comfortable",
    }, { context: authenticatedContext(testDatabase.db, "user-a", "active") });
    const userASettings = await call(appRouter.overlays.settings, undefined, {
      context: authenticatedContext(testDatabase.db, "user-a", "active"),
    });
    const userBSettings = await call(appRouter.overlays.settings, undefined, {
      context: authenticatedContext(testDatabase.db, "user-b", "active"),
    });

    expect(initialSettings).toEqual([]);
    expect(updatedSetting.id).toBe(originalSetting.id);
    expect(userASettings).toHaveLength(1);
    expect(userASettings[0]).toMatchObject({
      id: originalSetting.id,
      userId: "user-a",
      key: "reader.layout",
      valueJson: JSON.stringify("comfortable"),
    });
    expect(JSON.stringify(userASettings)).not.toContain("spacious");
    expect(userBSettings).toHaveLength(1);
    expect(userBSettings[0]).toMatchObject({ userId: "user-b", valueJson: JSON.stringify("spacious") });
  });

  test("authenticated users can delete only their own settings by key", async () => {
    await insertUser(testDatabase.db, "user-a", "delete-a@example.test", "active");
    await insertUser(testDatabase.db, "user-b", "delete-b@example.test", "active");
    await call(appRouter.overlays.saveSetting, { key: "player.autoplay", value: "disabled" }, {
      context: authenticatedContext(testDatabase.db, "user-a", "active"),
    });

    const crossUserDelete = await call(appRouter.overlays.deleteSetting, { key: "player.autoplay" }, {
      context: authenticatedContext(testDatabase.db, "user-b", "active"),
    });
    const settingsAfterCrossUserDelete = await call(appRouter.overlays.settings, undefined, {
      context: authenticatedContext(testDatabase.db, "user-a", "active"),
    });
    const ownerDelete = await call(appRouter.overlays.deleteSetting, { key: "player.autoplay" }, {
      context: authenticatedContext(testDatabase.db, "user-a", "active"),
    });
    const secondOwnerDelete = await call(appRouter.overlays.deleteSetting, { key: "player.autoplay" }, {
      context: authenticatedContext(testDatabase.db, "user-a", "active"),
    });
    const finalSettings = await call(appRouter.overlays.settings, undefined, {
      context: authenticatedContext(testDatabase.db, "user-a", "active"),
    });

    expect(crossUserDelete).toEqual({ deleted: false });
    expect(settingsAfterCrossUserDelete).toHaveLength(1);
    expect(ownerDelete).toEqual({ deleted: true });
    expect(secondOwnerDelete).toEqual({ deleted: false });
    expect(finalSettings).toEqual([]);
  });

  test("settings procedures reject anonymous callers and invalid bounded input", async () => {
    await insertUser(testDatabase.db, "user-a", "validation@example.test", "active");

    await expect(
      call(appRouter.overlays.settings, undefined, { context: anonymousContext(testDatabase.db) }),
    ).rejects.toHaveProperty("code", "UNAUTHORIZED");
    await expect(
      call(appRouter.overlays.saveSetting, { key: "Reader Layout", value: "compact" }, {
        context: authenticatedContext(testDatabase.db, "user-a", "active"),
      }),
    ).rejects.toBeDefined();
    await expect(
      call(appRouter.overlays.saveSetting, { key: "reader.layout", value: "x".repeat(4_097) }, {
        context: authenticatedContext(testDatabase.db, "user-a", "active"),
      }),
    ).rejects.toBeDefined();
    await expect(
      call(appRouter.overlays.deleteSetting, { key: "../reader.layout" }, {
        context: authenticatedContext(testDatabase.db, "user-a", "active"),
      }),
    ).rejects.toBeDefined();
  });
});

function anonymousContext(db: RepositoryDb): Context {
  return {
    db,
    sourceRegistry: testSourceRegistry,
    session: null,
  };
}

function authenticatedContext(db: RepositoryDb, userId: string, accountState: AccountState): Context {
  const now = new Date("2026-01-01T00:00:00.000Z");
  return {
    db,
    sourceRegistry: testSourceRegistry,
    session: {
      session: {
        id: `session-${userId}`,
        userId,
        expiresAt: new Date("2026-01-02T00:00:00.000Z"),
        createdAt: now,
        updatedAt: now,
      },
      user: {
        id: userId,
        name: userId,
        email: `${userId}@example.test`,
        emailVerified: true,
        image: null,
        createdAt: now,
        updatedAt: now,
        accountState,
      },
    },
  };
}

async function insertUser(db: RepositoryDb, id: string, email: string, accountState: AccountState): Promise<void> {
  await db.insert(schema.user).values({
    id,
    name: id,
    email,
    emailVerified: true,
    accountState,
  });
}

async function createTestDatabase(): Promise<TestDatabase> {
  const client = createClient({ url: ":memory:" });
  const db = drizzle({ client, schema });

  await client.execute("PRAGMA foreign_keys = ON");
  for (const statement of schemaStatements) {
    await client.execute(statement);
  }

  return { client, db };
}

const schemaStatements = [
  `CREATE TABLE user (
    id TEXT PRIMARY KEY NOT NULL,
    name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    email_verified INTEGER NOT NULL DEFAULT 0,
    image TEXT,
    account_state TEXT NOT NULL DEFAULT 'active',
    created_at INTEGER NOT NULL DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)),
    updated_at INTEGER NOT NULL DEFAULT (cast(unixepoch('subsecond') * 1000 as integer))
  )`,
  `CREATE TABLE user_setting (
    id TEXT PRIMARY KEY NOT NULL,
    user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
    key TEXT NOT NULL,
    value_json TEXT NOT NULL,
    created_at INTEGER NOT NULL DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)),
    updated_at INTEGER NOT NULL DEFAULT (cast(unixepoch('subsecond') * 1000 as integer))
  )`,
  "CREATE UNIQUE INDEX user_setting_user_key_uidx ON user_setting (user_id, key)",
];
