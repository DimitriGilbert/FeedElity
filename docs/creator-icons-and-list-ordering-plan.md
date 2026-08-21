# Creator Icons Fix + Creator List Ordering Plan

## Overview

Two user-facing improvements to the creator column and settings:

1. **Fix missing creator icons.** Root causes found during exploration:
   - The YouTube adapter structurally never supplies a creator avatar (channel RSS has none), so YouTube creators can never get an icon through any current code path (`packages/api/src/sources/youtube.ts:183-187`).
   - `findOrCreateCreator` (`packages/api/src/repositories/catalog.ts:174-205`) only backfills `creator.image_url` when it is NULL and never overwrites, so stale/broken URLs never heal.
   - Creators created by Strapi migration without a qualifying image option, and creators whose row survived the duplicate-merge repair, may also have no icon.
   - The creator list has no fallback avatar for NULL `image_url` (`apps/web/src/components/app-shell-rows.tsx:82-88`).
   - Solution: a user-invoked **"force refresh creator metadata"** action in Settings that re-fetches creator metadata (icon, description, canonical URL) from each source adapter and overwrites stale values, plus an initials fallback avatar in the list.
2. **Creator list ordering + page size.** Add a simple sort `<select>` next to the search box in the creator column with two orders — by name (current behavior, default) and by last video update — and load 100 creators per page instead of 50.

Reference architecture: `docs/architecture.md` (created during exploration for this plan).

## Prerequisites

- Bun toolchain installed; workspace dependencies installed (`bun install`).
- All file/line references below are indicative as of plan writing; line numbers may shift between phases. Implementers must locate code by symbol name, not blindly by line number.
- Every implementer/fixer dispatch carries the NO-SLOP policy verbatim (from `/home/didi/.agents/skills/subagent-orchestration/SKILL.md` Rule 6); every validator enforces it.
- Context reading for all subagents: `AGENTS.md`, `docs/architecture.md`.
- Do not start long-running dev servers. Verification is `bun run check-types` and `bun run build` from the repo root, plus package test scripts where they exist.

## Phase 1: DB — creator last-content-published timestamp
**Type**: Sequential

**Requirements**:
- Add nullable column `last_content_published_at` (timestamp) to the `creator` table in `packages/db/src/schema/catalog.ts`, with an index suitable for `ORDER BY last_content_published_at DESC` (e.g. `creator_last_content_published_at_idx`). Keep existing table/index conventions.
- Maintain the column inside `persistNormalizedCatalog` (`packages/api/src/services/ingestion.ts:171-249`): after persisting items, set the creator's `last_content_published_at` to the max published_at among that creator's persisted items when it is greater than the stored value. Items with NULL `published_at` are ignored. The column is never reset to NULL by ingestion.
- Produce a Drizzle migration (follow existing migration conventions; see drizzle config in `packages/db`) that adds the column + index and backfills existing rows with `UPDATE creator SET last_content_published_at = (SELECT MAX(published_at) FROM content_item WHERE content_item.creator_id = creator.id)` so sorting works immediately on existing data.
- Attempt `bun run db:migrate` against the local dev DB only if it is already reachable; if not, report that the migration is generated but unapplied. Never start `db:local` or any long-running server.
- The write must be idempotent: re-ingesting the same items must not corrupt or regress the value.

**Inputs**:
- Read: `packages/db/src/schema/catalog.ts`, `packages/api/src/services/ingestion.ts`, existing migrations under `packages/db` (locate via drizzle config), `packages/api/src/repositories/catalog.ts` (write patterns)
- Reference: existing index definitions in `schema/catalog.ts` (`content_item_published_at_idx`, line ~95)

**Outputs**:
- Modify: `packages/db/src/schema/catalog.ts`
- Create: new Drizzle migration file(s) under the existing migrations directory
- Modify: `packages/api/src/services/ingestion.ts`

**Validation Criteria**:
- `bun run check-types`: zero errors
- `bun run build`: success
- Migration SQL, read by the validator, correctly adds column + index and backfills from `content_item`
- Ingestion maintenance only ever increases the stored value; NULL `published_at` items ignored
- If a test setup exists in the touched packages, add/extend a behavior test for the max-maintenance logic; otherwise state that none exists

