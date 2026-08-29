/**
 * Core logic for the one-time creator dedup repair.
 *
 * A creator is cross-source, matched by a normalized display name (name_key).
 * Production was seeded when creators carried a per-source identity, so the same
 * channel mirrored on YouTube + Odysee (+ Odysee "@claim:rev" variants and a
 * YouTube case collision) became several creator rows. This module computes a
 * deterministic merge plan that collapses each name_key group onto one canonical
 * creator and rewires every foreign key that pointed at a merged-away row.
 *
 * Pure and unit-testable: it takes catalog rows and returns a plan. The CLI
 * (repair.ts) loads rows from a real DB and applies the plan.
 */

export interface CreatorRow {
  readonly id: string;
  readonly sourceType: string;
  readonly sourceExternalId: string;
  readonly displayName: string;
  readonly createdAt: number;
  readonly contentCount: number;
  readonly subscriptionCount: number;
}

export interface MergeAction {
  /** The creator row that survives and absorbs the others. */
  readonly canonical: CreatorRow;
  /** Creator ids to delete after rewiring their children onto the canonical id. */
  readonly mergedAwayIds: readonly string[];
}

export interface MergePlan {
  readonly groups: readonly MergeAction[];
}

/**
 * Normalize a display name into a cross-source key. Mirrors creatorNameKey() in
 * packages/api/src/domain/catalog.ts so the merge plan, the repair tooling, the
 * migration name_key backfill, and runtime ingestion agree on identity.
 */
export function creatorNameKey(displayName: string): string {
  const withoutHandle = displayName.trim().replace(/^@+/, "");
  const withoutClaimRevision = withoutHandle.includes(":")
    ? withoutHandle.slice(0, withoutHandle.indexOf(":"))
    : withoutHandle;
  return withoutClaimRevision.replace(/\s+/g, "").toLowerCase();
}

/**
 * Build the merge plan for a set of creator rows. Rows sharing a name_key form a
 * group; the canonical row is the one with the most content items, then the most
 * subscriptions, then the earliest created_at (stable, deterministic tie-break).
 * Singleton groups (no duplicates) produce no action.
 */
export function buildMergePlan(rows: readonly CreatorRow[]): MergePlan {
  const groups = new Map<string, CreatorRow[]>();
  for (const row of rows) {
    const key = creatorNameKey(row.displayName);
    const list = groups.get(key);
    if (list === undefined) {
      groups.set(key, [row]);
    } else {
      list.push(row);
    }
  }

  const actions: MergeAction[] = [];
  for (const members of groups.values()) {
    if (members.length < 2) {
      continue;
    }
    const ranked = [...members].sort(compareCanonicalPreference);
    const canonical = ranked[0];
    if (canonical === undefined) {
      continue;
    }
    actions.push({
      canonical,
      mergedAwayIds: ranked.slice(1).map((row) => row.id),
    });
  }
  // Stable ordering for reviewable output.
  actions.sort((a, b) => creatorNameKey(a.canonical.displayName).localeCompare(creatorNameKey(b.canonical.displayName)));
  return { groups: actions };
}

function compareCanonicalPreference(a: CreatorRow, b: CreatorRow): number {
  if (b.contentCount !== a.contentCount) {
    return b.contentCount - a.contentCount;
  }
  if (b.subscriptionCount !== a.subscriptionCount) {
    return b.subscriptionCount - a.subscriptionCount;
  }
  return a.createdAt - b.createdAt;
}

export interface PlanSummary {
  readonly groups: number;
  readonly creatorsMergedAway: number;
}

export function summarizePlan(plan: MergePlan): PlanSummary {
  let mergedAway = 0;
  for (const action of plan.groups) {
    mergedAway += action.mergedAwayIds.length;
  }
  return { groups: plan.groups.length, creatorsMergedAway: mergedAway };
}
