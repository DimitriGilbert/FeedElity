# FeedElity Architecture

Overview of the codebase as of August 2026. Planning documents live elsewhere:
`final-from-scratch-plan.md` (execution plan), `prd-from-scratch.md` (PRD),
`qol-features-plan.md` / `ux-fixes-plan.md` (follow-up feature and UX plans,
referenced from code comments), `research/` (old-app inventory). This document
describes what is actually built.

## Monorepo layout

Bun + Turborepo monorepo (`bun run check-types` / `bun run build` for verification).

| Path | Purpose |
| --- | --- |
| `apps/web` | Solid web frontend (three-column reader shell). TanStack Router/Query, Tailwind, `@orpc/client` RPC. |
| `apps/server` | Hono server. Mounts better-auth (`/api/auth/*`), oRPC RPC endpoint (`/rpc`), OpenAPI docs (`/api-reference`). |
| `apps/desktop` | Electrobun desktop app. `src/bun/local-backend.ts` embeds the Hono server module in a local Bun server (port 3217) so the desktop app talks to the same API in-process, or runs in `desktop-remote` mode (`FEELITY_DESKTOP_MODE=remote`) against a configured remote server URL instead of starting the embedded backend. |
| `apps/docs` | Static marketing/docs site (TanStack Router, Vite). Not part of the product runtime. |
| `packages/api` | Domain layer: source adapters, services (ingestion, refresh), repositories, oRPC routers, Strapi migration. |
| `packages/db` | Drizzle schema + SQLite/libSQL connection (`src/connection.ts`), SQL migration bootstrap (`src/bootstrap.ts`). |
| `packages/auth` | better-auth instance + password hashing (`src/password.ts`). |
| `packages/env` | Zod-validated server/web runtime env. |
| `packages/config` | Shared TS config presets. |

## DB layer (`packages/db/src/schema/`)

Drizzle over SQLite/libSQL. `packages/db/src/index.ts` exports the singleton `db`
built from `env.DATABASE_URL`.

### Global catalog (`schema/catalog.ts`)

- `creator` — cross-source, source-neutral row. Keyed by `name_key`
  (unique index `creator_name_key_uidx`), computed by
  `creatorNameKey()` in `packages/api/src/domain/catalog.ts` (lowercased display
  name with Odysee `@` handle and `:<claimId>` revision stripped). Columns:
  `id`, `name_key`, `display_name`, `description`, `image_url` (nullable,
  the creator avatar/icon), `canonical_url`, `last_content_published_at`
  (nullable timestamp_ms, indexed `creator_last_content_published_at_idx`,
  used for "last video update" sorting; backfilled from `content_item` by
  migration `0002_creator_last_published.sql`), `metadata_json`, timestamps.
- `feed` — one row per (source, channel): `creator_id` FK, `source_type`
  (`youtube|odysee|peertube`), `source_external_id` (unique per source type),
  `url`, `title`, `refresh_cadence_seconds`, `last_normal_refresh_at`,
  `next_refresh_after`, `adapter_metadata_json`.
- `content_item` — one row per remote video: `creator_id` FK, source identity
  (`source_type` + `source_external_id`, unique), `title`, `published_at`
  (indexed), `thumbnail_url`, `duration_seconds`, `canonical_url`, etc.
  `cross_source_key` (indexed `content_item_cross_source_key_idx`) groups
  cross-source mirrors of one video, computed by `contentCrossSourceKey()` in
  `packages/api/src/domain/catalog.ts` (creator `name_key` + normalized title);
  newest-first list pages also read pre-sorted through the composite
  `content_item_published_created_id_idx` index.
- `content_source` — per-item playback mirrors (embed URL, native media URL,
  `priority`; unique per `(content_item, priority)` and `(source_type, canonical_url)`).
- `feed_content` — join table feed ↔ content_item with per-link external id.
- `refresh_run` / `refresh_feed_result` — audit of refresh runs and per-feed outcomes.

**Cross-source creator model** (commit `367edd3`, July 2026): a creator carries no
source identity of its own. The same human publishing on YouTube and Odysee is one
`creator` row with two `feed` rows; `content_item.source_type` records where each
video came from; `content_source` holds alternative playback mirrors per video.
Duplicate creator rows that used to exist per-source were merged by
`scripts/db-repair/repair.ts` (dry-run gated CLI) using the pure merge planner
`packages/db/src/creator-merge-plan.ts` (`buildMergePlan`), which lives in
`packages/db` beside the mirrored `cross-source-key.ts` key helper so both stay
unit-tested without depending on `packages/api`; `scripts/repair-local-creator-sources.ts`
performs related local repairs (duplicate merges, identity canonicalization,
restoring legacy MySQL feeds).

