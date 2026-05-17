# Missing UI Functionality Inventory

## Executive summary

The FeedElity rewrite is backend-capable but UI-incomplete compared with the legacy application. The current Solid/Hono/oRPC rewrite has a cleaner architecture, authenticated overlay APIs, manual refresh services, playlists, settings storage, catalog browsing, and source-normalized playback. However, several behaviors that users could see or trigger in the old UI are either absent, weakly exposed, or compressed into narrow sections of the new shell.

The most visible gap is not the data model. It is interaction parity:

- The source/feed panes should scroll instead of extending the page or forcing the whole layout to grow.
- Settings are not discoverable; they are a raw key/value editor embedded low in the sources column.
- The add creator/source flow is missing from the rewrite UI and API router, even though ingestion/source-adapter infrastructure exists.
- Source selection is unclear: the list has a global source-type filter and the viewer has a playback-source dropdown, but feed/source row affordances are weaker than legacy.
- Mark viewed/opened and mark played flows exist in the rewrite API but are not wired to the viewer or playback events.
- Feed thumbnails and feed row affordances need parity with legacy content rows and source buttons.
- The old app had many controls, even if messy. The rewrite is more disciplined but currently hides or omits actions that made the old product feel operational.

This document inventories what the legacy app exposed, what the rewrite currently implements, and the missing or weak UI functionality grouped by implementation priority. It intentionally notes no-op and broken legacy controls so the plan does not blindly copy old mistakes.

## Legacy functionality inventory

Legacy codebase root: `/home/didi/workspace/Code/Feedelity`.

### 1. Three-column full-height layout and scroll behavior

The legacy app rendered a full-height three-column workflow from `client/src/App.tsx:133-170`:

- `Side0` in the left column for creators, playlists, and global actions (`client/src/App.tsx:166-167`).
- `SideList` in the middle column for content rows (`client/src/App.tsx:168`).
- `SelectedContent` in the right column for playback and content details (`client/src/App.tsx:169`).

The layout used `Row class="flex-nowrap vh-100"` to keep the columns in a viewport-height row (`client/src/App.tsx:166`). The legacy stylesheet then constrained internal panes:

- Creator and playlist lists used `height: calc(100vh - 6.5rem)` with overflow in `.side0 .creator-list, .side0 .playlist-list` (`client/src/index.scss:74-80`).
- Content list used `height: calc(100vh - 2.5rem)` with overflow in `.content-side .content-list` (`client/src/index.scss:81-85`).

> Note: the legacy CSS used `overflow-x: scroll`, which is not ideal for vertical lists, but the important behavior was that panes were height-constrained instead of growing the whole page.

### 2. Left pane controls and creator/source browsing

The legacy left pane lived in `client/src/components/Side0.tsx`. It exposed a dense set of controls:

| Control | Legacy file reference | Behavior/status |
| --- | --- | --- |
| Login button | `client/src/components/Side0.tsx:31-36` | Opened the login modal when no user was present. |
| Settings icon | `client/src/components/Side0.tsx:37-39` | Present but no-op. |
| External content button | `client/src/components/Side0.tsx:40-42` | Tried to open `external-content`; effectively broken/no modal in container. |
| Filter button | `client/src/components/Side0.tsx:46-49` | Present but `console.log("filter todo")`. |
| Playlist button | `client/src/components/Side0.tsx:50-53` | Auth-only, but `console.log("playlist todo")`. |
| Topics button | `client/src/components/Side0.tsx:54-56` | Auth-only, but `console.log("topics todo")`. |
| Favorites button | `client/src/components/Side0.tsx:57-59` | Dispatched `showfavorites`. |
| Add subscription button | `client/src/components/Side0.tsx:61-63` | Opened `add-subscription` modal. |
| Refresh all | `client/src/components/Side0.tsx:64-66` | Called `refreshAll()`. |
| Force refresh all | `client/src/components/Side0.tsx:67-69` | Called `refreshAll(true)`. |
| Creator search | `client/src/components/Side0.tsx:71-104` | DOM-filtered creator rows by name. |
| Per-creator select/filter | `client/src/components/Side0.tsx:111-123` | Dispatched `creatorselected` for the selected creator. |
| Per-creator settings icon | `client/src/components/Side0.tsx:124-126` | Present but no-op. |
| Per-creator refresh | `client/src/components/Side0.tsx:127-157` | Refreshed all feeds for a creator and dispatched `feedrefreshed`. |
| Hidden playlist pane | `client/src/components/Side0.tsx:163-180` | Present but hidden with `d-none`; dispatched `loadplaylist` when used. |

