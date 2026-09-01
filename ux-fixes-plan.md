# UX Fixes Plan — FeedElity (5 demands: selection visibility, viewer creator filter, compact controls, zero full-app reloads, multi-source creators)

> **Status: executed.** All phases implemented and merged via PR #1 (`fix/ux-five-demands`). Baseline figures and line numbers below are plan-time snapshots.

All paths are relative to the repo root `/home/didi/workspace/FeedElity` unless prefixed otherwise. Line numbers refer to the current baseline (pre-plan) and are hints, not contracts — re-locate symbols if lines drifted after earlier phases.

## Overview

This plan fixes five user-reported problems, all verified against the code:

1. **Selected creator not visibly selected** — selection styling (`bg-selected` = `oklch(0.23 0.09 160)`, `apps/web/src/styles.css:45`) is nearly invisible against column backgrounds (`--card 0.19`, `--muted 0.225`); the selected row is not pinned to the top and drifts under the dynamic `lastUpdate` sort; the list `<ol>` is replaced by a loading branch on every refetch (scroll reset); and `onClearCreator` (app-shell.tsx:243) is bound to no button.
2. **Creator name in the viewer is plain text** (apps/web/src/components/app-shell-viewer.tsx:469-474) — it must filter the content list to that creator without re-rendering the whole UI.
3. **Bloated search/sort/filter row in the creator column** (apps/web/src/components/app-shell.tsx:768-823) — native `<select>`s auto-size to their widest option ("By last video update", "PeerTube") and steal width from the search input in a 16%-wide pane.
4. **Full-app-reload / whole-UI-blank behaviors** — root mechanism: plain `resource()` reads suspend; the `<Suspense>` boundaries around the creator column (app-shell.tsx:1235-1270) and content column (1271-1308) have no fallback, and the viewer (1309-1329) is unwrapped, so its suspends bubble to the route-level Suspense and blank the entire app. Proven in-repo fix pattern: read `resource.latest` (commits `32ad33f`, `fa36a4b`). Seven concrete causes are enumerated below and each gets a fix.
5. **Multi-source creators do not show all their videos and cannot switch playback source** — the live dev DB (`local.db`) still has the legacy per-source creator schema (621 split creator rows); ingestion never re-points rows onto the merged creator; there is no cross-source mirror linkage; the viewer has no cross-source switcher; the YouTube privacy toggle is session-only; Odysee items without an enclosure are unplayable.

Execution model: this plan is written for the subagent-orchestration workflow (1 implementer → 1 validator per sub-phase/phase → fix loop → phase-wide validation for parallel phases). Every phase below is sized to fit one implementer context.

## Prerequisites

- Bun installed; repo dependencies installed (`bun install`).
- Gatekeeping commands: `bun run check-types` and `bun run build` from the repo root; `bun run test` where tests exist (packages/api, packages/db, apps/web, apps/server all have `test` scripts). Turbo caches: use `--force` if a cached pass must be re-verified.
- Do NOT start dev servers (`bun run dev*`, `db:local`) at any point.
- The live dev database is `/home/didi/workspace/FeedElity/local.db` (legacy creator schema, 621 split creators). Never run a writing migration against it during plan execution; validate migrations on a throwaway copy (`cp local.db /tmp/uxfix-local-copy.db`) as specified in Phase 7.
- Key baseline facts the implementers must know:
  - Drizzle migration journal (`packages/db/src/migrations/meta/_journal.json`) ends at `0002_creator_last_published`; its snapshot still has the **legacy** creator schema (`source_type`, no `name_key`). The schema files (`packages/db/src/schema/catalog.ts`) are ahead of the journal. Therefore `drizzle-kit generate` would produce an unsafe migration (unique `name_key` index over still-duplicated rows). This plan intentionally does **not** add a drizzle-kit migration; it uses the existing `__feedelity_migrations` bootstrap runner (packages/db/src/bootstrap.ts, `runSqlMigration`) extended to scripted TS steps.
  - The server (apps/server/src/index.ts) does **not** run migrations at startup; DB is created in packages/db/src/index.ts via `createDb()`. Migrations are explicit commands.
  - No document-wide custom events, no TanStack Query reads in components, native elements only, Solid signals/createResource only.
  - The `split("", 1)` / `split("", 2)` calls in apps/web/src/components/app-shell-source-sections.tsx:659 and :678 split per character (bug): collection ids collapse to their first character. The playlist twin does it correctly with the `"\u001f"` separator (:467, :472).

## Mandatory dispatch boilerplate (paste verbatim into EVERY implementer/fixer dispatch; validators must enforce it)

