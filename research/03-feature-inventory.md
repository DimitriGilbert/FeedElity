# Feature inventory

## Scope

This inventory covers the Solid client components under `client/src/components`, plus the small utility/view glue needed to understand how those components behave in the UI.
The app is a single-page shell with no router; features are assembled through document events, global signals, and a 3-column layout in `App.tsx`.

## Creators

### What users can do
- Browse creators in the left sidebar and filter them by name with the sidebar search box. `Side0` toggles creator rows by adding/removing `d-none` classes. [client/src/components/Side0.tsx](../../client/src/components/Side0.tsx)
- Select a creator to load that creator’s content list. The sidebar emits `creatorselected`, and `handleAppMount` fetches creator contents. [client/src/components/Side0.tsx](../../client/src/components/Side0.tsx), [client/src/utils/App.ts](../../client/src/utils/App.ts)
- Inspect creator data through the generic creator viewer, which can show name, description, options, feeds, contents, and subscriptions. [client/src/components/Creator/Creator.tsx](../../client/src/components/Creator/Creator.tsx)
- Add a creator indirectly by adding a subscription from a feed URL; successful creation emits `creatorcreated`. [client/src/components/Modal/Subscription.tsx](../../client/src/components/Modal/Subscription.tsx), [client/src/client/Creator.ts](../../client/src/client/Creator.ts)

### Gaps / placeholders
- The creator settings button is a no-op.
- The filter button logs `filter todo`.
- The `topics` button logs `topics todo`.
- There is no dedicated creator edit/create form flow in the components; the form components are scaffolding only.

### Rebuild-relevant behaviors
- Creator rows refresh their feeds one by one and then emit `feedrefreshed` with the refreshed contents.
- Creator selection is event-driven rather than prop-driven.
- Several creator list/form components snapshot props into local signals once and do not appear to sync later prop changes.

### File references
- `client/src/components/Side0.tsx`
- `client/src/components/Creator/Creator.tsx`
- `client/src/components/Creator/CreatorList.tsx`
- `client/src/components/Creator/CreatorForm.tsx`
- `client/src/components/Creator/Attributes/CreatorNameInput.tsx`
- `client/src/components/Creator/Attributes/CreatorDescription.tsx`
- `client/src/utils/App.ts`
- `client/src/client/Creator.ts`

## Feeds

### What users can do
- Refresh all feeds from the left sidebar, either normal or forced (`refreshAll()` / `refreshAll(true)`). [client/src/components/Side0.tsx](../../client/src/components/Side0.tsx), [client/src/utils/Feeds.tsx](../../client/src/utils/Feeds.tsx)
- Refresh a single creator’s feeds from that creator row. [client/src/components/Side0.tsx](../../client/src/components/Side0.tsx)
- Add a feed/subscription from a URL; the modal can auto-detect `youtube` or `odysee`. [client/src/components/Modal/Subscription.tsx](../../client/src/components/Modal/Subscription.tsx), [client/src/utils/Feeds.tsx](../../client/src/utils/Feeds.tsx)
- View feed fields and nested relations through the generic feed viewer (`name`, `url`, `type`, `externalId`, `refreshedAt`, options, feed contents, creator). [client/src/components/Feed/Feed.tsx](../../client/src/components/Feed/Feed.tsx)

### Gaps / placeholders
- There is no dedicated feed management screen beyond the generic relation viewer.
- `external-content` is opened from the sidebar, but no modal named `external-content` is registered.
- Feed form inputs exist, but there is no visible create/edit submission flow in the component tree.
- `refreshedAt` is displayed via a wrapper component only; no richer UI is present.

### Rebuild-relevant behaviors
- Feed refresh results are summarized in a toast.
- `refreshAll()` dispatches `feedsrefreshedall`, which later schedules a `reloadcontentlist`.
- Feed detection is URL-based and currently only recognizes YouTube and Odysee.

### File references
- `client/src/components/Feed/Feed.tsx`
- `client/src/components/Feed/FeedList.tsx`
- `client/src/components/Feed/FeedForm.tsx`
- `client/src/components/Feed/Attributes/FeedNameInput.tsx`
- `client/src/components/Feed/Attributes/FeedUrlInput.tsx`
- `client/src/components/Feed/Attributes/FeedTypeInput.tsx`
- `client/src/components/Feed/Attributes/FeedExternalId.tsx`
- `client/src/components/Feed/Attributes/FeedRefreshedAt.tsx`
- `client/src/utils/Feeds.tsx`
- `client/src/components/Modal/Subscription.tsx`
- `client/src/components/Side0.tsx`
- `client/src/client/Feed.ts`

## Content list

