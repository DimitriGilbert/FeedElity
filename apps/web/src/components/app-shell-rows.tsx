import type { CatalogContentListItem, CatalogCreator, CatalogFeed, PlaylistItemWithContent, UserSubscriptionWithCreator } from "@FeedElity/api";
import type { JSX } from "solid-js";
import { Show, createMemo, createSignal } from "solid-js";

import type { ReaderDensity } from "./app-shell.contract";
import { SourceIconBadge } from "./source-indicator";

type BrowsableCreator = CatalogCreator | UserSubscriptionWithCreator["creator"];

export interface ContentStatusFlags {
  readonly opened: boolean;
  readonly played: boolean;
}

function readerDensityPaddingClass(readerDensity: ReaderDensity): string {
  return readerDensity === "compact" ? "p-1.5" : "p-2";
}

function formatFeedDateTime(value: Date | null): string {
  if (value === null) {
    return "Not completed";
  }

  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(value);
}

function formatFeedRefreshMetadata(feed: CatalogFeed): string {
  if (feed.lastNormalRefreshAt === null) {
    return "Last refresh: Never";
  }

  return `Last refresh: ${formatFeedDateTime(feed.lastNormalRefreshAt)}`;
}

function formatFeedNextRefreshMetadata(feed: CatalogFeed): string {
  if (feed.nextRefreshAfter === null) {
    return "Next normal refresh: Not scheduled";
  }

  return `Next normal refresh: ${formatFeedDateTime(feed.nextRefreshAfter)}`;
}

export interface CreatorSourceRowProps {
  readonly creator: BrowsableCreator;
  readonly isAuthenticated: boolean;
  readonly isSelected: boolean;
  readonly isSubscribed: boolean;
  readonly showSubscriptionControl: boolean;
  readonly readerDensity: ReaderDensity;
  readonly subscriptionControl: JSX.Element;
  readonly onSelectCreator: (creator: BrowsableCreator) => void;
}

export function CreatorSourceRow(props: CreatorSourceRowProps) {
  return (
    <div class={`border border-border bg-card ${readerDensityPaddingClass(props.readerDensity)} text-card-foreground transition hover:border-ring hover:bg-accent hover:text-accent-foreground`}>
      <button
        type="button"
        class="w-full text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        aria-pressed={props.isSelected}
        data-selected={props.isSelected ? "true" : "false"}
        onClick={() => props.onSelectCreator(props.creator)}
      >
        <span class="block truncate text-xs font-semibold">{props.creator.displayName}</span>
        <span class="mt-1 flex items-center justify-between gap-2 text-[0.68rem] text-muted-foreground">
          <span class="truncate" title="Use the filter above to scope creator rows by catalog source type; select a creator to inspect its feeds.">
            Feeds
          </span>
          <Show when={props.isSubscribed}>
            <span class="shrink-0 border border-border bg-background px-1 py-0.5 text-[0.62rem] font-semibold uppercase tracking-[0.12em] text-foreground">
              Subscribed
            </span>
          </Show>
        </span>
      </button>
      <Show when={props.isAuthenticated && props.showSubscriptionControl}>
        <div class="mt-2 flex justify-end">
          {props.subscriptionControl}
        </div>
      </Show>
    </div>
  );
}

export interface PlaylistItemRowProps {
  readonly item: PlaylistItemWithContent;
  readonly itemIndex: number;
  readonly itemCount: number;
  readonly busy: boolean;
  readonly showManualControls: boolean;
  readonly onSelectContent: (contentItem: CatalogContentListItem) => Promise<void>;
  readonly onMove: (item: PlaylistItemWithContent, direction: -1 | 1) => Promise<void>;
  readonly onRemove: (item: PlaylistItemWithContent) => Promise<void>;
}

