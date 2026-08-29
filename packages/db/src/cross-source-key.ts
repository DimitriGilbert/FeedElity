/**
 * Cross-source mirror key for content items, mirrored for the backfill
 * migration. This duplicates contentCrossSourceKey() in
 * packages/api/src/domain/catalog.ts because packages/db must not depend on
 * packages/api: the migration backfill and runtime ingestion have to agree
 * byte-for-byte on the stored key. Both implementations are pinned to the same
 * case table by parity tests here (cross-source-key.test.ts) and in
 * packages/api (src/domain/catalog.test.ts).
 */

export function contentCrossSourceKey(nameKey: string, title: string): string | null {
  const normalizedTitle = title.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
  if (normalizedTitle.length === 0) {
    return null;
  }
  return `${nameKey}:${normalizedTitle}`;
}
