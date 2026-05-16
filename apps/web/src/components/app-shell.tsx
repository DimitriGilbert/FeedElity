import type {
  CatalogContentDetail,
  CatalogContentListItem,
  CatalogContentSource,
  CatalogCreator,
  CatalogFeed,
  SourceType,
} from "@FeedElity/api";
import { For, Match, Show, Switch, createEffect, createMemo, createResource, createSignal } from "solid-js";

import { client } from "@/utils/orpc";

export interface ShellColumnDefinition {
  readonly id: "creators" | "content" | "viewer";
  readonly title: string;
  readonly description: string;
}

interface CreatorListInput {
  readonly search?: string;
  readonly limit: number;
}

interface ContentListInput {
  readonly search?: string;
  readonly creatorId?: string;
  readonly sourceType?: SourceType;
  readonly limit: number;
}

export interface ShellSelectionState {
  readonly selectedCreatorId: string | null;
}

export interface ShellContentSelectionState extends ShellSelectionState {
  readonly selectedContentItemId: string | null;
}

export const creatorSearchInputId = "creator-source-search";

export const creatorListLimit = 50;

export const contentListLimit = 50;

export const contentSearchInputId = "content-list-search";

export const contentSourceFilterId = "content-source-filter";

const allContentSourceFilterValue = "all";

const sourceFilterOptions: readonly SourceType[] = ["youtube", "odysee", "peertube"];

const sourceLabels: Record<CatalogCreator["sourceType"], string> = {
  youtube: "YouTube",
  odysee: "Odysee",
  peertube: "PeerTube",
};

type PlaybackKind = "embed" | "native";

export interface PlayableSource {
  readonly id: string;
  readonly sourceType: SourceType;
  readonly label: string;
  readonly kind: PlaybackKind;
  readonly url: string;
  readonly canonicalUrl: string;
  readonly priority: number;
}

export const shellPaneIds = ["creators", "content", "viewer"] as const;

export const desktopShellGridClass = "lg:grid-cols-[1fr_3fr_8fr]";

export const shellRootClass = "h-full w-dvw overflow-x-hidden bg-background text-foreground lg:min-h-0";

export const shellGridClass = `flex min-h-full w-full flex-col lg:grid lg:min-h-0 ${desktopShellGridClass} lg:overflow-hidden`;

export const hasInternalAppHeader = false;

export const shellColumns: readonly ShellColumnDefinition[] = [
  {
    id: "creators",
    title: "Sources",
    description: "Compact creator and feed navigation.",
  },
  {
    id: "content",
    title: "Feed",
    description: "Scan list for videos from the selected source.",
  },
  {
    id: "viewer",
    title: "Viewer",
    description: "Large selected-video reading and playback surface.",
  },
] as const;

export function getShellColumnCount() {
  return shellColumns.length;
}

export function toCreatorListInput(search: string): CreatorListInput {
  const trimmedSearch = search.trim();
  if (trimmedSearch.length === 0) {
    return { limit: creatorListLimit };
  }

  return { search: trimmedSearch, limit: creatorListLimit };
}

export function toContentListInput(search: string, creatorId: string | null, sourceType: SourceType | null): ContentListInput {
  const trimmedSearch = search.trim();
  return {
    ...(trimmedSearch.length === 0 ? {} : { search: trimmedSearch }),
    ...(creatorId === null ? {} : { creatorId }),
    ...(sourceType === null ? {} : { sourceType }),
    limit: contentListLimit,
  };
}

export function toShellSelectionState(selectedCreatorId: string | null): ShellSelectionState {
  return { selectedCreatorId };
}

export function toShellContentSelectionState(
  selectedCreatorId: string | null,
  selectedContentItemId: string | null,
): ShellContentSelectionState {
  return { selectedCreatorId, selectedContentItemId };
}

function formatSourceLabel(sourceType: CatalogCreator["sourceType"]): string {
  return sourceLabels[sourceType];
}

function formatError(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }

  return "Catalog request failed.";
}

function formatPublishedAt(publishedAt: Date | null): string {
  if (publishedAt === null) {
    return "Undated";
  }

  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric" }).format(publishedAt);
}