A creator's source types are derived on read — `loadSourceTypesForCreator()` /
`loadSourceTypesByCreatorId()` in `packages/api/src/repositories/catalog.ts`
union `feed.source_type` and `content_item.source_type` for the creator.

### User overlays (`schema/overlays.ts`)

All scoped by `user_id` FK to the better-auth `user` table
(`schema/auth.ts`): `subscription` (user ↔ creator), `content_status`
(`opened|played|favorite` per user+item), `playlist` / `playlist_item`,
`creator_collection` / `collection_member` (grouping creators),
`user_setting` (key/value JSON per user), and `migration_run` /
`migration_mapping` (import audit).

## Source adapter layer (`packages/api/src/sources/`)

One adapter per source: `youtube.ts` (channel RSS XML), `odysee.ts`
(channel RSS XML), `peertube.ts` (instance REST/JSON API). `registry.ts` holds
the `SourceAdapterRegistry` (URL parsing, detection dispatch);
`xml.ts` is a small real XML parser used by the RSS adapters.

Normalized contract (`types.ts`): each adapter implements

- `detect(input)` → classify a URL as `feed-url | creator-url | content-url | unknown-url`;
- `resolveInput(...)` → stable `ResolvedSourceInput` (`sourceType`,
  `sourceExternalId`, canonical URL) without network calls;
- `fetchCatalog(...)` → fetch the remote feed/API;
- `normalizeCatalogPayload(...)` → `NormalizedCatalogPayload`:
  one `creator`, its `feeds`, and `items[]` where each item carries
  `contentItem`, `feedContent` link info, and playback `sources[]`.
- optional `fetchCreatorMetadata(...)` → `CreatorMetadata`
  (`displayName?`, `imageUrl?`, `description?`, `canonicalUrl?`) from a
  `FetchCreatorMetadataInput` (`feedUrl` + source identity): YouTube derives
  the channel page URL and extracts `og:` meta (avatar normalized to a stable
  `=s176` square variant), Odysee re-fetches the RSS, PeerTube re-fetches the
  actor endpoint. Failures degrade to unset fields rather than throwing.

Everything returns `SourceAdapterResult<T>` (`{ok:true,value}` or
`{ok:false,error}` with codes like `remote-fetch-failed`,
`remote-payload-invalid`). Source-specific logic never leaves this directory.

## Ingestion and refresh (`packages/api/src/services/`)

### Ingestion (`ingestion.ts`)

`addSource()` / `batchAddSources()` (auth-gated): detect → resolve →
`fetchCatalog` → `persistNormalizedCatalog()`. Persistence is idempotent:
`findOrCreateCreator/Feed/ContentItem/ContentSource` insert with
`onConflictDoNothing` on natural keys, then read back. Creator lookup is by
`name_key`. If the user is authenticated, a `subscription` overlay row is
created. `findOrCreateCreator` backfills `image_url` only when the stored value
is null and the adapter supplied one. After persisting items,
`advanceCreatorLastContentPublishedAt()` sets the creator's
`last_content_published_at` to the max `published_at` among its persisted
items when that is greater than the stored value (NULL `published_at` items
ignored); the column never regresses.

### Refresh (`refresh.ts`, `refresh-policy.ts`)

Scopes: `all`, `creator`, `feed`. A run creates a `refresh_run` row, then
processes feeds sequentially with jittered delays (`refresh-policy.ts`:
1–4 s between same-provider fetches) and per-provider 15-minute pauses on
HTTP 429/5xx. On server start, `recoverRunningRefreshRuns()` resumes runs
left `running` by a restart (`apps/server/src/index.ts`).

- **Normal refresh** (`force=false`): only feeds whose
  `next_refresh_after` has passed (or is null) and whose cadence is not
  disabled are selected; on success `last_normal_refresh_at` /
  `next_refresh_after` are updated (cadence defaults: YouTube 2 h,
  Odysee/PeerTube 1 h, min 15 min, plus 60 s–15 min jitter).