```text
NO-SLOP POLICY (MANDATORY — all items are hard requirements):
- NO `any`, `as any`, `: any` ANYWHERE. Use proper types, `unknown`, or validated schemas.
- NO placeholder code, NO `// TODO`, NO `// FIXME`.
- NO unused imports, NO unused variables. If it is not used, it must not exist.
- NO console.log hacks, NO `void` hacks to silence errors, NO silencing TypeScript/lint/runtime errors. Fix the cause.
- Use `import type` for type-only imports (`verbatimModuleSyntax` is enabled).
- External imports first, then a blank line, then local imports.
- No non-null assertions (`!`) unless the invariant is enforced immediately before use and obvious.
- No broad type assertions to force code through the compiler — narrow or validate instead.
- No caught-and-ignored errors: handle, return, or rethrow with context.
- Solid patterns only (signals/createResource/createMemo); no React patterns, no stores, no headless UI libs, no new dependencies.
- Do not start dev servers. Gatekeeping before reporting done: run `bun run check-types` and `bun run build` from the repo root and fix all errors. Run `bun run test` if the touched package has a test script.
```

Validator dispatches must additionally instruct: "ACTUALLY READ every changed file line-by-line and verify each requirement from the plan; do not only run commands; report issues with file paths and line numbers; enforce the NO-SLOP policy stringently."

---

## Phase 1: Whole-app blank fixes — settings reads, viewer playlists reads, webview-safe anchor

**Type**: Sequential (frontend chain start)

**Goal**: Eliminate reload causes 2, 3, and 7: changing any setting blanks the entire app; adding to a playlist from the viewer blanks the entire app; the native-playback fallback anchor navigates the Electrobun webview away.

**Requirements**:

1. `apps/web/src/components/app-shell.tsx` — the `settings` resource (`createResource(settingsResourceInput, ...)` near line 1040) is read plainly at lines 1041-1042 (`settings() ?? emptyUserSettings`) inside the `readerDensity` and `creatorSort` memos; `readerDensity()` is consumed on the shell root grid at line 1234, **outside** every column Suspense, so a `refetchSettings()` (triggered by reader-density change app-shell-source-sections.tsx:363-387, raw setting save/delete :319-361, creator sort change app-shell.tsx:794-799 → :1044-1047) suspends the whole route and blanks the app.
   - Add `const settingsValue = createMemo(() => settings.latest);` and change the `readerDensity` and `creatorSort` memos to read `settingsValue() ?? emptyUserSettings`.
   - Audit the rest of app-shell.tsx for any other plain `settings()` reads and convert them to `settingsValue()`. The viewer prop at line 1317 already uses `settings.latest` — keep it, optionally reusing the new memo.
2. `apps/web/src/components/app-shell-viewer.tsx` — the viewer is not wrapped in any Suspense, so plain reads of the `playlists` resource (:76-78) blank the whole app on refetch (`refetchPlaylists` at :157 inside `addSelectedContentToPlaylist`).
   - Add `const playlistsValue = createMemo(() => playlists.latest);` and replace **every** plain `playlists()` read with `playlistsValue()`, including: `effectiveTargetPlaylistId` (:129), the `Show` guard `(playlists() ?? emptyPlaylists).length > 0` (:339), and the `<For each={playlists() ?? ...}>` (:347).
   - Keep the existing favoriteItems `.latest` pattern (:97) intact.
   - The viewer's `contentDetail` Matches already read `contentDetailValue()` plus `.loading`/`.error` — do not regress them to plain reads.
3. `apps/web/src/components/app-shell-viewer.tsx` — `PlaybackSurface` native fallback `<a href={props.source?.url ?? ""}>` (:445-447) has no `target="_blank"`; clicking navigates the whole desktop webview away. Add `target="_blank"` and `rel="noreferrer"` to this anchor (matching the canonical-URL anchor at :479-491).
4. Sweep verification (validator + implementer): grep apps/web/src for `\.loading && ` guard expressions that read plain `resource()` inside `when=` conditions in the touched files — a plain read in a guard also registers suspense. Replace with the `.latest` memo equivalent while preserving the same rendered branches.

**Inputs**:
- Read: apps/web/src/components/app-shell.tsx, apps/web/src/components/app-shell-viewer.tsx, apps/web/src/components/app-shell.contract.ts (for `emptyUserSettings`-style constants and existing helpers), apps/web/src/components/app-shell-source-sections.tsx (settings save paths that trigger refetch).

**Outputs**:
- Modify: apps/web/src/components/app-shell.tsx, apps/web/src/components/app-shell-viewer.tsx

**Validation Criteria**:
- `bun run check-types`: zero errors. `bun run build`: success.
- Code review: no plain `playlists()` or `settings()` reads remain in app-shell-viewer.tsx / app-shell.tsx resource-consumption paths (only `.latest`-backed memos); the anchor has `target="_blank" rel="noreferrer"`; no behavior of the settings UI changed (same save flows, same disabled states).
- Manual reasoning check (documented in validator report): with these changes, toggling reader density, saving/deleting a raw setting, changing creator sort, and adding-to-playlist from the viewer each cause at most an in-place refetch — no `<Suspense>` fallback and no route-level blank. Playback video element is not unmounted by any of these actions.

**Dependencies**: None (first phase).

---

## Phase 2: Content column blank fixes, history stability, creator-clear chip

**Type**: Sequential

**Goal**: Eliminate reload causes 1 (favoriting blanks the content column), 6 (history refetch/reorder on every selection), and the content-column side of cause 5 (collection CRUD flashes the content column). Also bind the creator clear affordance in the content column (part of demand 1).

**Requirements**:

1. **Favorites (cause 1)** in `apps/web/src/components/app-shell-content-column.tsx`:
   - `favoriteContentItemIds` (:405-409) plainly reads `favoriteItems()` (:406). When a favorite toggles (row heart :477-487 → `refetchFavoriteItems()` :482, or viewer heart → `favoritesReloadKey` bump, app-shell.tsx:1302/:1325), this read suspends and the whole content column blanks. Introduce `const favoriteItemsValue = createMemo(() => favoriteItems.latest);` and read it at :406.
   - `favoriteItemsResourceInput` (:395-401) includes `props.favoritesReloadKey()`, so every viewer-side toggle refetches the whole favorites overlay through the column. Change the input to a stable non-keyed value (authenticated ? constant : null) so the bump no longer re-keys the resource, and add `createEffect(on(() => props.favoritesReloadKey(), () => { void refetchFavoriteItems(); }, { defer: true }))` so the column's heart states still reconcile in place after a viewer-side toggle (refetch = server reconciliation per AGENTS.md; `.latest` read = no blank).
   - In favorites view mode the content-list resource is still keyed on `favoritesReloadKey` (:367-381) — keep that (the list must update), it is now a no-blank in-place refetch because the list reads `contentItemsValue()`.
2. **Content-column overlay resources (cause 5 side)**: plain reads that must become `.latest` memos, including guard expressions:
   - `selectedCollectionMembers()` at :326 → `.latest` memo (also stops the blank when switching collections).
   - `collections()` at :337 inside `selectedCollectionName` → `.latest` memo.
   - `playlists()` at :411 inside `listTargetPlaylistId` → `.latest` memo.
   - The loading Match at :717 (`contentItems.loading && contentItemsValue() === undefined`) is already correct — preserve it.
3. **History stability (cause 6)**:
   - `autoMarkContentOpened`/`markContentOpened`/`markContentPlayed`/`autoMarkContentPlayed` (app-shell.tsx:1089-1139) bump `statusReloadKey` on every video open; in `history-opened`/`played` modes that key is part of `contentItemsResourceKey` (app-shell-content-column.tsx:367-381), so every selection refetches and reorders the history list, and with "hide played" on, the clicked row vanishes mid-interaction (:446-451).
   - Treat history views as snapshots: remove `statusReloadKey` from the resource key for history modes. Because that is its **only** consumer, remove the signal entirely: delete `statusReloadKey`/`setStatusReloadKey` (app-shell.tsx:1027), delete its bumps (:1097, :1101, :1112, :1116, :1127, :1138), delete the `statusReloadKey` prop on `ContentListColumnProps` and its usage in the key builder.
   - Row styling and hide-played keep working via the existing local patches (`patchContentStatus`/`removeContentStatus` mutate `contentStatuses`), and the viewer already reads `contentStatuses.latest`. Document the trade-off in the PR description: newly opened/played videos appear in history views on the next fetch (mode switch, filter change, revisit), not instantly mid-list.
4. **Creator clear chip (demand 1, affordance in content column)** in app-shell-content-column.tsx:
   - Replicate the collection-filter chip pattern (:599-616): when `props.selectedCreator() !== null`, render a chip `Creator: <displayName>` with an X button that calls a new prop `onClearCreator: () => void`. Add the prop to `ContentListColumnProps` and wire it in app-shell.tsx (next to the existing `onClearCollection` :1279) to the same handler as `onClearCreator` at :1257-1261 (clears creator + feed + selected content). Give the chip `data-creator-filter-active` for tests.

**Inputs**:
- Read: apps/web/src/components/app-shell-content-column.tsx, apps/web/src/components/app-shell.tsx, apps/web/src/components/app-shell.contract.ts, apps/web/src/components/app-shell-rows.tsx (chip styling reference at :599-616 of content column instead).

**Outputs**:
- Modify: apps/web/src/components/app-shell-content-column.tsx, apps/web/src/components/app-shell.tsx

**Validation Criteria**:
- `bun run check-types` zero errors; `bun run build` success; `bun run test` (apps/web contract tests still pass).
- Code review: `grep -n "statusReloadKey" apps/web/src` returns nothing; no plain `favoriteItems()`/`collections()`/`selectedCollectionMembers()`/`playlists()` reads remain in the content column (guards included); the favorites resource input no longer contains `favoritesReloadKey` and an `on`-effect triggers `refetchFavoriteItems` on bump with `{ defer: true }`; creator chip renders only when a creator is selected and its X clears creator + feed + viewer content.
- Behavior reasoning (validator report): favoriting from a row or the viewer updates hearts everywhere with no column unmount; switching collections no longer blanks the list; in history views, selecting a video neither blanks, nor reorders, nor removes the row while "hide played" is on.

**Dependencies**: Phase 1 must complete (both phases edit app-shell.tsx; do after 1 to avoid conflicts).

---

## Phase 3: Left-pane playlist/collection panels — no flash, resource-key bug, debounce helper

**Type**: Sequential (but file-disjoint from Phases 4-5; may run in parallel with Phase 4 if the orchestrator enforces file ownership)

**Goal**: Eliminate reload cause 5: playlist/collection panel CRUD flashes the creator column, collection key building is broken (`split("")`), and the collection member search flashes per keystroke.

**Requirements**:

All work in `apps/web/src/components/app-shell-source-sections.tsx`:

1. **`.latest` everywhere** — introduce `.latest` memos and replace every plain resource read, including `when=` guard expressions:
   - `PlaylistColumnSection`: `playlists` (:454) reads at :480 (`selectedPlaylist`), :588-589 (header count + selector `Show`/`For`), :600-603 (loading/error/empty/loaded Matches — the guards read plain `playlists()`; convert to a `playlistsValue` memo). `selectedPlaylistItems` (:469-479) reads at :558 (`movePlaylistItem`), :608-611 (Matches) → `selectedPlaylistItemsValue` memo.
   - `CollectionColumnSection`: `collections` (:637-639) reads at :800, :802, :814, :820, :887-896 → `collectionsValue` memo. `selectedCollectionMembers` (:656-666) reads at :687, :962-965 → memo. `creatorSearchResults` (:677-684) reads at :1007-1009 → memo.
2. **Fix the resource-key bug**: `selectedCollectionMembersInput` (:648-655) builds `` `${collectionId}${props.collectionsReloadKey().toString()}` `` and the fetcher splits with `resourceKey.split("", 1)` (:659) — per-character split, so `collectionId` is one character and the wrong collection's members load. Use the playlist twin's correct pattern (:467, :472): join with `"\u001f"` and `split("\u001f", 1)`. Same fix for `creatorSearchInput` (:668-676) built as `` `${collectionId}${trimmed}` `` and split with `resourceKey.split("", 2)` (:678) — join with `"\u001f"` and destructure `const [collectionId, search] = resourceKey.split("\u001f")` with explicit `undefined` narrowing.
3. **Debounce the member search**: add a small reusable helper `createDebouncedValue<T>(value: () => T, delayMs: number): () => T` to `apps/web/src/components/app-shell.contract.ts` (setTimeout-based, `onCleanup`-safe — the helper must live in a file that may import from `solid-js`; if app-shell.contract.ts must stay Solid-free, place it in a new `apps/web/src/utils/debounce.ts` instead and import it). Use it so `creatorSearchInput` only changes 300 ms after the last keystroke (avoid server hits per keystroke; the `.latest` memo already prevents flashing). Note in a code comment that this is user-typed search debounce, not background refresh.
4. Do not change any CRUD flows (create/update/delete/reorder/add/remove member) — only their rendering stability.

**Inputs**:
- Read: apps/web/src/components/app-shell-source-sections.tsx (whole file), apps/web/src/components/app-shell.contract.ts, apps/web/src/components/app-shell.tsx (how panels get mounted, :974-993).

**Outputs**:
- Modify: apps/web/src/components/app-shell-source-sections.tsx, apps/web/src/components/app-shell.contract.ts OR apps/web/src/utils/debounce.ts (new helper file)

**Validation Criteria**:
- `bun run check-types` zero errors; `bun run build` success.
- Code review: `grep -n 'split(""' apps/web/src` returns nothing; every resource in this file is consumed only via `.latest` memos (spot-check every occurrence of the resource identifiers); the debounce helper has `onCleanup`, no leaked timers, no `any`.
- Behavior reasoning: creating/renaming/deleting a collection or playlist, adding/removing members or items, and typing in member search never blank the left column or the app; selecting a collection loads that collection's actual members (id no longer truncated to one character).

**Dependencies**: Phase 1 (shares the app being built; no direct file overlap with Phase 2, but run after Phase 1 and after Phase 2 merged to keep app-shell.tsx stable).

---

## Phase 4: Selected creator obviously visible and stable (demand 1)

**Type**: Sequential

**Goal**: The selected creator is unmistakably highlighted, pinned to the top of the list, never scrolled out of view by refetches, and can be unselected without searching.

**Requirements**:

1. **High-contrast selection styling**:
   - `apps/web/src/styles.css`: `--selected: oklch(0.23 0.09 160)` (:45) is nearly the same lightness as `--card` (0.19) and `--muted` (0.225). Raise it to a clearly distinct value (e.g. `oklch(0.32 0.11 160)` — implementer picks the final value keeping `--selected-foreground` (0.78 lightness) readable on it) and verify the content-list selected row (`bg-selected`) still looks right with both.
   - `apps/web/src/components/app-shell-rows.tsx` `CreatorSourceRow` (:84-145): in addition to `bg-selected`, add a 1px inset ring in the accent ring color (`ring-1 ring-ring ring-inset` or an equivalent outline utility) on the selected row, set `aria-current="true"` on the row wrapper when selected, and keep the existing left bar. The goal: findable at a glance without color-only reliance.
2. **Pin the selected creator to the top** in `apps/web/src/components/app-shell.tsx` `listedCreators` (:384-396): after building the list (both the library-mode filtered branch and the catalog-mode appended-pages branch), reorder so the creator whose id equals `props.selectedCreatorId()` is index 0, preserving the relative order of everything else. This survives the dynamic `lastUpdate` sort (packages/api/src/repositories/catalog.ts:520-527) so the selection never drifts. Do not break pagination (pinning operates on the merged display array only).
3. **No list teardown while refetching** (scroll reset + search flicker): the loading Matches at :832-839 replace the whole `<ol>` whenever `creators.loading`/`subscriptions.loading` is true — including every refetch with stale data present. Change both guards to `…loading && <value memo>() === undefined` (create `creatorsValue` memo from `creators.latest` — it already exists at :342; `subscriptionsValue` at :353 — and use them in the guards). Preserve the error/empty/loaded Matches and switch their plain reads (`listedCreators()` is a memo — fine) as needed.
4. **Scroll the selected row into view**: give each creator `<li>` a `data-creator-id={creator.id}` attribute (app-shell.tsx creator `<For>` at :862-885) and put a template ref on the scroll region div (`sourceCreatorListRegionClass` container at :830). Add `createEffect(on(props.selectedCreatorId, ...))` that queries the row inside the region and calls `scrollIntoView({ block: "nearest" })` when the id is non-null. Guard the element lookup (may be null mid-render); escape/compare via `querySelector` with a CSS.escape-safe id or iterate `[data-creator-id]` elements comparing `dataset.creatorId`.
5. **Unselect affordances**:
   - Feeds tab: the selected creator name (:907) gets a compact X button (lucide `X`, same styling as the collection clear at app-shell-content-column.tsx:605-613) bound to `props.onClearCreator`.
   - The content-column chip from Phase 2 is the second affordance — no extra work here, just verify it exists.
6. **Debounced catalog creator search**: wrap the `search` signal with the Phase 3 `createDebouncedValue` helper (300 ms) and use the debounced value in `creatorListInput` (:336) so catalog search no longer refetches per keystroke. The input itself stays controlled by the immediate signal. Library mode keeps filtering client-side off the debounced value as well for consistency.

**Inputs**:
- Read: apps/web/src/components/app-shell.tsx (CreatorSourceColumn), apps/web/src/components/app-shell-rows.tsx, apps/web/src/styles.css, apps/web/src/components/app-shell.contract.ts (helper from Phase 3), apps/web/src/components/app-shell.test.ts (contract test conventions).

**Outputs**:
- Modify: apps/web/src/components/app-shell.tsx, apps/web/src/components/app-shell-rows.tsx, apps/web/src/styles.css

**Validation Criteria**:
- `bun run check-types` zero errors; `bun run build` success; `bun run test` for apps/web.
- Code review: loading Matches compare against `.latest` memos; pinning logic is a pure reorder (no duplicate rows, works with appended pages); the effect uses `on(...)` with proper cleanup guards and no timers; selected row has ring + `aria-current` + elevated `--selected`; X button in Feeds tab calls `onClearCreator`; debounce uses the shared helper with `onCleanup`.
- Behavior reasoning: selecting a creator in either mode scrolls it into view and pins it at the top; typing in search no longer empties the list between keystrokes; the selection stays visually obvious in both light/dark usage of the existing theme variables; clicking the selected row still toggles it off (existing behavior at app-shell.tsx:1061-1070).

**Dependencies**: Phases 2 and 3 must complete (uses the debounce helper; app-shell.tsx must be stable).

---

## Phase 5: Viewer creator-name filter + compact creator-column controls (demands 2 and 3)

**Type**: Sequential

**Goal**: Clicking the creator name in the viewer filters the content list to that creator without re-rendering the whole UI; the sort/filter controls become compact icon-based controls so the search input keeps its width.

**Requirements**:

1. **Clickable creator in viewer** (`apps/web/src/components/app-shell-viewer.tsx`):
   - `ContentDetailBody` (:464-495): wrap `{props.detail.creator.displayName}` (:470) in a `<button type="button">` styled inline (same size as the surrounding text, `hover:underline`, focus-visible ring; keep the ` · ` separators outside the button). New prop `onCreatorClick: (creator: CatalogCreatorSummary) => void` on `ContentDetailBodyProps`, invoked with `props.detail.creator` (`CatalogCreatorSummary` from packages/api/src/domain/catalog.ts:86-92 — it already carries `id`).
   - `SelectedContentViewerProps` (:38-56) gains `readonly onSelectCreator: (creator: CatalogCreatorSummary) => void;` and `ContentDetailBody` receives it from the detail Match (:412).
2. **Wiring in AppShell** (`apps/web/src/components/app-shell.tsx`):
   - Add `selectCreatorFromViewer(creator: CatalogCreatorSummary): void` — select-only semantics (NOT the row toggle): if `selectedCreator()?.id === creator.id`, do nothing; otherwise `setSelectedCreator(creator)` and `setSelectedFeed(null)`. (`CatalogCreatorSummary` is a member of the `BrowsableCreator` union — apps/web/src/components/app-shell.contract.ts:69 — so no type assertion is needed.)
   - Pass `onSelectCreator={selectCreatorFromViewer}` to `SelectedContentViewer` at :1309-1329.
   - Constraint check (must hold by construction, validator verifies the reasoning): `selectedCreator` feeds `contentListInput` (app-shell-content-column.tsx:339-347 via contract `toContentListInput` :320-338) → only the content-list resource key changes; the list reads `contentItems.latest` with a loading Match keyed on `undefined` value, so the column refetches in place; the viewer's `contentDetail` is keyed on the content id, not the creator, so the viewer does not remount; no other Suspense-consuming resource changes.
3. **Compact sort control** (app-shell.tsx :787-803): replace the text `<select>` with a compact icon cycling `<button type="button" class="shrink-0 ... p-1.5" aria-label=...>`:
   - Shows one icon for the current sort: `name` → `lucide-solid/icons/arrow-down-a-z`; `lastUpdate` → `lucide-solid/icons/clock-arrow-down`. Before using, verify these icon files exist in the installed `lucide-solid` package (`node_modules/lucide-solid`); if either is missing, pick the closest existing icon (e.g. `arrow-down-za`, `history`) — do not invent import paths and do not leave an unused import.
   - Click cycles `name` → `lastUpdate` → `name` through the existing `changeCreatorSort` flow (server-persisted setting `creator.list.sort`, disabled for anonymous via `disabled={!props.isAuthenticated()}` — preserve exactly).
   - `title` and `aria-label` must state the current mode and the action, e.g. `aria-label="Sorted by name. Activate to sort by last video update."`.
4. **Compact source-type filter** (app-shell.tsx :807-822): replace the text `<select>` with a compact popover using the existing `details`/`summary` pattern from the force-refresh control (:708-730) — no new dependencies:
   - The `summary` trigger is a fixed-width icon button (`p-1.5`, `shrink-0`, ~28px) showing the current state: "All" → a neutral icon (`lucide-solid/icons/layout-grid`); a specific source → `SourceTypeIcon` from ./source-indicator.
   - The popover body lists `All` + `youtube`/`odysee`/`peertube` as buttons with `SourceTypeIcon` + short label (YouTube/Odysee/PeerTube); clicking sets `sourceType` via the existing `setSourceType(toSourceFilterValue(...))` logic and closes the popover (`removeAttribute("open")`, same as the force-refresh pattern). Active option is visually marked and `aria-pressed`.
   - Trigger `aria-label` states the active filter, e.g. `aria-label="Filter creators by source: All"`.
   - Both controls keep ids reachable for tests where sensible (move `creatorListSortInputId`/`creatorSourceFilterId` onto the trigger buttons to keep existing selectors meaningful; update any test references in apps/web/src/components/app-shell.test.ts).
5. **Layout**: the search input keeps `min-w-0 flex-1`; both new controls are `shrink-0`; the row is still `flex items-center gap-1.5` (:768). The row must not wrap at the default 16% pane width (min-left 10%): verify with the class math in review (search gets the remaining width).
6. Update/extend `apps/web/src/components/app-shell.test.ts` contract tests for anything extracted into the contract file (none required beyond ids; add tests only for new pure helpers if any were added).

**Inputs**:
- Read: apps/web/src/components/app-shell-viewer.tsx, apps/web/src/components/app-shell.tsx, apps/web/src/components/app-shell.contract.ts, apps/web/src/components/source-indicator.tsx, apps/web/src/components/app-shell-content-column.tsx (:339-347 filter wiring), packages/api/src/domain/catalog.ts.

**Outputs**:
- Modify: apps/web/src/components/app-shell-viewer.tsx, apps/web/src/components/app-shell.tsx, apps/web/src/components/app-shell.test.ts (only if ids/tests referenced)

**Validation Criteria**:
- `bun run check-types` zero errors; `bun run build` success; `bun run test` for apps/web.
- Code review: viewer creator control is a real `<button>` wired to select-only logic (no toggle-off, no feed retained); no type assertions used to fit `CatalogCreatorSummary` into `BrowsableCreator`; sort cycling preserves the server-persisted setting flow and anonymous-disabled state; popover closes on selection; all imported lucide icons verified to exist (build passing proves it).
- Behavior reasoning: clicking the creator name changes only the content-list resource key → list refetches in place (`.latest`), viewer stays mounted (content key unchanged), no Suspense fallback anywhere; both controls are icon-only in every state and the search input retains the dominant width.

**Dependencies**: Phase 4 must complete (same file app-shell.tsx).

---

## Phase 6: Router — one persistent shell across catalog/library (reload cause 4)

**Type**: Parallel-eligible (file-disjoint from Phases 3-5; may run concurrently once Phase 2 is merged)

**Goal**: Navigating between the catalog route (`/`) and library route (`/dashboard`) must not unmount/remount `AppShell` (which refetches every resource and loses playback), and hover-preloading `/dashboard` must not fire `getSession()` on every hover.

**Requirements**:

1. **Pathless layout route** in `apps/web/src/routes/`:
   - Create `apps/web/src/routes/_shell.tsx`: a pathless layout route whose component renders `<Outlet />` **plus** the persistent `<AppShell />`. Decide the concrete structure and keep it simple: the cleanest variant is `_shell.tsx` rendering `<AppShell mode={mode} />` and child routes rendering `null`; `mode` is derived from `useLocation().pathname` (`pathname.startsWith("/dashboard") ? "library" : "catalog"`).
   - Move the catalog route to `apps/web/src/routes/_shell.index.tsx` (URL stays `/`) rendering `null` (or nothing meaningful) — delete the old `apps/web/src/routes/index.tsx`.
   - Move the library route to `apps/web/src/routes/_shell.dashboard.tsx` (URL stays `/dashboard`) rendering `null`, **keeping** the existing `beforeLoad` session guard with its redirect to `/login` verbatim — delete the old `apps/web/src/routes/dashboard.tsx`.
   - `/login` stays outside the `_shell` layout so the login page does not render the shell.
   - Regenerate/verify `apps/web/src/routeTree.gen.ts`: it is generated by the router plugin during `vite build` (apps/web/package.json build script also runs `bun scripts/normalize-route-tree.ts`). Run `bun run build` and verify the generated tree contains the `_shell` layout with `index` and `dashboard` children and that no stale route files remain.
2. **Preload churn** in `apps/web/src/main.tsx`: `defaultPreloadStaleTime: 0` (:14) makes every intent-hover of a `/dashboard` link re-run the guard's `authClient.getSession()`. Raise `defaultPreloadStaleTime` to `30_000`. Keep `defaultPreload: "intent"` and `scrollRestoration` unchanged.
3. **Behavior invariants** (validator must confirm by reading the final code):
   - Anonymous browsing of `/` is untouched (layout adds no auth requirement).
   - Visiting `/dashboard` unauthenticated still redirects to `/login` with the `redirect` search param.
   - With the shell living in the layout, `/` ↔ `/dashboard` navigation keeps the `AppShell` instance (and its playing `<video>`/iframe) mounted — only the invisible child outlet swaps.
   - `apps/web/src/main.test.ts` still passes (it exercises `createAppRouter`); update it only if the route shape assertions require it.

**Inputs**:
- Read: apps/web/src/routes/index.tsx, apps/web/src/routes/dashboard.tsx, apps/web/src/routes/__root.tsx, apps/web/src/main.tsx, apps/web/src/main.test.ts, apps/web/src/routeTree.gen.ts (generated), apps/web/package.json (build script), apps/web/src/components/app-shell.tsx (`AppShellProps.mode`).

**Outputs**:
- Create: apps/web/src/routes/_shell.tsx, apps/web/src/routes/_shell.index.tsx, apps/web/src/routes/_shell.dashboard.tsx
- Delete: apps/web/src/routes/index.tsx, apps/web/src/routes/dashboard.tsx
- Modify: apps/web/src/main.tsx, apps/web/src/routeTree.gen.ts (via build), apps/web/src/main.test.ts (if needed)

**Validation Criteria**:
- `bun run check-types` zero errors; `bun run build` success (this regenerates routeTree.gen.ts — confirm it changed and contains `_shell`); `bun run test` for apps/web.
- Code review: guard logic preserved exactly in `_shell.dashboard.tsx`; `mode` derivation has no `any`/assertions; old route files deleted; no unused imports left in deleted-file neighbors.
- Behavior reasoning: route identity of the shell is stable across `/` ↔ `/dashboard`; hover preload of `/dashboard` no longer re-fires `getSession()` more than once per 30s window per link.

**Dependencies**: Phase 2 must complete (AppShell props stable). File-disjoint from Phases 3-5 → may run in parallel with them.

---

## Phase 7: DB — idempotent catalog data-migration runner + creator cross-source merge (demand 5, data root cause)

**Type**: Sequential (backend chain start; parallel-eligible with frontend Phases 3-6)

**Goal**: The live dev DB (`local.db`) still has the legacy per-source creator schema (621 split creators — e.g. "Scott Manley" ×3), which is the #1 reason only YouTube videos show. Provide an explicit, idempotent, tested migration command that converges any DB (legacy or current) to the cross-source creator schema, merging duplicate creators first — without touching drizzle-kit's journal.

**Requirements**:

1. **Move the pure merge logic into packages/db** so both the script and the migration share it:
   - Move `scripts/db-repair/merge-plan.ts` → `packages/db/src/creator-merge-plan.ts` (content unchanged; it is pure and dependency-free).
   - Move `scripts/db-repair/merge-plan.test.ts` → `packages/db/src/creator-merge-plan.test.ts` (adjust import path).
   - Update `scripts/db-repair/repair.ts` to import from `@FeedElity/db/creator-merge-plan` (add the export to packages/db/package.json `exports` following the existing `"./*"` pattern) — keep repair.ts functional as a standalone manual tool.
2. **Migration runner** — create `packages/db/src/migrations/catalog-data-migrations.ts`:
   - Export `runCatalogDataMigrations(input: { databaseUrl: string; apply: boolean }): Promise<CatalogDataMigrationReport>` executing an ordered list of idempotent steps, each recorded in the existing `__feedelity_migrations` table (packages/db/src/bootstrap.ts pattern: `BEGIN IMMEDIATE` → check id → run → insert id → `COMMIT`; on any error ROLLBACK and rethrow with step id context). Report shape: per-step `{ id, applied, description }` plus a top-level `appliedCount`. `apply: false` = dry run (report only, no writes) — mirroring repair.ts's `--yes` safety.
   - Use `bun:sqlite` (`Database`) like scripts/db-repair/repair.ts, accepting plain paths and `file:` URLs (strip a leading `file:` before opening). `PRAGMA foreign_keys = ON`.
   - **Step `creator_cross_source_merge`** (skip if the id is already recorded):
     a. Detect schema state via `PRAGMA table_info(creator)`: presence of `source_type`/`source_external_id` (legacy) and `name_key`.
     b. Load creator rows in the union shape that `buildMergePlan` expects (repair.ts `loadCreatorRows` tolerance pattern: NULL for absent legacy columns).
     c. Run `buildMergePlan`; for each action re-point `content_item.creator_id`, `feed.creator_id`, `refresh_run.requested_creator_id`, and `subscription.creator_id` (deleting duplicate `(user_id, creator_id)` subscription losers first), then delete merged creator rows — parameterized statements, same semantics as repair.ts:154-170.
     d. Converge the creator table regardless of which drizzle migrations were applied: drop `creator_source_identity_uidx` if present; `ALTER TABLE creator DROP COLUMN source_type` / `DROP COLUMN source_external_id` if present; `ADD COLUMN name_key text` if missing; backfill `name_key` with TS `creatorNameKey(displayName)` per NULL row (parameterized UPDATE — parity with ingestion by construction; a raw SQL expression provably diverges from `creatorNameKey` on internal `@` and non-space whitespace); `CREATE UNIQUE INDEX IF NOT EXISTS creator_name_key_uidx` (after the backfill); `CREATE INDEX IF NOT EXISTS creator_display_name_idx`; and converge the `0002` pieces too: add `last_content_published_at` + index + the MAX(published_at) backfill (packages/db/src/migrations/0002_creator_last_published.sql) if the column is missing, and recompute `last_content_published_at` for canonical creators that absorbed rows (their item set changed).
     e. FK gate: run `PRAGMA foreign_key_check`; if orphans exceed the pre-existing count (snapshotted before writes), throw and roll back (repair.ts:141-180 pattern).
   - The step must be a no-op when re-run against an already-converged DB (id recorded, and/or zero merge groups + schema already correct).
3. **CLI wrapper** — create `packages/db/src/migrations/apply-catalog-migrations.ts`:
   - Args: `--db <path>` (default: `DATABASE_URL` from env, loaded via dotenv like other scripts; error if neither), `--yes` to write, dry-run by default, `--help`. Print a before/after summary (creators/feeds/items/subs counts, merge groups, orphan status) like repair.ts does.
4. **Scripts**: add `"db:repair": "bun run src/migrations/apply-catalog-migrations.ts"` to packages/db/package.json. The root package.json invokes the CLI DIRECTLY (`"db:repair": "bun run packages/db/src/migrations/apply-catalog-migrations.ts"`, next to the other `db:*` scripts) instead of through a turbo filter wrapper: turbo does not forward `--db`/`--yes` to the wrapped script (it rejects them), which would break `bun run db:repair --db <path> --yes`.
5. **Parity test**: add a test asserting the SQL/backfill `name_key` derivation and `creatorNameKey` (packages/db/src/creator-merge-plan.ts) agree on a table of cases (`@ScottManley`, `@ScottManley:5`, `Scott Manley`, case variants), and a test that `runCatalogDataMigrations` on an in-memory/temporary legacy-shaped DB (create minimal legacy creator/feed/content_item/subscription tables with duplicated creators) merges rows, converges schema, is a no-op on second run, and reports cleanly in dry-run mode. Use `bun:sqlite` `:memory:` or temp files.
6. **Verification against a COPY of the live DB (mandatory)**: first take a consistent snapshot — stop the server, then `cp local.db /tmp/uxfix-local-copy.db` including the `local.db-wal`/`local.db-shm` sidecars when present (or use the SQLite backup API / `VACUUM INTO` instead of a bare `cp`) — run the CLI dry-run against the copy (expect ~621 creators, many merge groups), then run with `--yes` and assert via `bun:sqlite` queries: creator count drops by the number of merged-away rows; a known multi-source creator (e.g. `name_key = 'scottmanley'`) has feeds and content items from both youtube and odysee; `PRAGMA foreign_key_check` shows no new orphans; second run reports zero applied steps. Do NOT run `--yes` against `local.db` itself — report the command for the user to run.
7. Document in `scripts/db-repair/README.md` (append a short section): the new `bun run db:repair` command, that it is idempotent, and that drizzle-kit generate must not be used for the creator change while the journal is behind the schema (note the deliberate divergence).

**Inputs**:
- Read: scripts/db-repair/repair.ts, scripts/db-repair/merge-plan.ts, scripts/db-repair/merge-plan.test.ts, scripts/db-repair/README.md, packages/db/src/bootstrap.ts, packages/db/src/schema/catalog.ts, packages/db/src/migrations/0002_creator_last_published.sql, packages/db/package.json, package.json, apps/server/.env (DATABASE_URL shape only).

**Outputs**:
- Create: packages/db/src/migrations/catalog-data-migrations.ts, packages/db/src/migrations/apply-catalog-migrations.ts
- Move: scripts/db-repair/merge-plan.ts → packages/db/src/creator-merge-plan.ts (+ its test)
- Modify: scripts/db-repair/repair.ts (import), scripts/db-repair/README.md, packages/db/package.json, package.json

**Validation Criteria**:
- `bun run check-types` zero errors; `bun run build` success; `bun run test` for packages/db (new migration + merge-plan tests pass, including idempotency and dry-run cases).
- Code review: transaction + rollback around all writes; parameterized SQL (no string interpolation of values — repair.ts's `esc()` allowlist pattern or plain parameters); no `any`; dry-run writes nothing; the copy-of-live verification in requirement 6 was actually executed with reported numbers.
- The command for the user to converge the live DB (`bun run db:repair --db /home/didi/workspace/FeedElity/local.db --yes`, server stopped) is included in the phase report.

**Dependencies**: None within the backend chain; parallel-eligible with frontend Phases 3-6. Phase 8 depends on this.

---

## Phase 8: Ingestion self-heal + cross-source mirror key (demand 5b, 5c)

**Type**: Sequential

**Goal**: Stop split creator rows from ever re-forming (ingestion re-points rows onto the name-key creator), and give mirrored copies of the same video on different sources a deterministic linkage (`content_item.cross_source_key`) so Phase 9 can expose "watch on <other source>".

**Requirements**:

1. **Self-heal on conflict** in `packages/api/src/repositories/catalog.ts`:
   - `findOrCreateFeed` (:307-330): after resolving `existing`, if `existing.creatorId !== input.creatorId`, `UPDATE feed SET creator_id = <input.creatorId> WHERE id = <existing.id>` and return the updated row. This heals rows created before the merge or by races.
   - `findOrCreateContentItem` (:351-388): same re-point when `existing.creatorId !== input.creatorId`, preserving the thumbnail backfill behavior.
   - Because refresh flows (packages/api/src/services/refresh.ts) go through these same repository functions, refresh self-heals automatically — verify by reading refresh.ts and state so in the phase report.
2. **Cross-source mirror key** (pure function, domain-owned):
   - `packages/api/src/domain/catalog.ts`: export `contentCrossSourceKey(nameKey: string, title: string): string` — normalize the title to a comparable form (lowercase, strip every character that is not a Unicode letter or number, collapse to nothing) and return `` `${nameKey}:${normalizedTitle}` ``; return shape documented; empty normalized title → return `null`-adjacent behavior: the function returns `string | null` (null when normalized title is empty) so callers never persist a garbage key.
   - `packages/db/src/migrations/catalog-data-migrations.ts` needs the same normalization **without** importing packages/api (db must not depend on api). Mirror it in `packages/db/src/creator-merge-plan.ts` (or a sibling `packages/db/src/cross-source-key.ts`) with a **parity test** (packages/db) asserting equality with the domain implementation over a case table — this repo already uses the mirror+parity-test convention (merge-plan header comment).
3. **Schema**: `packages/db/src/schema/catalog.ts` `contentItem` gains `crossSourceKey: text("cross_source_key")` (nullable) and `index("content_item_cross_source_key_idx").on(table.crossSourceKey)`.
4. **Migration step `content_cross_source_key`** in the Phase 7 runner (append to the ordered steps): add the column if missing (`ALTER TABLE content_item ADD COLUMN cross_source_key text`), create the index if missing, and backfill in TS: select `content_item.id, title, creator.name_key` joined on creator for rows where `cross_source_key IS NULL`, compute the mirrored key function per row, batch `UPDATE` (parameterized). Idempotent by the NULL guard and the migration id.
5. **Ingestion writes the key**:
   - `CatalogCreator` (packages/api/src/domain/catalog.ts:35-42) gains `readonly nameKey: string;` and `toCatalogCreator` (repositories/catalog.ts:901-910) maps it (column already exists on the row).
   - `SaveContentItemInput` (repositories/catalog.ts:45-56) gains `readonly crossSourceKey?: string | null;`; `findOrCreateContentItem` persists it on insert and, when an existing row has `NULL` and the input supplies a key, backfills it in the same update path as the re-point.
   - `persistNormalizedCatalog` (packages/api/src/services/ingestion.ts:200-207) computes `contentCrossSourceKey(creator.nameKey, normalizedItem.contentItem.title)` (skip when null) and passes it to `findOrCreateContentItem`.
   - All writes stay idempotent: repeated ingestion of the same video updates nothing but possibly creator_id / cross_source_key backfill.
6. **Tests** (public interfaces: repository functions + ingestion service):
   - repositories.test.ts: pre-existing feed/content row pointing at a stale creator id is re-pointed when the same source identity is persisted under the merged creator; cross_source_key is set on create and backfilled on conflict.
   - ingestion.test.ts: persisting the same normalized payload twice yields stable created-counts (no duplicate rows) and identical cross_source_key values; a title that normalizes to empty yields a null key that is not written.
   - packages/db: migration step test (legacy copy → column exists, backfilled values match the parity-tested function, re-run no-op).

**Inputs**:
- Read: packages/api/src/repositories/catalog.ts, packages/api/src/services/ingestion.ts, packages/api/src/services/refresh.ts, packages/api/src/domain/catalog.ts, packages/db/src/schema/catalog.ts, packages/db/src/migrations/catalog-data-migrations.ts (from Phase 7), existing tests: packages/api/src/repositories/repositories.test.ts, packages/api/src/services/ingestion.test.ts.

**Outputs**:
- Modify: packages/api/src/repositories/catalog.ts, packages/api/src/domain/catalog.ts, packages/api/src/services/ingestion.ts, packages/db/src/schema/catalog.ts, packages/db/src/migrations/catalog-data-migrations.ts, packages/db/src/creator-merge-plan.ts (or new cross-source-key.ts) + parity test
- Modify (tests): packages/api/src/repositories/repositories.test.ts, packages/api/src/services/ingestion.test.ts

**Validation Criteria**:
- `bun run check-types` zero errors; `bun run build` success; `bun run test` for packages/api and packages/db passes with the new cases.
- Code review: re-point logic cannot orphan rows (creator_id FK target validated by the merge creator existing — it comes from `findOrCreateCreator` in the same flow); the mirrored key functions live only in db + api with a parity test binding them; no write path regressed to non-idempotent behavior; refresh path confirmed self-healing by reading it.
- Behavior reasoning: after this phase, re-adding a legacy feed whose content rows point at a split creator heals the DB on next refresh/add-source; the YT and Odysee copies of the same video under the same creator share one `cross_source_key`.

**Dependencies**: Phase 7 must complete (runner + merge-plan location).

---

## Phase 9: Catalog/mirror API surface + Odysee embed fallback (demand 5, backend remainder)

**Type**: Sequential

**Goal**: Expose multi-source data to the UI: creator list entries carry `sourceTypes` (for per-creator source badges), content list items carry `mirrorCount`, content detail carries `mirrors` (the cross-source copies), and Odysee items without an enclosure become playable via an embed source.

**Requirements**:

1. **Creator list with sourceTypes** in `packages/api/src/repositories/catalog.ts` + `packages/api/src/domain/catalog.ts`:
   - Change `listCatalogCreators` (:506-533) to return `readonly CatalogCreatorSummary[]` (domain :86-92) instead of `CatalogCreator`: after fetching rows, call `loadSourceTypesByCreatorId` (:279-305) and map via `toCatalogCreatorSummary`.
   - Update the routers (packages/api/src/routers/index.ts `catalog.creators` procedure) and any service signatures that surface this list. Additive, non-breaking for fields the UI reads (id, displayName, imageUrl, canonicalUrl all present on the summary).
   - Keep ingestion's internal `CatalogCreator` usage unchanged (AddSourceValue.creator stays `CatalogCreator`).
2. **Mirror linkage queries**:
   - `CatalogContentListItem` (domain :81-84) gains `readonly mirrorCount: number;` — number of sibling content items with the same non-null `cross_source_key` (excluding self; 0 when the key is null). Add the correlated subselect in `listCatalogContentItems` (:535-597) and `listSubscribedContentItemsForUser` (packages/api/src/repositories/overlays.ts:214-273), mirroring the existing `sourceCount` subselect pattern (:561-565).
   - Mappers that cannot compute it cheaply — favorites list, history lists, playlist items-with-content (overlays.ts `listContentStatusWithContentForUser` :425, `listPlaylistItemsWithContentForUserPlaylist` :606) — set `mirrorCount: 0` explicitly (UI treats 0 as "unknown/none" in those views; the viewer switcher does not depend on it).
   - `CatalogContentDetail` (domain :94-98) gains `readonly mirrors: readonly CatalogContentListItem[];` — full list-item shape (so the web can feed them straight into its existing select-content flow) of sibling items sharing the same non-null `cross_source_key`, excluding self, ordered by `sourceType` then `publishedAt` desc. Implement in `getCatalogContentDetail` (:625-660) with a secondary query keyed on the item's `cross_source_key` (null → `[]`), reusing the same row-mapping as the list query (creator summary + sourceCount + mirrorCount).
   - Router `catalog.contentDetail` returns the new field automatically through the domain type — verify the procedure needs no input changes.
3. **Odysee embed fallback** in `packages/api/src/sources/odysee.ts`:
   - Today `buildContentSources` (:303-323) returns `[]` when `enclosureUrl === null` (:309), making such items unplayable (the web `toPlayableSources` guard also rejects odysee embeds — the web side is Phase 10). When the enclosure is missing, emit one embed source: `sourceType: "odysee"`, `embedUrl` = `https://odysee.com/$/embed<path>` where `<path>` is the pathname of the item's `canonicalUrl` **only if** the canonical URL parses and its host is `odysee.com` (validate; otherwise emit no source). `priority: 0`, `metadataJson` via the existing `stableJson` helper (`{ playback: "odysee-embed" }`).
   - Extend the odysee adapter fixture tests (locate them under packages/api/src/sources/ — follow existing naming) with: an item with an enclosure (unchanged native source), an item without an enclosure but with an odysee canonical URL (embed source produced with the correct `$/embed` URL), and a malformed/non-odysee canonical URL (no source, no throw).
