import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { createDbConnection } from "@FeedElity/db/connection";
import { z } from "zod";

import { runStrapiExportMigration } from "../packages/api/src/migration/run-migration";
import { buildUnvalidatedStrapiExportFromOldMysqlRows } from "../packages/api/src/migration/old-mysql-export";
import type { OldStrapiMysqlRows } from "../packages/api/src/migration/old-mysql-export";

const outputPath = resolve(process.env.FEELITY_LEGACY_EXPORT_PATH ?? "./legacy-strapi-export.json");
const databaseUrl = process.env.DATABASE_URL ?? "file:./local.db";
const mysqlContainer = process.env.FEELITY_LEGACY_MYSQL_CONTAINER ?? "feedelityDB";
const mysqlUri = process.env.FEELITY_LEGACY_MYSQL_URI ?? "strapi:feedelity@localhost:3306/Feedelity";
const mode = process.env.FEELITY_LEGACY_IMPORT_MODE ?? "export-and-import";

interface QuerySpec<Key extends keyof OldStrapiMysqlRows> {
  readonly key: Key;
  readonly sql: string;
}

type PartialOldStrapiMysqlRows = {
  [Key in keyof OldStrapiMysqlRows]?: OldStrapiMysqlRows[Key];
};

const queries: readonly QuerySpec<keyof OldStrapiMysqlRows>[] = [
  { key: "users", sql: "SELECT id, username, email, provider, confirmed, blocked, created_at, updated_at FROM up_users ORDER BY id" },
  { key: "creators", sql: "SELECT id, name, description, created_at, updated_at FROM creators ORDER BY id" },
  { key: "creatorOptions", sql: "SELECT id, name, type, COALESCE(value, '') AS value, created_at, updated_at FROM creator_options WHERE EXISTS (SELECT 1 FROM creator_options_creator_links WHERE creator_option_id = creator_options.id) ORDER BY id" },
  { key: "creatorOptionCreatorLinks", sql: "SELECT creator_option_id, creator_id FROM creator_options_creator_links WHERE EXISTS (SELECT 1 FROM creator_options WHERE id = creator_option_id) AND EXISTS (SELECT 1 FROM creators WHERE id = creator_id) ORDER BY creator_option_id" },
  { key: "feeds", sql: "SELECT id, name, url, type, external_id, refreshed_at, created_at, updated_at FROM feeds WHERE external_id <> '' AND EXISTS (SELECT 1 FROM feeds_creator_links WHERE feed_id = feeds.id) ORDER BY id" },
  { key: "feedCreatorLinks", sql: "SELECT feed_id, creator_id FROM feeds_creator_links WHERE EXISTS (SELECT 1 FROM feeds WHERE id = feed_id AND external_id <> '') AND EXISTS (SELECT 1 FROM creators WHERE id = creator_id) ORDER BY feed_id" },
  { key: "feedOptions", sql: "SELECT id, name, type, COALESCE(value, '') AS value, created_at, updated_at FROM feed_options WHERE EXISTS (SELECT 1 FROM feed_options_feed_links JOIN feeds ON feeds.id = feed_options_feed_links.feed_id WHERE feed_option_id = feed_options.id AND feeds.external_id <> '') ORDER BY id" },
  { key: "feedOptionFeedLinks", sql: "SELECT feed_option_id, feed_id FROM feed_options_feed_links WHERE EXISTS (SELECT 1 FROM feed_options WHERE id = feed_option_id) AND EXISTS (SELECT 1 FROM feeds WHERE id = feed_id AND external_id <> '') ORDER BY feed_option_id" },
  { key: "feedContents", sql: "SELECT id, external_id, raw, created_at, updated_at FROM feed_contents WHERE EXISTS (SELECT 1 FROM feed_contents_feed_links JOIN feeds ON feeds.id = feed_contents_feed_links.feed_id WHERE feed_content_id = feed_contents.id AND feeds.external_id <> '') AND EXISTS (SELECT 1 FROM feed_contents_content_links JOIN creator_contents_creator_links ON creator_contents_creator_links.creator_content_id = feed_contents_content_links.creator_content_id WHERE feed_contents_content_links.feed_content_id = feed_contents.id) ORDER BY id" },
  { key: "feedContentFeedLinks", sql: "SELECT feed_content_id, feed_id FROM feed_contents_feed_links WHERE EXISTS (SELECT 1 FROM feed_contents WHERE id = feed_content_id) AND EXISTS (SELECT 1 FROM feed_contents_content_links WHERE feed_content_id = feed_contents_feed_links.feed_content_id) AND EXISTS (SELECT 1 FROM feeds WHERE id = feed_id AND external_id <> '') ORDER BY feed_content_id" },
  { key: "feedContentContentLinks", sql: "SELECT feed_content_id, creator_content_id AS content_id FROM feed_contents_content_links WHERE EXISTS (SELECT 1 FROM feed_contents WHERE id = feed_content_id) AND EXISTS (SELECT 1 FROM feed_contents_feed_links JOIN feeds ON feeds.id = feed_contents_feed_links.feed_id WHERE feed_content_id = feed_contents_content_links.feed_content_id AND feeds.external_id <> '') AND EXISTS (SELECT 1 FROM creator_contents_creator_links WHERE creator_content_id = feed_contents_content_links.creator_content_id) ORDER BY feed_content_id" },
  { key: "creatorContents", sql: "SELECT id, COALESCE(NULLIF(title, ''), CONCAT('Untitled legacy content ', id)) AS title, type, publication, data, created_at, updated_at FROM creator_contents WHERE EXISTS (SELECT 1 FROM creator_contents_creator_links WHERE creator_content_id = creator_contents.id) ORDER BY id" },
  { key: "creatorContentCreatorLinks", sql: "SELECT creator_content_id, creator_id FROM creator_contents_creator_links WHERE EXISTS (SELECT 1 FROM creator_contents WHERE id = creator_content_id) AND EXISTS (SELECT 1 FROM creators WHERE id = creator_id) ORDER BY creator_content_id" },
  { key: "contentOptions", sql: "SELECT id, name, type, COALESCE(value, '') AS value, created_at, updated_at FROM content_options WHERE EXISTS (SELECT 1 FROM content_options_content_links JOIN creator_contents_creator_links ON creator_contents_creator_links.creator_content_id = content_options_content_links.creator_content_id WHERE content_option_id = content_options.id) ORDER BY id" },
  { key: "contentOptionContentLinks", sql: "SELECT content_option_id, creator_content_id AS content_id FROM content_options_content_links WHERE EXISTS (SELECT 1 FROM content_options WHERE id = content_option_id) AND EXISTS (SELECT 1 FROM creator_contents_creator_links WHERE creator_content_id = content_options_content_links.creator_content_id) ORDER BY content_option_id" },
  { key: "subscriptions", sql: "SELECT id, created_at, updated_at FROM subscriptions WHERE EXISTS (SELECT 1 FROM subscriptions_user_links WHERE subscription_id = subscriptions.id) AND EXISTS (SELECT 1 FROM subscriptions_creator_links WHERE subscription_id = subscriptions.id) ORDER BY id" },
  { key: "subscriptionUserLinks", sql: "SELECT subscription_id, user_id FROM subscriptions_user_links WHERE EXISTS (SELECT 1 FROM subscriptions WHERE id = subscription_id) AND EXISTS (SELECT 1 FROM subscriptions_creator_links WHERE subscription_id = subscriptions_user_links.subscription_id) AND EXISTS (SELECT 1 FROM up_users WHERE id = user_id) ORDER BY subscription_id" },
  { key: "subscriptionCreatorLinks", sql: "SELECT subscription_id, creator_id FROM subscriptions_creator_links WHERE EXISTS (SELECT 1 FROM subscriptions WHERE id = subscription_id) AND EXISTS (SELECT 1 FROM subscriptions_user_links WHERE subscription_id = subscriptions_creator_links.subscription_id) AND EXISTS (SELECT 1 FROM creators WHERE id = creator_id) ORDER BY subscription_id" },
  { key: "subscriptionOptions", sql: "SELECT id, name, type, COALESCE(value, '') AS value, created_at, updated_at FROM subscription_options WHERE EXISTS (SELECT 1 FROM subscription_options_subscription_links WHERE subscription_option_id = subscription_options.id) ORDER BY id" },
  { key: "subscriptionOptionSubscriptionLinks", sql: "SELECT subscription_option_id, subscription_id FROM subscription_options_subscription_links WHERE EXISTS (SELECT 1 FROM subscription_options WHERE id = subscription_option_id) AND EXISTS (SELECT 1 FROM subscriptions WHERE id = subscription_id) ORDER BY subscription_option_id" },
  { key: "subscriptionContentOptions", sql: "SELECT id, name, type, COALESCE(value, '') AS value, created_at, updated_at FROM subscription_content_options WHERE EXISTS (SELECT 1 FROM subscription_content_options_subscription_links JOIN subscriptions_user_links ON subscriptions_user_links.subscription_id = subscription_content_options_subscription_links.subscription_id JOIN subscriptions_creator_links ON subscriptions_creator_links.subscription_id = subscription_content_options_subscription_links.subscription_id WHERE subscription_content_option_id = subscription_content_options.id) AND EXISTS (SELECT 1 FROM subscription_content_options_content_links JOIN creator_contents_creator_links ON creator_contents_creator_links.creator_content_id = subscription_content_options_content_links.creator_content_id WHERE subscription_content_option_id = subscription_content_options.id) ORDER BY id" },
  { key: "subscriptionContentOptionSubscriptionLinks", sql: "SELECT subscription_content_option_id, subscription_id FROM subscription_content_options_subscription_links WHERE EXISTS (SELECT 1 FROM subscription_content_options WHERE id = subscription_content_option_id) AND EXISTS (SELECT 1 FROM subscription_content_options_content_links WHERE subscription_content_option_id = subscription_content_options_subscription_links.subscription_content_option_id) AND EXISTS (SELECT 1 FROM subscriptions_user_links WHERE subscription_id = subscription_content_options_subscription_links.subscription_id) AND EXISTS (SELECT 1 FROM subscriptions_creator_links WHERE subscription_id = subscription_content_options_subscription_links.subscription_id) ORDER BY subscription_content_option_id" },
  { key: "subscriptionContentOptionContentLinks", sql: "SELECT subscription_content_option_id, creator_content_id AS content_id FROM subscription_content_options_content_links WHERE EXISTS (SELECT 1 FROM subscription_content_options WHERE id = subscription_content_option_id) AND EXISTS (SELECT 1 FROM subscription_content_options_subscription_links JOIN subscriptions_user_links ON subscriptions_user_links.subscription_id = subscription_content_options_subscription_links.subscription_id JOIN subscriptions_creator_links ON subscriptions_creator_links.subscription_id = subscription_content_options_subscription_links.subscription_id WHERE subscription_content_option_id = subscription_content_options_content_links.subscription_content_option_id) AND EXISTS (SELECT 1 FROM creator_contents_creator_links WHERE creator_content_id = subscription_content_options_content_links.creator_content_id) ORDER BY subscription_content_option_id" },
  { key: "playlists", sql: "SELECT id, name, description, created_at, updated_at FROM playlists WHERE EXISTS (SELECT 1 FROM playlists_user_links WHERE playlist_id = playlists.id) ORDER BY id" },
  { key: "playlistUserLinks", sql: "SELECT playlist_id, user_id FROM playlists_user_links WHERE EXISTS (SELECT 1 FROM playlists WHERE id = playlist_id) AND EXISTS (SELECT 1 FROM up_users WHERE id = user_id) ORDER BY playlist_id" },
  { key: "playlistContents", sql: "SELECT id, added AS Added, position, created_at, updated_at FROM playlist_contents WHERE EXISTS (SELECT 1 FROM playlist_contents_playlist_links WHERE playlist_content_id = playlist_contents.id) AND EXISTS (SELECT 1 FROM playlist_contents_content_links JOIN creator_contents_creator_links ON creator_contents_creator_links.creator_content_id = playlist_contents_content_links.creator_content_id WHERE playlist_content_id = playlist_contents.id) ORDER BY id" },
  { key: "playlistContentPlaylistLinks", sql: "SELECT playlist_content_id, playlist_id FROM playlist_contents_playlist_links WHERE EXISTS (SELECT 1 FROM playlist_contents WHERE id = playlist_content_id) AND EXISTS (SELECT 1 FROM playlist_contents_content_links WHERE playlist_content_id = playlist_contents_playlist_links.playlist_content_id) AND EXISTS (SELECT 1 FROM playlists WHERE id = playlist_id) ORDER BY playlist_content_id" },
  { key: "playlistContentContentLinks", sql: "SELECT playlist_content_id, creator_content_id AS content_id FROM playlist_contents_content_links WHERE EXISTS (SELECT 1 FROM playlist_contents WHERE id = playlist_content_id) AND EXISTS (SELECT 1 FROM playlist_contents_playlist_links WHERE playlist_content_id = playlist_contents_content_links.playlist_content_id) AND EXISTS (SELECT 1 FROM creator_contents_creator_links WHERE creator_content_id = playlist_contents_content_links.creator_content_id) ORDER BY playlist_content_id" },
];

