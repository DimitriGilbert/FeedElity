import type { CatalogContentListItem, CatalogFeed, PlaylistItemWithContent } from "@FeedElity/api";
import type { JSX } from "solid-js";
import { For, Show, createEffect, createMemo, createSignal, on } from "solid-js";
import ChevronDown from "lucide-solid/icons/chevron-down";
import ChevronUp from "lucide-solid/icons/chevron-up";
import CircleCheck from "lucide-solid/icons/circle-check";
import CirclePlay from "lucide-solid/icons/circle-play";
import Eye from "lucide-solid/icons/eye";
import EyeOff from "lucide-solid/icons/eye-off";
import Heart from "lucide-solid/icons/heart";
import Plus from "lucide-solid/icons/plus";
import RefreshCw from "lucide-solid/icons/refresh-cw";
import Target from "lucide-solid/icons/target";
import X from "lucide-solid/icons/x";

import {
  formatPlaybackPosition,
  formatPlaybackResumeLabel,
  formatSourceLabel,
  toCreatorSourceTypes,
  type BrowsableCreator,
  type ContentStatusFlags,
  type PlaybackPosition,
  type ReaderDensity,
} from "./app-shell.contract";
import { SourceIconBadge, SourceTypeIcon } from "./source-indicator";

function readerDensityPaddingClass(readerDensity: ReaderDensity): string {
  return readerDensity === "compact" ? "px-2 py-1" : "px-2 py-1.5";
}

function creatorInitials(displayName: string): string {
  const parts = displayName.trim().split(/\s+/).filter((part) => part.length > 0);
  if (parts.length === 0) {
    return "?";
  }

  if (parts.length === 1) {
    return parts[0]?.slice(0, 2).toUpperCase() ?? "?";
  }

  const first = parts[0];
  const last = parts[parts.length - 1];
  if (first === undefined || last === undefined) {
    return "?";
  }

  return `${first.slice(0, 1)}${last.slice(0, 1)}`.toUpperCase();
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
  readonly refreshBusy: boolean;
  readonly readerDensity: ReaderDensity;
  // Unread count accessor for the library-mode badge; null (or an omitted
  // accessor) means not applicable (anonymous user, catalog mode, or no data
  // yet) and renders nothing. The column only passes a live accessor when the
  // mode is "library" and the user is authenticated.
  readonly unreadCount?: () => number | null;
  readonly markReadBusy?: boolean;
  readonly onMarkCreatorRead?: (creatorId: string) => Promise<void>;
  readonly subscriptionControl: JSX.Element;
  readonly onSelectCreator: (creator: BrowsableCreator) => void;
  readonly onForceRefreshCreator: (creatorId: string) => Promise<void>;
}