function formatDuration(durationSeconds: number | null): string {
  if (durationSeconds === null) {
    return "Video";
  }

  const hours = Math.floor(durationSeconds / 3_600);
  const minutes = Math.floor((durationSeconds % 3_600) / 60);
  const seconds = durationSeconds % 60;

  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;
  }

  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

export function toSafePlaybackUrl(value: string | null): string | null {
  if (value === null) {
    return null;
  }

  try {
    const url = new URL(value);
    if (url.protocol !== "https:") {
      return null;
    }

    return url.toString();
  } catch {
    return null;
  }
}

export function toPlayableSources(sources: readonly CatalogContentSource[]): readonly PlayableSource[] {
  return sources
    .map((source): PlayableSource | null => {
      const nativeMediaUrl = toSafePlaybackUrl(source.nativeMediaUrl);
      if (nativeMediaUrl !== null) {
        return {
          id: source.id,
          sourceType: source.sourceType,
          label: `${formatSourceLabel(source.sourceType)} media`,
          kind: "native",
          url: nativeMediaUrl,
          canonicalUrl: source.canonicalUrl,
          priority: source.priority,
        };
      }

      if (source.sourceType !== "youtube" && source.sourceType !== "peertube") {
        return null;
      }

      const embedUrl = toSafePlaybackUrl(source.embedUrl);
      if (embedUrl === null) {
        return null;
      }

      return {
        id: source.id,
        sourceType: source.sourceType,
        label: `${formatSourceLabel(source.sourceType)} embed`,
        kind: "embed",
        url: embedUrl,
        canonicalUrl: source.canonicalUrl,
        priority: source.priority,
      };
    })
    .filter((source): source is PlayableSource => source !== null)
    .sort((left, right) => left.priority - right.priority);
}

function toSourceFilterValue(value: string): SourceType | null {
  return sourceFilterOptions.find((sourceType) => sourceType === value) ?? null;
}

interface CreatorSourceColumnProps {
  readonly selectedCreatorId: () => string | null;
  readonly selectedCreator: () => CatalogCreator | null;
  readonly onSelectCreator: (creator: CatalogCreator) => void;
}

