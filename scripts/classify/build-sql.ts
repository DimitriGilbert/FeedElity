/**
 * Stage 3 — Build reviewable collection SQL from the subagent shards.
 *
 * Reads data/shard-*.json + data/creators.json, validates every creatorId
 * against the dump, dedupes memberships, and emits:
 *   - data/collections.sql        idempotent INSERT statements
 *   - data/collections.review.md  human-readable per-collection creator lists
 *
 * This script WRITES ONLY FILES. It executes no SQL and touches no database,
 * not even the test DB. The test-DB smoke check is verify-sql.ts (Stage 4).
 *
 * Usage:
 *   bun scripts/classify/build-sql.ts [--user <userId>]
 *
 * The --user value is the user_id the collections belong to. It defaults to a
 * placeholder token (:USER_ID) so the generated SQL is reviewable without a
 * real id; the user supplies their userId when applying.
 */

import { readFile, writeFile } from "node:fs/promises";
import { glob } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const dataDir = resolve(here, "data");

const args = parseArgs(Bun.argv);
const userIdToken = args.user ?? ":USER_ID";

// Fixed collection definitions: slug -> (human label, description, position).
// The id is stable so re-running the SQL is idempotent across reruns.
interface CollectionDef {
  readonly slug: string;
  readonly label: string;
  readonly description: string;
  readonly position: number;
}

const collections: readonly CollectionDef[] = [
  { slug: "science", label: "Science", description: "Natural sciences, math, space, medicine, climate.", position: 0 },
  { slug: "tech", label: "Tech", description: "Consumer tech, tech news, gadgets.", position: 1 },
  { slug: "computer", label: "Computer", description: "Hardware, systems, networking, Linux, self-hosting.", position: 2 },
  { slug: "dev+ai", label: "Dev + AI", description: "Software development and machine learning / AI.", position: 3 },
  { slug: "cars-bike-engine", label: "Cars / Bikes / Engines", description: "Vehicles, engines, motorsport, motorcycles.", position: 4 },
  { slug: "engineering", label: "Engineering", description: "Civil/mech/electrical engineering, robotics, maker builds.", position: 5 },
  { slug: "gaucho", label: "Gaucho", description: "Left-wing / progressive politics.", position: 6 },
  { slug: "droitarde", label: "Droitarde", description: "Right-wing / conservative politics.", position: 7 },
  { slug: "music", label: "Music", description: "Music creation, performance, reviews, theory.", position: 8 },
  { slug: "humor", label: "Humor", description: "Comedy, satire, entertainment-comedy.", position: 9 },
  { slug: "movies", label: "Movies", description: "Film criticism, cinema, movie industry.", position: 10 },
];

const allowedSlugs = new Set(collections.map((c) => c.slug));
const collectionId = (slug: string): string => `collection-${slug}`;

interface ShardEntry {
  readonly creatorId: string;
  readonly displayName: string;
  readonly collections: readonly string[];
  readonly reason: string;
}

interface DumpCreator {
  readonly id: string;
  readonly displayName: string;
  readonly sampleTitles: readonly string[];
}

function parseArgs(argv: readonly string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a?.startsWith("--")) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith("--")) {
        out[key] = next;
        i++;
      } else {
        out[key] = "true";
      }
    }
  }
  return out;
}

function sqlString(value: string): string {
  // Escape single quotes for SQL string literals.
  return `'${value.replace(/'/g, "''")}'`;
}

async function readJson<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(path, "utf-8")) as T;
}

