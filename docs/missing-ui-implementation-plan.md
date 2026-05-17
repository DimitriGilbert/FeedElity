# Missing UI Implementation Plan

Planner output for subagent-orchestration. This plan is implementation-ready but must be executed by an orchestrator using implementer → validator → fixer loops. Do not modify application code while planning.

## Non-negotiable product and UI constraints

- Preserve the dense video RSS reader workflow: creator/source pane, content/feed pane, selected viewer pane.
- Desktop must keep exactly three top-level panes and keep `lg:grid-cols-[1fr_3fr_8fr]` unchanged.
- Do not add a fourth pane, generic dashboard/cockpit, topics UI, or external-content UI.
- No automatic background refresh for v1. Refresh remains manual normal/force only.
- Use semantic tokens only. No palette classes, arbitrary color values, gradients, or decorative palette drift.
- No fake or no-op controls. Every visible action must call a real API path or be absent.
- Preserve anonymous public catalog browsing. User overlays stay auth-protected and scoped by `userId`.
- Use existing stack and boundaries: Solid web app, oRPC API, Hono server, Drizzle/libSQL, source adapters, ingestion service.
- Do not reintroduce document-wide custom events or old Strapi client/runtime shapes.
- Current imported legacy data caveat: the available migrated dataset is partially imported because unsupported or blank legacy feed rows were unmapped and skipped/reported. Usable catalog/subscription/content data is present and should be used for UI validation, but import/report UI must surface partial-import warnings rather than treating the dataset as complete.

## Orchestration rules for execution

- The orchestrator must not write code directly. Dispatch subagents per phase.
- Every implementer/fixer must run gate commands before reporting complete.
- Every validator must read changed files and verify requirements, not only run commands.
- Multi-sub-phase phases require per-sub-phase validation plus a phase-wide validator after all sub-phases pass.
- NO-SLOP policy for every implementer/fixer and enforced by every validator:
  - No `any`, `as any`, or `: any`.
  - No placeholder code, `TODO`, or `FIXME`.
  - No unused imports or unused variables.
  - No console logging hacks or void hacks.
  - Use `import type` for type-only imports.
  - External imports first, blank line, then local imports.
  - Do not start long-running dev servers.

## Baseline files to read before each relevant phase

- `AGENTS.md`
- `final-from-scratch-plan.md`
- `docs/missing-ui-functionality-inventory.md`
- `apps/web/src/components/app-shell.tsx`
- `apps/web/src/components/app-shell.test.ts`
- `packages/api/src/routers/index.ts`
- `packages/api/src/services/ingestion.ts`
- `packages/api/src/repositories/catalog.ts`
- `packages/api/src/repositories/overlays.ts`
- `packages/db/src/schema/catalog.ts`
- `packages/db/src/schema/overlays.ts`

## Phase 1 — Immediate UX repair: stable panes and discoverable controls

**Impact:** High UX impact, low domain impact. Must be first.

**Implementer type:** Solid UI implementer.

**Likely files touched:**
- `apps/web/src/components/app-shell.tsx`
- `apps/web/src/components/app-shell.test.ts`
- Possibly `apps/web/src/styles.css` only if needed for semantic utility support.

**Requirements:**
- Make source/feed/content/viewer regions scroll within the viewport on desktop without changing the approved three-pane layout.
- Keep `desktopShellGridClass` exactly `lg:grid-cols-[1fr_3fr_8fr]`.
- Keep exactly three `data-shell-column` top-level sections.
- Create deliberate internal scroll regions:
  - sources header/search/actions stay discoverable;
  - creator list scrolls;
  - selected creator feed list scrolls if long;
  - refresh/settings/playlist controls do not stretch the whole page indefinitely;
  - content filters stay visible while rows scroll;
  - viewer scrolls independently.
- Improve discoverability of existing real controls without adding no-op buttons:
  - visible add/source area may be a disabled sign-in-gated message only if the real flow lands in Phase 2; otherwise do not add the action yet;
  - settings and playlists can be collapsed/expanded only if controls still call real APIs;
  - refresh controls remain visible and labeled manual-only.