function CreatorSourceColumn(props: CreatorSourceColumnProps) {
  const [search, setSearch] = createSignal("");
  const [creators] = createResource(
    () => toCreatorListInput(search()),
    (input) => client.catalog.creators(input),
  );
  const [feeds] = createResource(props.selectedCreatorId, (creatorId) =>
    client.catalog.feeds({ creatorId, limit: 25 }),
  );
  const creatorCount = createMemo(() => creators()?.length ?? 0);

  return (
    <section
      aria-labelledby="creator-source-title"
      class="min-h-[12rem] border-b border-border bg-muted lg:min-h-0 lg:overflow-y-auto lg:border-b-0 lg:border-r"
      data-shell-column="creators"
    >
      <div class="space-y-2 border-b border-border px-2 py-2">
        <div class="flex items-center justify-between gap-2">
          <h2 id="creator-source-title" class="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            Sources
          </h2>
          <span class="text-[0.68rem] text-muted-foreground" data-creator-count>
            {creatorCount()} shown
          </span>
        </div>
        <label class="sr-only" for={creatorSearchInputId}>
          Search creators
        </label>
        <input
          id={creatorSearchInputId}
          class="w-full border border-input bg-background px-2 py-1.5 text-xs text-foreground outline-none transition focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring"
          type="search"
          value={search()}
          placeholder="Search creators"
          autocomplete="off"
          onInput={(event) => setSearch(event.currentTarget.value)}
        />
      </div>
      <div class="px-2 py-2">
        <Switch>
          <Match when={creators.loading}>
            <p class="text-xs font-semibold text-foreground">Loading sources</p>
            <p class="mt-2 text-[0.72rem] leading-5 text-muted-foreground">Loading the public catalog.</p>
          </Match>
          <Match when={creators.error !== undefined}>
            <p class="text-xs font-semibold text-destructive">Sources unavailable</p>
            <p class="mt-2 text-[0.72rem] leading-5 text-muted-foreground">{formatError(creators.error)}</p>
          </Match>
          <Match when={(creators()?.length ?? 0) === 0}>
            <p class="text-xs font-semibold text-foreground">No sources found</p>
            <p class="mt-2 text-[0.72rem] leading-5 text-muted-foreground">
              {search().trim().length === 0
                ? "The public catalog has no creators yet."
                : "No creators match this search."}
            </p>
          </Match>
          <Match when={creators()}>
            {(loadedCreators) => (
              <ol class="space-y-1" aria-label="Creator sources">
                <For each={loadedCreators()}>
                  {(creator) => (
                    <li>
                      <button
                        type="button"
                        class="w-full border border-border bg-card px-2 py-2 text-left text-card-foreground transition hover:border-ring hover:bg-accent hover:text-accent-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                        aria-pressed={props.selectedCreatorId() === creator.id}
                        data-selected={props.selectedCreatorId() === creator.id ? "true" : "false"}
                        onClick={() => props.onSelectCreator(creator)}
                      >
                        <span class="block truncate text-xs font-semibold">{creator.displayName}</span>
                        <span class="mt-1 block truncate text-[0.68rem] text-muted-foreground">
                          {formatSourceLabel(creator.sourceType)}
                        </span>
                      </button>
                    </li>
                  )}
                </For>
              </ol>
            )}
          </Match>
        </Switch>
      </div>
      <Show when={props.selectedCreator()}>
        {(creator) => (
          <aside class="border-t border-border px-2 py-2" aria-label="Selected source feeds">
            <p class="truncate text-xs font-semibold text-foreground">{creator().displayName}</p>
            <Switch>
              <Match when={feeds.loading}>
                <p class="mt-2 text-[0.72rem] leading-5 text-muted-foreground">Loading feeds.</p>
              </Match>
              <Match when={feeds.error !== undefined}>
                <p class="mt-2 text-[0.72rem] leading-5 text-destructive">Feeds unavailable.</p>
              </Match>
              <Match when={(feeds()?.length ?? 0) === 0}>
                <p class="mt-2 text-[0.72rem] leading-5 text-muted-foreground">No feeds are attached to this creator.</p>
              </Match>
              <Match when={feeds()}>
                {(loadedFeeds) => (
                  <ul class="mt-2 space-y-1" aria-label="Feeds for selected creator">
                    <For each={loadedFeeds()}>{(feed) => <FeedRow feed={feed} />}</For>
                  </ul>
                )}
              </Match>
            </Switch>
          </aside>
        )}
      </Show>
    </section>
  );
}

interface FeedRowProps {
  readonly feed: CatalogFeed;
}

function FeedRow(props: FeedRowProps) {
  return (
    <li class="border border-border bg-background px-2 py-1.5">
      <p class="truncate text-[0.72rem] font-semibold text-foreground">{props.feed.title ?? props.feed.url}</p>
      <p class="mt-1 truncate text-[0.68rem] text-muted-foreground">{formatSourceLabel(props.feed.sourceType)}</p>
    </li>
  );
}

interface ContentListColumnProps {
  readonly selectedCreator: () => CatalogCreator | null;
  readonly selectedContentItemId: () => string | null;
  readonly onSelectContent: (contentItem: CatalogContentListItem) => void;
}