Important lesson: the old app had many controls and gave users obvious places to act. Several controls were unfinished or broken, so parity should copy the useful affordances, not the implementation style or no-op states.

### 3. Add subscription/source modals

The legacy add-subscription flow was visible and modal-driven:

- Single URL modal: `client/src/components/Modal/Subscription.tsx:8-71`.
  - Captured a subscription URL (`client/src/components/Modal/Subscription.tsx:46-54`).
  - Auto-detected source type while typing (`client/src/components/Modal/Subscription.tsx:25-32`).
  - Submitted to `postFromFeedUrl` (`client/src/components/Modal/Subscription.tsx:14-17`).
  - Dispatched `creatorcreated` and closed the modal (`client/src/components/Modal/Subscription.tsx:18-23`).
- Multi-URL modal: `client/src/components/Modal/SubscriptionMulti.tsx:10-102`.
  - Accepted one URL per line (`client/src/components/Modal/SubscriptionMulti.tsx:89-97`).
  - Processed URLs serially with notifications (`client/src/components/Modal/SubscriptionMulti.tsx:16-84`).
- Modal router/container: `client/src/components/Modal/Container.tsx:23-33`.
  - Mapped `add-subscription` and `add-subscription-list` to the corresponding modals.
- URL type detection: `client/src/utils/Feeds.tsx:34-41`.
  - Detected Odysee and YouTube-ish URLs.
- Backend route: `src/api/creator/routes/01-creator_custom.ts:1-12`.
  - Exposed `POST /creators/fromFeedUrl` with handler `api::creator.creator.createFromFeedUrl`.

This is one of the clearest missing user flows in the rewrite: users need a visible way to add a creator/source from a URL.

### 4. Middle pane controls

The legacy middle pane lived in `client/src/components/SideList.tsx` and exposed:

- Hide played toggle (`client/src/components/SideList.tsx:13-19`, `client/src/components/SideList.tsx:24-27`).
- Reload content list (`client/src/components/SideList.tsx:28-34`).
- Content search by title (`client/src/components/SideList.tsx:38-75`).
- “Search also in creator name” checkbox (`client/src/components/SideList.tsx:77-82`).
- Scroll-constrained content list container (`client/src/components/SideList.tsx:86-94`, styled in `client/src/index.scss:81-85`).

The hide-played behavior was CSS-driven through `.content-list.hide-played .content-item.status-played` (`client/src/index.scss:56-61`).

### 5. Feed/content rows and row affordances

Legacy content rows were implemented in `client/src/components/CreatorContent/SideListItem.tsx`:

- Thumbnail with lazy image loading and click-to-select (`client/src/components/CreatorContent/SideListItem.tsx:62-74`).
- Title with click-to-select (`client/src/components/CreatorContent/SideListItem.tsx:76-81`).
- Duration display (`client/src/components/CreatorContent/SideListItem.tsx:82-84`).
- Action buttons and source buttons (`client/src/components/CreatorContent/SideListItem.tsx:84-97`).
- Creator click to filter/select creator (`client/src/components/CreatorContent/SideListItem.tsx:99-114`).
- Publication date (`client/src/components/CreatorContent/SideListItem.tsx:115-120`).
- Status CSS classes derived from subscription content options (`client/src/components/CreatorContent/SideListItem.tsx:36-53`).

The stylesheet added row affordances:

- Hover border and title expansion (`client/src/index.scss:16-25`).
- Pointer cursor for thumbnails, titles, and creators (`client/src/index.scss:26-34`, `client/src/index.scss:40-45`).
- Visual classes for opened/played statuses (`client/src/index.scss:49-61`).

Source buttons were in `client/src/components/CreatorContent/ContentSourceBtns.tsx:34-56`, rendering one button per source option and calling `selectContent` with the chosen source (`client/src/components/CreatorContent/ContentSourceBtns.tsx:42-50`). Source selection defaulted to the first source in `client/src/utils/Content.ts:69-86` when no explicit source was passed.

### 6. Viewer behavior and content status actions

The legacy viewer was implemented in `client/src/components/SelectedContent.tsx`:

