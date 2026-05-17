import type { CatalogContentListItem, CatalogFeed, PlaylistItemWithContent } from "@FeedElity/api";
import type { JSX } from "solid-js";
import { Show, createEffect, createMemo, createSignal, on } from "solid-js";
import ChevronDown from "lucide-solid/icons/chevron-down";
import ChevronUp from "lucide-solid/icons/chevron-up";
import CircleCheck from "lucide-solid/icons/circle-check";
import CirclePlay from "lucide-solid/icons/circle-play";
import Eye from "lucide-solid/icons/eye";
import EyeOff from "lucide-solid/icons/eye-off";
import Heart from "lucide-solid/icons/heart";
import Plus from "lucide-solid/icons/plus";
import Target from "lucide-solid/icons/target";
import X from "lucide-solid/icons/x";

import type { BrowsableCreator, ContentStatusFlags, ReaderDensity } from "./app-shell.contract";
import { SourceIconBadge } from "./source-indicator";

function readerDensityPaddingClass(readerDensity: ReaderDensity): string {
  return readerDensity === "compact" ? "px-1 py-1" : "px-1 py-1.5";
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
  const creatorRowClass = createMemo(() =>
    `group border-t border-border ${readerDensityPaddingClass(props.readerDensity)} transition hover:border-ring hover:bg-accent hover:text-accent-foreground ${props.isSelected ? "bg-selected text-selected-foreground hover:bg-selected hover:text-selected-foreground" : "text-card-foreground"}`,
  );

  return (
    <div class={creatorRowClass()} data-selected={props.isSelected ? "true" : "false"}>
      <div class="flex items-center justify-between gap-2">
        <button
          type="button"
          class="flex min-w-0 flex-1 items-center gap-1.5 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          aria-pressed={props.isSelected}
          onClick={() => props.onSelectCreator(props.creator)}
        >
          <Show when={props.creator.imageUrl}>
            {(imageUrl) => (
              <span class="h-4 w-4 shrink-0 overflow-hidden rounded-full border border-border bg-muted">
                <img class="h-full w-full object-cover" src={imageUrl()} alt="" loading="lazy" />
              </span>
            )}
          </Show>
          <span class="block truncate text-xs font-semibold">{props.creator.displayName}</span>
        </button>
        <Show when={props.isAuthenticated && props.showSubscriptionControl}>
          <span class="opacity-0 transition-opacity delay-100 duration-100 group-hover:opacity-100">{props.subscriptionControl}</span>
        </Show>
      </div>
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
    <li class="border-t border-border p-2">
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
            class="inline-flex items-center justify-center rounded-sm border border-border bg-card p-1 text-card-foreground transition hover:bg-accent hover:text-accent-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-60"
            aria-label="Move up"
            title="Move up"
            disabled={props.busy || props.itemIndex === 0}
            onClick={async () => {
              await props.onMove(props.item, -1);
            }}
          >
            <ChevronUp size={14} />
          </button>
          <button
            type="button"
            class="inline-flex items-center justify-center rounded-sm border border-border bg-card p-1 text-card-foreground transition hover:bg-accent hover:text-accent-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-60"
            aria-label="Move down"
            title="Move down"
            disabled={props.busy || props.itemIndex === props.itemCount - 1}
            onClick={async () => {
              await props.onMove(props.item, 1);
            }}
          >
            <ChevronDown size={14} />
          </button>
        </Show>
        <button
          type="button"
          class="inline-flex items-center justify-center rounded-sm border border-border bg-card p-1 text-destructive transition hover:bg-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-60"
          aria-label="Remove from playlist"
          title="Remove from playlist"
          disabled={props.busy}
          onClick={async () => {
            await props.onRemove(props.item);
          }}
        >
          <X size={14} />
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
    `border-t border-border ${readerDensityPaddingClass(props.readerDensity ?? "comfortable")} transition hover:border-ring hover:bg-accent hover:text-accent-foreground ${selected() ? "bg-selected text-selected-foreground hover:bg-selected hover:text-selected-foreground" : "bg-background"}`,
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

  createEffect(on(() => [props.contentItem.id, props.isFavorite], () => setFavoriteError(null)));
  createEffect(on(() => [props.contentItem.id, props.status.opened, props.status.played], () => setStatusError(null)));
  createEffect(on(() => [props.contentItem.id, props.targetPlaylistId], () => setPlaylistError(null)));
  const contentButtonClass = createMemo(() =>
    rowImageUrl() === null
      ? "w-full text-left text-foreground transition hover:text-accent-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      : "grid w-full grid-cols-[7.5rem_1fr] gap-2 text-left text-foreground transition hover:text-accent-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
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
      class={`group border-t border-border ${readerDensityPaddingClass(props.readerDensity)} transition hover:border-ring hover:bg-accent hover:text-accent-foreground ${props.selected ? "bg-selected text-selected-foreground hover:bg-selected hover:text-selected-foreground" : props.status.played ? "bg-muted" : props.status.opened ? "bg-card" : "bg-background"}`}
      data-selected={props.selected ? "true" : "false"}
      data-opened={props.status.opened ? "true" : "false"}
      data-played={props.status.played ? "true" : "false"}
      data-favorite={props.isFavorite ? "true" : "false"}
    >
      <button
        type="button"
        class={contentButtonClass()}
        aria-pressed={props.selected}
        title={props.contentItem.title}
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
          <span class="block truncate text-xs font-semibold">{props.contentItem.title}</span>
          <span class="mt-0.5 block truncate text-[0.68rem] text-muted-foreground">
            {props.contentItem.creator.displayName}
          </span>
          <span class="mt-0.5 flex items-center gap-1.5 text-[0.68rem] text-muted-foreground">
            <span class="truncate">{props.formatPublishedAt(props.contentItem.publishedAt)}</span>
            <Show when={props.contentItem.durationSeconds !== null}>
              <span class="shrink-0">{props.formatDuration(props.contentItem.durationSeconds)}</span>
            </Show>
            <Show when={props.selected}>
              <Target size={12} class="text-selected-foreground" data-content-status="selected" aria-label="Selected" />
            </Show>
            <Show when={props.status.opened}>
              <EyeOff size={12} data-content-status="opened" aria-label="Opened" />
            </Show>
            <Show when={props.status.played}>
              <CircleCheck size={12} data-content-status="played" aria-label="Played" />
            </Show>
            <Show when={props.isFavorite}>
              <Heart size={12} class="text-primary" data-content-status="favorite" aria-label="Favorite" />
            </Show>
            <SourceIconBadge sourceType={props.contentItem.sourceType} context="content" sourceCount={props.contentItem.sourceCount} />
          </span>
        </span>
      </button>
      <Show when={props.isAuthenticated}>
        <div class="grid grid-rows-[0fr] opacity-0 transition-all duration-150 delay-100 ease-in-out group-hover:grid-rows-[1fr] group-hover:opacity-100">
          <div class="overflow-hidden">
            <div class="flex items-center justify-end gap-1 pt-1">
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
                class="rounded-sm border border-border bg-card p-1 text-card-foreground transition hover:bg-accent hover:text-accent-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-60"
                aria-label="Add to playlist"
                title="Add to playlist"
                disabled={playlistBusy() || props.targetPlaylistId === null}
                onClick={addToPlaylist}
                data-content-row-add-playlist
              >
                <Plus size={12} />
              </button>
              <button
                type="button"
                class="rounded-sm border border-border bg-card p-1 text-card-foreground transition hover:bg-accent hover:text-accent-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-60"
                aria-pressed={props.status.opened}
                aria-label={props.status.opened ? "Unmark opened" : "Mark opened"}
                title={props.status.opened ? "Unmark opened" : "Mark opened"}
                disabled={statusBusy() !== null}
                onClick={markOpened}
              >
                {props.status.opened ? <EyeOff size={12} /> : <Eye size={12} />}
              </button>
              <button
                type="button"
                class="rounded-sm border border-border bg-card p-1 text-card-foreground transition hover:bg-accent hover:text-accent-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-60"
                aria-pressed={props.status.played}
                aria-label={props.status.played ? "Unmark played" : "Mark played"}
                title={props.status.played ? "Unmark played" : "Mark played"}
                disabled={statusBusy() !== null}
                onClick={markPlayed}
              >
                {props.status.played ? <CircleCheck size={12} /> : <CirclePlay size={12} />}
              </button>
              <button
                type="button"
                class="rounded-sm border border-border bg-card p-1 text-card-foreground transition hover:bg-accent hover:text-accent-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-60"
                aria-pressed={props.isFavorite}
                aria-label={props.favoritesView || props.isFavorite ? "Remove favorite" : "Favorite"}
                title={props.favoritesView || props.isFavorite ? "Remove favorite" : "Favorite"}
                disabled={favoriteBusy()}
                onClick={toggleFavorite}
              >
                <Heart size={12} />
              </button>
            </div>
          </div>
        </div>
      </Show>
    </div>
  );
}