async function main(): Promise<void> {
  const dump = await readJson<readonly DumpCreator[]>(resolve(dataDir, "creators.json"));
  const knownCreatorIds = new Set(dump.map((c) => c.id));
  const knownCreatorNameById = new Map(dump.map((c) => [c.id, c.displayName] as const));

  // Gather all shard files (sorted for deterministic output).
  const shardPaths = (await Array.fromAsync(glob(resolve(dataDir, "shard-*.json")))).sort();
  if (shardPaths.length === 0) {
    throw new Error("No data/shard-*.json files found. Run Stage 2 (subagent classification) first.");
  }

  const allEntries: ShardEntry[] = [];
  for (const path of shardPaths) {
    const entries = await readJson<readonly ShardEntry[]>(path);
    allEntries.push(...entries);
  }

  // Validate: every creatorId must exist in the dump; every slug must be allowed.
  const errors: string[] = [];
  for (const entry of allEntries) {
    if (!knownCreatorIds.has(entry.creatorId)) {
      errors.push(`Unknown creatorId in shard: ${entry.creatorId} (${entry.displayName})`);
    }
    for (const slug of entry.collections) {
      if (!allowedSlugs.has(slug)) {
        errors.push(`Unknown collection slug "${slug}" on ${entry.displayName} (${entry.creatorId})`);
      }
    }
  }
  if (errors.length > 0) {
    console.error(`Validation failed with ${errors.length} error(s):`);
    for (const e of errors.slice(0, 20)) {
      console.error(`  - ${e}`);
    }
    process.exit(1);
  }

  // Collapse duplicate channels: the same creator exists as multiple rows
  // (mirrors across YouTube/Odysee/PeerTube). A creator must appear at most
  // once. For each duplicated displayName, keep the row with the most content
  // titles (the richest feed = the one the user actually browses) and drop the
  // other ids from every assignment. Merge any collections the dropped rows had.
  const titleCountById = new Map<string, number>(
    dump.map((c) => [c.id, c.sampleTitles.length] as const),
  );
  // Pick the representative id per displayName: max titles, tiebreak by id.
  const representativeIdByName = new Map<string, string>();
  for (const c of dump) {
    const current = representativeIdByName.get(c.displayName);
    if (current === undefined || (titleCountById.get(c.id) ?? 0) > (titleCountById.get(current) ?? 0)) {
      representativeIdByName.set(c.displayName, c.id);
    }
  }
  const droppedIds = new Set<string>();
  let collapsedCount = 0;
  for (const c of dump) {
    if (representativeIdByName.get(c.displayName) !== c.id) {
      droppedIds.add(c.id);
      collapsedCount++;
    }
  }

  // Merge: for each displayName, union the collections of ALL its rows onto the
  // representative entry, then drop the non-representative rows entirely.
  const collectionsByName = new Map<string, Set<string>>();
  const reasonByName = new Map<string, string>();
  for (const entry of allEntries) {
    const set = collectionsByName.get(entry.displayName) ?? new Set<string>();
    for (const slug of entry.collections) {
      set.add(slug);
    }
    collectionsByName.set(entry.displayName, set);
    // Keep the first non-empty reason for the representative.
    if (!reasonByName.has(entry.displayName) && entry.reason.trim().length > 0) {
      reasonByName.set(entry.displayName, entry.reason.trim());
    }
  }

  // Rebuild a deduped entry list: one entry per displayName, on the representative id.
  const dedupedEntries: ShardEntry[] = [];
  for (const [name, slugs] of collectionsByName) {
    const repId = representativeIdByName.get(name);
    if (repId === undefined) {
      continue;
    }
    dedupedEntries.push({
      creatorId: repId,
      displayName: name,
      collections: [...slugs],
      reason: reasonByName.get(name) ?? "",
    });
  }
  // Preserve a stable order by displayName.
  dedupedEntries.sort((a, b) => a.displayName.localeCompare(b.displayName));

  // Build membership map: slug -> Set<creatorId>. One creator per collection max.
  const membersBySlug = new Map<string, Set<string>>();
  for (const c of collections) {
    membersBySlug.set(c.slug, new Set());
  }
  let assignedCount = 0;
  for (const entry of dedupedEntries) {
    if (entry.collections.length > 0) {
      assignedCount++;
    }
    for (const slug of entry.collections) {
      membersBySlug.get(slug)?.add(entry.creatorId);
    }
  }

  // --- Emit collections.sql ---
  const sqlLines: string[] = [
    "-- FeedElity collection import.",
    "-- Generated by scripts/classify/build-sql.ts. REVIEW BEFORE RUNNING.",
    `-- Targets ${assignedCount} of ${dedupedEntries.length} classified creators across ${collections.length} collections.`,
    `-- Creators are deduped by display name (one row per channel); ${collapsedCount} duplicate mirror rows collapsed.`,
    "-- Idempotent: uses ON CONFLICT DO NOTHING; safe to re-run.",
    "-- Replace :USER_ID with the owning user's id when applying.",
    "",
    "-- 1. Collections.",
  ];

  for (const c of collections) {
    sqlLines.push(
      `INSERT INTO creator_collection (id, user_id, name, description, position, created_at, updated_at) VALUES (${sqlString(collectionId(c.slug))}, ${sqlString(userIdToken)}, ${sqlString(c.label)}, ${sqlString(c.description)}, ${c.position}, (cast(unixepoch('subsecond') * 1000 as integer)), (cast(unixepoch('subsecond') * 1000 as integer))) ON CONFLICT(id, user_id) DO NOTHING;`,
    );
  }

  sqlLines.push("", "-- 2. Memberships (collection_id, creator_id).");
  let memberCount = 0;
  for (const c of collections) {
    const memberIds = [...(membersBySlug.get(c.slug) ?? new Set<string>())].sort();
    if (memberIds.length === 0) {
      continue;
    }
    sqlLines.push(`-- ${c.label} (${memberIds.length})`);
    for (const creatorId of memberIds) {
      const memberId = `member-${c.slug}-${creatorId}`;
      sqlLines.push(
        `INSERT INTO collection_member (id, user_id, collection_id, creator_id, added_at) VALUES (${sqlString(memberId)}, ${sqlString(userIdToken)}, ${sqlString(collectionId(c.slug))}, ${sqlString(creatorId)}, (cast(unixepoch('subsecond') * 1000 as integer))) ON CONFLICT(collection_id, creator_id) DO NOTHING;`,
      );
      memberCount++;
    }
  }

  const sqlPath = resolve(dataDir, "collections.sql");
  await writeFile(sqlPath, `${sqlLines.join("\n")}\n`);

  // --- Emit collections.review.md (human-readable) ---
  const md: string[] = [
    "# Collection classification — review",
    "",
    `Classified ${dedupedEntries.length} creators (deduped from ${allEntries.length} rows) from the production catalog API dump.`,
    `${assignedCount} assigned to at least one collection; ${dedupedEntries.length - assignedCount} left unassigned.`,
    `Total memberships: ${memberCount}.`,
    "",
    "Review each list below. The matching SQL is in `collections.sql`.",
    "",
  ];

  for (const c of collections) {
    const memberIds = [...(membersBySlug.get(c.slug) ?? new Set<string>())].sort();
    md.push(`## ${c.label} — ${memberIds.length}`);
    md.push(`_${c.description}_`, "");
    if (memberIds.length === 0) {
      md.push("_(none)_", "");
      continue;
    }
    for (const creatorId of memberIds) {
      const name = knownCreatorNameById.get(creatorId) ?? "??";
      const reason = dedupedEntries.find((e) => e.creatorId === creatorId)?.reason?.trim() ?? "";
      md.push(`- **${name}** — ${reason}`);
    }
    md.push("");
  }

  // Unassigned section so the user can sanity-check what was skipped.
  const unassigned = dedupedEntries.filter((e) => e.collections.length === 0);
  md.push(`## Unassigned — ${unassigned.length}`, "");
  md.push("_No clear fit for any of the 11 collections. Add manually if needed._", "");
  for (const e of unassigned) {
    md.push(`- ${e.displayName}`);
  }
  md.push("");

  const mdPath = resolve(dataDir, "collections.review.md");
  await writeFile(mdPath, md.join("\n"));

  console.log(`Wrote ${sqlPath} (${memberCount} memberships).`);
  console.log(`Wrote ${mdPath}.`);
  console.log("Summary:");
  for (const c of collections) {
    const n = membersBySlug.get(c.slug)?.size ?? 0;
    console.log(`  ${c.label.padEnd(22)} ${n}`);
  }
  console.log(`  ${"Unassigned".padEnd(22)} ${unassigned.length}`);
}

await main();