- Displayed title, creator, publication date, playback surface, and text body (`client/src/components/SelectedContent.tsx:75-185`).
- Provided authenticated action buttons for mark played/viewed and favorite (`client/src/components/SelectedContent.tsx:98-131`).
- Embedded YouTube via iframe (`client/src/components/SelectedContent.tsx:135-151`).
- Played Odysee/native video via `<video>` (`client/src/components/SelectedContent.tsx:152-168`).
- Marked played automatically on native video `onPlay` (`client/src/components/SelectedContent.tsx:157-161`).
- Dispatched pause workflow on native video `onPause` (`client/src/components/SelectedContent.tsx:163-165`).

Status persistence was event-driven:

- Selecting content dispatched `contentselected` (`client/src/utils/Content.ts:69-86`).
- Playing content dispatched `contentplayed` (`client/src/utils/Content.ts:88-100`).
- Favoriting dispatched `contentfavorited` (`client/src/utils/Content.ts:116-128`).
- App mount handlers persisted `open`, `played`, and `favorite` statuses in `client/src/utils/App.ts:39-119`.
- `setContentStatus` created subscription content options for statuses (`client/src/utils/Content.ts:14-58`).

### 7. Refresh routes and services

Legacy feed refresh routes were declared in `src/api/feed/routes/01-feed_custom.ts:1-44`:

- `GET /feeds/refreshable` (`src/api/feed/routes/01-feed_custom.ts:3-10`).
- `GET /feeds/:id/fetch` (`src/api/feed/routes/01-feed_custom.ts:11-18`).
- `GET /feeds/:id/refresh` (`src/api/feed/routes/01-feed_custom.ts:19-26`).
- `GET /feeds/refreshAll` (`src/api/feed/routes/01-feed_custom.ts:27-34`).
- `GET /feeds/test` (`src/api/feed/routes/01-feed_custom.ts:35-42`).

The client called refresh-all through `client/src/utils/Feeds.tsx:5-32`, including notifications and a `feedsrefreshedall` event. Per-creator refresh was wired in `client/src/components/Side0.tsx:127-157` by refreshing each feed attached to the creator.

## Current rewrite implemented functionality

Current rewrite root: `/home/didi/workspace/Code/FeedElity`.

### 1. App shell and three-pane structure

The rewrite centers on `apps/web/src/components/app-shell.tsx`.

- The shell defines three columns: `creators`, `content`, and `viewer` (`apps/web/src/components/app-shell.tsx:121-147`).
- Desktop grid uses `lg:grid-cols-[1fr_3fr_8fr]` (`apps/web/src/components/app-shell.tsx:123`).
- Root/grid classes try to constrain the layout with `h-full`, `min-h-0`, and `lg:overflow-hidden` (`apps/web/src/components/app-shell.tsx:125-128`).
- `AppShell` renders `CreatorSourceColumn`, `ContentListColumn`, and `SelectedContentViewer` (`apps/web/src/components/app-shell.tsx:1815-1864`).

The current routes point both `/` and `/dashboard` at the same shell:

- `/` renders `<AppShell />` (`apps/web/src/routes/index.tsx:1-11`).
- `/dashboard` performs an auth check but then also renders `<AppShell />` (`apps/web/src/routes/dashboard.tsx:1-22`).

### 2. Creator/source column

Implemented in `CreatorSourceColumn` (`apps/web/src/components/app-shell.tsx:338-458`):

- Creator search backed by `client.catalog.creators` (`apps/web/src/components/app-shell.tsx:338-343`, `apps/web/src/components/app-shell.tsx:367-375`).
- Creator list with selectable rows and selected state (`apps/web/src/components/app-shell.tsx:395-417`).
- Selected creator feed metadata via `client.catalog.feeds({ creatorId, limit: 25 })` (`apps/web/src/components/app-shell.tsx:344-346`, `apps/web/src/components/app-shell.tsx:421-445`).
- Feed rows display title/url and source type (`apps/web/src/components/app-shell.tsx:1155-1166`).
- Authenticated sections for refresh, settings, and playlists are embedded below sources (`apps/web/src/components/app-shell.tsx:446-455`).

### 3. Refresh controls and status

The rewrite implements manual refresh controls in `RefreshStatusSection`:

