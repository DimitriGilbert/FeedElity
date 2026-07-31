# Creator dedup repair

One-time repair that merges duplicate `creator` rows in production and converts
the `creator` table to the cross-source (`name_key`) model.

## Why

A creator is a cross-source channel (one channel, many sources). The app was
seeded when `creator` carried a per-source identity `(source_type, source_external_id)`,
so the same channel mirrored on YouTube + Odysee — plus Odysee `@claim:rev`
variants and a YouTube `UC`/`uc` case collision — became several creator rows. This
collapses each channel onto one creator and rewires every foreign key.

The matching key is `creatorNameKey(display_name)`: lowercase, leading `@` stripped,
trailing `:claimId` stripped, whitespace removed. Verified against production: 28
duplicate groups, 47 rows merged away, **0 false merges** (every group is a genuine
same-channel mirror).

## Files

- `merge-plan.ts` — pure, unit-tested merge logic (`bun test scripts/db-repair/merge-plan.test.ts`).
- `repair.ts` — loads rows from a DB, prints the plan, applies it (dry-run by default).

## What the repair does

In a single transaction, per duplicate group:

1. Rewire `content_item.creator_id`, `feed.creator_id`, `refresh_run.requested_creator_id` onto the canonical creator.
2. Dedup `subscription`: where the same `(user_id, creator_id)` would collide, drop the loser first (unique constraint), then re-point the survivor.
3. Delete the merged-away creator rows.
4. Schema change: drop `source_type`/`source_external_id` from `creator`, add `name_key` (backfilled from `display_name`), create `creator_name_key_uidx`.
5. Abort + rollback if the merge introduces any **new** foreign-key orphans.

Canonical pick per group: most content items, then most subscriptions, then earliest `created_at`.

## Run

```bash
# 1. Copy prod out of the container (never repair the live file in place without a backup):
docker cp feedelity-server-1:/data/local.db scripts/db-repair/work.db

# 2. Dry-run on the copy — review the plan:
bun scripts/db-repair/repair.ts --db scripts/db-repair/work.db

# 3. Apply on the copy — verify counts (creators 374 -> 327, feeds/items unchanged):
bun scripts/db-repair/repair.ts --db scripts/db-repair/work.db --yes
```

Then to deploy (run yourself, against prod):

```bash
docker compose stop server
docker cp feedelity-server-1:/data/local.db /tmp/local.db.bak        # backup
docker cp scripts/db-repair/work.db feedelity-server-1:/data/local.db  # restore repaired copy
# OR run the repair against the live volume copy and copy it back.
docker compose start server
```

The script is **idempotent**: re-running on an already-repaired DB is a no-op
(0 groups, 0 writes).

## Pre-existing orphans (informational)

Production already contains **2734 orphaned rows** unrelated to this bug:
- `refresh_feed_result`: ~2471 rows referencing feeds that were deleted earlier.
- `content_item`: ~263 rows referencing 89 creator ids that no longer exist.

This repair does **not** touch them and does not fail because of them — the
post-merge gate only aborts if the merge itself introduces *new* orphans. They are
reported in the run output. Clean them up separately if desired.