- Do not implement functional add-source/status/subscription behavior in this phase unless trivial and fully wired; this phase is layout/affordance repair only.

**Required tests:**
- Extend `app-shell.test.ts` to assert:
  - desktop grid class is unchanged;
  - exactly three top-level panes remain;
  - desktop panes use viewport/internal scroll classes (`lg:h-...`, `lg:min-h-0`, `lg:overflow-hidden`, or equivalent);
  - source and content columns expose stable header/action regions and scroll body regions;
  - no fourth pane, dialogs, fake controls, palette classes, or rejected jargon are introduced.

**Gate commands:**
- `bun test apps/web/src/components/app-shell.test.ts`
- `bun run check-types`
- `bun run build` if layout changes touch shared CSS or route shell behavior.

**Acceptance criteria:**
- At desktop sizes, long creators/feeds/settings/playlists/content no longer grow the entire page.
- Three-pane density is preserved.
- Controls are easier to find, but no new button lies about unavailable behavior.

## Phase 2 — Add source/add creator flow through ingestion

**Impact:** High. Restores core operational behavior.

**Phase shape:** Multi-sub-phase with phase-wide validation.

### Phase 2A — API exposure for ingestion

**Implementer type:** API/domain implementer.

**Likely files touched:**
- `packages/api/src/routers/index.ts`
- `packages/api/src/services/ingestion.ts` if output shaping is needed, but prefer not to change service semantics.
- API tests under `packages/api/src/**` if an existing test pattern exists.

**Requirements:**
- Add protected oRPC procedures for:
  - single add source from URL/input using existing `addSource`;
  - batch add sources using existing `batchAddSources`.
- Inputs must be validated with bounded string length and trimmed values.
- Use `context.sourceRegistry ?? createSourceAdapterRegistry()`.
- Pass `context.session.user.id` so successful authenticated add creates/reuses subscription.
- Return structured success/failure results; do not throw for adapter-level unsupported URL results unless the procedure contract already expects exceptions.
- Preserve anonymous catalog browsing; add-source remains protected.
- Do not introduce live-network test dependency unless existing adapter mocks/fixtures support it.

**Validation criteria:**
- Protected procedures reject anonymous calls through existing protectedProcedure behavior.
- Existing ingestion idempotency and partial failure behavior remain intact.
- No source-specific logic leaks into router beyond registry use.

### Phase 2B — Web add-source UI

**Implementer type:** Solid UI implementer.

**Likely files touched:**
- `apps/web/src/components/app-shell.tsx`
- `apps/web/src/components/app-shell.test.ts`

**Requirements:**
- Add a discoverable authenticated add-source control in the source pane.
- Support single URL/input first; batch textarea may be included if backed by the new batch API and result reporting is clear.
- Show source detection help text for YouTube, Odysee, and PeerTube without hardcoding unsupported promises.
- On success:
  - show creator/feed/content created/reused counts;
  - refresh creator/subscription/catalog resources as needed;
  - select the added creator if the returned creator is available.
- On failure:
  - show structured adapter/persistence messages;
  - keep input editable;
  - do not show fake success.
- For anonymous users, show a compact message that sign-in is required to add/subscribe, while public catalog browsing remains usable.

**Phase-wide validation:**
- Validate API and UI together: UI calls only real procedures, handles success/failure shapes, and keeps cross-user behavior protected.

**Required tests:**
- API tests for protected add-source and batch partial result behavior where feasible.
- UI source assertions/component tests for real client calls and absence of no-op add buttons.

**Gate commands:**
- Relevant API test command if present.
- `bun test apps/web/src/components/app-shell.test.ts`
- `bun run check-types`
- `bun run build`

**Acceptance criteria:**
- A signed-in user can add a supported source through ingestion and see real results.
- Unsupported/invalid inputs fail visibly and safely.
- Anonymous users cannot add sources but can keep browsing the catalog.

## Phase 3 — Subscriptions and Library/Catalog distinction

**Impact:** High UX/domain clarity.

**Implementer type:** Solid UI implementer with API familiarity.