### What users can do
- Browse content items in the middle pane.
- Hide played items with a toggle that adds a CSS class to the list container. [client/src/components/SideList.tsx](../../client/src/components/SideList.tsx)
- Reload the current content list. [client/src/components/SideList.tsx](../../client/src/components/SideList.tsx)
- Search content by title, with an optional creator-name fallback search. [client/src/components/SideList.tsx](../../client/src/components/SideList.tsx)
- Open a content item by clicking its thumbnail or title. [client/src/components/CreatorContent/SideListItem.tsx](../../client/src/components/CreatorContent/SideListItem.tsx)
- See duration, source buttons, action buttons, creator, publication date, and thumbnail. [client/src/components/CreatorContent/SideListItem.tsx](../../client/src/components/CreatorContent/SideListItem.tsx)

### Gaps / placeholders
- Filtering is DOM-class based rather than state-based.
- Pagination exists in the query helper, but the list UI does not expose it.
- There is no dedicated sort UI in the component tree.

### Rebuild-relevant behaviors
- Item CSS includes status classes from `subscription_content_options`, so played/opened/favorite states are encoded in content row classes.
- Thumbnails come from the `thumb` content option.
- Duration comes from the `duration` content option and is formatted manually.
- Source buttons are derived from content options named `source`.

### File references
- `client/src/components/SideList.tsx`
- `client/src/components/CreatorContent/SideListItem.tsx`
- `client/src/components/CreatorContent/ContentActionBtns.tsx`
- `client/src/components/CreatorContent/ContentSourceBtns.tsx`
- `client/src/utils/Content.ts`
- `client/src/utils/Options.ts`
- `client/src/utils/App.ts`

## Content viewer

### What users can do
- View the selected content title, creator, publication date, and body text lines. [client/src/components/SelectedContent.tsx](../../client/src/components/SelectedContent.tsx)
- Click the creator name to jump back to that creator’s content. [client/src/components/SelectedContent.tsx](../../client/src/components/SelectedContent.tsx)
- For logged-in users, mark the content played or favorite from the viewer. [client/src/components/SelectedContent.tsx](../../client/src/components/SelectedContent.tsx), [client/src/utils/Content.ts](../../client/src/utils/Content.ts)
- Render `video:embed` content as either a YouTube iframe or an Odysee video element. [client/src/components/SelectedContent.tsx](../../client/src/components/SelectedContent.tsx)

### Gaps / placeholders
- `srcLinks()` is a stub with a TODO for extracting raw links.
- The viewer only renders media for `video:embed` content.
- The selected-content card is empty until both a source and content type are present.

### Rebuild-relevant behaviors
- `contentselected` triggers the selection update and marks content as open.
- `contentplayed` and `contentfavorited` are event-driven, not direct callbacks.
- Odysee playback uses native `<video>` play/pause events; YouTube support is iframe-only.

### File references
- `client/src/components/SelectedContent.tsx`
- `client/src/utils/Content.ts`
- `client/src/utils/App.ts`

## Subscriptions

### What users can do
- Add a single subscription from a URL or add a batch of URLs separated by newlines. [client/src/components/Modal/Subscription.tsx](../../client/src/components/Modal/Subscription.tsx), [client/src/components/Modal/SubscriptionMulti.tsx](../../client/src/components/Modal/SubscriptionMulti.tsx)
- Browse a subscription as a nested object with user, creator, options, and content options. [client/src/components/Subscription/Subscription.tsx](../../client/src/components/Subscription/Subscription.tsx)
- Browse subscription-content options as nested records tied to content and subscription. [client/src/components/SubscriptionContentOption/SubscriptionContentOption.tsx](../../client/src/components/SubscriptionContentOption/SubscriptionContentOption.tsx)

### Gaps / placeholders
- Subscription forms are mostly scaffolding; they expose fields but do not wire submit/change behavior beyond the login/subscription modals.
- There is no standalone subscription management screen.
- The multi-add modal emits `creatorbatchcreated`, but no listener was found in the inspected UI flow.

### Rebuild-relevant behaviors
- A successful single add emits `creatorcreated` and closes the modal.
- The multi-add modal processes URLs sequentially with delays and toast feedback between items.
- Subscriptions are also created automatically for authenticated users when a new creator is added.

### File references
- `client/src/components/Subscription/Subscription.tsx`
- `client/src/components/Subscription/SubscriptionList.tsx`
- `client/src/components/Subscription/SubscriptionForm.tsx`
- `client/src/components/Subscription/Attributes/SubscriptionUserInput.tsx`
- `client/src/components/SubscriptionContentOption/SubscriptionContentOption.tsx`
- `client/src/components/SubscriptionContentOption/SubscriptionContentOptionList.tsx`
- `client/src/components/Modal/Subscription.tsx`
- `client/src/components/Modal/SubscriptionMulti.tsx`
- `client/src/utils/App.ts`
- `client/src/utils/Subscription.ts`

## Login / modal surfaces

