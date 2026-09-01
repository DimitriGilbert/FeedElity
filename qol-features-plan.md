# FeedElity QOL Features Plan (F1–F9)

## Overview

Eleven-phase implementation plan for nine approved QOL features on the FeedElity monorepo (Bun + SolidJS web + Hono/oRPC server + Drizzle/libSQL + docker nginx):

- F1 Playback resume ("continue watching") — YouTube IFrame API bridge + native `<video>` position tracking, persisted in `content_status.metadataJson`, restored on reopen, surfaced as list-row progress.
- F2 Unread counts + mark-all-read — per-subscription unread counts and bounded, idempotent mark-as-opened.
- F3 Keyboard shortcuts — j/k/Enter/f// /Esc/g-prefixed navigation with a pure, tested keymap.
- F4 Export / import user data — protected JSON export/import with natural-key attribution and round-trip idempotency.
- F5 External player — "copy stream URL" affordance in the viewer (light scope).
- F6 Feed health dashboard — per-feed health metrics, bulk unsubscribe, first confirm-dialog pattern, retention pruning.
- F7 Persisted UI state — device-local localStorage persistence for mode, tabs, filters, view mode.
- F8 Virtualized content list — `@tanstack/solid-virtual` for the lg content column.
- F9 First-load performance — composite index + slim list projection, WAL pragmas, devtools gating, nginx gzip/headers/favicon, startup waterfall fixes.

Ordering is de-risk-first: performance (the daily pain) first, then the schema-adjacent resume backend, then UI features; virtualization lands BEFORE keyboard shortcuts so j/k targets the final scrolling mechanism.

### Key design decisions (binding for implementers)

| # | Decision | Choice and rationale |
|---|----------|----------------------|
| D1 | F1 storage | **Option A: JSON in `content_status.metadataJson` on the "opened" row.** Zero DDL — the live volume DB is only safely mutated through the catalog-data-migrations runner, and typed columns would require either a drizzle migration (journal deliberately behind schema — unsafe) or an ALTER TABLE runner step plus backfill. Trade-off: needs a validated narrow parser in the web contract (precedent: `toYoutubeNoCookieFromSettings`, app-shell.contract.ts:630-654). Trade-off accepted. |
| D2 | F1 auto-mark played | **Move auto "played" marking from onPlay to near-end** (state `ended`, or position ≥ duration − 30s, or ≥ 90% when duration known) for BOTH native and YT bridge. Behavior change is correct: today YouTube embeds never auto-mark played and native marks on mere play start. Manual played button unchanged. |
| D3 | F2 counts | **Separate protected procedure `overlays.unreadCounts`.** Do NOT extend `UserSubscriptionWithCreator` and do NOT touch `CatalogCreatorSummary` — it is shared with anonymous `catalog.creators` via duplicated mappers (repositories/catalog.ts:1022-1033, repositories/overlays.ts:1125-1136); keeping it untouched preserves the anonymous contract. |
| D4 | F2 semantics | "New" = items with `coalesce(published_at, created_at) > threshold` AND no `opened`/`played` row for the user. Mark-all inserts **only `opened` rows** (never fabricates `played`), idempotent via the unique triple, bounded at 1000 rows per creator per call. Default threshold when unset = the subscription's `created_at`. |
| D5 | F3 Space | **Cut Space=play/pause for v1** (cross-origin iframe makes it impossible for embeds; native-only would be inconsistent). |
| D6 | F4 OPML | **Cut OPML from v1.** JSON export/import covers portability; fast-xml-parser is a parsing dep here and serialization is net-new scope. Deferred until a user asks. |
| D7 | F6 auth | **New `overlays.feedHealth` is `protectedProcedure`.** Existing public `refresh.status` stays as-is in this plan (the refresh-status dialog polls it); tightening it to protected is recorded as a separate follow-up decision, not silently changed here. |
| D8 | F6 retention | **Service-side age-based prune** in the refresh service after each run completes (delete `refresh_feed_result` rows older than 30 days) **plus a one-time `refresh_feed_result_retention` step** in the catalog-data-migrations runner to trim the existing backlog. No pruning exists today; the table grows forever. |
| D9 | F7 scope | localStorage only (device-local), guarded helpers following the exact `readPersistedHidePlayed`/`persistHidePlayed` pattern (app-shell.contract.ts:220-241). Search text stays ephemeral. Mode redirect only when a session exists. |
| D10 | F8 scoping | **Virtualize lg-only** via a `matchMedia("(min-width: 1024px)")` signal; below lg keep the existing plain `<For>` so mobile document-scroll UX is untouched. `contentScrollRegionClass` is unchanged. |
| D11 | F9 creators double-fetch | **ONE approach: gate the creators resource on settings settlement.** While authenticated and the settings resource is still pending (`settings.state === "pending"`), the creators resource input is `null`; once settings settle (ready OR errored) the list fetches once with the persisted sort. Anonymous users fetch immediately. No localStorage sort cache, no deferred-fetch rework. |
| D12 | F9 oRPC batching | **Cut the optional batch link.** After removing the redundant `client.session.current()` round trip, the gated resources are independent `createResource`s issuing concurrent fetches; batching adds complexity for marginal gain. Revisit only if measured waterfalls remain. |
| D13 | F9 precompression | **nginx directive changes only** (`gzip_comp_level 6`). Brotli/vite precompression plugins cut from v1. |
| D14 | F5+P10 parallelism | Phases 10.1 and 10.2 are **sequential** despite both being small: both may touch `app-shell.test.ts`, and parallel implementers on one test file conflict. Backend sub-phases in different phases (7.1, 8.1, 9.1) are file-disjoint from other phases' web work and MAY be dispatched in parallel at orchestrator discretion, but a phase-wide validation pass is then mandatory per skill Rule 3. |

### NO-SLOP POLICY (MANDATORY — paste VERBATIM into EVERY implementer and fixer dispatch; every validator must be instructed to enforce it)