function ContentListColumn(props: ContentListColumnProps) {
  const [search, setSearch] = createSignal("");
  const [sourceType, setSourceType] = createSignal<SourceType | null>(null);
  const contentListInput = createMemo(() => toContentListInput(search(), props.selectedCreator()?.id ?? null, sourceType()));
  const [contentItems] = createResource(contentListInput, (input) => client.catalog.contentItems(input));
  const contentCount = createMemo(() => contentItems()?.length ?? 0);

  return (
    <section
      aria-labelledby="content-list-title"
      class="min-h-[18rem] border-b border-border bg-card lg:min-h-0 lg:overflow-y-auto lg:border-b-0 lg:border-r"
      data-shell-column="content"
      data-selected-creator-id={props.selectedCreator()?.id ?? ""}
    >
      <div class="border-b border-border px-3 py-2">
        <div class="flex items-center justify-between gap-3">
          <h2 id="content-list-title" class="text-sm font-semibold tracking-tight text-card-foreground">
            Feed
          </h2>
          <span class="min-w-0 truncate border border-border bg-background px-2 py-1 text-[0.68rem] text-muted-foreground">
            {props.selectedCreator()?.displayName ?? "All sources"}
          </span>
        </div>
        <div class="mt-2 grid grid-cols-[1fr_auto] gap-2">
          <label class="sr-only" for={contentSearchInputId}>
            Search content
          </label>
          <input
            id={contentSearchInputId}
            class="min-w-0 border border-input bg-background px-2 py-1.5 text-xs text-foreground outline-none transition focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring"
            type="search"
            value={search()}
            placeholder="Search videos"
            autocomplete="off"
            onInput={(event) => setSearch(event.currentTarget.value)}
          />
          <label class="sr-only" for={contentSourceFilterId}>
            Filter content by source
          </label>
          <select
            id={contentSourceFilterId}
            class="border border-input bg-background px-2 py-1.5 text-xs text-foreground outline-none transition focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring"
            value={sourceType() ?? allContentSourceFilterValue}
            onChange={(event) => setSourceType(toSourceFilterValue(event.currentTarget.value))}
          >
            <option value={allContentSourceFilterValue}>All</option>
            <For each={sourceFilterOptions}>
              {(source) => <option value={source}>{formatSourceLabel(source)}</option>}
            </For>
          </select>
        </div>
      </div>
      <div class="px-3 py-2">
        <Switch>
          <Match when={contentItems.loading}>
            <p class="text-xs font-semibold text-card-foreground">Loading videos</p>
            <p class="mt-2 text-[0.72rem] leading-5 text-muted-foreground">Loading the public catalog.</p>
          </Match>
          <Match when={contentItems.error !== undefined}>
            <p class="text-xs font-semibold text-destructive">Videos unavailable</p>
            <p class="mt-2 text-[0.72rem] leading-5 text-muted-foreground">{formatError(contentItems.error)}</p>
          </Match>
          <Match when={(contentItems()?.length ?? 0) === 0}>
            <p class="text-xs font-semibold text-card-foreground">No videos found</p>
            <p class="mt-2 text-[0.72rem] leading-5 text-muted-foreground">
              {search().trim().length === 0 && props.selectedCreator() === null && sourceType() === null
                ? "The public catalog has no videos yet."
                : "No videos match the current filters."}
            </p>
          </Match>
          <Match when={contentItems()}>
            {(loadedContentItems) => (
              <ol class="space-y-1" aria-label={`Catalog videos, ${contentCount()} shown`}>
                <For each={loadedContentItems()}>
                  {(contentItem) => (
                    <li>
                      <button
                        type="button"
                        class="group grid w-full grid-cols-[4.75rem_1fr] gap-2 border border-border bg-background p-2 text-left text-foreground transition hover:border-ring hover:bg-accent hover:text-accent-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                        aria-pressed={props.selectedContentItemId() === contentItem.id}
                        data-selected={props.selectedContentItemId() === contentItem.id ? "true" : "false"}
                        onClick={() => props.onSelectContent(contentItem)}
                      >
                        <span class="aspect-video overflow-hidden border border-border bg-muted">
                          <Show when={contentItem.thumbnailUrl}>
                            {(thumbnailUrl) => (
                              <img
                                class="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
                                src={thumbnailUrl()}
                                alt=""
                                loading="lazy"
                              />
                            )}
                          </Show>
                        </span>
                        <span class="min-w-0">
                          <span class="block truncate text-xs font-semibold">{contentItem.title}</span>
                          <span class="mt-1 block truncate text-[0.68rem] text-muted-foreground">
                            {contentItem.creator.displayName}
                          </span>
                          <span class="mt-1 flex items-center justify-between gap-2 text-[0.68rem] text-muted-foreground">
                            <span class="truncate">{formatPublishedAt(contentItem.publishedAt)}</span>
                            <span class="shrink-0">{formatDuration(contentItem.durationSeconds)}</span>
                          </span>
                        </span>
                      </button>
                    </li>
                  )}
                </For>
              </ol>
            )}
          </Match>
        </Switch>
      </div>
    </section>
  );
}

interface SelectedContentViewerProps {
  readonly selectedContent: () => CatalogContentListItem | null;
}

