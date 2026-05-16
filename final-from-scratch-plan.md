# Feedelity Final From-Scratch Rewrite Plan

This is the execution-ready plan for rebuilding Feedelity on the already bootstrapped Better-T-Stack monorepo in this repository.

The old Strapi app in `../Feedelity` is a reference for behavior and migration only. Do not adapt, copy, or reintroduce its generated client, event-bus shell, Strapi response shapes, or low-code component structure.

## Confirmed Stack And Boundaries

- Bootstrap source of truth: `bts.jsonc`.
- Package manager/runtime: Bun.
- Frontend: Solid in `apps/web`.
- Backend: Hono in `apps/server`.
- API contract: oRPC in `packages/api`.
- Auth: better-auth in `packages/auth`.
- Database: SQLite/libSQL with Drizzle in `packages/db`.
- Desktop: Electrobun in `apps/desktop`.
- Monorepo orchestration: Turborepo over `apps/*` and `packages/*`.
- No new top-level `client/` app should be created.

## Product Decisions Closed During Grilling

- Preserve anonymous browsing of the global creator/content catalog.
- Use a global catalog for creators, feeds, and content items.
- Keep private user overlays for subscriptions, favorites, opened history, played history, playlists, and account settings.
- Migrated users must reset or set a new password before first login in the new app. Do not attempt to reuse Strapi password hashes.
- Migration input is a deterministic Strapi export JSON. A separate helper may export from the old Strapi MySQL database into that JSON shape.
- Preserve normal-vs-force manual refresh semantics.
- Normal refresh respects stored cadence metadata.
- Force refresh bypasses cadence metadata.
- v1 has no automatic background scheduler.
- PeerTube launch support must use the PeerTube instance API, not RSS-only support.
- Placeholder scope for v1: implement playlists, favorites, account/app settings, and list filters.
- Explicitly defer `topics` and `external-content` unless a later PRD defines them.
- Desktop must support both local and remote backend modes.
- Desktop default should be local-first, but users can configure a remote/shared server.

## Non-Negotiables

- Preserve current high-density three-column workflow: creator/source column, content list column, selected content viewer column.
- Preserve current core behavior without regression: browse, select, view, favorite, mark open, mark played, add subscriptions, batch-add subscriptions, refresh individual creators, refresh all, force refresh all.
- Complete v1 placeholder features only where they have confirmed scope: playlists, favorites view, settings, filters.
- Support YouTube, Odysee, and PeerTube from launch.
- Design source handling through adapters and a registry.
- Keep ingestion separate from presentation.
- Keep all user-scoped persisted records explicitly tied to `userId`.
- Keep global catalog data safe for anonymous read access.
- Do not leak user overlays into anonymous or other-user responses.
- No payments.
- No Strapi runtime dependency in the new app.
- No document-wide custom event bus as the new app architecture.
- No placeholder code, no TODO-driven implementation phases.

## TDD And Validation Policy

- Use vertical TDD slices: one behavior test, one implementation, then repeat.
- Tests must verify public behavior through API procedures, domain services, or rendered UI behavior, not private helper internals.
- Prefer integration-style tests around source parsing, ingestion, refresh selection, migration mapping, API authorization, and UI flows.
- Avoid bulk-writing imagined tests for whole phases before implementation.
- Each implementer must run the relevant gatekeeping commands before reporting done.
- Required root gatekeeping commands: `bun run check-types`, `bun run build`, and relevant package/app tests once test scripts exist.
- Every package that receives implementation must expose a `check-types` script if it does not already have one.
- Validators must read changed code and verify requirements, not only run commands.

## Orchestration Policy

