# App shell and global flow

## Architecture summary

- The app is a single-page Solid app rooted in `App.tsx` with no router.
- The shell is a 3-column layout: left nav (`Side0`), content list (`SideList`), and selected content viewer (`SelectedContent`). `App.tsx` also renders a global `ToastContainer` and a single `ModalContainer`.
- Global interaction is event-bus driven: most cross-component actions dispatch `CustomEvent`s on `document`, and `handleAppMount` wires the app-wide listeners.
- Data loading is backed by cached Solid resources via `apiOperator` / `customApiOperator`; resources are keyed by operation name + request parameters.

## Facts: top-level flow

### App boot
- `client/src/index.tsx` renders `<App />` into `#root`.
- `App.tsx` creates global signals for:
  - creators
  - creatorContents
  - selectedContent
  - user
  - notifications
- On mount, `handleAppMount(...)` registers document listeners for app-wide events.

### Initial data loading
- `App.tsx` has a `createEffect` that loads content depending on auth state:
  - authenticated user: fetch subscribed creators and subscribed contents
  - anonymous user: fetch all creators, then fetch creator contents for those creators
- Request builders live in `utils/App.ts`:
  - `getCreatorReqArgs(user)`
  - `getContentReqArgs(creators, user, page, filters)`
- Auth token is stored globally via `setApiRequestOpt` in `Login.tsx`.

### Shell rendering
- `ToastContainer` shows notifications from the `notifs` signal.
- `ModalContainer` shows one modal at a time based on the `modal` event.
- Main row renders:
  - `Side0` with creators + auth state
  - `SideList` with content list
  - `SelectedContent` for the current selection

## Facts: event / signal / resource map

### Document events listened for in `utils/App.ts`
- `contentselected`
- `contentplayed`
- `contentfavorited`
- `userloggedin`
- `feedrefreshed`
- `feedsrefreshedall`
- `reloadcontentlist`
- `creatorcreated`
- `notif`
- `creatorselected`
- `showfavorites`
- plus any extra handlers in `eventsHandlers`

### Modal events
- `showModal(name)` dispatches `modal` with `{ name, show: true }`.
- `closeModal(name)` dispatches `modal` with `{ name, show: false }`.
- `ModalContainer` switches on `show()` and currently supports:
  - `login`
  - `add-subscription`
  - `add-subscription-list`

### API/resource names seen in the app flow
- `get/creators`
- `get/subscriptions/:id/creators`
- `get/subscriptions/:id/contents`
- `get/creator-contents`
- `post/subscription-content-options`
- `post/subscriptions`
- feed refresh endpoints in `client/src/client/Feed.ts`
- creator import endpoint in `client/src/client/Creator.ts`

## User-facing interactions / functions

### Left nav (`Side0.tsx`)
- Login button (only when no user): opens `login` modal.
- Settings button: currently no-op.
- Second settings-looking button: opens `external-content` modal, but no modal is wired for that name in `ModalContainer`.
- Filter button: placeholder console log.
- Logged-in-only buttons:
  - playlist button: placeholder console log
  - topics button: placeholder console log
  - star button: dispatches `showfavorites`
- Add subscription button: opens `add-subscription` modal.
- Refresh button: calls `refreshAll()`.
- Force refresh button: calls `refreshAll(true)`.
- Creator search box: filters creator list DOM items by name.
- Creator row actions:
  - hide button: dispatches `creatorselected` with that creator
  - refresh button: refreshes each of the creator’s feeds, then dispatches `feedrefreshed`

### Content list (`SideList.tsx` + `SideListItem.tsx`)
- Hide played toggle: toggles CSS class `hide-played`.
- Reload button: dispatches `reloadcontentlist`.
- Content search box: filters list items by title; optionally also matches creator name.
- Each content item supports:
  - clicking thumbnail/title: dispatches `contentselected`
  - clicking creator name: dispatches `creatorselected`
  - action buttons:
    - mark played: dispatches `contentplayed`
    - toggle favorite: dispatches `contentfavorited`
  - source buttons: re-select same content with a specific source (youtube / odysee)

