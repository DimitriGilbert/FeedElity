# Feedelity From-Scratch Rewrite Plan

This rewrite starts from scratch inside the bootstrapped `client/` app.
Do not carry over the existing Strapi client/UI code, generated Strapi types, event-bus shell, or low-code component structure.
The goal is parity with the current app plus completion of the placeholder features, using a clean architecture that can later be executed by subagent-orchestration.

## Non-Negotiables

- New app lives entirely in `client/`.
- Stack: Solid frontend, Hono backend, Bun runtime, ORPC API, better-auth auth, SQLite + Drizzle, Electrobun desktop target, web target.
- No payments.
- Preserve current behavior parity and complete currently-placeholder features.
- Support YouTube, Odysee, PeerTube, and future source types.
- Include a one-time migration/import from the old low-code app.
- Design for multi-user capability even if usage stays personal-first.
- v1 uses manual refresh only.
- No feature cutting.
- Keep boundaries and phase size small enough for agent-sized execution.

## Rewrite Principles

- Define domain models before UI.
- Treat each source type as an adapter, not a special case.
- Keep auth/user ownership explicit in every persisted record that is user-scoped.
- Separate ingestion from presentation.
- Prefer small vertical slices over broad framework work.
- Make each phase independently verifiable.
- Preserve parity first, then add the missing feature surfaces.

## Phase 0: Bootstrap Boundary And Project Shape

Depends on:

- Existing `client/` bootstrap.
- Agreement that the Strapi app is being replaced, not adapted.

Outputs:

- `client/` owns the web app and Electron-ready desktop entry points.
- Backend app skeleton in `client/` using Bun and Hono.
- API contract entrypoint using ORPC.
- DB layer skeleton using SQLite and Drizzle.
- Auth layer skeleton using better-auth.
- Source, domain, persistence, and UI folders with clear ownership boundaries.

Validation:

- `client/` can start in dev mode without importing Strapi code.
- A minimal Hono route and a minimal Solid screen both run.
- Build/test commands exist for web and backend boundaries.
- The repo structure makes it obvious where source adapters, domain logic, and UI live.

## Phase 1: Domain And Model Design

Depends on:

- Phase 0 project shape.
- Research docs for current creators, feeds, contents, subscriptions, playlists, favorites, refresh, and viewer behavior.

Outputs:

- Canonical domain entities for users, sources, creators, feeds, content items, subscriptions, playlists, favorites, history, and refresh state.
- Source-agnostic content and feed contracts.
- User-scoped ownership rules for all records.
- A source registry contract that can register YouTube, Odysee, PeerTube, and future sources.
- Explicit parity map from old app concepts to new domain concepts.

Validation:

- Every current feature has a named domain object or service target.
- Placeholder features have a domain home, not just UI TODOs.
- Multi-user boundaries are explicit in the model.
- Nothing depends on Strapi response shapes.

## Phase 2: Auth And Account Setup

Depends on:

- Phase 1 domain model.
- A decision on session strategy within better-auth.

Outputs:

- better-auth login/session/account flows.
- User records persisted in SQLite via Drizzle.
- Ownership scaffolding for subscriptions, playlists, favorites, and history.
- Auth-aware API guards and request context.
- A personal-first default account flow that still supports multiple users.

Validation:

- A user can sign up, sign in, sign out, and restore a session.
- API calls can distinguish anonymous and authenticated access.
- User-scoped data cannot leak across accounts.
- The app can still support anonymous or pre-auth browsing where intended.

## Phase 3: Source Abstraction And Ingestion

Depends on:

- Phase 1 domain model.
- Phase 2 auth context, so ingested data can be owned and scoped correctly.

Outputs:

- Source adapter interface for ingesting feed metadata and content.
- Implementations for YouTube, Odysee, and PeerTube.
- Source detection and normalization logic.
- A unified ingestion pipeline that converts source payloads into internal creators, feeds, and content.
- Extensibility points for future sources without changing core domain code.

Validation:

- Each supported source can produce normalized creator/feed/content records.
- The system can add a new source without modifying existing source adapters.
- Ingestion output is stable enough to power list, viewer, and history behavior.
- Source-specific playback details remain isolated.

## Phase 4: Content Library And Playback

Depends on:

- Phase 3 ingestion pipeline.
- Content and source contracts from Phase 1.

Outputs:

- Content list queries with search, filtering, and source-aware display data.
- Content detail/viewer screen.
- Playback support for embedded and native media where the source allows it.
- Mapping for thumbnail, duration, publication, creator, and body data.
- Selected-content behavior equivalent to the old app, minus the event-bus implementation.

Validation:

- Users can browse content and open an item into a viewer.
- YouTube and Odysee playback parity is preserved.
- PeerTube content renders with the same unified content contract.
- The viewer does not require Strapi field names.

## Phase 5: Subscriptions, Playlists, Favorites, And History

Depends on:

- Phase 2 auth.
- Phase 4 content library.
- Subscription and playlist entities from Phase 1.

Outputs:

- Subscription management flows.
- Playlist create/read/update/delete flows.
- Favorite toggling and favorites-only views.
- History tracking for played/opened content.
- UI and API support for the placeholder features that exist in the old app as stubs.

Validation:

- A user can subscribe to creators and see subscribed content.
- A user can create and manage playlists.
- Favorites work as a first-class user feature, not just a content flag.
- History captures open/play events without breaking anonymous browsing.

## Phase 6: Refresh And One-Time Migration

Depends on:

- Phase 1 domain model.
- Phase 3 ingestion.
- Existing old app data access path for migration.

Outputs:

- Manual refresh flow for v1 only.
- Per-source refresh and refresh-all orchestration.
- Refresh status tracking and user feedback.
- One-time import from the old low-code app into the new SQLite schema.
- Migration mapping for creators, feeds, contents, subscriptions, playlists, favorites, and history where possible.

Validation:

- Manual refresh updates content correctly without background scheduling requirements.
- The import can run once against the old dataset and produce usable new records.
- Imported data preserves user ownership where the source data allows it.
- Migration failures are reportable and do not corrupt the new database.

## Phase 7: UI Shell And Navigation

Depends on:

- Phase 4 content viewer.
- Phase 5 feature screens.
- Phase 2 auth state.

Outputs:

- Solid app shell for web with a coherent navigation model.
- Dedicated sections for creators, feeds, library, subscriptions, playlists, favorites, history, and refresh.
- Modal/dialog patterns for add-subscription and login flows.
- A replacement for the old event-bus-driven shell using direct state and explicit actions.

Validation:

- The main flows can be reached without the old 3-column Strapi shell.
- Placeholder features now have visible UI entry points.
- UI state is driven by app state, not document-wide custom events.
- The shell works on desktop and web sizes.

## Phase 8: Desktop And Web Packaging

Depends on:

- Phase 7 UI shell.
- A stable backend process model in Bun/Hono.

Outputs:

- Web packaging path.
- Electrobun desktop packaging path.
- Environment and runtime configuration for local, web, and desktop execution.
- Shared build strategy that keeps client and backend aligned.

Validation:

- The app runs as a web target.
- The app runs as a desktop target.
- The backend and frontend can be packaged together without runtime path hacks.
- Production and local configuration are separated cleanly.

## Execution Notes For Future Subagents

- Each phase should be implemented as a bounded slice with clear input and output contracts.
- Avoid cross-phase refactors unless they unblock the current phase.
- Keep migration and source adapters testable in isolation.
- Treat the domain model and API contract as the primary handoff artifacts between subagents.
- Do not reintroduce Strapi-era event plumbing or generated client assumptions.
