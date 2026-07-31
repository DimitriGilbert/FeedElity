/**
 * Stage 1 — READ-ONLY creator dump for classification.
 *
 * Fetches every creator from the deployed catalog API plus a bounded sample of
 * each creator's content titles/descriptions and feed descriptions, and writes
 * the result to data/creators.json. This file is the sole input to the
 * classification subagents (Stage 2) so they never touch production.
 *
 * This script ONLY reads. It performs no writes against any API or database.
 *
 * Usage:
 *   bun scripts/classify/fetch-creators.ts [--api http://localhost:31001] [--sample 20]
 *
 * Output: data/creators.json — array of:
 *   { id, displayName, description, sourceType, sampleTitles, feedDescriptions }
 */

import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const dataDir = resolve(here, "data");
const outPath = resolve(dataDir, "creators.json");

// Defaults can be overridden via argv flags.
const args = parseArgs(Bun.argv);
const apiBase = args.api ?? "http://localhost:31001";
const sampleLimit = Number(args.sample ?? 20);
const pageSize = 100; // catalog limit input is capped at 100 by the API zod schema.

interface CatalogCreator {
  readonly id: string;
  readonly sourceType: string;
  readonly sourceExternalId: string;
  readonly displayName: string;
  readonly description: string | null;
}

interface ContentItem {
  readonly title: string;
  readonly description: string | null;
}

interface Feed {
  readonly description: string | null;
}

interface DumpCreator {
  readonly id: string;
  readonly displayName: string;
  readonly description: string | null;
  readonly sourceType: string;
  readonly sampleTitles: readonly string[];
  readonly feedDescriptions: readonly string[];
}

async function postJson(path: string, body: Record<string, unknown>): Promise<unknown> {
  const response = await fetch(`${apiBase}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ json: body }),
  });
  if (!response.ok) {
    throw new Error(`${path} -> HTTP ${response.status}: ${await response.text()}`);
  }
  const payload = (await response.json()) as { json: unknown };
  return payload.json;
}

async function fetchAllCreators(): Promise<readonly CatalogCreator[]> {
  const all: CatalogCreator[] = [];
  let offset = 0;
  // Loop pages of `pageSize` until a page comes back short. Ordered by displayName.
  for (;;) {
    const page = (await postJson("/rpc/catalog/creators", { limit: pageSize, offset })) as readonly CatalogCreator[];
    if (page.length === 0) {
      break;
    }
    all.push(...page);
    if (page.length < pageSize) {
      break;
    }
    offset += pageSize;
  }
  return all;
}

async function fetchContentSample(creatorId: string): Promise<readonly ContentItem[]> {
  const items = (await postJson("/rpc/catalog/contentItems", { creatorId, limit: sampleLimit })) as readonly ContentItem[];
  return items;
}

async function fetchFeeds(creatorId: string): Promise<readonly Feed[]> {
  const feeds = (await postJson("/rpc/catalog/feeds", { creatorId, limit: 10 })) as readonly Feed[];
  return feeds;
}

// Bounded concurrency: process a queue with at most `concurrency` in flight so we
// stay gentle on the production API while walking ~621 creators.
async function mapWithConcurrency<T, R>(
  items: readonly T[],
  concurrency: number,
  task: (item: T, index: number) => Promise<R>,
  onProgress: (done: number, total: number) => void,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;
  let completed = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      try {
        results[index] = await task(items[index], index);
      } catch (error) {
        // Don't let one creator's fetch error abort the whole dump; record empty
        // signal so the classifier still sees the creator's name/description.
        console.error(`creator ${items[index] instanceof Object ? "" : ""}index ${index} failed:`, error);
        results[index] = undefined as unknown as R;
      } finally {
        completed++;
        onProgress(completed, items.length);
      }
    }
  });
  await Promise.all(workers);
  return results;
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

async function main(): Promise<void> {
  console.log(`Fetching creators from ${apiBase} (sample ${sampleLimit} items each)...`);
  const creators = await fetchAllCreators();
  console.log(`Found ${creators.length} creators. Enriching with content + feed signal...`);

  const dump: DumpCreator[] = new Array(creators.length);
  let lastReport = 0;
  await mapWithConcurrency(
    creators,
    8,
    async (creator, index) => {
      const [content, feeds] = await Promise.all([fetchContentSample(creator.id), fetchFeeds(creator.id)]);
      dump[index] = {
        id: creator.id,
        displayName: creator.displayName,
        description: creator.description,
        sourceType: creator.sourceType,
        sampleTitles: content.map((item) => item.title).filter((title) => title.length > 0),
        feedDescriptions: feeds
          .map((feed) => feed.description)
          .filter((desc): desc is string => desc !== null && desc.trim().length > 0),
      };
    },
    (done, total) => {
      if (done - lastReport >= 50 || done === total) {
        lastReport = done;
        console.log(`  enriched ${done}/${total}`);
      }
    },
  );

  await mkdir(dataDir, { recursive: true });
  await writeFile(outPath, JSON.stringify(dump, null, 2));
  const withContent = dump.filter((c) => c.sampleTitles.length > 0).length;
  console.log(`Wrote ${outPath}: ${dump.length} creators (${withContent} with content signal).`);
}

await main();