4. **Tests** (public interfaces):
   - repositories.test.ts / catalog-browsing router test (packages/api/src/routers/catalog-browsing.test.ts): creators list returns `sourceTypes` aggregated from feeds+items; two items sharing a `cross_source_key` see each other in `mirrorCount` and in `contentDetail.mirrors`; items with null keys see none; user-scoped subscribed list mirrors the same counts (overlay scoping of the parent list unchanged — cross-user leakage check: mirrors are catalog-global by design, mirror **counts** are not user data).
   - Existing ingestion/refresh tests keep passing (mirrorCount/mirrors additions must not break payload shapes — update fixtures where they construct these domain objects).

**Inputs**:
- Read: packages/api/src/repositories/catalog.ts, packages/api/src/repositories/overlays.ts, packages/api/src/domain/catalog.ts, packages/api/src/routers/index.ts (catalog procedures), packages/api/src/sources/odysee.ts (+ its tests), packages/api/src/sources/youtube.ts (embed precedent :23, :362), tests: packages/api/src/routers/catalog-browsing.test.ts, packages/api/src/repositories/repositories.test.ts.

**Outputs**:
- Modify: packages/api/src/domain/catalog.ts, packages/api/src/repositories/catalog.ts, packages/api/src/repositories/overlays.ts, packages/api/src/routers/index.ts (signature plumbing only), packages/api/src/sources/odysee.ts, packages/api/src/routers/catalog-browsing.test.ts, packages/api/src/repositories/repositories.test.ts, odysee adapter tests