function parseMysqlJsonRows(output: string): readonly Record<string, unknown>[] {
  const cleanOutput = stripAnsiEscapes(output);
  if (cleanOutput.trim().length === 0) {
    return [];
  }

  const start = cleanOutput.indexOf("[");
  const end = cleanOutput.lastIndexOf("]");
  if (start < 0 || end < start) {
    throw new Error(`mysqlsh did not return a JSON array: ${cleanOutput.slice(0, 200)}`);
  }

  const parsed: unknown = JSON.parse(cleanOutput.slice(start, end + 1));
  if (!Array.isArray(parsed) || !parsed.every(isJsonObject)) {
    throw new Error("mysqlsh returned malformed row JSON.");
  }

  return parsed;
}

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const auditRowSchema = z.object({
  id: z.number(),
  created_at: z.string().nullable().optional(),
  updated_at: z.string().nullable().optional(),
  published_at: z.string().nullable().optional(),
});

const optionRowSchema = auditRowSchema.extend({
  name: z.string(),
  type: z.string(),
  value: z.string(),
});

const collectionSchemas = {
  users: z.array(auditRowSchema.extend({
    username: z.string(),
    email: z.string(),
    provider: z.string(),
    confirmed: z.union([z.boolean(), z.literal(0), z.literal(1)]),
    blocked: z.union([z.boolean(), z.literal(0), z.literal(1)]),
  })),
  creators: z.array(auditRowSchema.extend({ name: z.string(), description: z.string().nullable() })),
  creatorOptions: z.array(optionRowSchema),
  creatorOptionCreatorLinks: z.array(z.object({ creator_option_id: z.number(), creator_id: z.number() })),
  feeds: z.array(auditRowSchema.extend({
    name: z.string(),
    url: z.string(),
    type: z.string(),
    external_id: z.string(),
    refreshed_at: z.string().nullable(),
  })),
  feedCreatorLinks: z.array(z.object({ feed_id: z.number(), creator_id: z.number() })),
  feedOptions: z.array(optionRowSchema),
  feedOptionFeedLinks: z.array(z.object({ feed_option_id: z.number(), feed_id: z.number() })),
  feedContents: z.array(auditRowSchema.extend({ external_id: z.string(), raw: z.string().nullable().optional() })),
  feedContentFeedLinks: z.array(z.object({ feed_content_id: z.number(), feed_id: z.number() })),
  feedContentContentLinks: z.array(z.object({ feed_content_id: z.number(), content_id: z.number() })),
  creatorContents: z.array(auditRowSchema.extend({
    title: z.string(),
    type: z.string(),
    publication: z.string().nullable(),
    data: z.string().nullable(),
  })),
  creatorContentCreatorLinks: z.array(z.object({ creator_content_id: z.number(), creator_id: z.number() })),
  contentOptions: z.array(optionRowSchema),
  contentOptionContentLinks: z.array(z.object({ content_option_id: z.number(), content_id: z.number() })),
  subscriptions: z.array(auditRowSchema),
  subscriptionUserLinks: z.array(z.object({ subscription_id: z.number(), user_id: z.number() })),
  subscriptionCreatorLinks: z.array(z.object({ subscription_id: z.number(), creator_id: z.number() })),
  subscriptionOptions: z.array(optionRowSchema),
  subscriptionOptionSubscriptionLinks: z.array(z.object({ subscription_option_id: z.number(), subscription_id: z.number() })),
  subscriptionContentOptions: z.array(optionRowSchema),
  subscriptionContentOptionSubscriptionLinks: z.array(z.object({ subscription_content_option_id: z.number(), subscription_id: z.number() })),
  subscriptionContentOptionContentLinks: z.array(z.object({ subscription_content_option_id: z.number(), content_id: z.number() })),
  playlists: z.array(auditRowSchema.extend({ name: z.string(), description: z.string().nullable() })),
  playlistUserLinks: z.array(z.object({ playlist_id: z.number(), user_id: z.number() })),
  playlistContents: z.array(auditRowSchema.extend({ Added: z.string().nullable(), position: z.number() })),
  playlistContentPlaylistLinks: z.array(z.object({ playlist_content_id: z.number(), playlist_id: z.number() })),
  playlistContentContentLinks: z.array(z.object({ playlist_content_id: z.number(), content_id: z.number() })),
} satisfies { readonly [Key in keyof OldStrapiMysqlRows]: z.ZodType<OldStrapiMysqlRows[Key]> };