- Execute with subagent-orchestration after this plan is approved.
- The orchestrator must dispatch implementers, validators, and fixers; it must not write code directly during execution.
- Each phase below is sized for agent execution.
- Larger phases are split into sub-phases with per-sub-phase validation and a phase-wide validator.
- Every implementer and fixer dispatch must include the no-slop policy:
- No `any`, `as any`, or `: any`.
- No placeholder code, `TODO`, or `FIXME`.
- No unused imports or unused variables.
- No console logging hacks or void hacks.
- Use `import type` for type-only imports.
- External imports first, blank line, then local imports.
- Do not start a long-running dev server.

## Target Domain Model

### Global Catalog

- `sourceType`: `youtube`, `odysee`, `peertube`, with room for future source types.
- `creator`: normalized creator/channel/account identity, display name, description, optional image, source-neutral metadata.
- `feed`: source-specific feed or remote collection belonging to a creator, with URL, source type, external ID, refresh metadata, and adapter metadata.
- `contentItem`: normalized video-oriented item with creator, title, description/body, publication date, content type, duration, thumbnail, and source-neutral fields.
- `contentSource`: one or more playable/source links for a content item, including source type, embed URL, native media URL, canonical URL, and priority.
- `feedContent`: association between feed and content item, with source external ID and raw import reference where needed.
- `refreshRun`: manual refresh attempt, scope, force flag, status, counts, started/completed timestamps, and error summaries.
- `refreshFeedResult`: per-feed result for a refresh run.

### User-Owned Overlays

- `user`: better-auth user record plus app-level preferences where needed.
- `subscription`: user-to-creator subscription with optional user-specific settings.
- `contentStatus`: user/content status for `opened`, `played`, and `favorite`.
- `playlist`: user-owned playlist with name, description, sort/order metadata.
- `playlistItem`: playlist/content association with position and added timestamp.
- `userSetting`: account/app settings not owned by better-auth.
- `migrationRun`: one-time import state, source export fingerprint, status, counts, warnings, and failures.
- `migrationMapping`: old Strapi entity reference to new entity reference for safe reporting and idempotency.

## Source Adapter Contracts

Each source adapter must implement a stable interface for:

- Detecting supported URL/input forms.
- Resolving an input URL into creator/feed identity.
- Fetching creator/feed metadata.
- Fetching or listing content items.
- Normalizing remote payloads into catalog records.
- Producing one or more playable `contentSource` records.
- Reporting recoverable and unrecoverable ingestion errors.

### YouTube

- Preserve current RSS-feed behavior for channel feeds.
- Preserve YouTube no-cookie iframe playback when embed data is available.
- Normalize thumbnail, title, publication date, description, channel identity, and video ID.

### Odysee

- Preserve current RSS behavior and native media playback behavior.
- Normalize thumbnail, duration, title, publication date, description, creator identity, and enclosure/media URL.

### PeerTube

- Use PeerTube instance APIs for discovery and metadata.
- Support canonical video, account, channel, and instance URLs where resolvable.
- Normalize videos into the same content contract.
- Prefer PeerTube embed URLs where available and native media links when appropriate.
- Keep instance-specific details inside the adapter.

## Migration Contract

### Primary Import Format

- Import from a Strapi export JSON file.
- The export must include users, creators, creator options, feeds, feed options, feed contents, creator contents, content options, subscriptions, subscription options, subscription content options, playlists, and playlist contents where available.
- The importer must validate the export shape before writing data.
- The importer must be idempotent for a given migration run fingerprint.

### Old MySQL Export Helper

- Provide a separate script or package command that can read the old Strapi MySQL database and produce the import JSON.
- Keep MySQL-specific table/relationship knowledge out of the new app runtime importer.
- Do not require a running old Strapi server for normal import tests.

### User Migration

- Import email, username/name, old user ID mapping, and account metadata.
- Do not import old password hashes into better-auth credentials.
- Mark migrated users as requiring password setup/reset.
- Preserve ownership for subscriptions, favorites, opened/played status, playlists, and settings where source data allows.

### Failure Behavior

- Do not partially corrupt the target database on malformed input.
- Report unmapped records with old entity type, old ID, reason, and severity.
- Allow safe retry after fixing export data when no successful migration run exists for the same fingerprint.