**Likely files touched:**
- `apps/web/src/components/app-shell.tsx`
- `apps/web/src/components/app-shell.test.ts`
- Possibly `apps/web/src/components/header.tsx` and route files if Library/Catalog route behavior changes.

**Requirements:**
- Surface subscription state using existing `client.overlays.subscriptions()`.
- Add subscribe/unsubscribe controls for selected creator and/or creator rows, gated by auth.
- Distinguish Catalog from Library:
  - Catalog shows global public creators/content and remains anonymous-friendly.
  - Library shows subscribed creators/content/favorites/history/playlists for authenticated users.
- If `/dashboard` remains, make it a meaningful Library entry; otherwise redirect/rename consistently. Do not create a generic dashboard/cockpit.
- Library filtering should not leak into anonymous catalog reads or require user state to browse public catalog.
- Update copy to use user-facing terms (`Catalog`, `Library`, `Subscribed`) rather than internal overlay jargon.

**Required tests:**
- UI tests/assertions that subscription calls are real (`subscriptions`, `subscribeToCreator`, `unsubscribeFromCreator`).
- Tests/assertions that anonymous users do not see protected mutation controls.
- Tests/assertions that Catalog and Library labels/routes are deliberate and not duplicate confusing shells.

**Gate commands:**
- `bun test apps/web/src/components/app-shell.test.ts`
- `bun run check-types`
- `bun run build`

**Acceptance criteria:**
- Users can tell whether they are browsing global Catalog or personal Library.
- Signed-in users can subscribe/unsubscribe with visible state changes.
- Anonymous catalog experience is preserved.

## Phase 4 — Opened/played/viewed workflows and history

**Impact:** High. Restores status parity.

**Phase shape:** Multi-sub-phase with phase-wide validation.

### Phase 4A — Content status state in list/viewer

**Implementer type:** Solid UI implementer.

**Likely files touched:**
- `apps/web/src/components/app-shell.tsx`
- `apps/web/src/components/app-shell.test.ts`

**Requirements:**
- Load authenticated content statuses through `client.overlays.contentStatuses()`.
- Mark opened when a signed-in user selects a content item.
- Do not mark opened for anonymous users.
- Make opened and played row state visible using semantic tokens and data attributes.
- Add explicit mark opened/viewed and mark played actions where useful; label consistently as `Opened`/`Played` or `Mark played`, not ambiguous raw status names.
- Ensure status updates refetch/reconcile list and viewer state.

### Phase 4B — Playback event and manual played workflow

**Implementer type:** Solid UI implementer.

**Likely files touched:**
- `apps/web/src/components/app-shell.tsx`
- `apps/web/src/components/app-shell.test.ts`

**Requirements:**
- Native `<video>` playback should call mark played on `onPlay` when authenticated and content is selected.
- Iframe embeds cannot reliably emit native playback; provide an explicit Mark played button in the viewer.
- Make errors visible without throwing into the UI event loop.
- Avoid double-writing problems by relying on idempotent status API.

### Phase 4C — Hide played/unplayed filters and history view

**Implementer type:** Solid UI implementer.

**Likely files touched:**
- `apps/web/src/components/app-shell.tsx`
- `apps/web/src/components/app-shell.test.ts`

**Requirements:**
- Add authenticated content filters: All, Favorites, History/Open, Played, and Hide played.
- Hide played must filter from loaded UI state or use an API if added; no DOM-class filtering.
- Add a history view using `client.overlays.contentHistory({ status: "opened" | "played" })`.
- Filters must combine predictably with search/source/creator where feasible; if history endpoint cannot combine server-side, document and show local behavior clearly.

**Phase-wide validation:**
- Verify selection → opened, manual/native played, row state, hide played, and history all use the same status source and no conflicting duplicate resources.

**Required tests:**
- Tests/assertions for `markContentOpened`, `markContentPlayed`, `contentStatuses`, and `contentHistory` usage.
- Tests/assertions that anonymous users do not call protected status procedures.
- Tests/assertions that no DOM filtering (`querySelector`, `classList`, hidden hacks) is introduced.