const collectionParsers: { readonly [Key in keyof OldStrapiMysqlRows]: (rows: readonly Record<string, unknown>[]) => OldStrapiMysqlRows[Key] } = {
  users: (rows) => collectionSchemas.users.parse(rows),
  creators: (rows) => collectionSchemas.creators.parse(rows),
  creatorOptions: (rows) => collectionSchemas.creatorOptions.parse(rows),
  creatorOptionCreatorLinks: (rows) => collectionSchemas.creatorOptionCreatorLinks.parse(rows),
  feeds: (rows) => collectionSchemas.feeds.parse(rows),
  feedCreatorLinks: (rows) => collectionSchemas.feedCreatorLinks.parse(rows),
  feedOptions: (rows) => collectionSchemas.feedOptions.parse(rows),
  feedOptionFeedLinks: (rows) => collectionSchemas.feedOptionFeedLinks.parse(rows),
  feedContents: (rows) => collectionSchemas.feedContents.parse(rows),
  feedContentFeedLinks: (rows) => collectionSchemas.feedContentFeedLinks.parse(rows),
  feedContentContentLinks: (rows) => collectionSchemas.feedContentContentLinks.parse(rows),
  creatorContents: (rows) => collectionSchemas.creatorContents.parse(rows),
  creatorContentCreatorLinks: (rows) => collectionSchemas.creatorContentCreatorLinks.parse(rows),
  contentOptions: (rows) => collectionSchemas.contentOptions.parse(rows),
  contentOptionContentLinks: (rows) => collectionSchemas.contentOptionContentLinks.parse(rows),
  subscriptions: (rows) => collectionSchemas.subscriptions.parse(rows),
  subscriptionUserLinks: (rows) => collectionSchemas.subscriptionUserLinks.parse(rows),
  subscriptionCreatorLinks: (rows) => collectionSchemas.subscriptionCreatorLinks.parse(rows),
  subscriptionOptions: (rows) => collectionSchemas.subscriptionOptions.parse(rows),
  subscriptionOptionSubscriptionLinks: (rows) => collectionSchemas.subscriptionOptionSubscriptionLinks.parse(rows),
  subscriptionContentOptions: (rows) => collectionSchemas.subscriptionContentOptions.parse(rows),
  subscriptionContentOptionSubscriptionLinks: (rows) => collectionSchemas.subscriptionContentOptionSubscriptionLinks.parse(rows),
  subscriptionContentOptionContentLinks: (rows) => collectionSchemas.subscriptionContentOptionContentLinks.parse(rows),
  playlists: (rows) => collectionSchemas.playlists.parse(rows),
  playlistUserLinks: (rows) => collectionSchemas.playlistUserLinks.parse(rows),
  playlistContents: (rows) => collectionSchemas.playlistContents.parse(rows),
  playlistContentPlaylistLinks: (rows) => collectionSchemas.playlistContentPlaylistLinks.parse(rows),
  playlistContentContentLinks: (rows) => collectionSchemas.playlistContentContentLinks.parse(rows),
};