```
NO-SLOP rules — all of these are hard requirements, not suggestions:
- NO `any`, `as any`, `: any` ANYWHERE
- NO placeholder code, NO `// TODO`, NO `// FIXME`
- NO unused imports, NO unused variables — if a variable is not used, it must not exist
- NO console.log hacks to suppress errors. NO void hacks.
- Use `import type` for type-only imports (`verbatimModuleSyntax: true`)
- External imports first, blank line, then local imports
- ONE query/mutation per file, named export
- Do NOT start the dev server
```

Repo supplements (append to every dispatch, from AGENTS.md): TS strict; no unsafe non-null assertions (`!`) unless the invariant is enforced immediately before use and obvious; no broad type assertions to force compilation — validate or narrow; no swallowed errors (handle, return, or rethrow with context); no speculative abstractions; validate all external input at boundaries; user-owned reads/writes scoped by authenticated `userId` at the API/service boundary; ingestion/writes idempotent; tests through public interfaces (API procedures, services, contract helpers, rendered UI behavior via `bun test --conditions browser` in apps/web).

### Global gatekeeping (every phase and sub-phase)

Implementers AND fixers must run, and see pass, BEFORE reporting done:

1. `bun run check-types` — zero errors.
2. `bun run build` — success.
3. `bun run test` — zero failures. Baselines before any phase: **api 175 passed, db 35 passed, web 114 passed**. Each phase must finish at `≥ baseline + (that phase's new tests)` with zero failures. Web package tests run through its script (`bun test --conditions browser`); report per-package counts.

Validators must ACTUALLY READ the changed files line-by-line, verify every requirement below, enforce NO-SLOP, and re-run all three gates. Max 3 fix attempts per (sub-)phase, then HALT and report.

## Prerequisites

- Bun 1.3.x, TypeScript strict, Turbo. No new dependencies except `@tanstack/solid-virtual` (Phase 5) — verified: solid-compatible (`peer solid-js ^1.3`), headless, same TanStack ecosystem; everything else uses existing deps.
- Files that must exist before starting (verified present): packages/db/src/schema/{catalog,overlays}.ts, packages/db/src/connection.ts, packages/db/src/migrations/catalog-data-migrations.ts (+ apply-catalog-migrations.ts, root script `db:repair`), packages/api/src/{domain,repositories,routers,services,migration}/*, apps/web/src/components/app-shell*.tsx, apps/web/src/components/app-shell.contract.ts, apps/web/src/routes/*, apps/web/src/utils/orpc.ts, docker/nginx.conf, docker/server-entrypoint.sh.
- Environment: live deployment mutates its volume DB ONLY via `bun run db:repair` (catalog-data-migrations runner, `__feedelity_migrations` table). Never plan drizzle-journal migrations for the volume.
- Do not start dev servers. All verification through check-types/build/test plus phase-specific scripts/tests.

---

## Phase 1: First-load performance (F9)

**Type**: Sequential (sub-phases sequential; 1.4 is a measurement/validation task)

### 1.1 Query plan, composite index, slim list projection

**Requirements**:
- Add composite index `content_item_published_created_id_idx` on `content_item (published_at DESC, created_at DESC, id DESC)`:
  - Modify `/home/didi/workspace/FeedElity/packages/db/src/schema/catalog.ts` contentItem index list (around line 98) to include it (keep the existing single-column `content_item_published_at_idx` — other queries sort/compare on published_at alone).
  - Add an idempotent step `content_item_list_order_idx` to `/home/didi/workspace/FeedElity/packages/db/src/migrations/catalog-data-migrations.ts`: `CREATE INDEX IF NOT EXISTS content_item_published_created_id_idx ON content_item (published_at DESC, created_at DESC, id DESC)` inside the existing step pattern (BEGIN IMMEDIATE → check id → run → insert id → COMMIT; `details` report index creation). Follow `CREATOR_INDEX_DDL` style.
- Slim the catalog list projection so list rows stop carrying `description` and `metadataJson` (the detail endpoint keeps fetching them):
  - In `/home/didi/workspace/FeedElity/packages/api/src/domain/catalog.ts`: redefine `CatalogContentListItem` as a standalone interface (no longer `extends CatalogContentItem`) declaring exactly: `id`, `creatorId`, `sourceType`, `sourceExternalId`, `title`, `publishedAt`, `contentType`, `durationSeconds`, `thumbnailUrl`, `canonicalUrl`, `creator: CatalogCreatorSummary`, `sourceCount`, `mirrorCount`. Keep `CatalogContentItem` and `CatalogContentDetail` (full shape) unchanged. `CatalogContentDetail.mirrors: readonly CatalogContentListItem[]` stays (the viewer only needs the id to reselect; it refetches detail).
  - In `/home/didi/workspace/FeedElity/packages/api/src/repositories/catalog.ts`: change `selectCatalogContentListItemRows` (:734-755) to select explicit narrow columns instead of the whole `contentItem` row (omit `description`, `metadataJson`); add a slim row mapper producing `CatalogContentListItem` directly (do not go through `toCatalogContentItem`). Update `listCatalogContentItems` (:579-623) and `listCatalogContentListItemsByMirrorKey` (:700-717) to the new shape. Update every overlay mapper that produces `CatalogContentListItem` (favorites, history via `listContentStatusWithContentForUser`, subscribed items via `listSubscribedContentItemsForUser`, playlist items via `listPlaylistItemsWithContentForUserPlaylist` in repositories/overlays.ts) to the slim shape — they must join/select the same narrow columns.
  - Grep apps/web + packages/api for `.description` / `metadataJson` reads off list items and fix any compile breakage; the web list row renders only title/thumb/duration/creator/published/source chips (verified in ContentListItemRow). If a genuine UI need for description in lists appears, STOP and report — do not re-widen silently.
- Add a db package test asserting the step is idempotent (apply twice, second is a no-op) and that the index exists after apply (follow existing catalog-data-migrations.test.ts patterns).
- Add an api repository test asserting list rows lack description/metadataJson and detail rows keep them.

**Inputs**:
- Read: packages/db/src/schema/catalog.ts, packages/db/src/migrations/catalog-data-migrations.ts (+ its test), packages/api/src/repositories/catalog.ts, packages/api/src/repositories/overlays.ts, packages/api/src/domain/catalog.ts.

**Outputs**:
- Modify: packages/db/src/schema/catalog.ts, packages/db/src/migrations/catalog-data-migrations.ts, packages/db/src/migrations/catalog-data-migrations.test.ts, packages/api/src/domain/catalog.ts, packages/api/src/repositories/catalog.ts, packages/api/src/repositories/overlays.ts, packages/api/src/repositories/repositories.test.ts, plus minimal compile-fix touch-ups where list items were over-read.

**Validation Criteria**:
- All global gates pass (api ≥ 175 + new, db ≥ 35 + new, web 114, zero failures).
- A db test or scripted check shows `EXPLAIN QUERY PLAN` of `SELECT ... FROM content_item ORDER BY published_at DESC, created_at DESC, id DESC LIMIT 50` uses the composite index with NO `TEMP B-TREE` and NO full `SCAN content_item` (grep the plan output in the test).
- `bun run db:repair` (dry-run mode via the runner's `apply:false` path) lists the new step.

**Dependencies**: None (first phase).

### 1.2 WAL pragmas at connection creation

**Requirements**:
- Modify `/home/didi/workspace/FeedElity/packages/db/src/connection.ts`: on connection creation, execute `PRAGMA journal_mode = WAL;` and `PRAGMA busy_timeout = 5000;` through the libsql client before returning (verify the libsql client's pragma execution path — `client.execute("PRAGMA ...")`; if libsql rejects pragma statements on this version, fall back to `drizzle`'s `db.run(sql...)` — verify by test, not assumption).
- Keep semantics consistent with the migration runner: the runner (`catalog-data-migrations.ts`, bun:sqlite) and `docker/server-entrypoint.sh:29` (deletes stale `-wal`/`-shm` after seeding) already expect sidecars; add a comment block documenting that WAL creates `local.db-wal`/`local.db-shm` next to the volume DB and that backups/repair must treat the DB+sidecars as one unit (checkpoint before copying).
- Add a db test asserting a connection created against a temp file DB reports `journal_mode = wal` and that a second connection can write while the first holds the file open (busy_timeout exercised).

**Inputs**:
- Read: packages/db/src/connection.ts, docker/server-entrypoint.sh, packages/db/src/bootstrap.ts, packages/db/src/bootstrap.test.ts.

**Outputs**:
- Modify: packages/db/src/connection.ts, packages/db/src/bootstrap.test.ts (or a new connection test file following package test conventions).

**Validation Criteria**:
- All global gates pass.
- New test proves WAL is active and a concurrent-writer scenario does not throw `SQLITE_BUSY` within the timeout.

**Dependencies**: None (file-disjoint from 1.1; sequenced to keep db package changes in one review window).

### 1.3 Web bundle: devtools gating, startup waterfall, nginx

**Requirements**:
- Devtools gating: create `/home/didi/workspace/FeedElity/apps/web/src/components/dev-tools.tsx` rendering both `<SolidQueryDevtools />` and `<TanStackRouterDevtools />`. In `/home/didi/workspace/FeedElity/apps/web/src/routes/__root.tsx` remove the unconditional renders (lines 26-27) and the top-level devtools imports; import the new component via `lazy(() => import("@/components/dev-tools"))` (solid-js `lazy`) and render `<Show when={import.meta.env.DEV}><Suspense><LazyDevTools /></Suspense></Show>`. The prod build must NOT include devtools in the main chunk (code-split chunk, unreferenced at runtime because the constant is false).
- Startup waterfall:
  - In `/home/didi/workspace/FeedElity/apps/web/src/components/app-shell.tsx` (lines 1140-1143): delete the `client.session.current()` resource; derive `isAuthenticated` from the already-present `authClient.useSession()` hook (`session().data !== undefined` / `session().isPending` handled so behavior matches: not authenticated while pending). Grep for other `client.session.current` usages before deleting anything from the router.
  - Creators double-fetch (decision D11): compute settings settlement via `settings.state` (`"pending"` while first fetch in flight). `creatorsResourceInput` (app-shell.tsx:364-369 path) returns `null` when `isAuthenticated() && settings.state === "pending"`; otherwise the normal key. Anonymous behavior unchanged (fetches immediately).
  - Verify in code review that settings/contentStatuses/subscriptions/playlists/collections/favoriteItems are independent resources that now all key off the same `isAuthenticated` memo (no sequential awaits). No batch link (D12).
- nginx (`/home/didi/workspace/FeedElity/docker/nginx.conf`):
  - Add `gzip_comp_level 6;` next to the existing gzip directives.
  - In the asset regex location block (lines 53-57) re-declare the four security headers (`X-Frame-Options`, `X-Content-Type-Options`, `X-XSS-Protection`, `Referrer-Policy`) because `add_header` in a location suppresses inherited server-level headers.
  - Favicon: replace the `<link rel="icon" href="/favicon.ico" />` in `/home/didi/workspace/FeedElity/apps/web/index.html` with `<link rel="icon" type="image/svg+xml" href="/favicon.svg" />` and add a real (non-placeholder) `favicon.svg` under `/home/didi/workspace/FeedElity/apps/web/public/` — a simple, deliberate mark (e.g. rounded square with an "F" or play glyph) using the app palette; no TODO art.

**Inputs**:
- Read: apps/web/src/routes/__root.tsx, apps/web/src/components/app-shell.tsx, apps/web/src/main.tsx, apps/web/index.html, apps/web/vite.config.ts, docker/nginx.conf, apps/web/src/lib/auth-client.ts, apps/web/src/utils/orpc.ts.

**Outputs**:
- Create: apps/web/src/components/dev-tools.tsx, apps/web/public/favicon.svg.
- Modify: apps/web/src/routes/__root.tsx, apps/web/src/components/app-shell.tsx, apps/web/index.html, docker/nginx.conf.

**Validation Criteria**:
- All global gates pass (web tests ≥ 114; update any test asserting the devtools markup or session resource if present).
- `apps/web/dist` after build: main JS chunk contains no `SolidQueryDevtools`/`TanStackRouterDevtools` code; a separate devtools chunk exists but is not preloaded (inspect dist file list + grep).
- `gzip -6 -c dist/assets/<main>.js | wc -c` recorded and strictly smaller than `gzip -1` output; dist contains `favicon.svg`.

**Dependencies**: None (file-disjoint from 1.1/1.2).

### 1.4 Performance measurement report

**Type**: Measurement (dispatch a read-only validator-style agent; it must not modify code)

**Requirements**:
- Produce before/after numbers into the phase report (recorded as text in the dispatch result):
  - EXPLAIN QUERY PLAN before (index dropped on a scratch copy) vs after: prove "SEARCH content_item using index" with no `TEMP B-TREE`.
  - Serialized list payload size: a bun script against a seeded temp DB (≥ 50 items, realistic titles/descriptions) calling `listCatalogContentItems` and `JSON.stringify`-ing the result; record KB before (with description/metadataJson) vs after (slim). Target ~95.4KB → ~30KB per 50 rows.
  - Dist JS main-chunk size before/after (git stash or rebuild from main if needed) + gzip -1 vs gzip -6 sizes.
  - Note WAL sidecar expectation for ops.
- No long-running servers: use temp DBs, scripts, and dist artifacts only.

**Validation Criteria**: Report contains all four measurement pairs with concrete numbers.

**Dependencies**: 1.1, 1.2, 1.3 complete.

---

## Phase 2: Playback resume — backend position storage (F1a)

**Type**: Sequential

**Requirements** (decision D1: metadataJson on the "opened" row; zero DDL):
- Domain (`/home/didi/workspace/FeedElity/packages/api/src/domain/overlays.ts`): add `PlaybackPositionMetadata` interface `{ positionSeconds: number; durationSeconds: number | null; updatedAt: string }` documenting that it is stored under the `playback` key inside `content_status.metadataJson` on the `opened` row (UTC ISO `updatedAt`).
- Repository (`/home/didi/workspace/FeedElity/packages/api/src/repositories/overlays.ts`): add named export `upsertPlaybackPositionForUser(db, { userId, contentItemId, positionSeconds, durationSeconds })`:
  - Load existing `opened` row via `getContentStatusForUser`; parse its `metadataJson` as a JSON object (malformed → treat as `{}`); set `metadata.playback = { positionSeconds, durationSeconds ?? null, updatedAt: new Date().toISOString() }`; write back.
  - Insert-with-update semantics (idempotent): if no `opened` row, create it (reuse `findOrCreateContentStatus`) then update its metadata; if present, `db.update` the row's `metadataJson` (the `$onUpdate` timestamp bumps `updated_at` automatically). Return the resulting `UserContentStatus`. Never insert duplicate rows — the unique triple (schema/overlays.ts:57) is the invariant.
  - Validate inputs at the function boundary too (positionSeconds integer ≥ 0; durationSeconds null or integer ≥ 0), rethrowing with context.
- Router (`/home/didi/workspace/FeedElity/packages/api/src/routers/index.ts`): add protected procedure `overlays.savePlaybackPosition` with zod input `{ contentItemId: string min 1, positionSeconds: int 0..86400, durationSeconds: int 0..86400 optional }`; 404 if the content item does not exist (follow `markContentOpened` :547-559); returns `{ status: UserContentStatus }`. The metadata travels to the web already (listContentStatusesForUser carries metadataJson).
- Tests (public interfaces):
  - repositories.test.ts: upsert creates the opened row when absent; preserves other metadata keys; merges repeated saves (last write wins); malformed existing metadataJson does not crash.
  - New `routers/playback-api.test.ts` (follow settings-api.test.ts harness): anonymous call rejected; authenticated save persists and returns status; unknown contentItemId → NOT_FOUND; boundary values rejected by zod.

**Inputs**:
- Read: packages/db/src/schema/overlays.ts, packages/api/src/domain/overlays.ts, packages/api/src/repositories/overlays.ts (findOrCreateContentStatus :330-362, getContentStatusForUser :376-391), packages/api/src/routers/index.ts, packages/api/src/routers/settings-api.test.ts (harness pattern).

**Outputs**:
- Modify: packages/api/src/domain/overlays.ts, packages/api/src/repositories/overlays.ts, packages/api/src/repositories/repositories.test.ts, packages/api/src/routers/index.ts.
- Create: packages/api/src/routers/playback-api.test.ts.

**Validation Criteria**:
- All global gates pass (api ≥ 175 + new tests, zero failures).
- Round-trip test: save position → `overlays.contentStatuses` shows the opened row with parseable `metadataJson.playback`.
- Idempotency: saving the same position twice yields exactly one `opened` row for the item.

**Dependencies**: Phase 1 complete (sequential ordering keeps db/api lanes conflict-free).

---

## Phase 3: Playback resume — player surfaces and tracking (F1b)

**Type**: Sequential

**Requirements**:
- Contract helpers (`/home/didi/workspace/FeedElity/apps/web/src/components/app-shell.contract.ts`), each pure and unit-tested:
  - `toPlaybackPosition(metadataJson: string | null): PlaybackPosition | null` — validated narrow parser (same discipline as `toYoutubeNoCookieFromSettings` :630-654): parses JSON, requires `playback.positionSeconds` finite number ≥ 0, optional finite `durationSeconds` ≥ 0; returns `{ positionSeconds, durationSeconds }` or null. Never throws.
  - `toEmbedUrlWithApi(embedUrl: string, appOrigin: string): string | null` — only for hosts `www.youtube-nocookie.com` / `www.youtube.com` (parse with `new URL`, https only): sets `enablejsapi=1` and `origin=<appOrigin>` params, preserves existing params; returns null for any other host or unsafe URL. `formatPlaybackPosition(position: PlaybackPosition): string` — "12:34 / 45:00" style using `formatContentDuration` formatting rules; null-safe.
  - `shouldFlushPlaybackPosition({ lastSavedSeconds, nextSeconds, lastSavedAtMs, nowMs }): boolean` — true when never saved, ≥ 10s since last save, ≥ 5s position delta, or forced flush. Pure throttle logic for tests.
- YouTube bridge module `/home/didi/workspace/FeedElity/apps/web/src/lib/youtube-player-bridge.ts` (AGENTS.md nuance, stated explicitly: this module is a contained external transport boundary to YouTube's documented IFrame API — postMessage per the provider's public protocol. It is NOT app-internal custom-event architecture and does not reintroduce document-wide custom events; no other module touches `postMessage`/`message` events for playback):
  - `createYouTubePlaybackTracker(options: { iframe: HTMLIFrameElement; onPosition: (position: { positionSeconds: number; durationSeconds: number | null; ended: boolean }) => void; onEnded: () => void })` returning `{ dispose(): void }`.
  - Message listener on `window` filtered BOTH by `event.source === iframe.contentWindow` AND origin allowlist `["https://www.youtube-nocookie.com", "https://www.youtube.com"]`; everything else ignored.
  - Handshake: post `{ event: "listening" }` to `iframe.contentWindow` (target origin = the iframe's URL origin); on the player's `onReady`/`infoDelivery` flow, poll ~1/s while state is playing using `getParameter`/`getCurrentTime`/`getDuration` command posts; deliver state changes (`onStateChange` data) including `ended` (state 0).
  - 5-second handshake timeout: if the player never acknowledges, `dispose` the tracker silently (no saving, no console spam) — degradation path for blocked third-party cookies/JS.
- Viewer wiring (`/home/didi/workspace/FeedElity/apps/web/src/components/app-shell-viewer.tsx`):
  - Extend `PlaybackSurface` props: `resumePosition: () => PlaybackPosition | null`, `onPositionUpdate: (positionSeconds: number, durationSeconds: number | null) => void`, `onNearEnd: () => void`, `onExplicitEnded: () => void`.
  - Embed path: render the iframe with `src = toEmbedUrlWithApi(url, window.location.origin)` when the source is YouTube (fall back to bare `url` for non-YouTube embeds with no tracker); attach ref; instantiate the tracker in `onMount`, `dispose` in `onCleanup`; flush pending position in `onCleanup` (video switch/close).
  - Native path: keep `<video controls>`; add `onLoadedMetadata` (seek to `resumePosition().positionSeconds` only when `< durationSeconds − 10`), `onTimeUpdate` (throttle via `shouldFlushPlaybackPosition` → `onPositionUpdate`; near-end detection → `onNearEnd` once), `onPause` (flush), `onEnded` (`onExplicitEnded`), plus flush in `onCleanup`.
  - **Remove** the `onPlay={props.onNativePlay}` auto-mark (decision D2); delete the now-unused `onNativePlay` prop. Near-end OR `ended` triggers `autoMarkSelectedContentPlayed` exactly once per playback session (guard flag).
- App-shell glue (`/home/didi/workspace/FeedElity/apps/web/src/components/app-shell.tsx`):
  - Add `onPlaybackPositionSaved` flow: `SelectedContentViewer` gets a new prop `onPlaybackPositionSaved: (status: UserContentStatus) => void`; the viewer calls `client.overlays.savePlaybackPosition(...)` (only when `props.isAuthenticated()` and the active source is tracked: native video OR YouTube embed) and forwards the returned status; app-shell patches `contentStatuses` in place via the existing `patchContentStatus` (:1235-1240) — no refetch, no suspense.
  - Viewer-level flush on `pagehide` and on `visibilitychange` → hidden (registered in `SelectedContentViewer` with `onCleanup`), following the existing event-listener + `onCleanup` pattern (user-menu.tsx:26-38 precedent).
- Tests (web, `bun test --conditions browser`): contract helper tests (parser happy/garbage paths, embed URL allowlist/rejection, throttle logic, position formatting). Bridge behavior is covered by reasoning + contract tests per the no-live-network rule; a validator must specifically review the bridge's origin/source filtering, timeout disposal, and cleanup paths line-by-line.

**Inputs**:
- Read: apps/web/src/components/app-shell-viewer.tsx (PlaybackSurface :522-551, viewer props :40-60), apps/web/src/components/app-shell.tsx (:1235-1297 status patchers), apps/web/src/components/app-shell.contract.ts, apps/web/src/components/user-menu.tsx (listener pattern), packages/api/src/domain/overlays.ts (Phase 2 type), packages/api/src/sources/youtube.ts (:23 nocookie base).

**Outputs**:
- Create: apps/web/src/lib/youtube-player-bridge.ts.
- Modify: apps/web/src/components/app-shell.contract.ts (+ app-shell.contract tests), apps/web/src/components/app-shell-viewer.tsx, apps/web/src/components/app-shell.tsx, apps/web/src/components/app-shell.test.ts.

**Validation Criteria**:
- All global gates pass (web ≥ 114 + new tests).
- Validator reasoning checklist (recorded in report): tracker disabled after handshake timeout produces zero saves; iframe reload/content switch disposes exactly one tracker; no save path runs for anonymous users; Odysee/PeerTube embeds render with unmodified src and no tracker.
- No `postMessage`/`message` usage outside the bridge module (grep).

**Dependencies**: Phase 2 complete.

---

## Phase 4: Playback resume — restore + list progress UI (F1c)

**Type**: Sequential

**Requirements**:
- List progress (`/home/didi/workspace/FeedElity/apps/web/src/components/app-shell-content-column.tsx`): build `playbackPositionByItemId = createMemo(() => Map<string, PlaybackPosition>)` from `props.contentStatuses()` via `toPlaybackPosition` (opened rows only); pass a new prop `playbackPosition: () => PlaybackPosition | null` into each `ContentListItemRow`.
- Row UI (`/home/didi/workspace/FeedElity/apps/web/src/components/app-shell-rows.tsx`): `ContentListItemRow` renders the duration slot as `formatPlaybackPosition(position)` ("12:34 / 45:00") when a position exists, with `data-content-playback-progress` and an `aria-label` like "Resume at 12:34 of 45:00"; hide the badge entirely when no position (scope cut: embed-only PeerTube/Odysee items get none). Duration-only display unchanged when position is null.
- Restore paths (already partly in Phase 3): verify end-to-end that (a) native `<video>` seeks on `onLoadedMetadata` with the `< duration − 10s` guard, (b) YouTube embed src carries `start=<floor(position)>` when `positionSeconds ≥ 10` — extend `toEmbedUrlWithApi` signature to accept an optional `startSeconds` and set `start` only for allowlisted hosts; (c) reopening a finished (near-end) video does NOT auto-resume to the end — if remaining < 10s, ignore resume.
- Tests: web contract tests for the extended `toEmbedUrlWithApi` (start param) and a content-column test asserting the progress prop derivation from `contentStatuses` (follow existing app-shell.test.ts derivation-test style).

**Inputs**:
- Read: apps/web/src/components/app-shell-content-column.tsx (:433-465 memos, :767-792 list render), apps/web/src/components/app-shell-rows.tsx (ContentListItemRow :322-470), apps/web/src/components/app-shell.contract.ts.

**Outputs**:
- Modify: apps/web/src/components/app-shell-content-column.tsx, apps/web/src/components/app-shell-rows.tsx, apps/web/src/components/app-shell.contract.ts, apps/web/src/components/app-shell.test.ts.

**Validation Criteria**:
- All global gates pass (web ≥ baseline + new).
- Manual-reasoning trace recorded by validator: select video → play 5 min → close → row shows "5:00 / …" → reopen → player resumes (native: currentTime; YT: start param) → near-end auto-marks played once.

**Dependencies**: Phase 3 complete.

---

## Phase 5: Virtualized content list (F8)

**Type**: Sequential (deliberately BEFORE keyboard shortcuts, decision: j/k must land on the final scroll mechanism)

**Requirements**:
- Add dependency `@tanstack/solid-virtual` to `/home/didi/workspace/FeedElity/apps/web/package.json` (latest 3.x; peer solid-js compatible). After install, verify the exact export name (`createVirtualizer`) from the installed dist types and record it — do not assume.
- `/home/didi/workspace/FeedElity/apps/web/src/components/app-shell-content-column.tsx`:
  - Add a desktop signal via `window.matchMedia("(min-width: 1024px)")` with change listener + `onCleanup` (same pattern as app-shell.tsx:1383-1387). Decision D10: virtualize lg-only; below lg keep the existing `<For>` branch and unchanged `contentScrollRegionClass`.
  - Ref the scroll region div (`:741`, add local `let contentScrollRegionEl: HTMLDivElement | undefined` — the region must have `data-content-scroll-region`, which it does). lg path: `createVirtualizer({ count: displayedContentItems().length, getScrollElement: () => contentScrollRegionEl ?? null, estimateSize: (index) => density-aware estimate (compact vs comfortable; derive from `props.readerDensity()`), overscan: 5, getItemKey: (index) => displayedContentItems()[index]?.id ?? index })`.
  - Replace the `<For>` body (:769-792) on the lg path with absolutely-positioned virtual rows inside a relatively-positioned container sized `virtualizer.getTotalSize()`; each row renders the SAME `ContentListItemRow` inside the existing `<li>` (add `data-content-item-id={contentItem.id}` on the `<li>` — required later by j/k), using `measureElement` ref for variable heights.
  - Keep `displayedContentItems`, `mergeStableItemReferences` (:133-138, mitigates thumbnail re-fetch on scroll-back via DOM reuse where references survive), pagination (`ContentLoadMoreControl` stays explicit; no auto-load), empty/error/loading Matches untouched.
  - Re-measure on density change: key the virtualizer option object on `props.readerDensity()` (or call `virtualizer.measure()` in an effect on density) so cached sizes invalidate.
- Update `/home/didi/workspace/FeedElity/apps/web/src/components/app-shell.test.ts`: tests asserting the plain `<For>` markup (~:455+) must now accept both branches or target the mobile path explicitly; keep assertions behavioral (rows render, data attributes present) per AGENTS.md (no brittle implementation-order assertions).
- Record in the phase report: exact `createVirtualizer` import path verified from node_modules types; confirmation that `estimateSize` reacts to density.

**Inputs**:
- Read: apps/web/src/components/app-shell-content-column.tsx (whole file), apps/web/src/components/app-shell-rows.tsx (:25-27 density padding, :322+ row), apps/web/src/components/app-shell.test.ts, apps/web/package.json.

**Outputs**:
- Modify: apps/web/package.json (+ bun.lock via install), apps/web/src/components/app-shell-content-column.tsx, apps/web/src/components/app-shell.test.ts.

**Validation Criteria**:
- All global gates pass.
- bun install resolves `@tanstack/solid-virtual`; `check-types` proves the hook signature usage.
- App-shell tests still verify list behavior through rendered markup (both branches where applicable).
- Code review: no change to `displayedContentItems` semantics; mobile branch untouched; `getItemKey` stable by id.

**Dependencies**: Phases 1–4 complete (works on the slim row shape).

---

## Phase 6: Keyboard shortcuts (F3)

**Type**: Sequential

**Requirements** (decision D5: no Space binding):
- Pure keymap module `/home/didi/workspace/FeedElity/apps/web/src/lib/keyboard-shortcuts.ts`:
  - `export type ShortcutAction = "move-down" | "move-up" | "open-active" | "focus-creator-search" | "clear-selection" | "toggle-favorite" | "go-library" | "go-catalog";`
  - `resolveShortcut(event: { key: string; ctrlKey: boolean; metaKey: boolean; altKey: boolean }, gPrefixActive: boolean): ShortcutAction | null` — pure: `j`/`J`→move-down, `k`/`K`→move-up, `Enter`→open-active, `/`→focus-creator-search, `Escape`→clear-selection, `f`→toggle-favorite, `g` sets prefix (returns null) and the NEXT key `l`→go-library, `c`→go-catalog; any modifier (ctrl/meta/alt) → null; unknown → null. Fully unit-tested.
  - `isShortcutTargetBlocked(target: EventTarget | null): boolean` — true for input/textarea/select/contentEditable targets; plus `isDialogOpen(): boolean` checking `document.querySelector("dialog[open]") !== null` (covers RefreshStatusDialog native `<dialog>`; verified: that is the only dialog pattern in the app).
- Single window keydown listener with `onCleanup`, registered in `AppShell` (app-shell.tsx) following the user-menu.tsx:26-38 pattern. Handlers:
  - j/k: `ContentListColumn` owns `activeIndex` (new signal, clamped to `displayedContentItems().length − 1`, reset to 0 when `contentItemsResourceKey` changes). Exposed via new props on `ContentListColumn`: `onActiveMove: (delta: 1 | -1) => void`, `onOpenActive: () => Promise<void>`, and a way for app-shell to trigger focus-search/clear. Active row gets the SAME highlight styling as `selected()` (extend `ContentListItemRow` with an `active: () => boolean` prop mapping to the selected-style classes, and set `aria-current="true"` only for the actually-selected row to avoid lying to AT — active gets `data-active="true"` + ring styling). Scroll: on lg, call `virtualizer.scrollToIndex(activeIndex)`; below lg, look up `[data-content-item-id="…"]` inside the scroll region and `scrollIntoView({ block: "nearest" })` with the pending-scroll retry pattern (app-shell.tsx:466-510 precedent).
  - Enter: opens the active row via `props.onSelectContent(displayedContentItems()[activeIndex()])` (no-op when the list is empty).
  - `/`: `document.getElementById(creatorSearchInputId)?.focus()` (stable id, contract:104) and preventDefault.
  - Escape: `clearSelectedCreator()` (app-shell.tsx:1229) + clear both column searches: add a `searchClearKey` signal in app-shell; `CreatorSourceColumn` and `ContentListColumn` watch it (effect `on(..., { defer: true })`) and reset their local `search` signals.
  - f: toggle favorite of the ACTIVE row — reuse the content-column `toggleFavorite` (:485) path so refetch semantics match.
  - g l / g c: `useRouter().navigate({ to: "/dashboard" })` (library; the route's beforeLoad auth-guard redirects anonymous users to login, verified `_shell.dashboard.tsx:9-23`) and `{ to: "/" }` (catalog).
  - Guards: ignore when `isShortcutTargetBlocked(event.target)` or `isDialogOpen()`; g-prefix cancels on any non-matching follow-up key.
- Tests: unit tests for `resolveShortcut` and `isShortcutTargetBlocked` (web package). App-shell tests: contract-level wiring assertions (activeIndex clamp/reset logic as pure helper `clampActiveIndex(index, length)` exported from the keymap module and tested).

**Inputs**:
- Read: apps/web/src/components/app-shell.tsx, apps/web/src/components/app-shell-content-column.tsx, apps/web/src/components/app-shell-rows.tsx, apps/web/src/components/app-shell.contract.ts (:104 creatorSearchInputId), apps/web/src/routes/_shell.dashboard.tsx, apps/web/src/components/user-menu.tsx, apps/web/src/components/app-shell.test.ts.

**Outputs**:
- Create: apps/web/src/lib/keyboard-shortcuts.ts (+ tests file following web test conventions).
- Modify: apps/web/src/components/app-shell.tsx, apps/web/src/components/app-shell-content-column.tsx, apps/web/src/components/app-shell-rows.tsx, apps/web/src/components/app-shell.test.ts.

**Validation Criteria**:
- All global gates pass (web ≥ baseline + keymap tests).
- j/k scrolls via `scrollToIndex` on lg (Phase 5 virtualizer) and via row lookup below lg — validator verifies BOTH call sites exist and the virtualizer path passes the active index.
- Shortcuts dead while a `<dialog>` is open and while typing in any field (tests for the pure guards; review for the wiring).

**Dependencies**: Phase 5 complete (binding order).

---

## Phase 7: Unread counts + mark-all-read (F2)

### 7.1 Backend: unread counts + bounded mark-opened

**Type**: Sequential

**Requirements** (decisions D3, D4):
- Domain (`packages/api/src/domain/overlays.ts`): add `CreatorUnreadSummary { creatorId: string; unreadCount: number; lastContentPublishedAt: Date | null }`.
- Repository (`packages/api/src/repositories/overlays.ts`): add named exports:
  - `listCreatorUnreadForUser(db, userId): Promise<readonly CreatorUnreadSummary[]>` — ONE grouped query over the user's `subscription` rows joined to `content_item`, with threshold `coalesce(content_item.published_at, content_item.created_at) > coalesce(threshold.value_json_ts, subscription.created_at)` where the threshold comes from `user_setting` key `'unread.threshold.' || subscription.creator_id` (value stored as `JSON.stringify(<epoch ms number>)`; parse tolerantly, malformed → treated as absent), and `NOT EXISTS (SELECT 1 FROM content_status cs WHERE cs.user_id = :userId AND cs.content_item_id = content_item.id AND cs.status IN ('opened','played'))`; `GROUP BY` creator, `COUNT` as unreadCount, plus `MAX(lastContentPublishedAt)` per creator for badge freshness. Order by unreadCount desc then creator displayName for deterministic output. Cross-check with the native SQL builder style already used in the repo (`sql<number>` subselects in repositories/catalog.ts:734-755 are the precedent).
  - `markCreatorContentOpenedForUser(db, { userId, creatorId, markedBeforeMs })`: bounded idempotent bulk insert — `INSERT INTO content_status (id, user_id, content_item_id, status, metadata_json) SELECT ... ` for items matching the unread predicate, `ON CONFLICT (user_id, content_item_id, status) DO NOTHING`, `LIMIT 1000`, newest first; then `saveUserSetting` (existing :936, onConflictDoUpdate) writing `'unread.threshold.' + creatorId` = `JSON.stringify(markedBeforeMs)`. Return `{ markedCount }`. Only `opened` rows — never fabricate `played` (D4). Verify creator ownership: creatorId must be subscribed by userId, else return `{ markedCount: 0 }` (or router 404s first — see below).
  - `markAllCreatorsContentOpenedForUser(db, { userId, markedBeforeMs })`: loop the user's subscribed creator ids through the same per-creator bounded logic (aggregate `{ markedCount }`).
- Router (`packages/api/src/routers/index.ts`), all `protectedProcedure`, all scoped by `context.session.user.id`:
  - `overlays.unreadCounts` (no input) → `CreatorUnreadSummary[]`.
  - `overlays.markCreatorContentOpened` `{ creatorId }` → 404 via `getCatalogCreatorSummaryById` if unknown; 404 (`ORPCError`) if not subscribed; returns `{ markedCount, summaries? }` — keep it `{ markedCount }`.
  - `overlays.markAllContentOpened` (no input) → `{ markedCount }`.
- Tests: repositories.test.ts (threshold default = subscription.createdAt; threshold setting respected; malformed threshold tolerated; already opened/played excluded; re-run of mark is a no-op — idempotency; 1000-cap honored via seeded fixture). New `routers/unread-api.test.ts` (anonymous rejected; cross-user isolation: user B's statuses never affect user A's counts; unknown creator 404).

**Inputs**:
- Read: packages/db/src/schema/overlays.ts (unique triple :57, userSetting :166-182), packages/api/src/repositories/overlays.ts (saveUserSetting :936-954, listSubscriptionsWithCreatorsForUser :195-215), packages/api/src/routers/index.ts (:204-215 key regex, :498+ overlays), packages/api/src/repositories/catalog.ts (:734-755 sql subselect precedent), packages/api/src/routers/settings-api.test.ts.

**Outputs**:
- Modify: packages/api/src/domain/overlays.ts, packages/api/src/repositories/overlays.ts, packages/api/src/repositories/repositories.test.ts, packages/api/src/routers/index.ts.
- Create: packages/api/src/routers/unread-api.test.ts.

**Validation**:
- Global gates; api ≥ 175 + new.
- Cross-user isolation test passes (release-blocker check per AGENTS.md).
- Idempotency: double mark-all → second returns markedCount 0.

**Dependencies**: Phase 6 complete (ordering only; files disjoint).

### 7.2 Web: badges + mark-all affordances

**Type**: Sequential

**Requirements**:
- `AppShell` fetches `client.overlays.unreadCounts()` behind an authenticated resource keyed by `subscriptionsReloadKey` (+ initial mount) so counts refresh after subscribe/unsubscribe/refresh actions; memo map creatorId → summary; pass down to `CreatorSourceColumn`.
- `CreatorSourceRow` (`apps/web/src/components/app-shell-rows.tsx:90-170`): new optional prop `unreadCount: () => number | null` (null = not applicable/anonymous); library mode only (ContentListColumn's sibling CreatorSourceColumn passes it only when `props.mode === "library"` and authenticated). Render a compact numeric badge (`data-creator-unread-count`, tabular-nums, muted style consistent with the existing chips) next to the display name; hidden when 0 or null.
- Mark-all affordances following the existing compact button patterns:
  - Per creator: a hover action button in `CreatorSourceRow`'s existing hover actions cluster (`data-mark-creator-read={creatorId}`), calling `client.overlays.markCreatorContentOpened({ creatorId })`, then bumping `subscriptionsReloadKey`/unread resource; disabled while in flight; error surfaced through the column's existing error text pattern.
  - Global: a button in the creator column header row (next to sort/filter; `data-mark-all-read`, authenticated + library mode only) calling `overlays.markAllContentOpened`, then reloading counts. No confirm dialog needed (additive, idempotent).
- Tests (web): derivation + wiring tests — badge appears for count > 0 in library mode only; global button issues the right client call (mocked client following existing app-shell.test.ts stub patterns).

**Inputs**:
- Read: apps/web/src/components/app-shell.tsx (CreatorSourceColumn props :244-273, header :781-944), apps/web/src/components/app-shell-rows.tsx (:77-170), apps/web/src/components/app-shell.test.ts.

**Outputs**:
- Modify: apps/web/src/components/app-shell.tsx, apps/web/src/components/app-shell-rows.tsx, apps/web/src/components/app-shell.test.ts.

**Validation**:
- Global gates; web ≥ baseline + new.
- Badge absent for anonymous users and catalog mode (test asserts).

**Dependencies**: 7.1 complete.

---

## Phase 8: Feed health dashboard + retention (F6)

### 8.1 Backend: health metrics + retention prune

**Type**: Sequential

**Requirements** (decisions D7, D8):
- Domain (`packages/api/src/domain/catalog.ts`): add `FeedHealthEntry { feedId; feedTitle; feedUrl; sourceType; creatorId; creatorDisplayName; nextRefreshAfter: Date | null; lastAttemptAt: Date | null; lastSuccessAt: Date | null; consecutiveFailureCount: number; lastErrorCode: string | null; lastErrorMessage: string | null; itemsCreatedTotal: number }`.
- Repository (`packages/api/src/repositories/catalog.ts`): `listFeedHealth(db, input { limit })` (default 200, max 500): all feeds joined `creator`; for each feed the latest `refresh_feed_result` rows (bounded window: latest 10 per feed via a correlated subselect on `started_at`) from which the mapper computes: `lastAttemptAt` = max started_at, `lastSuccessAt` = max completed_at where status='succeeded', `consecutiveFailureCount` = trailing run of status='failed' in the window (scanned in the mapper, not SQL), `lastErrorCode/lastErrorMessage` = first parsed entry of the newest failed row's `errorSummaryJson` **kept as raw JSON string** — the web already parses it (`parseRefreshErrorSummaries`, contract:422-441; do NOT parse server-side), `itemsCreatedTotal` = SUM(items_created_count) over the retained rows. Deterministic ordering: consecutiveFailureCount desc, then oldest lastSuccessAt (nulls first) — or return unsorted and let the client sort; pick ONE and document (recommend: repository returns sorted by `feed.url` for determinism; the client sorts by staleness/failures).
- Retention (D8):
  - `packages/api/src/services/refresh.ts`: after each run reaches a terminal state (both `refreshAll` and `startRefreshAll`'s background process path), invoke a new exported `pruneRefreshFeedResultsForRetention(db, { olderThanMs })` — single DELETE `WHERE started_at < :cutoff` (30 days). Called with `now()`; errors rethrown with context (do not swallow — wrap: prune failure must not fail the run report, so catch, `console.error` with context, and continue; this is a handled, logged degradation, not a silent swallow — document the choice in a comment).
  - `packages/db/src/migrations/catalog-data-migrations.ts`: one-time step `refresh_feed_result_retention` — `DELETE FROM refresh_feed_result WHERE started_at < (cast(unixepoch() - 30*86400 as integer) * 1000)` and report the deleted row count in `details`.
- Router (`packages/api/src/routers/index.ts`): `overlays.feedHealth` — **protectedProcedure** (D7), input `{ limit: int 1..500 default 200 optional }`. Leave `refresh.status` untouched (D7 note recorded).
- Tests: repositories test (metrics computed from seeded runs: consecutive-failure counting incl. window edge, null-safe lastSuccess); services/refresh.test.ts extension (prune invoked on completion, deletes only old rows); new `routers/feed-health-api.test.ts` (anonymous rejected; authenticated returns entries).

**Inputs**:
- Read: packages/db/src/schema/catalog.ts (:42-69 feed, :150-199 refresh tables), packages/api/src/repositories/catalog.ts (:815-860 refresh run queries), packages/api/src/services/refresh.ts, packages/api/src/domain/catalog.ts (:160-213 refresh types), packages/db/src/migrations/catalog-data-migrations.ts.

**Outputs**:
- Modify: packages/api/src/domain/catalog.ts, packages/api/src/repositories/catalog.ts, packages/api/src/repositories/repositories.test.ts, packages/api/src/services/refresh.ts, packages/api/src/services/refresh.test.ts, packages/api/src/routers/index.ts, packages/db/src/migrations/catalog-data-migrations.ts (+ its test).

**Validation**:
- Global gates (api/db ≥ baselines + new).
- `bun run db:repair` dry-run lists `refresh_feed_result_retention`.
- Validator verifies the prune error path is logged-and-continued (not silent) and that health entries never include user-owned overlay data.

**Dependencies**: 7.2 complete.

### 8.2 Web: health list + confirm-dialog + bulk unsubscribe

**Type**: Sequential

**Requirements**:
- Backend companion (small, same sub-phase to keep the API surface coherent): `overlays.bulkUnsubscribe` protectedProcedure, input `{ creatorIds: array(string min 1) max 100 }` (array pattern follows `batchAddSourcesInput`, routers/index.ts:228-230), loops `unsubscribeFromCreatorForUser`, returns `{ unsubscribedCount, missingCreatorIds }`.
- Web client procedure calls + new `apps/web/src/components/feed-health-dialog.tsx`, modeled directly on `RefreshStatusDialog` (native `<dialog>`, ref signal, `createEffect` open/close :27-44):
  - Trigger: a button in the creator column actions region (`data-feed-health-trigger`, authenticated only), placed in the `sourceActionsRegionClass` area beside the RefreshStatusDialog mount (app-shell.tsx:1122-1129).
  - Data: fetched on open via `client.overlays.feedHealth({})`; rows sorted client-side by consecutiveFailureCount desc, then stale-est lastSuccessAt; each row: creator displayName, feed title/URL (truncated link, like RefreshStatusDialog :120-129), source chip (`SourceIconBadge`), status pill, "last success Xd ago" / "never", consecutive failure count with `TriangleAlert` when ≥ 2, last error via `parseRefreshErrorSummaries` + `formatRefreshErrorCodeLabel` (contract:422-481), `data-feed-health-row={feedId}` attributes.
  - Per-row and bulk actions: row-level "Unsubscribe creator" and a bulk "Unsubscribe failed-feed creators" button; both go through the new confirm dialog (below) and then `overlays.bulkUnsubscribe`, then bump `subscriptionsReloadKey` + refetch health.
- First confirm-dialog pattern: `apps/web/src/components/confirm-dialog.tsx` — generic-but-minimal (title, body text, confirm label, destructive styling, cancel), native `<dialog>` like RefreshStatusDialog, `data-confirm-dialog` attributes; `props.open/props.onConfirm/props.onCancel`. (One real repeated use here: row + bulk paths; not speculative.)
- Tests (web): contract-level tests — dialog renders rows from a fixture health payload; destructive actions route through the confirm dialog (confirm required before the client call fires, cancel fires nothing); sorting order function (pure exported `sortFeedHealthEntries` in the contract file, unit-tested).

**Inputs**:
- Read: apps/web/src/components/refresh-status-dialog.tsx (whole), apps/web/src/components/app-shell.tsx (:1122-1129 actions region), apps/web/src/components/app-shell.contract.ts (:392-481 error parsing), packages/api/src/routers/index.ts (:228-230 array pattern, :531-543 unsubscribe).

**Outputs**:
- Modify: packages/api/src/routers/index.ts, packages/api/src/routers/unread-api.test.ts or new routers/bulk-unsubscribe-api.test.ts, apps/web/src/components/app-shell.tsx, apps/web/src/components/app-shell.contract.ts, apps/web/src/components/app-shell.test.ts.
- Create: apps/web/src/components/feed-health-dialog.tsx, apps/web/src/components/confirm-dialog.tsx.

**Validation**:
- Global gates; api + web ≥ baselines + new.
- Phase-wide (8.1+8.2) review: health data carries NO user overlay fields; bulk unsubscribe is userId-scoped; confirm dialog blocks direct destructive calls (no `window.confirm` anywhere — grep).

**Dependencies**: 8.1 complete.

---

## Phase 9: Export / import user data (F4)

### 9.1 Backend: export + idempotent import

**Type**: Sequential

**Requirements**:
- Schema module `packages/api/src/migration/user-data-schema.ts`: zod `.strict()` schemas for the portable envelope (pattern: strapi-export.ts:54-61) — `{ format: literal("feedelity.user-data"), version: literal(1), exportedAt: string, data: { subscriptions[], contentStatuses[], playlists[] (with items[]), collections[] (with members[]), settings[] } }` with bounded arrays (subscriptions ≤ 2000, contentStatuses ≤ 20000, playlists ≤ 200 × items ≤ 1000, collections ≤ 200 × members ≤ 500, settings ≤ 200, strings bounded like existing inputs). Attribution by natural keys: creators by `nameKey`, content by `{ sourceType, sourceExternalId }` (mirrors ingestion identity).
- Export repository/service `packages/api/src/migration/user-data-export.ts`: read all overlay rows for the authenticated userId (subscription, content_status, playlist+playlist_item, creator_collection+collection_member, user_setting) joined to catalog rows to recover natural keys (`creator.name_key`; `content_item.(source_type, source_external_id)`); assemble the envelope; EXCLUDE auth tables and never include userIds or internal row ids as identity (ids may be omitted entirely). Deterministic ordering everywhere (stable exports → stable fingerprints).
- Import `packages/api/src/migration/user-data-import.ts` (blueprint: run-migration.ts + overlay-import.ts):
  - Whole-payload fingerprint short-circuit (pattern run-migration.ts:209-224): sha-256 of the canonical JSON; persist via `saveUserSetting` key `'import.user-data.fingerprint'`; if the incoming fingerprint equals the stored one, return `{ skipped: true, report }` without writes.
  - Resolution: creators by nameKey, content by source identity. Unresolved content → **warnings, not failures** (its status/playlist/collection entry is skipped and counted); unresolved creator (subscription/collection member) → warning.
  - Idempotent writes reusing existing helpers: `findOrCreateSubscription` (:158), `findOrCreateContentStatus` (:330, metadataJson passthrough — carries F1 playback data), `saveUserSetting` (:936), playlists/collections with deterministic ids + `onConflictDoNothing` (pattern overlay-import.ts:318-359).
  - Report shape mirrors run-migration.ts:46-57/:139-170: counts per entity + warnings[] + failures[] (failures reserved for genuinely broken payloads rejected by zod, which surface as ORPCError before any write).
- Router: `overlays.exportUserData` (protected, no input) → the envelope JSON; `overlays.importUserData` (protected, input `{ exportData: unknown, sourceFilename? }` — pattern migrationImportInput :217-220) → validate → import → report. Both scoped by `context.session.user.id`.
- Settings exclusion note: the fingerprint setting itself is exported as a normal setting — harmless (re-import on another device short-circuits only if data identical; verify in the round-trip test that a changed payload still imports).
- Tests: `user-data-export.test.ts` (envelope shape, natural keys, no userId leakage — assert no UUID user ids in output); `user-data-import.test.ts` (fresh import; duplicate import no-ops via fingerprint AND via onConflict even with fingerprint cleared — double idempotency; unresolved content → warning + counted; malformed payload → failure, zero writes); `routers/user-data-api.test.ts` (anonymous rejected; **round-trip**: seed user → export → wipe overlays → import → export → the two envelopes match modulo `exportedAt`; import twice → second `skipped: true`).

**Inputs**:
- Read: packages/api/src/migration/strapi-export.ts (:54-61), packages/api/src/migration/run-migration.ts (:46-57, :139-170, :209-224), packages/api/src/migration/overlay-import.ts (:318-359), packages/api/src/repositories/overlays.ts, packages/api/src/routers/index.ts (:217-220, :785-792), packages/db/src/schema/overlays.ts.

**Outputs**:
- Create: packages/api/src/migration/user-data-schema.ts, packages/api/src/migration/user-data-export.ts, packages/api/src/migration/user-data-import.ts, + their test files, packages/api/src/routers/user-data-api.test.ts.
- Modify: packages/api/src/routers/index.ts.

**Validation**:
- Global gates; api ≥ 175 + new.
- Round-trip idempotency test is the phase's headline gate — it must pass.
- Validator greps: no `password`/`token`/`account` table reads in export code; every import write path userId-scoped.

**Dependencies**: 8.2 complete.

### 9.2 Web: settings export/import UI

**Type**: Sequential

**Requirements**:
- In the settings viewer section (`apps/web/src/components/app-shell-source-sections.tsx` — `SettingsColumnSection`): a "Data" block following the existing setting-row markup:
  - Export button (`data-export-user-data`): calls `client.overlays.exportUserData()`, wraps the JSON in a `Blob` and triggers a download named `feedelity-user-data-YYYY-MM-DD.json` (programmatic `<a download>` click); busy + error states per existing patterns; authenticated only (whole settings section already is).
  - Import: file input (`data-import-user-data-input`, accept `.json`) → read via `FileReader`/`file.text()` → `JSON.parse` guarded → `client.overlays.importUserData({ exportData })` → render the report inline (counts, warnings list, `skipped` notice); failures shown via the existing destructive text pattern. Size hint text if the file exceeds ~8MB before parsing (client-side pre-check, still bounded server-side by zod).
- No new deps. OPML cut (D6) — record in code comment block header why JSON-only (no TODO wording).
- Tests (web): wiring tests with the existing client-stub pattern — export triggers download path (stub URL.createObjectURL), import posts parsed JSON and renders warning/success report; bad file → error text, no call.

**Inputs**:
- Read: apps/web/src/components/app-shell-source-sections.tsx (SettingsColumnSection), apps/web/src/components/app-shell-viewer.tsx (:290-310 settings mount), apps/web/src/components/app-shell.test.ts.

**Outputs**:
- Modify: apps/web/src/components/app-shell-source-sections.tsx, apps/web/src/components/app-shell.test.ts.

**Validation**: Global gates; web ≥ baseline + new; manual trace recorded (export → inspect file has no user ids → import into empty user → statuses/playlists/settings restored → re-import skipped).

**Dependencies**: 9.1 complete.

---

## Phase 10: Small QOL — external player + persisted UI state (F5, F7)

(Sequential sub-phases — both may touch app-shell.test.ts; see decision D14. Backend lanes of other phases are the parallel-eligible ones, not these.)

### 10.1 Copy stream URL (F5)

**Requirements**:
- In `apps/web/src/components/app-shell-viewer.tsx` near the playback source switcher / detail body: a compact "Copy stream URL" affordance (`data-copy-stream-url`) using `navigator.clipboard.writeText` with `createSignal` "Copied" feedback for ~2s (setTimeout + onCleanup — no timer leaks):
  - Copies the **native media URL** when the currently selected playable source is `kind: "native"` (`detail().sources` → `PlayableSource.url` via the existing `toPlayableSources` memo); copies the **canonical URL** otherwise (embed-only items), labeled accordingly ("Copy stream URL" vs "Copy page link").
  - Clipboard failure (permissions/insecure context) → visible error text, no silent swallow.
  - Documented usage in `title`/`aria-label`: "Stream URL for mpv/yt-dlp" (no docs file per repo rules).
- Keep tiny: no protocol handlers, no server control. Pure helper `toCopyableStreamLink(source: PlayableSource | null): { label: string; url: string } | null` in the contract file, unit-tested (null-safe, native vs embed branches).
- Tests: contract helper tests + a viewer wiring test (button present for native source; clipboard stub called with the media URL).

**Inputs**: Read: apps/web/src/components/app-shell-viewer.tsx (:108-129 playableSources, :505-596 detail body), apps/web/src/components/app-shell.contract.ts (toPlayableSources :673-712).

**Outputs**: Modify: apps/web/src/components/app-shell-viewer.tsx, apps/web/src/components/app-shell.contract.ts, apps/web/src/components/app-shell.test.ts.

**Validation**: Global gates; web ≥ baseline + new.

**Dependencies**: Phase 9 complete.

### 10.2 Persisted UI state (F7)

**Requirements** (decision D9):
- Contract helpers (`app-shell.contract.ts`), following `readPersistedHidePlayed`/`persistHidePlayed` (:220-241) exactly — add guarded generic pair `readPersistedLocalValue(key: string): string | null` / `persistLocalValue(key: string, value: string): void` (try/catch → null/no-op), plus per-key narrow parsers (pure, tested): `toPersistedShellMode`, `toPersistedLeftPaneTab` (coerce auth-required tabs to "library" when applied anonymously — pass an `isAuthenticated` arg), `toPersistedSourceTypeFilter` (null | SourceType), `toPersistedContentViewMode` (auth-required modes coerced to the mode default — same gate arg). New key constants: `shellModeLocalStorageKey = "feedelity.shell.mode"`, `leftPaneTabLocalStorageKey = "feedelity.shell.left-tab"`, `creatorSourceFilterLocalStorageKey = "feedelity.creators.source-filter"`, `contentViewModeLocalStorageKey = "feedelity.content.view-mode"`, `contentSourceFilterLocalStorageKey = "feedelity.content.source-filter"`. Search text deliberately NOT persisted.
- Last mode + redirect: `_shell.tsx` layout persists mode on change (effect on the mode memo). `/home/didi/workspace/FeedElity/apps/web/src/routes/_shell.index.tsx` gains `beforeLoad`: `await authClient.getSession()`; ONLY when `session.data` exists AND persisted mode parses to `"library"` → `redirect({ to: "/dashboard", throw: true })`. Anonymous users never redirect (loop-safety, decision D9). Catalog mode or no preference → render null as today.
- Left-pane tab (app-shell.tsx:1156): initialize `activeTab` from persisted value (auth-coerced); persist on every `setActiveTab` (wrap in a `changeActiveTab` helper used by all tab buttons).
- Creator sourceType filter (CreatorSourceColumn `sourceType` signal, app-shell.tsx:332 area): initialize from persisted, persist on `applyCreatorSourceType`.
- Content viewMode + sourceType filter (content-column :283-285): initialize both from persisted with the auth gate applied (the existing !isAuthenticated reset effect :299-303 remains the enforcer after login-state changes); persist on change. Tension resolved: persisted `favorites` while anonymous → coerced to the mode default at init AND by the existing reset effect.
- Tests: parser tests (each coercion incl. anonymous gate); a `_shell.index` beforeLoad test if route testing conventions allow (else pure parser tests + review); wiring tests for persistence writes following existing localStorage-mocking tests (`hidePlayedLocalStorageKey` tests are the precedent — mock `localStorage` in the test).

**Inputs**: Read: apps/web/src/routes/_shell.tsx, apps/web/src/routes/_shell.index.tsx, apps/web/src/components/app-shell.tsx (:1138-1173, :332 area), apps/web/src/components/app-shell-content-column.tsx (:283-311), apps/web/src/components/app-shell.contract.ts (:213-241), apps/web/src/lib/auth-client.ts, apps/web/src/routes/_shell.dashboard.tsx (getSession pattern), apps/web/src/components/app-shell.test.ts.

**Outputs**: Modify: apps/web/src/components/app-shell.contract.ts, apps/web/src/routes/_shell.tsx, apps/web/src/routes/_shell.index.tsx, apps/web/src/components/app-shell.tsx, apps/web/src/components/app-shell-content-column.tsx, apps/web/src/components/app-shell.test.ts.

**Validation**: Global gates; web ≥ baseline + new; validator verifies no persisted search text and that the anonymous path never redirects.

**Dependencies**: 10.1 complete.

---

## Phase 11: Final verification & demand-by-demand traceability

**Type**: Sequential

**Requirements**:
- Run the full gate set from a clean state: `bun install` (idempotent), `bun run check-types`, `bun run build`, `bun run test`. Record per-package counts vs baselines (api 175+, db 35+, web 114+).
- Demand-by-demand trace table in the phase report, each row: feature → phases → key files → tests that prove it → any deliberate scope cut:
  - F1 → Phases 2-4 (resume save/restore/progress; cuts: PeerTube player-API bridge, embed-only items untracked, badge hidden when no position).
  - F2 → Phase 7 (badge library-only, mark per-creator + global, opened-only semantics).
  - F3 → Phase 6 (j/k/Enter/f///Esc/g l/g c; cut: Space).
  - F4 → Phase 9 (JSON export/import round-trip; cut: OPML).
  - F5 → Phase 10.1 (copy stream/canonical URL).
  - F6 → Phase 8 (health dialog, bulk unsubscribe + confirm pattern, 30-day retention both service-side and runner step).
  - F7 → Phase 10.2 (5 persisted keys; search excluded; anonymous redirect loop impossible).
  - F8 → Phase 5 (lg-only virtualization, explicit Load More retained).
  - F9 → Phase 1 (numbers: EXPLAIN plans, payload KB before/after, chunk sizes, gzip levels, WAL verification).
- Re-run Phase 1.4 measurements against the final tree; confirm no regression from later phases (payload, chunk size, EXPLAIN).
- Constraint audit (validator): no automatic background refresh added anywhere (grep for setInterval/setTimeout loops — the only allowed timers are the existing refresh poll, debounce, throttle, and the new ~1/s YT bridge poll and 2s clipboard feedback, all user-interaction-scoped); no document-wide custom events; overlays userId-scoped; anonymous catalog procedures untouched in shape; no `any`/TODO/placeholder (grep); new dep list == `@tanstack/solid-virtual` only.
- Final report to user with statistics (phases, fix iterations, files created/modified, measurements).

**Validation Criteria**: All gates pass; trace table complete; audit greps clean; numbers recorded.

**Dependencies**: All phases complete.

---

## Success Criteria

Overall success requires:
- All 11 phases (and every sub-phase) complete with implementer → validator pass (fix loops ≤ 3 attempts each; multi-sub-phase phases get phase-wide validation).
- Final `bun run check-types` zero errors; `bun run build` success; `bun run test` zero failures with per-package counts ≥ api 175 / db 35 / web 114 plus each phase's new tests.
- Every design decision D1–D14 implemented as specified; every scope cut explicitly recorded in the final trace.
- Measured performance improvements recorded: indexed index-scan (no TEMP B-TREE), slim list payload (~95KB → ~30KB per 50 rows), devtools out of the prod main chunk, gzip level 6 asset sizes, single session round trip, single creators fetch on startup.
- Cross-user isolation, idempotent ingestion/migration/export-import, and the no-automatic-refresh constraint all verified by tests or audit greps.