**Gate commands:**
- `bun test apps/web/src/components/app-shell.test.ts`
- `bun run check-types`
- `bun run build`

**Acceptance criteria:**
- Selecting content records opened for signed-in users.
- Native playback and explicit button can mark played.
- Opened/played state is visible in rows and available through history/filter views.

## Phase 5 — Feed/source selection, filtering, refresh, and thumbnail parity

**Impact:** Medium/high. Improves scanning and source clarity.

**Phase shape:** Multi-sub-phase with phase-wide validation.

### Phase 5A — Creator/source-type and feed selection filters

**Implementer type:** API + Solid UI implementer.

**Likely files touched:**
- `apps/web/src/components/app-shell.tsx`
- `apps/web/src/components/app-shell.test.ts`
- `packages/api/src/routers/index.ts`
- `packages/api/src/repositories/catalog.ts`

**Requirements:**
- Add source-type filter to creator/source pane using existing `creatorListInput.sourceType` support.
- Make selected feed explicit in UI.
- Add content filtering by selected feed. If API lacks feed-id filtering, add a narrow repository/router field that joins `feedContent` safely.
- Distinguish source-type filtering (list scope) from playback source switching (selected video source).

### Phase 5B — Feed row affordance and source/thumbnail parity

**Implementer type:** Solid UI implementer.

**Likely files touched:**
- `apps/web/src/components/app-shell.tsx`
- `apps/web/src/components/app-shell.test.ts`

**Requirements:**
- Improve feed rows with clear action zones: select/filter feed, source chip, URL/title, last refresh metadata, and selected state.
- If feed/creator image is available, use it; otherwise do not invent thumbnails or fake images.
- Improve content rows with source/source-count indicators, clearer selected/opened/played/favorite state, and source switcher/thumbnail parity where data exists.

### Phase 5C — Feed-level refresh if backend support is added

**Implementer type:** API/domain implementer, then Solid UI implementer.

**Likely files touched:**
- `packages/api/src/routers/index.ts`
- `packages/api/src/services/refresh.ts`
- `packages/api/src/repositories/catalog.ts`
- `apps/web/src/components/app-shell.tsx`
- tests in API/web.

**Requirements:**
- Only add feed-level refresh UI if a protected backend procedure exists and is tested.
- Backend should use existing `refreshRun.scope = "feed"` and `requestedFeedId` schema support.
- UI must show feed-level normal/force actions with force confirmation.
- If backend support is deferred, feed rows should not show fake refresh buttons.

**Phase-wide validation:**
- Verify creator source-type filter, feed selection, content filtering, and optional feed refresh compose without breaking creator selection or viewer selection.

**Required tests:**
- API tests for feedId filtering/refresh if added.
- UI tests/assertions for source filter in creators, selected feed state, no fake feed refresh.

**Gate commands:**
- Relevant API tests if backend touched.
- `bun test apps/web/src/components/app-shell.test.ts`
- `bun run check-types`
- `bun run build`

**Acceptance criteria:**
- Users can filter creators by source type, select a feed, and understand which list filter is active.
- Feed rows feel actionable without clutter.
- Feed refresh appears only when backed by real backend behavior.

## Phase 6 — Settings UX replacement

**Impact:** Medium. Makes an existing feature discoverable.

**Implementer type:** Solid UI implementer, possibly API implementer if typed settings need stricter contracts.

**Likely files touched:**
- `apps/web/src/components/app-shell.tsx`
- `apps/web/src/components/app-shell.test.ts`
- Possibly `packages/api/src/routers/index.ts` for typed save helpers, but prefer existing settings API if sufficient.

**Requirements:**
- Replace raw key/value as the primary settings UX with typed, discoverable controls for confirmed v1 settings only.
- Candidate typed controls must map to real stored setting keys and values with validation:
  - reader density/layout preference if already meaningful;
  - playback preference only if implemented;
  - refresh defaults only if manual semantics remain explicit.
- Raw key/value editor may remain as collapsed Advanced settings, authenticated-only.
- No fake default settings; show saved values or documented app defaults that are actually used.
- Settings entry point must be visible without forcing users to scroll through long source lists.