function stripAnsiEscapes(output: string): string {
  return output.replace(/\u001b\[[0-9;?]*[ -/]*[@-~]/g, "");
}

function readRows<Key extends keyof OldStrapiMysqlRows>(query: QuerySpec<Key>): OldStrapiMysqlRows[Key] {
  const result = Bun.spawnSync([
    "docker",
    "exec",
    mysqlContainer,
    "mysqlsh",
    "--sql",
    "--result-format=json/array",
    "--uri",
    mysqlUri,
    "-e",
    query.sql,
  ], {
    stdout: "pipe",
    stderr: "pipe",
  });

  if (!result.success) {
    throw new Error(`Legacy MySQL query failed: ${result.stderr.toString()}`);
  }

  const rows = parseMysqlJsonRows(result.stdout.toString());
  return validateRows(query.key, rows);
}

function validateRows<Key extends keyof OldStrapiMysqlRows>(
  key: Key,
  rows: readonly Record<string, unknown>[],
): OldStrapiMysqlRows[Key] {
  try {
    return collectionParsers[key](rows);
  } catch (error: unknown) {
    if (error instanceof z.ZodError) {
      throw new Error(`Legacy MySQL collection ${key} contained malformed rows: ${error.message}`);
    }
    throw error;
  }
}

async function main(): Promise<void> {
  if (mode === "import-only") {
    const exportData: unknown = JSON.parse(await readFile(outputPath, "utf8"));
    await importExportData(exportData);
    return;
  }

  const partialRows: PartialOldStrapiMysqlRows = {};
  for (const query of queries) {
    const rows = readRows(query);
    setCollection(partialRows, query.key, rows);
    console.log(`${query.key}: ${rows.length}`);
  }

  const rows = validateCompleteOldMysqlRows(partialRows);
  const exportData = buildUnvalidatedStrapiExportFromOldMysqlRows(rows, {
    exportedAt: new Date().toISOString(),
    strapiVersion: "4.25.9",
    sourceInstanceId: mysqlContainer,
  });

  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(exportData, null, 2)}\n`);
  console.log(`exported: ${outputPath}`);

  if (mode === "export-only") {
    return;
  }

  await importExportData(exportData);
}

async function importExportData(exportData: unknown): Promise<void> {
  const { client, db } = createDbConnection(databaseUrl);
  try {
    const report = await db.transaction((tx) => runStrapiExportMigration(tx, { exportData, sourceFilename: outputPath }));
    console.log(JSON.stringify({ status: report.status, counts: report.counts, warnings: report.warnings.length, failures: report.failures.length }, null, 2));
    if (report.failures.length > 0) {
      console.log(JSON.stringify(report.failures.slice(0, 20), null, 2));
    }
  } finally {
    client.close();
  }
}

function validateCompleteOldMysqlRows(
  partialRows: PartialOldStrapiMysqlRows,
): OldStrapiMysqlRows {
  const missingCollections = queries
    .map((query) => query.key)
    .filter((key) => partialRows[key] === undefined);

  if (missingCollections.length > 0) {
    throw new Error(`Legacy MySQL export is missing required collections: ${missingCollections.join(", ")}.`);
  }

  return {
    users: requiredCollection(partialRows, "users"),
    creators: requiredCollection(partialRows, "creators"),
    creatorOptions: requiredCollection(partialRows, "creatorOptions"),
    creatorOptionCreatorLinks: requiredCollection(partialRows, "creatorOptionCreatorLinks"),
    feeds: requiredCollection(partialRows, "feeds"),
    feedCreatorLinks: requiredCollection(partialRows, "feedCreatorLinks"),
    feedOptions: requiredCollection(partialRows, "feedOptions"),
    feedOptionFeedLinks: requiredCollection(partialRows, "feedOptionFeedLinks"),
    feedContents: requiredCollection(partialRows, "feedContents"),
    feedContentFeedLinks: requiredCollection(partialRows, "feedContentFeedLinks"),
    feedContentContentLinks: requiredCollection(partialRows, "feedContentContentLinks"),
    creatorContents: requiredCollection(partialRows, "creatorContents"),
    creatorContentCreatorLinks: requiredCollection(partialRows, "creatorContentCreatorLinks"),
    contentOptions: requiredCollection(partialRows, "contentOptions"),
    contentOptionContentLinks: requiredCollection(partialRows, "contentOptionContentLinks"),
    subscriptions: requiredCollection(partialRows, "subscriptions"),
    subscriptionUserLinks: requiredCollection(partialRows, "subscriptionUserLinks"),
    subscriptionCreatorLinks: requiredCollection(partialRows, "subscriptionCreatorLinks"),
    subscriptionOptions: requiredCollection(partialRows, "subscriptionOptions"),
    subscriptionOptionSubscriptionLinks: requiredCollection(partialRows, "subscriptionOptionSubscriptionLinks"),
    subscriptionContentOptions: requiredCollection(partialRows, "subscriptionContentOptions"),
    subscriptionContentOptionSubscriptionLinks: requiredCollection(partialRows, "subscriptionContentOptionSubscriptionLinks"),
    subscriptionContentOptionContentLinks: requiredCollection(partialRows, "subscriptionContentOptionContentLinks"),
    playlists: requiredCollection(partialRows, "playlists"),
    playlistUserLinks: requiredCollection(partialRows, "playlistUserLinks"),
    playlistContents: requiredCollection(partialRows, "playlistContents"),
    playlistContentPlaylistLinks: requiredCollection(partialRows, "playlistContentPlaylistLinks"),
    playlistContentContentLinks: requiredCollection(partialRows, "playlistContentContentLinks"),
  };
}

function requiredCollection<Key extends keyof OldStrapiMysqlRows>(
  partialRows: PartialOldStrapiMysqlRows,
  key: Key,
): OldStrapiMysqlRows[Key] {
  const rows = partialRows[key];
  if (rows === undefined) {
    throw new Error(`Legacy MySQL export is missing required collection: ${key}.`);
  }
  return rows;
}

function setCollection<Key extends keyof OldStrapiMysqlRows>(
  partialRows: PartialOldStrapiMysqlRows,
  key: Key,
  rows: OldStrapiMysqlRows[Key],
): void {
  partialRows[key] = rows;
}

await main();