### Selected content viewer (`SelectedContent.tsx`)
- Shows title, creator, publication date, and body text lines.
- Clicking creator name dispatches `creatorselected`.
- If a user is logged in, shows buttons to mark played or favorite.
- If content type is `video:embed`:
  - youtube renders an `<iframe>`
  - odysee renders a `<video>` with play/pause handlers

### Login modal
- Submits email/password to `/api/auth/local`.
- Stores bearer token in global API request options.
- Dispatches `userloggedin` with the user object.
- Closes the login modal on success.

### Add subscription modal
- Accepts one feed URL.
- Auto-detects type from the URL (`youtube` or `odysee`) but lets the user override it.
- Posts via `postFromFeedUrl`.
- Dispatches `creatorcreated` with the created creator.
- Closes the modal.
- Provides a link to the multi-add modal.

### Multi subscription modal
- Accepts newline-separated URLs.
- Detects feed type per URL.
- Sequentially posts each URL.
- On each success, dispatches `creatorcreated` and shows a notification.
- When done, dispatches `creatorbatchcreated` and shows a completion notification.
- Closes the modal after submit.

## Facts: refresh and status behavior

### Feed refresh
- `refreshAll(force?)` calls `/feeds/refreshAll`.
- It shows a notification summarizing refresh result or “Nothing to refresh”.
- It dispatches `feedsrefreshedall` with the response payload.
- `handleAppMount` listens for `feedsrefreshedall` and schedules `reloadcontentlist` after `maxdelay + 10000` ms.
- `Side0` creator refresh dispatches `feedrefreshed` after all feed refresh calls finish.
- `handleAppMount` listens for `feedrefreshed` and refetches the current content list, then shows a notification.

### Content status / favorite behavior
- `contentselected` sets the selected content and calls `setContentStatus("open", ...)`.
- `contentplayed` calls `setContentStatus("played", ...)`.
- `setContentStatus` only creates a status option if one does not already exist.
- `contentfavorited` toggles a `favorite` subscription-content option:
  - updates existing favorite via PUT when present
  - creates one via POST when absent
- `contentpaused` is emitted by the video player but no listener was found in the inspected flow.

### Creator / subscription behavior
- `creatorcreated` behaves differently by auth state:
  - anonymous: waits 20s, then refetches creators and notifies that refresh will happen later
  - authenticated: creates a subscription for the new creator if not already subscribed, then refetches creators and notifies success
- `showfavorites` replaces the content list with items filtered by favorite subscription-content options.

## Inferred behavior / caveats

- The app is intentionally event-driven; many UI actions mutate state indirectly through document events instead of direct prop callbacks.
- `external-content`, `loadplaylist`, and some button actions appear present in UI code, but no handler was found in the inspected top-level flow, so they may be placeholders or incomplete features.
- `creatorbatchcreated` is emitted by the multi-add modal, but no listener was found in the inspected files.
- `SelectedContent` uses `props.contentIndex || -1` in some handlers, so index-based updates rely on the selection originating from the list.
- `ModalG` currently always renders a visible Bootstrap modal when mounted; visibility is controlled by whether `ModalContainer` mounts the modal component.

## File references
- `client/src/App.tsx`
- `client/src/utils/App.ts`
- `client/src/apiResource.ts`
- `client/src/components/Side0.tsx`
- `client/src/components/SideList.tsx`
- `client/src/components/SelectedContent.tsx`
- `client/src/utils/Content.ts`
- `client/src/utils/Modal.ts`
- `client/src/utils/Notif.ts`
- `client/src/components/Modal/Container.tsx`
- `client/src/components/Modal/Login.tsx`
- `client/src/components/Modal/Subscription.tsx`
- `client/src/components/Modal/SubscriptionMulti.tsx`
- `client/src/utils/Feeds.tsx`
- `client/src/components/CreatorContent/SideListItem.tsx`
- `client/src/components/CreatorContent/ContentActionBtns.tsx`
- `client/src/components/CreatorContent/ContentSourceBtns.tsx`
- `client/src/components/Modal/Generic.tsx`
- `client/src/client/Creator.ts`
- `client/src/client/Feed.ts`
- `client/src/index.tsx`