**Validation Criteria**:
- `bun run check-types` zero errors; `bun run build` success; `bun run test` for packages/api passes including new mirror/sourceTypes/odysee cases.
- Code review: mirror queries always guard on non-null `cross_source_key`; `mirrors` excludes self; no user-owned overlay data is exposed through the catalog mirror fields; the odysee embed URL is validated (protocol + host) before persistence; overlay mappers updated for the new required field with explicit `0` (no `any`-patches).
- Behavior reasoning: after Phase 8's data exists, `GET`-equivalent `catalog.contentDetail` for the YouTube copy of a mirrored video returns the Odysee copy in `mirrors`, and `catalog.creators` entries for multi-source creators list both source types.

**Dependencies**: Phase 8 must complete. Phase 10 depends on this.

---

## Phase 10: Web multi-source UX + persisted YouTube privacy preference (demand 5, UI)

**Type**: Sequential

**Goal**: Per-source icons on creator rows and content rows, a per-video "watch on <other source>" switcher in the viewer for mirrored videos, Odysee embed playback allowed in the web contract, and the YouTube no-cookie preference persisted as a user setting (behaving like `reader.density` / `creator.list.sort`).

**Requirements**:

1. **Creator row source badges** (`apps/web/src/components/app-shell-rows.tsx` + contract):
   - `BrowsableCreator` (app-shell.contract.ts:69) stays the union `CatalogCreator | CatalogCreatorSummary`; add a contract helper `toCreatorSourceTypes(creator: BrowsableCreator): readonly SourceType[]` returning `creator.sourceTypes ?? []` (narrow with `"sourceTypes" in creator` — no assertions).
   - In `CreatorSourceRow` (:84-145), render one small `SourceTypeIcon` (from ./source-indicator) per source type next to the display name (wrap in a `flex items-center gap-0.5`, `aria-label`/`title` listing the sources via `formatSourceLabel`). Hide when the list is empty. In library mode the summary already has `sourceTypes`; in catalog mode Phase 9 supplies it.