export function PlaylistItemRow(props: PlaylistItemRowProps) {
  return (
    <li class="border border-border bg-background p-2">
      <button
        type="button"
        class="w-full text-left text-foreground transition hover:text-accent-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        onClick={async () => {
          await props.onSelectContent(props.item.content);
        }}
      >
        <span class="block truncate text-[0.72rem] font-semibold">{props.item.content.title}</span>
        <span class="mt-1 block truncate text-[0.68rem] text-muted-foreground">{props.item.content.creator.displayName}</span>
      </button>
      <div class={`mt-2 grid ${props.showManualControls ? "grid-cols-3" : "grid-cols-1"} gap-1`} data-manual-reorder={props.showManualControls ? "true" : "false"}>
        <Show when={props.showManualControls}>
          <button
            type="button"
            class="border border-border bg-card px-1 py-1 text-[0.68rem] text-card-foreground transition hover:bg-accent hover:text-accent-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-60"
            disabled={props.busy || props.itemIndex === 0}
            onClick={async () => {
              await props.onMove(props.item, -1);
            }}
          >
            Up
          </button>
          <button
            type="button"
            class="border border-border bg-card px-1 py-1 text-[0.68rem] text-card-foreground transition hover:bg-accent hover:text-accent-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-60"
            disabled={props.busy || props.itemIndex === props.itemCount - 1}
            onClick={async () => {
              await props.onMove(props.item, 1);
            }}
          >
            Down
          </button>
        </Show>
        <button
          type="button"
          class="border border-border bg-card px-1 py-1 text-[0.68rem] text-destructive transition hover:bg-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-60"
          disabled={props.busy}
          onClick={async () => {
            await props.onRemove(props.item);
          }}
        >
          Remove
        </button>
      </div>
    </li>
  );
}

export interface FeedRowProps {
  readonly feed: CatalogFeed;
  readonly creatorImageUrl?: string | null;
  readonly isSelected?: boolean;
  readonly readerDensity?: ReaderDensity;
  readonly onSelectFeed?: (feed: CatalogFeed) => void;
}

export function FeedRow(props: FeedRowProps) {
  const selected = createMemo(() => props.isSelected ?? false);
  const feedTitle = createMemo(() => props.feed.title ?? props.feed.url);
  const feedUrl = createMemo(() => (props.feed.title === null ? null : props.feed.url));
  const rowClass = createMemo(() =>
    `border border-border ${readerDensityPaddingClass(props.readerDensity ?? "comfortable")} transition hover:border-ring hover:bg-accent hover:text-accent-foreground ${selected() ? "bg-card" : "bg-background"}`,
  );
  const rowBodyClass = createMemo(() =>
    props.creatorImageUrl === null || props.creatorImageUrl === undefined
      ? "min-w-0"
      : "grid grid-cols-[2.75rem_1fr] gap-2",
  );
  const content = () => (
    <span class={rowBodyClass()}>
      <Show when={props.creatorImageUrl}>
        {(imageUrl) => (
          <span class="aspect-square overflow-hidden border border-border bg-muted" data-feed-image="creator">
            <img class="h-full w-full object-cover" src={imageUrl()} alt="" loading="lazy" />
          </span>
        )}
      </Show>
      <span class="min-w-0">
        <span class="flex items-center justify-between gap-2">
          <span class="min-w-0 truncate text-[0.72rem] font-semibold text-foreground" data-feed-title>
            {feedTitle()}
          </span>
          <span data-feed-source-chip>
            <SourceIconBadge sourceType={props.feed.sourceType} context="feed" />
          </span>
        </span>
        <Show when={feedUrl()}>
          {(url) => <span class="mt-1 block truncate text-[0.68rem] text-muted-foreground" data-feed-url>{url()}</span>}
        </Show>
        <span class="mt-1 block truncate text-[0.68rem] text-muted-foreground" data-feed-refresh-metadata>
          {formatFeedRefreshMetadata(props.feed)}
        </span>
        <span class="mt-1 block truncate text-[0.68rem] text-muted-foreground" data-feed-next-refresh-metadata>
          {formatFeedNextRefreshMetadata(props.feed)}
        </span>
        <Show when={props.onSelectFeed}>
          <span class="mt-1 block text-[0.68rem] font-semibold text-muted-foreground" data-feed-action-label>
            {selected() ? "Selected feed" : "Filter feed"}
          </span>
        </Show>
      </span>
    </span>
  );

  return (
    <li class={rowClass()} data-selected={selected() ? "true" : "false"} data-selected-feed-id={selected() ? props.feed.id : ""}>
      <Show
        when={props.onSelectFeed}
        fallback={
          content()
        }
      >
        {(onSelectFeed) => (
          <button
            type="button"
            class="w-full text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            aria-pressed={selected()}
            onClick={() => onSelectFeed()(props.feed)}
          >
            {content()}
          </button>
        )}
      </Show>
    </li>
  );
}