export function CreatorSourceRow(props: CreatorSourceRowProps) {
  const creatorRowClass = createMemo(() =>
    `group relative border-b border-border ${readerDensityPaddingClass(props.readerDensity)} transition hover:bg-accent hover:text-accent-foreground ${props.isSelected ? "bg-selected text-selected-foreground ring-1 ring-ring ring-inset hover:bg-selected hover:text-selected-foreground" : "text-card-foreground"}`,
  );
  const sourceTypes = createMemo(() => toCreatorSourceTypes(props.creator));
  const sourceBadgesLabel = createMemo(() =>
    `Sources: ${sourceTypes().map((sourceType) => formatSourceLabel(sourceType)).join(" + ")}`,
  );
  const unreadCount = createMemo(() => props.unreadCount?.() ?? null);
  const showUnreadBadge = createMemo(() => {
    const count = unreadCount();
    return count !== null && count > 0;
  });
  const unreadBadgeLabel = createMemo(() => `${unreadCount() ?? 0} unread video${unreadCount() === 1 ? "" : "s"}`);

  return (
    <div
      class={creatorRowClass()}
      data-selected={props.isSelected ? "true" : "false"}
      aria-current={props.isSelected ? "true" : undefined}
    >
      <Show when={props.isSelected}>
        <span class="absolute inset-y-1 left-0 w-0.5 rounded-full bg-ring" aria-hidden="true" />
      </Show>
      <div class="flex items-center justify-between gap-2">
        <button
          type="button"
          class="flex min-w-0 flex-1 items-center gap-2 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          aria-pressed={props.isSelected}
          onClick={() => props.onSelectCreator(props.creator)}
        >
          <Show
            when={props.creator.imageUrl}
            fallback={
              <span
                class="flex h-6 w-6 shrink-0 items-center justify-center overflow-hidden rounded-full border border-border bg-muted text-[0.6rem] font-semibold text-muted-foreground"
                aria-hidden="true"
                data-creator-avatar-fallback
              >
                {creatorInitials(props.creator.displayName)}
              </span>
            }
          >
            {(imageUrl) => (
              <span class="h-6 w-6 shrink-0 overflow-hidden rounded-full border border-border bg-muted">
                <img class="h-full w-full object-cover" src={imageUrl()} alt="" loading="lazy" />
              </span>
            )}
          </Show>
          <span class="block truncate text-sm font-semibold">{props.creator.displayName}</span>
          <Show when={showUnreadBadge()}>
            <span
              class="shrink-0 rounded-full border border-border bg-muted px-1.5 py-0.5 text-[0.62rem] font-semibold tabular-nums text-muted-foreground"
              aria-label={unreadBadgeLabel()}
              title={unreadBadgeLabel()}
              data-creator-unread-count
            >
              {unreadCount() ?? 0}
            </span>
          </Show>
          <Show when={sourceTypes().length > 0}>
            <span
              class="flex shrink-0 items-center gap-0.5 text-muted-foreground"
              role="img"
              aria-label={sourceBadgesLabel()}
              title={sourceBadgesLabel()}
              data-creator-source-badges
            >
              <For each={sourceTypes()}>{(sourceType) => <SourceTypeIcon sourceType={sourceType} />}</For>
            </span>
          </Show>
        </button>
        <Show when={props.isAuthenticated}>
          <div class="pointer-events-none flex items-center gap-1 opacity-0 transition-opacity delay-100 duration-100 group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100">
            <button
              type="button"
              class="shrink-0 rounded-md border border-border bg-background p-1 text-muted-foreground transition hover:bg-accent hover:text-accent-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-60"
              aria-label={`Force refresh ${props.creator.displayName}`}
              title="Force refresh this source"
              data-refresh-creator={props.creator.id}
              disabled={props.refreshBusy}
              onClick={(event) => {
                event.stopPropagation();
                void props.onForceRefreshCreator(props.creator.id);
              }}
            >
              <RefreshCw size={13} class={props.refreshBusy ? "animate-spin" : ""} />
            </button>
            <Show when={showUnreadBadge() && props.onMarkCreatorRead !== undefined}>
              <button
                type="button"
                class="shrink-0 rounded-md border border-border bg-background p-1 text-muted-foreground transition hover:bg-accent hover:text-accent-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-60"
                aria-label={`Mark ${props.creator.displayName} as read`}
                title={`Mark ${props.creator.displayName} as read`}
                data-mark-creator-read={props.creator.id}
                disabled={props.markReadBusy}
                onClick={(event) => {
                  event.stopPropagation();
                  void props.onMarkCreatorRead?.(props.creator.id);
                }}
              >
                <CircleCheck size={13} aria-hidden="true" />
              </button>
            </Show>
            <Show when={props.showSubscriptionControl}>
              <span class="flex items-center">{props.subscriptionControl}</span>
            </Show>
          </div>
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
    <li class="border-b border-border p-2">
      <button
        type="button"
        class="w-full text-left text-foreground transition hover:text-accent-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        onClick={async () => {
          await props.onSelectContent(props.item.content);
        }}
      >
        <span class="block truncate text-sm font-semibold">{props.item.content.title}</span>
        <span class="mt-0.5 block truncate text-xs text-muted-foreground">{props.item.content.creator.displayName}</span>
      </button>
      <div class={`mt-2 grid ${props.showManualControls ? "grid-cols-3" : "grid-cols-1"} gap-1`} data-manual-reorder={props.showManualControls ? "true" : "false"}>
        <Show when={props.showManualControls}>
          <button
            type="button"
            class="inline-flex items-center justify-center rounded-md border border-border bg-card p-1 text-card-foreground transition hover:bg-accent hover:text-accent-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-60"
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
            class="inline-flex items-center justify-center rounded-md border border-border bg-card p-1 text-card-foreground transition hover:bg-accent hover:text-accent-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-60"
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
          class="inline-flex items-center justify-center rounded-md border border-border bg-card p-1 text-destructive transition hover:bg-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-60"
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
    `relative border-b border-border ${readerDensityPaddingClass(props.readerDensity ?? "comfortable")} transition hover:bg-accent hover:text-accent-foreground ${selected() ? "bg-selected text-selected-foreground hover:bg-selected hover:text-selected-foreground" : "bg-background"}`,
  );
  const rowBodyClass = createMemo(() =>
    props.creatorImageUrl === null || props.creatorImageUrl === undefined
      ? "min-w-0"
      : "grid grid-cols-[2.75rem_1fr] gap-2",
  );
  const content = () => (
    <span class={rowBodyClass()}>
      <Show when={selected()}>
        <span class="absolute inset-y-1 left-0 w-0.5 rounded-full bg-ring" aria-hidden="true" />
      </Show>
      <Show when={props.creatorImageUrl}>
        {(imageUrl) => (
          <span class="aspect-square overflow-hidden rounded-md border border-border bg-muted" data-feed-image="creator">
            <img class="h-full w-full object-cover" src={imageUrl()} alt="" loading="lazy" />
          </span>
        )}
      </Show>
      <span class="min-w-0">
        <span class="flex items-center justify-between gap-2">
          <span class="min-w-0 truncate text-sm font-semibold text-foreground" data-feed-title>
            {feedTitle()}
          </span>
          <span data-feed-source-chip>
            <SourceIconBadge sourceType={props.feed.sourceType} context="feed" />
          </span>
        </span>
        <Show when={feedUrl()}>
          {(url) => <span class="mt-0.5 block truncate text-xs text-muted-foreground" data-feed-url>{url()}</span>}
        </Show>
        <span class="mt-0.5 block truncate text-xs text-muted-foreground" data-feed-refresh-metadata>
          {formatFeedRefreshMetadata(props.feed)}
        </span>
        <span class="block truncate text-xs text-muted-foreground" data-feed-next-refresh-metadata>
          {formatFeedNextRefreshMetadata(props.feed)}
        </span>
        <Show when={props.onSelectFeed}>
          <span class="mt-0.5 block text-xs font-semibold text-muted-foreground" data-feed-action-label>
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
  readonly isAuthenticated: () => boolean;
  readonly isFavorite: () => boolean;
  readonly status: () => ContentStatusFlags;
  readonly playbackPosition: () => PlaybackPosition | null;
  readonly selected: () => boolean;
  // Keyboard-active row (j/k): renders the SAME highlight classes as
  // selected() but never claims selection semantics — data-active marks it,
  // aria-current stays reserved for the actually-selected row.
  readonly active: () => boolean;
  readonly favoritesView: () => boolean;
  readonly readerDensity: () => ReaderDensity;
  readonly targetPlaylistId: () => string | null;
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
  const mirrorCountLabel = createMemo(() => {
    const count = props.contentItem.mirrorCount;
    return `This video also appears on ${count} other source${count === 1 ? "" : "s"}; open it to switch.`;
  });

  const isAuthenticated = createMemo(() => props.isAuthenticated());
  const isFavorite = createMemo(() => props.isFavorite());
  const status = createMemo(() => props.status());
  const playbackPosition = createMemo(() => props.playbackPosition());
  const selected = createMemo(() => props.selected());
  const active = createMemo(() => props.active());
  const favoritesView = createMemo(() => props.favoritesView());
  const readerDensity = createMemo(() => props.readerDensity());
  const targetPlaylistId = createMemo(() => props.targetPlaylistId());

  createEffect(on(() => [props.contentItem.id, isFavorite()], () => setFavoriteError(null)));
  createEffect(on(() => [props.contentItem.id, status().opened, status().played], () => setStatusError(null)));
  createEffect(on(() => [props.contentItem.id, targetPlaylistId()], () => setPlaylistError(null)));
  const contentButtonClass = createMemo(() =>
    rowImageUrl() === null
      ? "w-full text-left text-foreground transition hover:text-accent-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      : "grid w-full grid-cols-[7rem_1fr] gap-2 text-left text-foreground transition hover:text-accent-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
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
      class={`group relative border-b border-border ${readerDensityPaddingClass(readerDensity())} transition hover:bg-accent hover:text-accent-foreground ${selected() || active() ? "bg-selected text-selected-foreground hover:bg-selected hover:text-selected-foreground" : status().played ? "bg-muted" : status().opened ? "bg-card" : "bg-background"}`}
      data-selected={selected() ? "true" : "false"}
      data-active={active() ? "true" : "false"}
      data-opened={status().opened ? "true" : "false"}
      data-played={status().played ? "true" : "false"}
      data-favorite={isFavorite() ? "true" : "false"}
    >
      <Show when={selected()}>
        <span class="absolute inset-y-1 left-0 w-0.5 rounded-full bg-ring" aria-hidden="true" />
      </Show>
      <button
        type="button"
        class={contentButtonClass()}
        aria-pressed={selected()}
        title={props.contentItem.title}
        onClick={async () => {
          await props.onSelectContent(props.contentItem);
        }}
      >
        <Show when={rowImageUrl()}>
          {(imageUrl) => (
            <span class="aspect-video overflow-hidden rounded-md border border-border bg-muted" data-thumbnail-source={rowImageSource() ?? ""}>
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
          <span class="block truncate text-sm font-semibold">{props.contentItem.title}</span>
          <span class="mt-0.5 block truncate text-xs text-muted-foreground">
            {props.contentItem.creator.displayName}
          </span>
          <span class="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
            <span class="truncate">{props.formatPublishedAt(props.contentItem.publishedAt)}</span>
            <Show
              when={playbackPosition()}
              fallback={
                <Show when={props.contentItem.durationSeconds !== null}>
                  <span class="shrink-0 tabular-nums">{props.formatDuration(props.contentItem.durationSeconds)}</span>
                </Show>
              }
            >
              {(position) => (
                <span
                  class="shrink-0 tabular-nums"
                  data-content-playback-progress
                  aria-label={formatPlaybackResumeLabel(position())}
                >
                  {formatPlaybackPosition(position())}
                </span>
              )}
            </Show>
            <Show when={selected()}>
              <Target size={12} class="text-selected-foreground" data-content-status="selected" aria-label="Selected" />
            </Show>
            <Show when={status().opened}>
              <EyeOff size={12} data-content-status="opened" aria-label="Opened" />
            </Show>
            <Show when={status().played}>
              <CircleCheck size={12} data-content-status="played" aria-label="Played" />
            </Show>
            <Show when={isFavorite()}>
              <Heart size={12} class="text-primary" data-content-status="favorite" aria-label="Favorite" />
            </Show>
            <span data-content-source-chip>
              <span data-content-source-indicator>
                <SourceIconBadge sourceType={props.contentItem.sourceType} context="content" sourceCount={props.contentItem.sourceCount} />
              </span>
              <Show when={props.contentItem.mirrorCount > 0}>
                <span
                  class="text-[0.62rem] font-semibold tabular-nums text-muted-foreground"
                  role="img"
                  aria-label={mirrorCountLabel()}
                  title={mirrorCountLabel()}
                  data-content-mirror-count
                >
                  +{props.contentItem.mirrorCount}
                </span>
              </Show>
            </span>
          </span>
        </span>
      </button>
      <Show when={isAuthenticated()}>
        <div
          class="pointer-events-none absolute bottom-1 right-1 flex items-center justify-end gap-1 opacity-0 transition-opacity duration-150 group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100"
          data-content-row-actions
        >
          <Show when={statusError()}>
            {(message) => <p class="pointer-events-none min-w-0 max-w-[8rem] truncate text-xs text-destructive">{message()}</p>}
          </Show>
          <Show when={favoriteError()}>
            {(message) => <p class="pointer-events-none min-w-0 max-w-[8rem] truncate text-xs text-destructive">{message()}</p>}
          </Show>
          <Show when={playlistError()}>
            {(message) => <p class="pointer-events-none min-w-0 max-w-[8rem] truncate text-xs text-destructive">{message()}</p>}
          </Show>
          <div class="flex items-center gap-1">
            <button
              type="button"
              class="rounded-md border border-border bg-card p-1 text-card-foreground transition hover:bg-accent hover:text-accent-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-60"
              aria-label="Add to playlist"
              title="Add to playlist"
              disabled={playlistBusy() || targetPlaylistId() === null}
              onClick={addToPlaylist}
              data-content-row-add-playlist
            >
              <Plus size={12} />
            </button>
            <button
              type="button"
              class="rounded-md border border-border bg-card p-1 text-card-foreground transition hover:bg-accent hover:text-accent-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-60"
              aria-pressed={status().opened}
              aria-label={status().opened ? "Unmark opened" : "Mark opened"}
              title={status().opened ? "Unmark opened" : "Mark opened"}
              disabled={statusBusy() !== null}
              onClick={markOpened}
            >
              {status().opened ? <EyeOff size={12} /> : <Eye size={12} />}
            </button>
            <button
              type="button"
              class="rounded-md border border-border bg-card p-1 text-card-foreground transition hover:bg-accent hover:text-accent-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-60"
              aria-pressed={status().played}
              aria-label={status().played ? "Unmark played" : "Mark played"}
              title={status().played ? "Unmark played" : "Mark played"}
              disabled={statusBusy() !== null}
              onClick={markPlayed}
            >
              {status().played ? <CircleCheck size={12} /> : <CirclePlay size={12} />}
            </button>
            <button
              type="button"
              class="rounded-md border border-border bg-card p-1 text-card-foreground transition hover:bg-accent hover:text-accent-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-60"
              aria-pressed={isFavorite()}
              aria-label={favoritesView() || isFavorite() ? "Remove favorite" : "Favorite"}
              title={favoritesView() || isFavorite() ? "Remove favorite" : "Favorite"}
              disabled={favoriteBusy()}
              onClick={toggleFavorite}
            >
              <Heart size={12} />
            </button>
          </div>
        </div>
      </Show>
    </div>
  );
}