**Required tests:**
- UI tests/assertions that typed controls call `saveSetting`/`deleteSetting` with bounded, known keys.
- Tests/assertions that raw editor, if retained, is collapsed/advanced and not primary.
- Tests/assertions that no fake defaults or no-op settings appear.

**Gate commands:**
- `bun test apps/web/src/components/app-shell.test.ts`
- `bun run check-types`
- `bun run build`

**Acceptance criteria:**
- A signed-in user can find and change settings without knowing raw key names.
- Raw settings do not dominate the narrow source pane.

## Phase 7 — Playlist UX fixes and add-to-playlist discoverability

**Impact:** Medium. Reduces cramped overlay UX.

**Implementer type:** Solid UI implementer with repository/API awareness for sort behavior.

**Likely files touched:**
- `apps/web/src/components/app-shell.tsx`
- `apps/web/src/components/app-shell.test.ts`
- Possibly `packages/api/src/repositories/overlays.ts` / `packages/api/src/routers/index.ts` if honoring sort server-side.

**Requirements:**
- Keep playlists inside the approved three-pane shell; no fourth pane.
- Move/collapse/resize playlist management so it does not consume the whole source column:
  - compact playlist selector in source pane or viewer;
  - expanded management in a collapsible panel/Library mode within existing panes.
- Add-to-playlist must be discoverable near content rows and viewer, backed by `addPlaylistItem`.
- Fix sort mode mismatch:
  - either honor sort mode when fetching/rendering playlist items; or
  - remove/disable misleading sort selector and make manual ordering explicit.
- Manual up/down controls should appear only when manual order is active.

**Required tests:**
- UI tests/assertions for no fourth pane/dialog, real playlist API calls, discoverable add controls.
- If backend sorting is added, API/repository tests for each supported sort mode.
- Tests/assertions that manual reorder is not shown for non-manual sort modes.

**Gate commands:**
- Relevant API tests if backend touched.
- `bun test apps/web/src/components/app-shell.test.ts`
- `bun run check-types`
- `bun run build`

**Acceptance criteria:**
- Playlist management is usable in the dense layout.
- Sort controls are truthful.
- Adding selected/list content to a playlist is obvious and real.

## Phase 8 — Refresh UX improvements

**Impact:** Medium. Operational clarity.

**Implementer type:** API/domain implementer for enriched data if needed, then Solid UI implementer.

**Likely files touched:**
- `packages/api/src/repositories/catalog.ts`
- `packages/api/src/routers/index.ts`
- `packages/api/src/services/refresh.ts` only if report data is insufficient.
- `apps/web/src/components/app-shell.tsx`
- tests.

**Requirements:**
- Show feed names/titles in refresh result rows, not only statuses.
- Show errors and skipped reasons from `errorSummaryJson` where present.
- Show in-progress/busy state and completion feedback clearly.
- Add force confirmation for force all/source/feed actions.
- Keep normal refresh cadence semantics separate from force refresh.
- Do not add polling, timers, or background refresh.

**Required tests:**
- API tests if result shape changes to include feed labels.
- UI tests/assertions for feed names, error/skipped copy, force confirmation, and absence of `setInterval`/polling.

**Gate commands:**
- Relevant API tests if backend touched.
- `bun test apps/web/src/components/app-shell.test.ts`
- `bun run check-types`
- `bun run build`

**Acceptance criteria:**
- Users can tell what refreshed, what skipped, and why a failure happened.
- Force refresh requires deliberate confirmation.
- Refresh remains manual-only.

## Phase 9 — Pagination/load-more for creators, feeds, and content

**Impact:** Medium. Prevents silent truncation.

**Implementer type:** API/repository implementer and Solid UI implementer.

**Likely files touched:**
- `packages/api/src/repositories/catalog.ts`
- `packages/api/src/routers/index.ts`
- `apps/web/src/components/app-shell.tsx`
- `apps/web/src/components/app-shell.test.ts`
- API tests.