function SelectedContentViewer(props: SelectedContentViewerProps) {
  const selectedContentItemId = createMemo(() => props.selectedContent()?.id ?? null);
  const [contentDetail] = createResource(selectedContentItemId, (id) => client.catalog.contentDetail({ id }));
  const playableSources = createMemo(() => toPlayableSources(contentDetail()?.sources ?? []));
  const [selectedSourceId, setSelectedSourceId] = createSignal<string | null>(null);

  createEffect(() => {
    const sources = playableSources();
    const currentSourceId = selectedSourceId();
    if (sources.length === 0) {
      setSelectedSourceId(null);
      return;
    }

    if (!sources.some((source) => source.id === currentSourceId)) {
      setSelectedSourceId(sources[0]?.id ?? null);
    }
  });

  const selectedPlayableSource = createMemo(() => {
    const sources = playableSources();
    return sources.find((source) => source.id === selectedSourceId()) ?? sources[0] ?? null;
  });

  return (
    <section
      aria-labelledby="selected-viewer-title"
      class="min-h-[30rem] bg-background lg:min-h-0 lg:overflow-y-auto"
      data-shell-column="viewer"
      data-selected-content-item-id={selectedContentItemId() ?? ""}
    >
      <div class="p-3">
        <h2 id="selected-viewer-title" class="sr-only">Viewer</h2>
        <Switch>
          <Match when={selectedContentItemId() === null}>
            <div class="flex min-h-[18rem] items-center justify-center border border-border bg-muted px-6 text-center">
              <p class="text-sm leading-6 text-muted-foreground">Pick a catalog video to open the viewer.</p>
            </div>
          </Match>
          <Match when={contentDetail.loading}>
            <div class="flex min-h-[18rem] items-center justify-center border border-border bg-muted px-6 text-center">
              <p class="text-sm leading-6 text-muted-foreground">Loading selected video.</p>
            </div>
          </Match>
          <Match when={contentDetail.error !== undefined}>
            <div class="border border-border bg-card p-4">
              <p class="text-sm font-semibold text-destructive">Video unavailable</p>
              <p class="mt-2 text-sm leading-6 text-muted-foreground">{formatError(contentDetail.error)}</p>
            </div>
          </Match>
          <Match when={contentDetail()}>
            {(detail) => (
              <div class="min-w-0">
                <PlaybackSurface source={selectedPlayableSource()} title={detail().title} />
                <Show when={playableSources().length > 1}>
                  <div class="mt-3 flex justify-end">
                    <label class="sr-only" for="viewer-source-switcher">
                      Playback source
                    </label>
                    <select
                      id="viewer-source-switcher"
                      class="w-52 border border-input bg-background px-2 py-1.5 text-xs text-foreground outline-none transition focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring"
                      value={selectedPlayableSource()?.id ?? ""}
                      onChange={(event) => setSelectedSourceId(event.currentTarget.value)}
                    >
                      <For each={playableSources()}>
                        {(source) => (
                          <option value={source.id}>
                            {source.label}
                          </option>
                        )}
                      </For>
                    </select>
                  </div>
                </Show>
                <ContentDetailBody detail={detail()} />
                <ContentDetailMetadata detail={detail()} playableSources={playableSources()} />
              </div>
            )}
          </Match>
        </Switch>
      </div>
    </section>
  );
}

interface PlaybackSurfaceProps {
  readonly source: PlayableSource | null;
  readonly title: string;
}

function PlaybackSurface(props: PlaybackSurfaceProps) {
  return (
    <div class="aspect-video overflow-hidden border border-border bg-muted">
      <Switch>
        <Match when={props.source?.kind === "embed" && props.source !== null}>
          <iframe
            class="h-full w-full"
            src={props.source?.url ?? ""}
            title={props.title}
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
            allowfullscreen
            referrerpolicy="strict-origin-when-cross-origin"
          />
        </Match>
        <Match when={props.source?.kind === "native" && props.source !== null}>
          <video class="h-full w-full" src={props.source?.url ?? ""} controls preload="metadata">
            <a class="text-primary underline" href={props.source?.url ?? ""}>
              Open video source
            </a>
          </video>
        </Match>
        <Match when={true}>
          <div class="flex h-full items-center justify-center px-6 text-center text-sm text-muted-foreground">
            No safe playable source is available for this video.
          </div>
        </Match>
      </Switch>
    </div>
  );
}