- Refresh status resource calls `client.refresh.status` (`apps/web/src/components/app-shell.tsx:465-473`).
- Normal all and force all actions call `client.refresh.runAll` (`apps/web/src/components/app-shell.tsx:475-487`, `apps/web/src/components/app-shell.tsx:517-534`).
- Normal source and force source actions call `client.refresh.runCreator` for the selected creator (`apps/web/src/components/app-shell.tsx:489-507`, `apps/web/src/components/app-shell.tsx:535-550`).
- Recent runs and latest feed results are displayed (`apps/web/src/components/app-shell.tsx:568-595`, `apps/web/src/components/app-shell.tsx:600-615`).

Backend refresh router support is in `packages/api/src/routers/index.ts:233-272`, backed by `packages/api/src/services/refresh.ts`.

### 4. Content list search, source filter, favorites, and thumbnails

Implemented in `ContentListColumn` (`apps/web/src/components/app-shell.tsx:1177-1340`):

- Catalog content list resource uses search, selected creator, source type, and limit (`apps/web/src/components/app-shell.tsx:1177-1195`).
- Authenticated favorites view uses `client.overlays.favoriteContentItems` (`apps/web/src/components/app-shell.tsx:1182-1192`).
- Search input and source filter select are present (`apps/web/src/components/app-shell.tsx:1264-1293`).
- Content rows include thumbnail, title, creator, publication date, and duration (`apps/web/src/components/app-shell.tsx:1368-1399`).
- Authenticated favorite toggle exists in list rows (`apps/web/src/components/app-shell.tsx:1400-1415`).

### 5. Viewer playback, source switching, favorites, and playlists

Implemented in `SelectedContentViewer` (`apps/web/src/components/app-shell.tsx:1430-1610`):

- Fetches content detail from `client.catalog.contentDetail` (`apps/web/src/components/app-shell.tsx:1430-1433`).
- Builds safe playable sources and chooses a selected source (`apps/web/src/components/app-shell.tsx:284-322`, `apps/web/src/components/app-shell.tsx:1460-1488`).
- Renders iframe/native playback (`apps/web/src/components/app-shell.tsx:1701-1735`).
- Offers a playback source switcher when multiple playable sources exist (`apps/web/src/components/app-shell.tsx:1561-1581`).
- Offers favorite controls in the viewer (`apps/web/src/components/app-shell.tsx:1512-1529`, `apps/web/src/components/app-shell.tsx:1582-1589`, `apps/web/src/components/app-shell.tsx:1631-1655`).
- Offers add-to-playlist controls in the viewer (`apps/web/src/components/app-shell.tsx:1490-1510`, `apps/web/src/components/app-shell.tsx:1590-1599`, `apps/web/src/components/app-shell.tsx:1657-1699`).
- Displays content body, metadata, original link, feeds, and playable source links (`apps/web/src/components/app-shell.tsx:1741-1813`).

### 6. Playlists and raw settings editor

The rewrite has actual playlist CRUD UI:

- Playlist list, create/update/delete form, sort-mode select, and selected playlist items are implemented in `PlaylistColumnSection` (`apps/web/src/components/app-shell.tsx:782-1095`).
- Playlist item rows support select, up/down, and remove (`apps/web/src/components/app-shell.tsx:1098-1153`).
- Viewer can add the selected content to a chosen playlist (`apps/web/src/components/app-shell.tsx:1657-1699`).

The rewrite also has a raw settings editor:

- `SettingsColumnSection` lists, saves, edits, and deletes user settings (`apps/web/src/components/app-shell.tsx:617-773`).
- Inputs are raw key/value fields (`apps/web/src/components/app-shell.tsx:680-727`).

Backend support is in the overlays router:

- Playlists: `packages/api/src/routers/index.ts:356-432`.
- Settings: `packages/api/src/routers/index.ts:433-445`.
- Domain types: `packages/api/src/domain/overlays.ts:33-60`.

### 7. Backend/API capabilities already present but hidden or underused by UI

The rewrite API already exposes several capabilities that are not fully reflected in the UI:

- Subscriptions: list, subscribe, unsubscribe (`packages/api/src/routers/index.ts:273-312`).
- Content statuses: list, mark opened, mark played, toggle favorite (`packages/api/src/routers/index.ts:313-352`).
- Content history for opened/played (`packages/api/src/routers/index.ts:353-355`).
- Migration import (`packages/api/src/routers/index.ts:447-453`) using migration modules under `packages/api/src/migration/`.
- Refresh services (`packages/api/src/routers/index.ts:233-272`, `packages/api/src/services/refresh.ts`).
- Ingestion service and source adapters (`packages/api/src/services/ingestion.ts`, `packages/api/src/sources/index.ts`, `packages/api/src/sources/youtube.ts`, `packages/api/src/sources/odysee.ts`, `packages/api/src/sources/peertube.ts`).

These APIs mean several missing UI flows do not require inventing a new persistence model. They require router exposure where absent, UI entry points, and wiring from user actions to existing API procedures.

## Missing/weak functionality grouped by priority

### Priority 0 — Layout and basic usability blockers

1. **Source/feed panes should scroll instead of extending.**
   - Complaint to preserve explicitly: source/feed panes should scroll instead of extending.
   - Legacy constrained the creator/playlist and content panes by viewport height (`client/src/index.scss:74-85`).
   - Current sections use `lg:overflow-y-auto`, but the overall composition still allows long embedded settings/playlists/feed lists to make the source column feel like one long page (`apps/web/src/components/app-shell.tsx:350-456`, `apps/web/src/components/app-shell.tsx:1226-1338`).
   - Desired behavior: creator list, selected-source feeds, refresh/settings/playlists, content list, and viewer should have deliberate scroll regions with stable headers/actions.

2. **Settings are not discoverable.**
   - Complaint to preserve explicitly: settings are not discoverable.
   - Legacy had a visible settings icon, even though it was a no-op (`client/src/components/Side0.tsx:37-39`).
   - Rewrite settings are real but hidden as a raw section inside the sources column (`apps/web/src/components/app-shell.tsx:617-773`).
   - Desired behavior: a visible settings entry point, clearer route/modal/panel, and typed settings instead of only raw key/value editing.

3. **Mobile pane navigation is weak.**
   - The rewrite stacks panes vertically by default and uses desktop grid only at `lg` (`apps/web/src/components/app-shell.tsx:125-128`).
   - There is no explicit mobile mode for switching between Sources, Feed, and Viewer. The three-pane workflow should be navigable without forcing users through a long vertical page.

4. **Devtools are unconditional.**
   - `SolidQueryDevtools` and `TanStackRouterDevtools` are always rendered in the root route (`apps/web/src/routes/__root.tsx:1-4`, `apps/web/src/routes/__root.tsx:26-27`).
   - Desired behavior: development-only rendering or a deliberate debug flag.

### Priority 1 — Core legacy parity gaps

1. **Add creator/source flow is missing.**
   - Complaint to preserve explicitly: add creator/source flow missing.
   - Legacy exposed add subscription from the left pane (`client/src/components/Side0.tsx:61-63`) and implemented single/multi URL modals (`client/src/components/Modal/Subscription.tsx:8-71`, `client/src/components/Modal/SubscriptionMulti.tsx:10-102`).
   - Rewrite has source adapters and ingestion service files but no visible add-source UI and no obvious router procedure equivalent to `POST /creators/fromFeedUrl` (`packages/api/src/services/ingestion.ts`, `packages/api/src/sources/index.ts`).
   - Desired behavior: authenticated add-source panel/modal with URL validation, source detection, adapter-backed ingestion, clear success/error states, and optional batch input after the single flow is solid.

2. **Subscribe/unsubscribe exists in API but is hidden in UI.**
   - Backend supports subscriptions (`packages/api/src/routers/index.ts:273-312`).
   - The current source list is catalog browsing; there is no obvious subscribe/unsubscribe control on creator rows or selected creator details (`apps/web/src/components/app-shell.tsx:395-445`).
   - Desired behavior: clear distinction between global catalog browsing and user subscriptions, with per-creator subscribe/unsubscribe controls gated by auth.

3. **Opened/viewed and played status are not wired.**
   - Complaint to preserve explicitly: mark viewed/played missing.
   - Backend supports `markContentOpened`, `markContentPlayed`, and `contentHistory` (`packages/api/src/routers/index.ts:313-355`).
   - Legacy marked open on content selection and played through viewer actions/native `onPlay` (`client/src/utils/App.ts:39-67`, `client/src/components/SelectedContent.tsx:109-129`, `client/src/components/SelectedContent.tsx:157-161`).
   - Rewrite viewer selection only sets local selected content (`apps/web/src/components/app-shell.tsx:1818-1860`); playback surface has no status callbacks (`apps/web/src/components/app-shell.tsx:1706-1735`).
   - Desired behavior: selecting a content item marks opened for authenticated users; native playback `onPlay` marks played; a manual mark played/viewed action exists; opened/played status changes update row styling.