export interface ContentListItemRowProps {
  readonly contentItem: CatalogContentListItem;
  readonly isAuthenticated: boolean;
  readonly isFavorite: boolean;
  readonly status: ContentStatusFlags;
  readonly selected: boolean;
  readonly favoritesView: boolean;
  readonly readerDensity: ReaderDensity;
  readonly targetPlaylistId: string | null;
  readonly formatError: (error: unknown) => string;
  readonly formatPublishedAt: (publishedAt: Date | null) => string;
  readonly formatDuration: (durationSeconds: number | null) => string;
  readonly onSelectContent: (contentItem: CatalogContentListItem) => Promise<void>;
  readonly onMarkOpened: (contentItemId: string) => Promise<void>;
  readonly onMarkPlayed: (contentItemId: string) => Promise<void>;
  readonly onToggleFavorite: (contentItemId: string) => Promise<void>;
  readonly onAddToPlaylist: (contentItemId: string) => Promise<void>;
}

export function ContentListItemRow(props: ContentListItemRowProps) {
  const [favoriteError, setFavoriteError] = createSignal<string | null>(null);
  const [favoriteBusy, setFavoriteBusy] = createSignal(false);
  const [statusError, setStatusError] = createSignal<string | null>(null);
  const [statusBusy, setStatusBusy] = createSignal<"opened" | "played" | null>(null);
  const [playlistBusy, setPlaylistBusy] = createSignal(false);
  const [playlistError, setPlaylistError] = createSignal<string | null>(null);
  const rowImageUrl = createMemo(() => props.contentItem.thumbnailUrl ?? props.contentItem.creator.imageUrl);
  const rowImageSource = createMemo(() => (props.contentItem.thumbnailUrl !== null ? "content" : props.contentItem.creator.imageUrl !== null ? "creator" : null));
  const contentButtonClass = createMemo(() =>
    rowImageUrl() === null
      ? "group w-full text-left text-foreground transition hover:text-accent-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      : "group grid w-full grid-cols-[4.75rem_1fr] gap-2 text-left text-foreground transition hover:text-accent-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
  );

  const toggleFavorite = async () => {
    setFavoriteBusy(true);
    setFavoriteError(null);
    try {
      await props.onToggleFavorite(props.contentItem.id);
    } catch (error) {
      setFavoriteError(props.formatError(error));
    } finally {
      setFavoriteBusy(false);
    }
  };

  const markOpened = async () => {
    setStatusBusy("opened");
    setStatusError(null);
    try {
      await props.onMarkOpened(props.contentItem.id);
    } catch (error) {
      setStatusError(props.formatError(error));
    } finally {
      setStatusBusy(null);
    }
  };

  const markPlayed = async () => {
    setStatusBusy("played");
    setStatusError(null);
    try {
      await props.onMarkPlayed(props.contentItem.id);
    } catch (error) {
      setStatusError(props.formatError(error));
    } finally {
      setStatusBusy(null);
    }
  };

  const addToPlaylist = async () => {
    setPlaylistBusy(true);
    setPlaylistError(null);
    try {
      await props.onAddToPlaylist(props.contentItem.id);
    } catch (error) {
      setPlaylistError(props.formatError(error));
    } finally {
      setPlaylistBusy(false);
    }
  };

  return (
    <div
      class={`border border-border ${readerDensityPaddingClass(props.readerDensity)} transition hover:border-ring hover:bg-accent hover:text-accent-foreground ${props.status.played ? "bg-muted" : props.status.opened ? "bg-card" : "bg-background"}`}
      data-selected={props.selected ? "true" : "false"}
      data-opened={props.status.opened ? "true" : "false"}
      data-played={props.status.played ? "true" : "false"}
      data-favorite={props.isFavorite ? "true" : "false"}
    >
      <button
        type="button"
        class={contentButtonClass()}
        aria-pressed={props.selected}
        onClick={async () => {
          await props.onSelectContent(props.contentItem);
        }}
      >
        <Show when={rowImageUrl()}>
          {(imageUrl) => (
            <span class="aspect-video overflow-hidden border border-border bg-muted" data-thumbnail-source={rowImageSource() ?? ""}>
              <img
                class="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
                src={imageUrl()}
                alt=""
                loading="lazy"
              />
            </span>
          )}
        </Show>
        <span class="min-w-0">
          <span class="flex items-start justify-between gap-2">
            <span class="min-w-0 truncate text-xs font-semibold">{props.contentItem.title}</span>
            <span data-content-source-chip data-content-source-indicator>
              <SourceIconBadge sourceType={props.contentItem.sourceType} context="content" sourceCount={props.contentItem.sourceCount} />
            </span>
          </span>
          <span class="mt-1 block truncate text-[0.68rem] text-muted-foreground">
            {props.contentItem.creator.displayName}
          </span>
          <span class="mt-1 flex items-center justify-between gap-2 text-[0.68rem] text-muted-foreground">
            <span class="truncate">{props.formatPublishedAt(props.contentItem.publishedAt)}</span>
            <span class="shrink-0">{props.formatDuration(props.contentItem.durationSeconds)}</span>
          </span>
          <Show when={props.selected || props.status.opened || props.status.played || props.isFavorite}>
            <span class="mt-1 flex items-center gap-1 text-[0.62rem] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
              <Show when={props.selected}>
                <span class="border border-border bg-background px-1 py-0.5" data-content-status="selected">Selected</span>
              </Show>
              <Show when={props.status.opened}>
                <span class="border border-border bg-background px-1 py-0.5" data-content-status="opened">Opened</span>
              </Show>
              <Show when={props.status.played}>
                <span class="border border-border bg-background px-1 py-0.5" data-content-status="played">Played</span>
              </Show>
              <Show when={props.isFavorite}>
                <span class="border border-border bg-background px-1 py-0.5" data-content-status="favorite">Favorite</span>
              </Show>
            </span>
          </Show>
        </span>
      </button>
      <Show when={props.isAuthenticated}>
        <div class="mt-2 flex items-center justify-end gap-2">
          <Show when={statusError()}>
            {(message) => <p class="min-w-0 flex-1 truncate text-[0.68rem] text-destructive">{message()}</p>}
          </Show>
          <Show when={favoriteError()}>
            {(message) => <p class="min-w-0 flex-1 truncate text-[0.68rem] text-destructive">{message()}</p>}
          </Show>
          <Show when={playlistError()}>
            {(message) => <p class="min-w-0 flex-1 truncate text-[0.68rem] text-destructive">{message()}</p>}
          </Show>
          <button
            type="button"
            class="border border-border bg-card px-2 py-1 text-[0.68rem] font-semibold text-card-foreground transition hover:bg-accent hover:text-accent-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-60"
            disabled={playlistBusy() || props.targetPlaylistId === null}
            onClick={addToPlaylist}
            data-content-row-add-playlist
          >
            Add to playlist
          </button>
          <button
            type="button"
            class="border border-border bg-card px-2 py-1 text-[0.68rem] font-semibold text-card-foreground transition hover:bg-accent hover:text-accent-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-60"
            aria-pressed={props.status.opened}
            disabled={statusBusy() !== null || props.status.opened}
            onClick={markOpened}
          >
            {props.status.opened ? "Opened" : "Mark opened"}
          </button>
          <button
            type="button"
            class="border border-border bg-card px-2 py-1 text-[0.68rem] font-semibold text-card-foreground transition hover:bg-accent hover:text-accent-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-60"
            aria-pressed={props.status.played}
            disabled={statusBusy() !== null || props.status.played}
            onClick={markPlayed}
          >
            {props.status.played ? "Played" : "Mark played"}
          </button>
          <button
            type="button"
            class="border border-border bg-card px-2 py-1 text-[0.68rem] font-semibold text-card-foreground transition hover:bg-accent hover:text-accent-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-60"
            aria-pressed={props.isFavorite}
            disabled={favoriteBusy()}
            onClick={toggleFavorite}
          >
            {props.favoritesView || props.isFavorite ? "Remove favorite" : "Favorite"}
          </button>
        </div>
      </Show>
    </div>
  );
}