## Phase 0: Baseline Cleanup And Execution Harness

Depends on:

- Current Better-T-Stack scaffold.
- Current `apps/*` and `packages/*` layout.

Outputs:

- Remove or quarantine the example todo surface from API and UI without breaking the scaffold.
- Document package boundaries in code-facing README or package-level comments where useful.
- Ensure every package/app has a working `check-types` script.
- Establish a test runner strategy for backend/domain packages and web UI tests.
- Add minimal smoke tests for existing server and web bootstrap behavior.

Validation:

- `bun run check-types` passes.
- `bun run build` passes.
- Test command exists and passes for touched packages/apps.
- No old Strapi client imports exist in the new codebase.

## Phase 1: Domain Schema And Repository Contracts

Depends on:

- Phase 0.
- Target domain model in this plan.

Sub-phases:

- 1A: Drizzle schema for global catalog tables.
- 1B: Drizzle schema for user overlays and migration tables.
- 1C: Repository/service interfaces and public domain types.

Outputs:

- Drizzle tables and relations for global catalog records.
- Drizzle tables and relations for user overlays.
- Source-neutral domain types exported from the appropriate package.
- Repository functions with narrow interfaces for catalog reads/writes and overlay reads/writes.
- Uniqueness constraints for source external IDs, subscription uniqueness, playlist order, and idempotent migration mappings.

Validation:

- Tests prove global catalog records can exist without user ownership.
- Tests prove user overlays are scoped by `userId`.
- Tests prove duplicate source records are handled deterministically.
- `bun run check-types` and `bun run build` pass.

## Phase 2: Auth, Sessions, And Access Rules

Depends on:

- Phase 1.
- Existing better-auth scaffold.

Outputs:

- Self-service sign-up, sign-in, sign-out, and session restore flows.
- API context exposes authenticated user/session when present.
- Public procedures for anonymous catalog browsing.
- Protected procedures for subscriptions, favorites, history, playlists, settings, migration, and user-specific refresh where needed.
- Migrated-user password setup/reset flow support.

Validation:

- Anonymous users can read allowed catalog endpoints.
- Anonymous users cannot read or mutate user overlays.
- Authenticated users cannot access another user's overlays.
- Migrated users cannot authenticate until password setup/reset is completed.

## Phase 3: Source Registry And Adapter Implementations

Depends on:

- Phase 1 domain contracts.

Sub-phases:

- 3A: Source adapter interface, registry, detection, and shared normalization helpers.
- 3B: YouTube adapter with RSS/channel-feed support and embed source output.
- 3C: Odysee adapter with RSS/enclosure support and native source output.
- 3D: PeerTube adapter using instance APIs.
- 3E: Phase-wide adapter integration validation.

Outputs:

- A source registry that supports current and future source types without changing core ingestion flow.
- URL/source detection for add-subscription and batch-add flows.
- Normalized creator, feed, content item, and content source payloads from each adapter.
- Adapter-level tests using fixtures, not live network calls by default.

Validation:

- Each adapter has fixture-backed tests for detection and normalization.
- PeerTube tests cover instance API payload normalization.
- Source-specific playback data does not leak into generic UI contracts except through `contentSource`.
- Adding a new adapter requires registry registration, not rewriting existing adapters.

## Phase 4: Ingestion, Refresh, And Catalog Persistence

Depends on:

- Phase 1 repositories.
- Phase 3 adapters.

Sub-phases:

- 4A: Add source/subscription ingestion pipeline.
- 4B: Manual refresh-all, force-refresh-all, and per-creator refresh orchestration.
- 4C: Refresh cadence metadata and refresh result reporting.
- 4D: Phase-wide ingestion/refresh validation.

Outputs:

- Add single source URL flow that creates or reuses creator/feed/catalog records.
- Batch-add source URL flow with per-item result reporting.
- Manual normal refresh that respects cadence metadata.
- Manual force refresh that bypasses cadence metadata.
- Per-creator refresh.
- Refresh run and per-feed result persistence.
- No background scheduler in v1.

Validation:

- Tests prove normal refresh skips non-refreshable feeds.
- Tests prove force refresh selects all applicable feeds.
- Tests prove ingestion deduplicates existing creators/feeds/content.
- Tests prove batch-add reports partial failures without hiding successes.

## Phase 5: Catalog And Overlay API

Depends on:

- Phase 1 repositories.
- Phase 2 auth/access rules.
- Phase 4 catalog persistence.

Sub-phases:

- 5A: Catalog browsing API for creators, feeds, content lists, content details, search, filters, and selected content data.
- 5B: Subscription API.
- 5C: Favorites, opened, and played status API.
- 5D: Playlist API.
- 5E: Settings API.
- 5F: Phase-wide API integration validation.

Outputs:

- Public catalog list/detail procedures safe for anonymous browsing.
- Authenticated overlay procedures for all user-owned actions.
- Favorites view as first-class API behavior, not a generic option hack.
- Opened/played history as explicit statuses.
- Playlist CRUD and playlist item ordering.
- Settings for account/app preferences needed by v1 UI.

Validation:

- API tests cover anonymous catalog browsing.
- API tests cover protected overlay mutations.
- API tests cover cross-user isolation.
- API tests cover favorites-only content queries.
- API tests cover playlist ordering and item removal.

## Phase 6: One-Time Migration

Depends on:

- Phase 1 schema.
- Phase 2 migrated-user auth policy.
- Phase 5 overlay APIs or repositories.

Sub-phases:

- 6A: Strapi export JSON schema and fixture set.
- 6B: Import mapper for catalog data.
- 6C: Import mapper for users and overlays.
- 6D: Migration command/procedure and reporting.
- 6E: Optional old MySQL-to-export helper.
- 6F: Phase-wide migration validation.

Outputs:

- Validated import JSON format.
- Fixture exports representing old creators, feeds, contents, options, subscriptions, favorites, history, and playlists.
- Idempotent migration command/procedure.
- Migration report with counts, warnings, failures, and old-to-new mappings.
- Migrated users marked for password setup/reset.

Validation:

- Tests prove malformed exports fail before writes.
- Tests prove successful import creates usable catalog and overlays.
- Tests prove repeated import of the same fingerprint is safe.
- Tests prove unmapped/invalid records are reported.

## Phase 7: Web UI Shell And Core Browsing

Depends on:

- Phase 5 APIs.
- Current Solid/TanStack Router scaffold.

Sub-phases:

- 7A: App layout and navigation shell.
- 7B: Creator/source column with search, creator selection, add source, batch add, per-creator refresh.
- 7C: Content list column with search, filters, hide played, reload, status/action buttons, source indicators.
- 7D: Selected content viewer with metadata, body text, source switching, and playback.
- 7E: Phase-wide UI integration validation.

Outputs:

- High-density three-column UI matching the old workflow without copying the old event-bus architecture.
- Direct state/actions instead of document-wide custom events.
- Anonymous catalog browsing.
- Auth-aware action visibility and disabled states.
- YouTube iframe, Odysee native playback, and PeerTube playback support through normalized `contentSource` data.

Validation:

- UI tests or component tests cover main browse/select/view flow.
- Anonymous users can browse and select content.
- Authenticated users can mark opened, played, and favorite.
- Source switching changes playback source without losing selected content.
- Desktop-sized and mobile/narrow layouts remain usable.

## Phase 8: Feature UI Completion

Depends on:

- Phase 5 APIs.
- Phase 7 shell.

Sub-phases:

- 8A: Playlists UI.
- 8B: Favorites view UI.
- 8C: Settings UI.
- 8D: Filters UI.
- 8E: Refresh status/history UI.
- 8F: Phase-wide feature validation.