4. **Hide played is missing.**
   - Legacy had a hide-played toggle (`client/src/components/SideList.tsx:13-27`) and CSS hiding played rows (`client/src/index.scss:56-61`).
   - Rewrite has favorites view but no played-status list, no status decoration, and no hide-played toggle (`apps/web/src/components/app-shell.tsx:1177-1340`).
   - Desired behavior: content list can hide played items using authenticated status data, without impacting anonymous catalog browsing.

5. **Source selection is unclear.**
   - Complaint to preserve explicitly: source selection unclear.
   - Legacy rows displayed source buttons directly per content item (`client/src/components/CreatorContent/ContentSourceBtns.tsx:42-50`) and passed selected source into the viewer (`client/src/utils/Content.ts:69-86`).
   - Rewrite has a global source-type filter in the content list (`apps/web/src/components/app-shell.tsx:1264-1293`) and a viewer dropdown only when multiple playable sources exist (`apps/web/src/components/app-shell.tsx:1561-1581`).
   - Desired behavior: make row-level source availability and selected playback source more apparent; distinguish filtering the feed by source type from choosing a playable source for a specific video.

6. **Feed-specific selection/filter/refresh is missing or too weak.**
   - Legacy had per-creator refresh that iterated creator feeds (`client/src/components/Side0.tsx:127-157`) and content rows could filter by creator through a click (`client/src/components/CreatorContent/SideListItem.tsx:99-114`).
   - Rewrite displays selected creator feeds as metadata only (`apps/web/src/components/app-shell.tsx:421-445`, `apps/web/src/components/app-shell.tsx:1159-1166`).
   - Current refresh supports all and selected creator (`apps/web/src/components/app-shell.tsx:517-550`), but not a per-feed refresh/select/filter UI.
   - Desired behavior: feed rows should be actionable: select/filter a feed, show counts/last refresh status, and refresh that feed if backend support exists or is added.

### Priority 2 — Row parity, feed affordances, and scanning efficiency

1. **Feed thumbnails and feed row affordances need parity.**
   - Complaint to preserve explicitly: feed thumbnails and feed row affordances need parity.
   - Legacy content rows had thumbnails, duration, creator click, action buttons, source buttons, date, status classes, and hover affordances (`client/src/components/CreatorContent/SideListItem.tsx:55-124`, `client/src/index.scss:16-61`).
   - Rewrite content rows have thumbnails and metadata (`apps/web/src/components/app-shell.tsx:1368-1399`), but feed rows are plain title/source text (`apps/web/src/components/app-shell.tsx:1159-1166`).
   - Desired behavior: strengthen feed/content row affordances with explicit action zones, source chips/buttons, status badges, and consistent hover/selected/opened/played visual states.

2. **Content row actions are thinner than legacy.**
   - Legacy rows had action buttons plus source buttons (`client/src/components/CreatorContent/SideListItem.tsx:84-97`).
   - Rewrite rows only expose favorite for authenticated users (`apps/web/src/components/app-shell.tsx:1400-1415`).
   - Desired behavior: add relevant row-level controls without reintroducing clutter: mark played, source/source-count indicator, open original, add to playlist, maybe creator-filter shortcut.

3. **Creator/source selection state needs clearer feedback.**
   - Rewrite rows set `aria-pressed` and `data-selected` (`apps/web/src/components/app-shell.tsx:401-406`) but visual affordance may be subtle depending on CSS.
   - Desired behavior: selected creator, selected feed, and selected content should be visually unambiguous.

4. **Pagination/load-more is missing.**
   - Current creator and content limits are constants at 50 (`apps/web/src/components/app-shell.tsx:49-51`) and feed limit is 25 (`apps/web/src/components/app-shell.tsx:344-346`).
   - Legacy requested larger content pages (`client/src/utils/App.ts:306-309`) and creator pages (`client/src/utils/App.ts:341-345`).
   - Desired behavior: add load-more or pagination for creators, feeds, and content instead of silently truncating.