**Dependencies**: None (first phase)

---

## Phase 2: API — creator list sorting + default limit 100
**Type**: Sequential

**Requirements**:
- Extend the `creatorListInput` schema (`packages/api/src/routers/index.ts:152-159`) with an optional `sort` enum: `"name" | "lastUpdate"`, default `"name"`. Keep `limit` max at 100 but change its default from 50 to 100.
- Extend `listCatalogCreators` (`packages/api/src/repositories/catalog.ts:474-494`):
  - `sort: "name"` → current ordering: `asc(display_name), asc(created_at), asc(id)`
  - `sort: "lastUpdate"` → `desc(last_content_published_at)` with NULLs ordered last, then `asc(display_name), asc(id)` as stable tiebreakers (offset pagination requires a deterministic total order)
- The `catalog.creators` public procedure (`routers/index.ts:351-353`) passes `sort` through; anonymous access stays unchanged (it is a safe catalog read).
- Update web contract constant `creatorListLimit` from 50 to 100 in `apps/web/src/app-shell.contract.ts:95` so the UI loads 100 per page (the "More" offset pagination must keep working unchanged).
- Search (`containsNormalized`) and source filter behavior must be unaffected by sort.

**Inputs**:
- Read: `packages/api/src/routers/index.ts` (input schemas + catalog procedures), `packages/api/src/repositories/catalog.ts` (`listCatalogCreators`, `containsNormalized`), `apps/web/src/app-shell.contract.ts`
- Reference: Phase 1 column `last_content_published_at`

**Outputs**:
- Modify: `packages/api/src/routers/index.ts`, `packages/api/src/repositories/catalog.ts`, `apps/web/src/app-shell.contract.ts`

**Validation Criteria**:
- `bun run check-types`: zero errors
- `bun run build`: success
- Validator confirms by reading code: default limit is now 100, sort enum validated at the API boundary, both orderings have deterministic tiebreakers, NULLs last for `lastUpdate`
- With no `sort` supplied, behavior is identical to today except the limit default

**Dependencies**: Phase 1 must complete (sort column must exist)

---

## Phase 3: Creator metadata force refresh (backend)
**Type**: Parallel (two sub-phases, sequential execution between them, then phase-wide validation)

Background: refresh already re-delivers creator metadata on every feed fetch, but the repository only fills NULLs and YouTube never supplies an avatar. This phase adds a dedicated, user-invoked metadata refresh that can actually overwrite stale values and can fetch data the RSS path cannot.

### 3.1: Adapter contract — `fetchCreatorMetadata`
**Requirements**:
- Add an optional capability to the source adapter contract (where the `SourceAdapter` interface/normalized contract lives, `packages/api/src/sources/`): `fetchCreatorMetadata(input)` returning `{ displayName?, imageUrl?, description?, canonicalUrl? }` (nullable fields; undefined/"unknown" when the source cannot determine a value). Design the input from what adapters already know about a feed (feed URL / source-specific identifiers stored on the feed row).
- YouTube (`packages/api/src/sources/youtube.ts`):
  - Derive the channel page URL from the feed URL (`...?channel_id=UC...` → `https://www.youtube.com/channel/{id}`; `...?user={name}` → `https://www.youtube.com/@{name}` / user page).
  - Fetch the channel page HTML once with a timeout and extract the avatar URL (e.g. `og:image` meta or the ytInitialData avatar thumbnails; prefer a stable square thumbnail variant). Prefer reusing existing fetch/parse utilities in the adapter; do not add a new dependency for this (targeted meta extraction is acceptable).
  - Network/parse failures return a result with unset fields — they must never throw in a way that breaks the caller's loop.
