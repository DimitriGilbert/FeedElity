# Data Models and API Surface

Scope: generated API client, response mappers, and helper layers used by the Feedelity client.

## Model inventory

### Creators
- `Creator` fields: `name`, `description`, `options`, `feeds`, `contents`, `subscriptions`.
- Wrapper type: `CreatorT = Creator & { id?: number }`.
- Related option model: `CreatorOption` (`creator`, `name`, `type`, `value`) and `CreatorOptionT`.
- Related content model: `CreatorContent` (`creator`, `title`, `type`, `publication`, `data`, `options`, `feed_contents`, `subscription_content_options`) and `CreatorContentT`.
- Related feed model: `Feed` and `FeedT`.
- File refs: `/home/didi/workspace/Code/Feedelity/client/src/client.ts:16-105`, `/home/didi/workspace/Code/Feedelity/client/src/client.ts:2879-3076`.

### Feeds
- `Feed` fields: `creator`, `name`, `url`, `type`, `externalId`, `options`, `feed_contents`, `refreshedAt`.
- Wrapper type: `FeedT = Feed & { id?: number }`.
- Related models: `FeedOption`, `FeedContent`.
- File refs: `/home/didi/workspace/Code/Feedelity/client/src/client.ts:28-43`, `/home/didi/workspace/Code/Feedelity/client/src/client.ts:3077-3222`.

### Contents
- Core content model is `CreatorContent`.
- Relations/collections: `creator`, `options`, `feed_contents`, `subscription_content_options`.
- Related edge models: `ContentOption`, `FeedContent`, `SubscriptionContentOption`.
- Wrapper type: `CreatorContentT`.
- File refs: `/home/didi/workspace/Code/Feedelity/client/src/client.ts:95-110`, `/home/didi/workspace/Code/Feedelity/client/src/client.ts:2953-3037`.

### Subscriptions
- `Subscription` fields: `user` (number), `creator`, `options`, `content_options`.
- Wrapper type: `SubscriptionT = Subscription & { id?: number }`.
- Related models: `SubscriptionOption`, `SubscriptionContentOption`.
- File refs: `/home/didi/workspace/Code/Feedelity/client/src/client.ts:68-86`, `/home/didi/workspace/Code/Feedelity/client/src/client.ts:3309-3486`.

### Options
- Generic option shapes exist for each parent entity: `CreatorOption`, `FeedOption`, `ContentOption`, `SubscriptionOption`, `SubscriptionContentOption`.
- Shared utility shape: `GenericOption` in `utils/Options.ts`.
- All option types carry `name`, `type`, `value` and a relation back to the owning record where applicable.
- File refs: `/home/didi/workspace/Code/Feedelity/client/src/client.ts:16-27`, `/home/didi/workspace/Code/Feedelity/client/src/client.ts:68-110`, `/home/didi/workspace/Code/Feedelity/client/src/utils/Options.ts:1-19`.

### Playlists
- `Playlist` fields: `name`, `description`, `user`, `playlist_contents`.
- `PlaylistContent` fields: `content`, `playlist`, `Added`, `position`.
- Wrapper types: `PlaylistT`, `PlaylistContentT`.
- File refs: `/home/didi/workspace/Code/Feedelity/client/src/client.ts:44-55`, `/home/didi/workspace/Code/Feedelity/client/src/client.ts:3223-3308`.

### Users
- Generated API type: `User` with `username`, `email`, `provider`, `password`, `resetPasswordToken`, `confirmationToken`, `confirmed`, `blocked`, `subscriptions`, `playlists`.
- Separate UI-facing type: `UserT` with `id`, `username`, `email`, `provider`, `confirmed`, `blocked`, `createdAt`, `updatedAt`.
- No generated CRUD helpers for users were found in the client surface.
- File refs: `/home/didi/workspace/Code/Feedelity/client/src/client.ts:56-67`, `/home/didi/workspace/Code/Feedelity/client/src/client/UserModel.ts:1-10`.

### Response / request envelope types
- Each resource also has `XResponse`, `XListResponse`, and `XRequest` types.
- List responses include `meta.pagination` (`page`, `pageSize`, `pageCount`, `total`).
- Shared error envelope is `Error` with `error.status/name/message/details`.
- File refs: `/home/didi/workspace/Code/Feedelity/client/src/client.ts:111-269`.

## API surface

### Standard CRUD-style endpoints
All list endpoints support the usual Strapi query options: `sort`, `pagination[withCount]`, `pagination[page]`, `pagination[pageSize]`, `pagination[start]`, `pagination[limit]`, `fields`, `populate`, `filters`, `locale`.