**Requirements:**
- Replace fixed silent limits with load-more or pagination for:
  - creators;
  - selected creator feeds;
  - content items.
- Prefer cursor-based pagination if practical; offset-based is acceptable for v1 if stable ordering is explicit and tested.
- Preserve bounded limits and API validation.
- UI must show loaded count and a real Load more button only when more data may exist.
- No infinite auto-load timers/observers unless explicitly tested and accessible.

**Required tests:**
- Repository/API tests for pagination boundaries and stable ordering.
- UI tests/assertions for load-more controls and updated input shape.

**Gate commands:**
- Relevant API tests.
- `bun test apps/web/src/components/app-shell.test.ts`
- `bun run check-types`
- `bun run build`

**Acceptance criteria:**
- Users are not silently capped at 50 creators/content or 25 feeds.
- Load more works without breaking current filters/search/selection.

## Phase 10 — Mobile pane navigation

**Impact:** Medium. Usability on narrow screens.

**Implementer type:** Solid UI implementer.

**Likely files touched:**
- `apps/web/src/components/app-shell.tsx`
- `apps/web/src/components/app-shell.test.ts`
- Possibly `apps/web/src/styles.css`.

**Requirements:**
- Add explicit mobile navigation between Sources, Feed, and Viewer.
- Desktop stays three panes with `lg:grid-cols-[1fr_3fr_8fr]`.
- Mobile may show one pane at a time or stacked with jump controls, but must avoid a long uncontrolled vertical page.
- Selecting a creator should move users to Feed on mobile; selecting content should move users to Viewer on mobile.
- Keyboard and screen-reader labels must be clear.
- No fourth pane or route-level generic dashboard.

**Required tests:**
- Tests/assertions for mobile pane state contract and desktop class preservation.
- Tests/assertions for exactly three pane IDs and labels.

**Gate commands:**
- `bun test apps/web/src/components/app-shell.test.ts`
- `bun run check-types`
- `bun run build`

**Acceptance criteria:**
- Narrow screens have an intentional Sources/Feed/Viewer navigation flow.
- Desktop layout is unchanged.

## Phase 11 — Migration/import/report UI, scoped later

**Impact:** Medium/high operationally, but later than reader parity.

**Implementer type:** API/domain implementer for report endpoints if needed, then Solid UI implementer.

**Likely files touched:**
- `packages/api/src/routers/index.ts`
- `packages/api/src/repositories/overlays.ts`
- `packages/api/src/migration/**`
- `apps/web/src/**` route/component files.

**Requirements:**
- Scope as admin-only or explicitly privileged before implementation. If no admin role exists, do not expose broad migration UI to every signed-in user without a product decision.
- UI should support:
  - Strapi export JSON upload/paste;
  - validation/dry-run if backend supports it, otherwise clearly label actual import;
  - run summary counts;
  - warnings/failures/unmapped records;
  - downloadable/copyable report.
- Include current data caveat in UI/report copy: partial import can be expected when legacy feed rows are unsupported or blank; usable data can still be present.
- Migrated users must be told they need password setup/reset; never reuse Strapi hashes.
- Keep migration input validation at API boundary and avoid client-side-only trust.

**Required tests:**
- API tests for authorization and malformed input if endpoints change.
- UI tests/assertions for warning/failure display and no anonymous access.

**Gate commands:**
- Relevant migration/API tests.
- `bun run check-types`
- `bun run build`

**Acceptance criteria:**
- Operators can import/review migration results without hiding partial failures.
- Unmapped unsupported/blank legacy feed rows are reported clearly.

## Final release validation after all phases

- `bun run check-types`
- `bun run build`
- `bun test apps/web/src/components/app-shell.test.ts`
- Relevant API/package tests introduced by the phases.
- Manual smoke checklist:
  - anonymous Catalog browse/select/view works;
  - authenticated add-source/subscription/status/favorite/playlist/settings flows work;
  - refresh remains manual-only;
  - desktop has exactly three panes and exact grid class;
  - mobile has explicit pane navigation;
  - no topics/external-content/generic dashboard/no-op controls appear.