- Odysee (`packages/api/src/sources/odysee.ts`): re-fetch the feed/channel data and reuse the existing image extraction (`<image><url>` / `itunes:image`, lines ~152-172); same failure tolerance.
- PeerTube (`packages/api/src/sources/peertube.ts`): re-fetch the channel/account API and reuse the existing avatar resolution (lines ~320-336, ~558-563); instance-kind feeds without a channel avatar return unset fields.
- Keep source-specific logic entirely inside adapters; the contract stays normalized (AGENTS.md module boundary rule).

**Inputs**:
- Read: `packages/api/src/sources/` (adapter interface, `youtube.ts`, `odysee.ts`, `peertube.ts`), feed rows as persisted (what identifiers are available), `docs/architecture.md`
- Reference: existing fetch/timeout/parse patterns already used by each adapter

**Outputs**:
- Modify: the adapter contract/types module, `youtube.ts`, `odysee.ts`, `peertube.ts`

**Validation**:
- `bun run check-types` + `bun run build` pass
- Validator reads all three adapters: no live-network test dependency (fixture-based tests only if a test setup exists), failures degrade to unset fields, no source-specific leakage into the shared contract
- No new dependencies added

### 3.2: Repository + service + API procedures
**Requirements**:
- Repository: add `updateCreatorMetadata` to `packages/api/src/repositories/catalog.ts` — updates `image_url`, `description`, `canonical_url` for a creator, overwriting only fields the adapter supplied (non-null/non-undefined); never touches `name_key` or `display_name`; `updated_at` bumps via the existing `$onUpdate`. Fields the adapter did not supply keep their stored value (no wiping with nulls).
- Service (`packages/api/src/services/`, follow the existing refresh service pattern in `refresh.ts`): a creator-metadata refresh job that
  - iterates all catalog feeds grouped by creator (one metadata fetch per feed, or per creator when the adapter input allows deduplication),
  - calls the adapter's `fetchCreatorMetadata`, applies `updateCreatorMetadata` when anything changed,
  - runs in the background with pollable status, reusing the pattern of `startRefreshAll` (`refresh.ts:109-129`) and its status polling shape,
  - collects per-feed failures and continues; exposes a summary (updated / unchanged / failed counts) in the status,
  - never touches feed refresh-cadence metadata (`last_normal_refresh_at`, `next_refresh_after`) — keep normal-cadence and force behavior separated (AGENTS.md).
- API (`packages/api/src/routers/index.ts`, next to the existing `refresh.*` procedures at lines ~396-449): protected procedures to start the metadata refresh and to poll its status, mirroring the existing `refresh.startAll` shape. These must require authentication (global catalog write, same protection level as `refresh.runAll`); no user-owned overlay data is written.
- A concurrent second invocation must not run a second parallel job over the same catalog (follow whatever guard `startRefreshAll` uses, or add an equivalent).

**Inputs**:
- Read: `packages/api/src/services/refresh.ts`, `packages/api/src/repositories/catalog.ts`, `packages/api/src/routers/index.ts`, 3.1 adapter contract
- Reference: `startRefreshAll` background + poll pattern, existing protected-procedure definitions

**Outputs**:
- Modify: `packages/api/src/repositories/catalog.ts`, `packages/api/src/services/refresh.ts` (or a sibling service module if that matches existing structure better), `packages/api/src/routers/index.ts`

**Validation**:
- `bun run check-types` + `bun run build` pass
- Validator reads the service and procedures: authentication enforced, partial failures reported not swallowed (AGENTS.md error rules), cadence metadata untouched, no cross-user data access introduced
- If a test setup exists in `packages/api`, add a behavior test for the update-only-supplied-fields repository semantics and/or the job summary; otherwise state that none exists

**Phase-level Validation** (after 3.1 and 3.2 pass individually):
- One validator reads all Phase 3 files together: contract types line up between adapters and service, no duplicated metadata-fetch logic across adapters, integration is coherent, `bun run check-types` + `bun run build` pass repo-wide

**Dependencies**: Phase 1 and 2 complete; 3.2 depends on 3.1

---

## Phase 4: UI — settings action, sort select, fallback avatar
**Type**: Sequential