### What users can do
- Open the login modal from the sidebar when signed out.
- Submit email/password, receive a JWT, and have the client store the bearer token globally.
- Open the add-subscription modal and the add-subscription-list modal.

### Gaps / placeholders
- The sidebar also opens `external-content`, but `ModalContainer` does not render a component for that name.
- Modal support is limited to the names wired in `ModalContainer`.

### Rebuild-relevant behaviors
- Modal visibility is controlled through a document event bus (`modal` events).
- `ModalG` is a thin Bootstrap wrapper; `ModalContainer` chooses which modal to mount.
- Login success dispatches `userloggedin`, which updates app state and shows a notification.

### File references
- `client/src/components/Modal/Container.tsx`
- `client/src/components/Modal/Generic.tsx`
- `client/src/components/Modal/Login.tsx`
- `client/src/components/Modal/Subscription.tsx`
- `client/src/components/Modal/SubscriptionMulti.tsx`
- `client/src/utils/Modal.ts`
- `client/src/utils/App.ts`

## Notifications

### What users can do
- See toast notifications in the top-center container.
- Receive notifications for login, feed refresh, subscription adds, and empty refresh results.

### Gaps / placeholders
- Toast dismissal mutates the notification array in place (`splice`) instead of using an immutable filter/update path.

### Rebuild-relevant behaviors
- Notifications are pushed through a `notif` custom event.
- Toast styling, title, content, and timeout are all passed through the event payload.

### File references
- `client/src/utils/Notif.ts`
- `client/src/components/Modal/SubscriptionMulti.tsx`
- `client/src/utils/Feeds.tsx`
- `client/src/utils/App.ts`
- `client/src/App.tsx`

## Playlists

### What users can do
- The sidebar reserves a playlist area and emits `loadplaylist` when a playlist row is clicked.
- The sidebar also exposes a playlist button for logged-in users.

### Gaps / placeholders
- The playlist button is a console-log placeholder.
- The playlist list is hidden by default and appears empty in the inspected flow.
- No playlist-specific components or event listeners were found under `client/src/components` or the app flow.
- Playlist types exist in the generated API client, but the UI is not wired up.

### Rebuild-relevant behaviors
- Playlist support is currently only a shell, not a completed feature.

### File references
- `client/src/components/Side0.tsx`
- `client/src/client.ts`

## Favorites

### What users can do
- Mark content as favorite from the content list or selected-content view.
- Filter the content list to favorites via the sidebar star button.
- Toggle favorite state on a content item already associated with a subscription-content option named `favorite`.

### Gaps / placeholders
- Favorites are not a standalone screen; they are encoded as subscription-content options.
- The top-level star button only works for logged-in users.

### Rebuild-relevant behaviors
- `contentfavorited` either updates an existing `favorite` option or creates a new one.
- `showfavorites` replaces the current content list with items filtered by favorite options.
- Favorite state also affects the content row icon (`BiSolidStar` vs `BiRegularStar`).

### File references
- `client/src/components/CreatorContent/ContentActionBtns.tsx`
- `client/src/components/SelectedContent.tsx`
- `client/src/utils/Content.ts`
- `client/src/utils/App.ts`
- `client/src/components/Side0.tsx`

## Refresh

### What users can do
- Refresh all feeds.
- Force refresh all feeds.
- Refresh a single creator’s feeds.
- Reload the current content list after refresh events.

### Gaps / placeholders
- There is no dedicated refresh history or status page.
- Refresh feedback is mostly toast-based.

### Rebuild-relevant behaviors
- `refreshAll()` emits `feedsrefreshedall`, then the app schedules a content reload after a delay reported by the backend.
- Individual feed refresh emits `feedrefreshed`, which causes the app to refetch the content list.
- Refresh notifications distinguish between “Refreshing Feeds”, “feed refreshed”, and “no new content”.

### File references
- `client/src/utils/Feeds.tsx`
- `client/src/utils/App.ts`
- `client/src/components/Side0.tsx`
- `client/src/components/SideList.tsx`
- `client/src/client/Feed.ts`

## Cross-cutting implementation notes

- The app is event-bus driven (`document.dispatchEvent` / `document.addEventListener`) rather than route-driven.
- Many list components cache incoming props into local signals once and do not appear to resubscribe to later prop updates.
- The generic entity viewers (`Creator`, `Feed`, `CreatorContent`, `Subscription`, `ContentOption`, `FeedContent`, etc.) are mostly wrappers for nested relation browsing.
- Forms exist for many entity types, but only login and subscription add flows are actually wired to submit behavior in the inspected UI.
- The generated API client includes playlist and content-option types even where the UI is not finished.

## Top-level glue

- `client/src/index.tsx` renders `<App />` into `#root`.
- `client/src/App.tsx` owns the shell layout, notification container, modal container, global state, and initial data loading.
- No router was found in the client UI.