2. **Content row mirror chip** (`apps/web/src/components/app-shell-rows.tsx` `ContentListItemRow` :445-449): next to the existing `SourceIconBadge` (which shows the item's own source + per-item `sourceCount`), add a `+N` chip when `props.contentItem.mirrorCount > 0` — `title`/`aria-label`: "This video also exists on N other source(s); open it to switch." Pure display; no new fetches.
3. **Viewer cross-source switcher** (`apps/web/src/components/app-shell-viewer.tsx`):
   - `SelectedContentViewerProps` gains `readonly onSelectContent: (contentItem: CatalogContentListItem) => Promise<void>;` wired in app-shell.tsx to the existing `selectContent` (:1141-1149, which also marks opened and updates status — desired).
   - In the detail Match, when `detail().mirrors.length > 0`, render a "Also on" row (grouped with the existing `#viewer-source-switcher` area :362-397; place it above or below the per-item switcher, visually distinct): one button per mirror (`SourceTypeIcon` + `formatSourceLabel(mirror.sourceType)`, `aria-pressed` never — these are actions, `title` = mirror title) calling `void props.onSelectContent(mirror)`. Selecting a mirror re-keys `contentDetail` on the mirror id → playback switches to that source's `content_source` rows (same mechanism as clicking the row in the list). This is the per-video cross-source switch, complementing the existing within-item switcher and privacy toggle.
   - Keep the existing YouTube privacy toggle buttons (:384-411) functional.
4. **Odysee embed allowed in web contract** (`apps/web/src/components/app-shell.contract.ts` `toPlayableSources` :620-657): extend the embed eligibility guard (:636-638) from `youtube | peertube` to `youtube | peertube | odysee`. Extend the existing `toPlayableSources` unit tests in apps/web/src/components/app-shell.test.ts with an odysee-embed case (accepted) and an odysee source with neither embed nor native (dropped).
5. **Persisted privacy preference**:
   - Contract (`app-shell.contract.ts`): add `youtubePrivacySettingKey = "playback.youtube.noCookie"` (satisfies `settingKeyPattern` `^[a-z][a-z0-9._-]*$`) and `toYoutubeNoCookieFromSettings(settings: readonly UserSetting[]): boolean` (JSON-parse `valueJson`, accept only boolean, default `true`) — mirror `toReaderDensityFromSettings` (:567-583) exactly. Unit-test it in app-shell.test.ts.
   - Viewer: initialize the existing `useNoCookieEmbed` signal from `toYoutubeNoCookieFromSettings(props.settings())` (sync via `createEffect` when settings change, without clobbering an in-flight user click — simplest correct version: effect sets the signal to the settings-derived value; the save below updates settings, which re-converges the signal). On toggle: flip the local signal immediately (optimistic) and, only when `props.isAuthenticated()`, `await client.overlays.saveSetting({ key: youtubePrivacySettingKey, value: next ? "true" : "false" })` then `await props.onSettingsChanged()` (in-place settings refetch — safe since Phase 1; errors surfaced through the existing viewer error displays pattern). Anonymous users keep the session-local toggle with no save (preserve current capability).
   - Confirm the saved value round-trips through `overlays.settings()` → `toYoutubeNoCookieFromSettings` (parsing `"true"`/`"false"` JSON strings).
6. **Tests**: extend apps/web/src/components/app-shell.test.ts for the new contract functions (`toCreatorSourceTypes`, `toYoutubeNoCookieFromSettings`, `toPlayableSources` odysee cases). No component-mount tests required (repo convention is contract-level tests).

**Inputs**:
- Read: apps/web/src/components/app-shell-viewer.tsx, apps/web/src/components/app-shell-rows.tsx, apps/web/src/components/app-shell.contract.ts, apps/web/src/components/app-shell.tsx, apps/web/src/components/source-indicator.tsx, apps/web/src/components/app-shell.test.ts, packages/api/src/domain/catalog.ts (updated types from Phase 9).

**Outputs**:
- Modify: apps/web/src/components/app-shell-viewer.tsx, apps/web/src/components/app-shell-rows.tsx, apps/web/src/components/app-shell.contract.ts, apps/web/src/components/app-shell.tsx, apps/web/src/components/app-shell.test.ts

**Validation Criteria**:
- `bun run check-types` zero errors; `bun run build` success; `bun run test` for apps/web passes with new contract tests.
- Code review: no `any`/assertions in the union narrowing; the mirror switch uses the existing selection flow (no bespoke fetch logic in the viewer); the persisted toggle follows the reader-density save pattern and surfaces failures; anonymous behavior preserved; creator badges and mirror chip render nothing when data is absent (no empty-icon artifacts).
- Behavior reasoning: a multi-source creator row shows all its source icons; a mirrored video row shows its own source icon plus `+N`; opening it offers one-click switching to the other source which loads that source's playback (embed or native) through the normal playable-source pipeline; the privacy choice survives reload for authenticated users.

**Dependencies**: Phases 5 and 9 must complete (viewer wiring + API fields).

---

## Phase 11: Final verification

**Type**: Sequential

**Goal**: Prove the whole plan holds together: types, builds, tests, and the five demands, through public interfaces and code review — no dev servers.

**Requirements**:

1. Run from the repo root: `bun run check-types` (zero errors), `bun run build` (success), `bun run test` (all package suites pass: api, db, web, server). Re-run with Turbo `--force` if any task was served from cache during a phase that changed it.
2. Cross-phase integration review (validator reads the final state of: app-shell.tsx, app-shell-content-column.tsx, app-shell-viewer.tsx, app-shell-source-sections.tsx, app-shell-rows.tsx, app-shell.contract.ts, routes/*, main.tsx, styles.css, packages/db migration runner, packages/api repositories/domain/sources):
   - Every resource in the three shell columns + viewer is consumed via `.latest` memos or Mutation-free reads; `grep -n "statusReloadKey\|split(\"\")" apps/web/src` is empty; no plain `settings()`/`playlists()`/`favoriteItems()`/`collections()` reads remain on render paths.
   - Shared types line up end-to-end: `CatalogCreatorSummary.sourceTypes`, `CatalogContentListItem.mirrorCount`, `CatalogContentDetail.mirrors`, `content_item.cross_source_key` — web contract types and API domain types agree (no structural assertions anywhere).
   - Demand-by-demand trace (each validated against code, with file:line evidence in the report):
     1. Selected creator: high-contrast styling + ring + `aria-current`, pinned to top, scrollIntoView on selection, X affordances (content-column chip + Feeds tab), list not torn down by refetches.
     2. Viewer creator name is a button → select-only creator selection → only the content-list resource re-keys; viewer and creator column do not remount.
     3. Creator column controls are icon-based in both states; search input retains dominant width; catalog search debounced 300 ms.
     4. Favoriting (row or viewer), playlist add (row or viewer), settings changes, collection CRUD, member search, history selection, catalog↔library navigation, and the native-playback fallback link each cause no blank of any column and no full-app suspension; playback survives all of them.
     3→5. Multi-source: DB migration command exists and was proven on a copy; ingestion self-heals and tags mirrors; creator rows show all source icons; content rows show own source + mirror count; viewer offers cross-source switching; privacy toggle persists for authenticated users; Odysee no-enclosure items are playable.
3. Re-confirm the standing invariants (validator checklist): no automatic background refresh added (the only timers are the existing refresh-status poll, metadata poll, and the new 300 ms input debounces); anonymous catalog browsing intact; all overlay reads/writes scoped by authenticated `userId` at the API boundary; ingestion writes remain idempotent; no document-wide custom events introduced.
4. Report the operator step for the live DB: stop the server, run `bun run db:repair --db /home/didi/workspace/FeedElity/local.db --yes`, optionally `bun run db:push` afterwards to confirm zero drift; then restart. (Not executed by the plan; dry-run output from Phase 7's copy-test is the evidence it is safe.)

**Inputs**: all outputs of Phases 1-10.

**Outputs**: none (verification only); a findings report if anything fails (route to fixer dispatches for the owning phase).

**Validation Criteria**:
- All three commands pass; every demand trace has concrete file:line evidence; any gap is dispatched back to the owning phase's fixer loop before the plan is declared complete.

**Dependencies**: Phases 1-10 must all complete.

---

## Success Criteria

Overall success requires:

- All 11 phases complete and validated (implementer gatekeeping + independent validator code review per phase; phase-wide validation across parallel lanes).
- `bun run check-types`: zero errors. `bun run build`: success. `bun run test`: all suites pass, including the new tests for the migration runner, ingestion self-heal/mirror keys, mirror/sourceTypes catalog queries, odysee embed fallback, and the new web contract functions.
- All five user demands demonstrably satisfied per the Phase 11 trace, with no full-app-reload/blank path remaining and no regressions to anonymous browsing, refresh semantics, cross-user isolation, or ingestion idempotency.
- The live-DB convergence command is documented and proven on a copy, ready for the user to run.

## Design decisions recorded (with trade-offs)

- **Reload squashing = `.latest` reads + in-place refetches, not a big refactor.** AppShell stays one component; no speculative state-module extraction. Optimistic local flips are always reconciled by an immediate server refetch (AGENTS.md rule).
- **History views become snapshots**: `statusReloadKey` is removed outright; opened/played markers propagate through local status patches. Trade-off: a newly opened video joins the history list on the next fetch, not instantly — accepted because the alternative (refetch on every open) reorders the list under the user's cursor.
- **Migration mechanism = idempotent TS steps in `__feedelity_migrations` (existing bootstrap pattern), NOT a drizzle-kit migration.** The drizzle journal snapshot is still at the legacy creator schema, so a generated migration would create the `name_key` unique index over duplicated rows and fail. Trade-off: the journal stays deliberately behind for the creator change; documented in scripts/db-repair/README.md and mitigated by `db:push` for fresh dev DBs.
- **Mirror linkage = persisted `content_item.cross_source_key`** (`nameKey + normalized title`), computed at ingestion and backfilled by migration. Trade-off vs query-time fuzzy matching (title ± duration): a stored key is deterministic, cheap to query, and heals incrementally; risk is false positives on identically-titled different videos by the same creator — accepted for a personal RSS client, and the linkage only affects display/switching, never ingestion identity (source-unique rows remain the source of truth).
- **Mirror rows stay separate in lists** (no dedupe): overlays (favorites/history/statuses/playlists) are keyed per `content_item.id`; merging rows would require overlay semantics this plan does not change. Mirrors surface as a `+N` chip in lists and an explicit switcher in the viewer.
- **Catalog creator list switches to `CatalogCreatorSummary`** so creator rows can show per-source badges; ingestion-internal `CatalogCreator` (which now carries `nameKey`) is unchanged.
- **Compact controls use native `details`/`summary` + plain buttons** (existing in-repo popover precedent), no headless libraries, keeping the stack constraint intact.