**Requirements**:
- **Settings action**: in `SettingsColumnSection` (`apps/web/src/components/app-shell-source-sections.tsx:236-349`), add a section (beside "Reader density") with a "Force refresh creator metadata" button that calls the new API procedure, polls status while running (reuse the existing header-refresh polling pattern in `app-shell.tsx:539-560`), shows progress/result (updated / unchanged / failed counts) and errors explicitly. Button disabled while a run is in progress.
- **Sort select**: in the creator column header next to the search box (`apps/web/src/components/app-shell.tsx:289-956`, search markup near lines 780-851), add a `<select>` with exactly two options: "By name" and "By last video update" (default "By name"). Wire it through `toCreatorListInput` (`apps/web/src/app-shell.contract.ts:281-290`) to the API `sort` param; changing it refetches the list. Persist the choice as a typed user setting via the existing settings overlay (pattern: `reader.density` in `SettingsColumnSection`), so it survives reloads; invalid stored values fall back to "name" safely.
- **Fallback avatar**: in `CreatorSourceRow` (`apps/web/src/components/app-shell-rows.tsx:65-115`), when `imageUrl` is missing render an initials placeholder styled consistently with the existing avatar, instead of omitting the avatar entirely.
- The limit-100 page size from Phase 2 must be reflected: initial load and "More" pagination use the contract limit with no hardcoded 50 left in the creator list path.
- Solid patterns only (signals/resources, no React patterns); no document-wide custom events.

**Inputs**:
- Read: `apps/web/src/components/app-shell-source-sections.tsx`, `app-shell.tsx`, `app-shell-rows.tsx`, `app-shell.contract.ts`, the typed-settings mechanism used by `reader.density`, the API client surface for the new procedures
- Reference: existing polling in `runHeaderRefresh`, existing typed settings select, existing avatar markup

**Outputs**:
- Modify: `apps/web/src/components/app-shell-source-sections.tsx`, `app-shell.tsx`, `app-shell-rows.tsx`, `apps/web/src/app-shell.contract.ts` (and the typed-settings definition module it lives in)

**Validation Criteria**:
- `bun run check-types`: zero errors
- `bun run build`: success
- Validator reads the UI code: select persists via settings overlay, refetch on change, no no-op UI, fallback avatar renders for missing icons, disabled state while job runs, real error surfacing
- No hardcoded demo data, no optimistic state left unreconciled

**Dependencies**: Phases 2 and 3 must complete

---

## Phase 5: Documentation update + final verification
**Type**: Sequential

**Requirements**:
- Update `docs/architecture.md` to reflect: the new `creator.last_content_published_at` column and its maintenance, the creator-list sort parameter and 100 default, the adapter `fetchCreatorMetadata` capability, the metadata-refresh service/procedures, and the new settings/sort UI. Keep the doc's existing style and length; do not rewrite unrelated sections.
- Run repo-wide `bun run check-types` and `bun run build` as the final gate; report results.

**Inputs**:
- Read: `docs/architecture.md`, all files created/modified in Phases 1-4

**Outputs**:
- Modify: `docs/architecture.md`

**Validation Criteria**:
- Doc matches the implemented code (validator cross-checks file paths and behavior descriptions against the actual code)
- `bun run check-types`: zero errors; `bun run build`: success

**Dependencies**: Phases 1-4 must complete

---

## Success Criteria

- All 5 phases complete with individual validation (and phase-wide validation for Phase 3)
- Final `bun run check-types` and `bun run build` pass
- User-visible outcomes:
  - Settings offers "Force refresh creator metadata"; after running it, creators (including YouTube ones) gain icons where the source provides them; stale icons/descriptions/canonical URLs are overwritten; the run reports updated/unchanged/failed counts
  - Creators without any icon show an initials fallback instead of a blank row
  - Creator column has a two-option sort select next to search ("By name" default, "By last video update"), persisted across reloads
  - Creator list loads 100 per page instead of 50
- Non-goals (explicitly out of scope): sorting the Library/subscriptions tab, background/automatic metadata refresh, YouTube Data API integration, banner/thumbnail columns, touching existing force-refresh content behavior