### Priority 3 — Authenticated overlays and operational completeness

1. **Playlist UI is cramped.**
   - Complaint to preserve explicitly: playlist UI cramped.
   - Rewrite playlist management is embedded under sources in the narrow first column (`apps/web/src/components/app-shell.tsx:782-1095`).
   - Desired behavior: move playlist management into a more spacious panel or route while keeping quick playlist selection/add actions near the viewer.

2. **Playlist sort mode is not honored in displayed items.**
   - UI lets users choose sort mode (`apps/web/src/components/app-shell.tsx:971-979`) and stores it via playlist update/create (`apps/web/src/components/app-shell.tsx:835-839`, `apps/web/src/components/app-shell.tsx:859-864`).
   - Displayed playlist items are fetched and rendered in service/repository order, and the UI still emphasizes manual up/down ordering (`apps/web/src/components/app-shell.tsx:901-928`, `apps/web/src/components/app-shell.tsx:1072-1089`).
   - Desired behavior: either honor sort mode when listing playlist items or make clear that only manual mode can be reordered.

3. **Refresh status is too thin.**
   - Rewrite shows summary counts and only latest feed results (`apps/web/src/components/app-shell.tsx:568-615`).
   - Legacy notifications were crude but made activity obvious (`client/src/utils/Feeds.tsx:5-32`).
   - Desired behavior: show in-progress state, selected feed/run details, errors/warnings, skipped reasons, and clear completion feedback.

4. **Migration UI is missing.**
   - Backend exposes migration import (`packages/api/src/routers/index.ts:447-453`) and migration modules exist under `packages/api/src/migration/`.
   - There is no UI for uploading/importing legacy Strapi export JSON, reviewing unmapped records, or prompting migrated users to reset/set passwords.
   - Desired behavior: admin-only migration screen with dry-run/validation, summary counts, warnings/failures, and downloadable report.

5. **`/dashboard` is not differentiated from `/`.**
   - `/dashboard` is auth-gated but renders the same shell as `/` (`apps/web/src/routes/dashboard.tsx:1-22`, `apps/web/src/routes/index.tsx:1-11`).
   - Desired behavior: either make dashboard a meaningful authenticated workspace or remove/redirect it to reduce confusion.

## Do not blindly copy these legacy pieces

Several legacy controls were present but incomplete or broken:

- Settings icon was a no-op (`client/src/components/Side0.tsx:37-39`).
- External content opened a modal name that was not implemented in the modal container (`client/src/components/Side0.tsx:40-42`, `client/src/components/Modal/Container.tsx:23-33`).
- Filter, playlist, and topics buttons logged TODOs (`client/src/components/Side0.tsx:46-56`).
- Hidden playlist pane existed but was not a polished feature (`client/src/components/Side0.tsx:163-180`).
- Legacy relied heavily on document-wide custom events (`client/src/utils/App.ts:39-290`, `client/src/utils/Content.ts:69-128`), which the rewrite should not reintroduce as the main architecture.

The target should be functional parity, not structural parity. The rewrite should keep its explicit API/service/UI boundaries while restoring the missing user-visible actions.

## Suggested reading path for implementation planning

1. Start with layout and scroll regions in `apps/web/src/components/app-shell.tsx:125-128`, `apps/web/src/components/app-shell.tsx:338-456`, and `apps/web/src/components/app-shell.tsx:1177-1338`.
2. Add a visible source-add flow by comparing legacy `client/src/components/Modal/Subscription.tsx:8-71` with rewrite source adapters in `packages/api/src/sources/` and ingestion in `packages/api/src/services/ingestion.ts`.
3. Wire opened/played statuses from the existing router procedures in `packages/api/src/routers/index.ts:313-355` to selection and playback in `apps/web/src/components/app-shell.tsx:1430-1735`.
4. Improve content/feed row parity using legacy row affordances from `client/src/components/CreatorContent/SideListItem.tsx:55-124` and source buttons from `client/src/components/CreatorContent/ContentSourceBtns.tsx:34-56`.
5. Revisit authenticated overlays: subscriptions (`packages/api/src/routers/index.ts:273-312`), playlists (`packages/api/src/routers/index.ts:356-432`), settings (`packages/api/src/routers/index.ts:433-445`), and migration (`packages/api/src/routers/index.ts:447-453`).