- **Force refresh** (`force=true`): selects every feed in scope regardless of
  cadence/due time, and deliberately does **not** touch the cadence metadata.
  Each selected feed still runs the full `fetchCatalog` + persist cycle, so
  the adapter's creator/feed metadata is re-fetched too (subject to the
  fill-only-if-null image rule above).

No background scheduler exists in v1; refresh is user-triggered.

### Creator metadata refresh (`services/creator-metadata.ts`)

A separate user-invoked background job (guarded against concurrent runs,
in-memory pollable status) that iterates catalog feeds, calls each adapter's
optional `fetchCreatorMetadata`, and applies `updateCreatorMetadata`
(`repositories/catalog.ts`) — overwriting only the fields the adapter
supplied, never `name_key`/`display_name`, and never touching feed cadence
columns. Failures are collected per feed and reported in the status
(updated / unchanged / failed counts).

## API layer (`packages/api/src/`)

oRPC router in `routers/index.ts` (`appRouter`), procedures built in
`index.ts`: `publicProcedure` and `protectedProcedure` (middleware throws
`UNAUTHORIZED` without a better-auth session). Context
(`context.ts`) = `{db, session|null, sourceRegistry}`; sessions come from
better-auth's `auth.api.getSession` against request headers.

- Public: `healthCheck`, `session.current`, `auth.setupMigratedPassword`,
  `catalog.creators|feeds|contentItems|contentDetail` (`catalog.creators`
  accepts `sort: "name" | "lastUpdate"` — default `name`; `lastUpdate`
  orders by `last_content_published_at` desc NULLs last with
  display_name/id tiebreakers — and defaults to limit 100;
  `catalog.contentItems` also takes an optional `collectionId` filter that
  applies only when the caller's session supplies the owning user, so
  anonymous calls stay unscoped), `refresh.status` (read-only run status).
- Protected: `refresh.startAll|runAll|runCreator|runFeed`,
  `creatorMetadata.start|status` (metadata refresh job),
  `ingestion.addSource|batchAddSources`, `migration.runImport`, and all
  `overlays.*`: subscriptions (`subscriptions`, `subscribeToCreator`,
  `unsubscribeFromCreator`, `subscribedContentItems`, `bulkUnsubscribe`,
  `unreadCounts`, `feedHealth`, `markCreatorContentOpened`,
  `markAllContentOpened`), content statuses (`contentStatuses`,
  `markContentOpened|markContentPlayed`, `toggleContentOpened`,
  `toggleContentPlayed`, `toggleContentFavorite`, `favoriteContentItems`,
  `contentHistory`, `savePlaybackPosition`), playlists (`playlists`,
  `createPlaylist|updatePlaylist|deletePlaylist`, `playlistItems`,
  `addPlaylistItem|removePlaylistItem|reorderPlaylistItems`), collections
  (`collections`, `createCollection|updateCollection|deleteCollection`,
  `collectionMembers`, `addCollectionMember|removeCollectionMember`), settings
  (`settings`, `saveSetting|deleteSetting`), and user-data portability
  (`exportUserData|importUserData`).

Cross-user isolation: every overlay procedure passes
`context.session.user.id` into repository functions that filter on it, and
playlist/collection items have composite FKs tying them to their owning user.

The Hono server (`apps/server/src/index.ts`) mounts the RPC handler at
`/rpc`, OpenAPI reference at `/api-reference`, better-auth at `/api/auth/*`.

## Web frontend (`apps/web/src/`)

Routes are a single layout route, `routes/_shell.tsx`, which renders
`<AppShell mode={mode()}>` with the mode derived from the pathname —
`/dashboard*` is `library`, anything else is `catalog` (anonymous browsing
works) — and persists it to localStorage; a one-time mount redirect reopens a
signed-in user's last section. `_shell.index.tsx` and `_shell.dashboard.tsx`
render null by design; the dashboard route keeps the `beforeLoad` that sends
anonymous visitors to `/login`, which hosts the auth forms.
The typed oRPC client is `src/utils/orpc.ts` (`createORPCClient` over
`RPCLink` with cookie credentials).

The shell is no longer one file. `src/components/app-shell.tsx` owns
composition and state and renders the three-column layout with draggable
`pane-resizer.tsx` dividers (fractions persisted to localStorage);
`app-shell.contract.ts` is the typed state/derivation layer (persisted
localStorage keys, view modes, `toPlayableSources`, label formatters) shared
by the components and their tests; `app-shell-rows.tsx` holds the shared
creator/content row components; and `src/lib/` contains `auth-client.ts` /
`auth-helpers.ts` (better-auth client and post-auth redirect resolution),
`keyboard-shortcuts.ts` (pure shortcut keymap), and `youtube-player-bridge.ts`
(contained YouTube IFrame postMessage playback tracker). The columns:

1. **Creator/source column** — `CreatorSourceColumn` with tabs
   Library (subscribed creators) / Feeds (selected creator's feeds) /
   Playlists / Collections. Catalog tab pages through
   `client.catalog.creators` (limit 100, offset pagination, search + source
   filter) with a sort select (typed setting `creator.list.sort`:
   "By name" default / "By last video update", persisted via overlays and
   refetching on change); rows are `CreatorSourceRow`
   (`app-shell-rows.tsx`) with avatar (`creator.image_url`, falling back to
   an initials placeholder when missing), per-creator force-refresh and
   subscribe buttons.
   Header hosts add-source, normal/force refresh buttons, and settings gear.
2. **Content list column** — `app-shell-content-column.tsx`; filters
   (search/source/view mode incl. favorites, history, played) and
   `ContentListItemRow` cards (thumbnail, published date, duration, status).
3. **Viewer column** — `app-shell-viewer.tsx`; selected content detail with
   playable sources (`toPlayableSources` prefers native media over embeds),
   or the settings panel when `viewerMode === "settings"`.

Refresh UX: `startAll` runs in the background server-side; the shell polls
`client.refresh.status` every 2.5 s while a run is active and refetches the
content list only when `itemsCreatedCount` increases. Failures surface through
`refresh-status-dialog.tsx`.

Features layered onto the shell since the first cut: a hide-played toggle and
content-list view modes (`catalog | subscribed | favorites | history-opened |
played` — library mode defaults to `subscribed`), a YouTube no-cookie embed
preference (setting key `playback.youtube.nocookie`), a "Copy stream URL"
action in the viewer, playback-position saving through the YouTube bridge with
a "Resume at" restore when an item is reopened, keyboard shortcuts (`j`/`k`
move the active row, `Enter` opens it, `/` focuses creator search, `Escape`
clears the selection, `f` toggles favorite, `g l` / `g c` switch
library/catalog — `lib/keyboard-shortcuts.ts`), unread-count badges with
per-creator and global mark-read, a feed-health dialog with bulk unsubscribe
for failing feeds, and creator collection management (create/save/delete,
membership) in the Collections tab. Device-local UI state (hide-played,
content view mode, pane widths, shell mode, source filters) persists to
localStorage; user-facing preferences (creator sort, reader density, YouTube
privacy) persist as typed `user_setting` rows.

## Settings UI

Lives in the viewer column: the gear button in the creator column header sets
`viewerMode="settings"`, and `SelectedContentViewer` renders
`SettingsColumnSection` (`app-shell-source-sections.tsx`). It contains a typed
"Reader density" control (setting key `reader.density`, comfortable/compact),
a "Creator metadata" section with a force-refresh button that starts the
`creatorMetadata.start` job and polls `creatorMetadata.status`, showing the
updated/unchanged/failed summary and per-feed failures, a user-data section
that downloads/restores the account's subscriptions, watched history,
playlists, collections, and settings as one portable JSON file
(`client.overlays.exportUserData` / `importUserData`), and an "Advanced
settings" editor for raw `user_setting` keys
(`client.overlays.saveSetting` / `deleteSetting`).

## Migration

Strapi export JSON → `packages/api/src/migration/`
(`strapi-export.ts` validates, `catalog-import.ts` + `overlay-import.ts`
persist, `run-migration.ts` orchestrates with fingerprinted idempotency and
exports `runStrapiExportMigration` / `runImportMigration`).
`scripts/import-legacy-strapi.ts` drives it by querying the old app's MySQL
database and building a Strapi-shaped export from the rows
(`old-mysql-export.ts`), which the validated pipeline then imports. Migrated
users must set a new password via `auth.setupMigratedPassword`.

A separate user-data portability flow lives beside it: `user-data-schema.ts`
defines the portable envelope (natural keys only — creators by `name_key`,
content by `(source_type, source_external_id)`), and `user-data-export.ts` /
`user-data-import.ts` back the `overlays.exportUserData` / `importUserData`
procedures and the settings UI, so a user can download and restore their
subscriptions, statuses, playlists, collections, and settings as one JSON
file.