Outputs:

- Playlist create/edit/delete and add/remove/reorder content flows.
- Favorites-only view reachable from the sidebar.
- Settings screen for account/app preferences in confirmed v1 scope.
- State-based filter controls replacing old DOM-class filtering.
- Refresh status/results surfaced beyond transient toasts.
- `topics` and `external-content` are not visible as broken placeholders in v1.

Validation:

- Tests cover playlist CRUD and ordering from the UI-facing interface.
- Tests cover favorites view and favorite toggling.
- Tests cover filters combining with search and hide-played behavior.
- No visible no-op placeholder buttons remain for confirmed v1 scope.

## Phase 9: Desktop, Web Runtime Modes, And Packaging

Depends on:

- Phase 7 shell.
- Phase 8 feature completion.
- Stable server package.

Sub-phases:

- 9A: Web deployment/runtime configuration.
- 9B: Desktop local-backend mode.
- 9C: Desktop remote-backend mode.
- 9D: Packaging validation.

Outputs:

- Web target can connect to configured server URL.
- Desktop can run local-first with a bundled/local Bun/Hono server and local SQLite/libSQL database.
- Desktop can be configured to connect to a remote/shared server.
- Runtime configuration separates local, desktop-local, desktop-remote, and web modes.
- No runtime path hacks for packaged desktop builds.

Validation:

- `bun run build` passes.
- `bun run build:desktop` passes or has documented environment limitations if Electrobun packaging cannot run in CI/local environment.
- Desktop local mode can reach API/auth/database.
- Desktop remote mode can reach configured API/auth server.

## Phase 10: Parity Audit, Hardening, And Release Readiness

Depends on:

- All previous phases.

Outputs:

- Parity checklist against old app behavior and research docs.
- Security pass for auth guards, migration input validation, source URL handling, and cross-user isolation.
- Performance pass for large content lists and high-density browsing.
- Accessibility pass for keyboard navigation, focus handling, controls, and playback actions.
- Release notes for migration and first-run flow.

Validation:

- Old-app parity checklist is complete or explicitly documented as deferred.
- No confirmed v1 placeholder features remain as no-ops.
- Cross-user isolation tests pass.
- Migration fixture tests pass.
- Source adapter fixture tests pass.
- API tests pass.
- UI tests pass.
- `bun run check-types` passes.
- `bun run build` passes.

## Old-App Parity Checklist

- Login, logout, and session restore.
- Self-service sign-up.
- Anonymous creator/content browsing.
- Creator search.
- Creator selection loads that creator's content.
- Add one subscription/source URL.
- Add multiple subscription/source URLs.
- Auto-detect source type where possible.
- Refresh all.
- Force refresh all.
- Refresh one creator's feeds.
- Refresh notifications and visible status.
- Content search by title and creator where supported.
- Hide played.
- Open selected content in viewer.
- Mark opened on selection for authenticated users.
- Mark played from list and viewer.
- Toggle favorite from list and viewer.
- Favorites-only view.
- Source switching for content with multiple playable sources.
- YouTube embed playback.
- Odysee native playback.
- PeerTube playback.
- Playlists as completed v1 feature.
- Settings as completed v1 feature.
- Filters as completed v1 feature.
- Migration of users, creators, feeds, content, subscriptions, favorites, opened/played history, playlists, and source metadata where available.

## Explicit Deferrals

- Automatic background refresh.
- Payments.
- Strapi runtime compatibility.
- Reusing old Strapi password hashes.
- `topics` feature.
- `external-content` feature.
- Generic Strapi-style entity viewers and scaffolding forms that were not part of real user workflows.

## Recommended First Orchestration Dispatch

Start with Phase 0 only. Phase 0 must remove example-surface ambiguity and establish validation commands before any domain work begins. Do not let later phases start until Phase 0 has passed implementation validation and code review validation.