interface ContentDetailBodyProps {
  readonly detail: CatalogContentDetail;
}

function ContentDetailBody(props: ContentDetailBodyProps) {
  return (
    <article class="mt-4 space-y-3">
      <div>
        <h3 class="text-xl font-semibold tracking-tight text-foreground">{props.detail.title}</h3>
        <p class="mt-2 text-sm text-muted-foreground">
          {props.detail.creator.displayName} · {formatPublishedAt(props.detail.publishedAt)} · {formatDuration(props.detail.durationSeconds)}
        </p>
      </div>
      <Show when={props.detail.description}>
        {(description) => <p class="whitespace-pre-line text-sm leading-6 text-foreground">{description()}</p>}
      </Show>
      <Show when={props.detail.canonicalUrl}>
        {(canonicalUrl) => (
          <a
            class="inline-flex border border-border bg-card px-3 py-2 text-xs font-semibold text-card-foreground transition hover:border-ring hover:bg-accent hover:text-accent-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            href={canonicalUrl()}
            rel="noreferrer"
            target="_blank"
          >
            Open original
          </a>
        )}
      </Show>
    </article>
  );
}

interface ContentDetailMetadataProps {
  readonly detail: CatalogContentDetail | undefined;
  readonly playableSources: readonly PlayableSource[];
}

function ContentDetailMetadata(props: ContentDetailMetadataProps) {
  return (
    <section class="mt-4 border-t border-border" aria-label="Selected video metadata">
      <Show when={props.detail?.creator}>
        {(creator) => (
          <section class="border-b border-border py-3">
            <p class="text-[0.68rem] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Creator</p>
            <p class="mt-2 text-sm font-semibold text-card-foreground">{creator().displayName}</p>
            <p class="mt-1 text-xs text-muted-foreground">{formatSourceLabel(creator().sourceType)}</p>
          </section>
        )}
      </Show>
      <Show when={(props.detail?.feeds.length ?? 0) > 0}>
        <section class="border-b border-border py-3">
          <p class="text-[0.68rem] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Feeds</p>
          <ul class="mt-2 space-y-1" aria-label="Feeds containing selected video">
            <For each={props.detail?.feeds ?? []}>{(feed) => <FeedRow feed={feed} />}</For>
          </ul>
        </section>
      </Show>
      <Show when={props.playableSources.length > 0}>
        <section class="py-3">
          <p class="text-[0.68rem] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Playable sources</p>
          <ul class="mt-2 space-y-1" aria-label="Playable sources for selected video">
            <For each={props.playableSources}>
              {(source) => (
                <li class="border border-border bg-background px-2 py-1.5">
                  <p class="text-[0.72rem] font-semibold text-foreground">{source.label}</p>
                  <a class="mt-1 block truncate text-[0.68rem] text-muted-foreground underline" href={source.canonicalUrl} rel="noreferrer" target="_blank">
                    Source page
                  </a>
                </li>
              )}
            </For>
          </ul>
        </section>
      </Show>
    </section>
  );
}

export default function AppShell() {
  const [selectedCreator, setSelectedCreator] = createSignal<CatalogCreator | null>(null);
  const [selectedContent, setSelectedContent] = createSignal<CatalogContentListItem | null>(null);
  const selectedCreatorId = createMemo(() => selectedCreator()?.id ?? null);
  const selectedContentItemId = createMemo(() => selectedContent()?.id ?? null);

  const selectCreator = (creator: CatalogCreator) => {
    setSelectedCreator(creator);
    setSelectedContent(null);
  };

  return (
    <main class={shellRootClass}>
      <div class={shellGridClass}>
        <CreatorSourceColumn
          selectedCreatorId={selectedCreatorId}
          selectedCreator={selectedCreator}
          onSelectCreator={selectCreator}
        />
        <ContentListColumn
          selectedCreator={selectedCreator}
          selectedContentItemId={selectedContentItemId}
          onSelectContent={setSelectedContent}
        />
        <SelectedContentViewer selectedContent={selectedContent} />
      </div>
    </main>
  );
}