- `content-options`: list/create/read/update/delete.
- `creators`: list/create/read/update/delete.
- `creator-contents`: list/create/read/update/delete.
- `creator-options`: list/create/read/update/delete.
- `feeds`: list/create/read/update/delete.
- `feed-contents`: list/create/read/update/delete.
- `feed-options`: list/create/read/update/delete.
- `playlists`: list/create/read/update/delete.
- `playlist-contents`: list/create/read/update/delete.
- `subscriptions`: list/create/read/update/delete.
- `subscription-content-options`: list/create/read/update/delete.
- `subscription-options`: list/create/read/update/delete.
- File refs: `/home/didi/workspace/Code/Feedelity/client/src/client.ts:271-2838`.

### Custom feed operations
- `GET /feeds/:id/refresh` via `getFeedsByIdRefresh`: refresh a single feed and returns refreshed `CreatorContentResponse[]`.
- `GET /feeds/refreshable` via `getFeedsRefreshable`: fetches a refreshable feed record.
- `GET /feeds/refreshAll[?force=1]` via `getFeedsRefreshAll`: refreshes all feeds; returns `{ maxdelay, feeds }`.
- File refs: `/home/didi/workspace/Code/Feedelity/client/src/client/Feed.ts:8-120`.

### Custom creator/subscription operations
- `POST /creators/fromFeedUrl` via `postFromFeedUrl`: creates/derives a creator from a feed URL and type.
- `GET /subscriptions/:userId/creators` via `getSubscribedCreators`: lists creators for a user.
- `GET /subscriptions/:userId/contents` via `getSubscribedContents`: lists contents for a user.
- `GET /subscriptions/:userId/:creatorId` via `getSubscribtionForCreator`: looks up the subscription between a user and a creator.
- File refs: `/home/didi/workspace/Code/Feedelity/client/src/client/Creator.ts:8-145`.

## Data-fetching helpers and runtime behavior

### `apiResource.ts`
- Wraps generated client methods with Solid `createResource`.
- `apiOperator(operationId, requestParameters)` resolves the generated function by camelCased name and caches it in `ApiOperators`.
- `customApiOperator` can cache a non-generated operator under the same naming scheme.
- `setApiRequestOpt/getApiRequestOpt` store request defaults shared by helpers.
- File refs: `/home/didi/workspace/Code/Feedelity/client/src/apiResource.ts:1-113`.

### Option helpers
- `getOptions` filters by exact `name` match.
- `getOptionsValues` and `getFirstOptionValue` expose the option values for a key.
- File refs: `/home/didi/workspace/Code/Feedelity/client/src/utils/Options.ts:1-19`.

### Subscription helper
- `getUserCreatorSub(userId, creatorId)` calls `getSubscribtionForCreator` and returns the first subscription record.
- There is a commented-out fallback using `getSubscriptions` with filters.
- File refs: `/home/didi/workspace/Code/Feedelity/client/src/utils/Subscription.ts:1-55`.

### Content helper and side effects
- `setContentStatus(status, content, user)` checks for an existing matching subscription-content option; if absent, it creates one with `type: "status"` and `value: "1"`.
- `contentHasStatus` checks whether a content item already has a non-zero status option.
- `selectContent`, `contentPlayed`, `contentPaused`, and `contentFavorited` dispatch DOM events consumed elsewhere.
- File refs: `/home/didi/workspace/Code/Feedelity/client/src/utils/Content.ts:14-128`.

### App-level event wiring
- `contentselected` marks content as `open` and updates the in-memory content list.
- `contentplayed` marks content as `played`.
- `contentfavorited` toggles or creates a `favorite` subscription-content option.
- `feedrefreshed` and `feedsrefreshedall` trigger content list refreshes.
- `creatorcreated` can create a subscription for the current user or schedule a creator refresh for anonymous users.
- `showfavorites` loads contents filtered by favorite status.
- File refs: `/home/didi/workspace/Code/Feedelity/client/src/utils/App.ts:39-364`.

## Technical debt / risks observed
- The generated client is pinned to `http://localhost:1337/api`, so environment switching depends on overrides elsewhere.
- Several relation hydrations are commented out (`Playlist.user`, `CreatorContent.playlist_contents`, `Subscription.user`), so nested objects may stay partially populated.
- `fromPlaylistContentResponse` assumes nested populated data exists when `content`/`playlist` are present.
- `setContentStatus` can leave its promise unresolved when no user exists, the status already exists, or the subscription lookup does not yield a record.
- `apiResource` caches by `btoa(JSON.stringify(requestParameters))`, which is sensitive to object shape/order.
- Notable naming inconsistencies: `Added` is capitalized, and `getSubscribtionForCreator` is misspelled.
- File refs: `/home/didi/workspace/Code/Feedelity/client/src/client.ts:9-15`, `/home/didi/workspace/Code/Feedelity/client/src/client.ts:3020-3025`, `/home/didi/workspace/Code/Feedelity/client/src/client.ts:3239-3249`, `/home/didi/workspace/Code/Feedelity/client/src/utils/Content.ts:19-57`, `/home/didi/workspace/Code/Feedelity/client/src/apiResource.ts:37-49`, `/home/didi/workspace/Code/Feedelity/client/src/client/Creator.ts:114-145`.
