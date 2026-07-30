import type { RefreshFeedResultWithFeed, RefreshRun, SourceType } from "@FeedElity/api";
import { For, Show, createEffect, createMemo, createSignal } from "solid-js";
import TriangleAlert from "lucide-solid/icons/triangle-alert";
import X from "lucide-solid/icons/x";

import type { ParsedRefreshError } from "./app-shell.contract";
import { formatRefreshErrorCodeLabel, parseRefreshErrorSummaries, refreshStatusRegionId } from "./app-shell.contract";
import { SourceIconBadge } from "./source-indicator";

export interface RefreshStatusDialogProps {
  readonly open: boolean;
  readonly run: RefreshRun | null;
  readonly feedResults: readonly RefreshFeedResultWithFeed[];
  readonly onClose: () => void;
}

function feedLabel(feed: RefreshFeedResultWithFeed["feed"]): string {
  return feed.title ?? feed.url;
}

/**
 * Native dialog-based refresh status viewer. Renders a full per-feed breakdown
 * of the latest refresh run: feed label, source-type chip, status, error code +
 * message, and item counts. Holds no state of its own beyond the dialog ref —
 * all data arrives via props from the parent's refresh status resource.
 */
export function RefreshStatusDialog(props: RefreshStatusDialogProps) {
  const [dialogRef, setDialogRef] = createSignal<HTMLDialogElement | null>(null);

  // Drive the native dialog open/closed state idempotently. showModal()/close()
  // throw InvalidStateError if called in the wrong state, so guard each call.
  createEffect(() => {
    const dialog = dialogRef();
    if (dialog === null) {
      return;
    }

    const shouldOpen = props.open;
    if (shouldOpen && !dialog.open) {
      dialog.showModal();
    } else if (!shouldOpen && dialog.open) {
      dialog.close();
    }
  });

  const providerPausedNote = createMemo<ParsedRefreshError | null>(() => {
    if (props.run === null) {
      return null;
    }

    return parseRefreshErrorSummaries(props.run.errorSummaryJson).find((summary) => summary.code === "provider-refresh-paused") ?? null;
  });

  const failedFeeds = createMemo(() => props.feedResults.filter((result) => result.status === "failed"));
  const failedCount = createMemo(() => failedFeeds().length);

  return (
    <dialog
      ref={(element) => setDialogRef(element)}
      id={refreshStatusRegionId}
      aria-label="Refresh status"
      class="m-auto w-[min(36rem,92vw)] rounded-lg border border-border bg-popover p-0 text-popover-foreground opacity-0 backdrop:bg-background/80 open:opacity-100"
      onClose={() => props.onClose()}
    >
      <div class="flex items-center justify-between gap-2 border-b border-border px-4 py-3">
        <h2 class="flex items-center gap-2 text-sm font-semibold text-foreground">
          <TriangleAlert class="h-4 w-4 text-destructive" aria-hidden="true" />
          Refresh status
        </h2>
        <form method="dialog">
          <button
            type="submit"
            class="inline-flex items-center justify-center rounded-md p-1 text-muted-foreground transition hover:bg-accent hover:text-accent-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            aria-label="Close refresh status"
            title="Close"
          >
            <X class="h-4 w-4" />
          </button>
        </form>
      </div>

      <div class="max-h-[80dvh] overflow-y-auto px-4 py-3">
        <p class="text-xs font-semibold text-destructive" data-refresh-status-run-summary>
          {failedCount()} feed{failedCount() === 1 ? "" : "s"} failed to refresh
        </p>

        <Show when={providerPausedNote()}>
          {(note) => (
            <p class="mt-2 text-xs text-destructive" data-refresh-status-provider-note>
              {note().message}
            </p>
          )}
        </Show>

        <Show
          when={failedCount() > 0}
          fallback={
            <p class="mt-3 text-xs text-muted-foreground" data-refresh-status-empty>
              No failed feeds are available for this run.
            </p>
          }
        >
          <ul class="mt-3 space-y-2" aria-label="Failed refresh feeds">
            <For each={failedFeeds()}>
              {(result) => (
                <li
                  class="rounded-md border border-border bg-card px-3 py-2 text-card-foreground"
                  data-refresh-status-feed={result.feed.id}
                  data-refresh-status-feed-state={result.status}
                >
                  <span class="flex min-w-0 items-center gap-2">
                    <span class="truncate text-sm font-semibold" data-refresh-status-feed-title>
                      {feedLabel(result.feed)}
                    </span>
                    <span data-refresh-status-feed-chip>
                      <SourceIconBadge sourceType={result.feed.sourceType satisfies SourceType} context="feed" />
                    </span>
                  </span>

                  <a
                    href={result.feed.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    class="mt-0.5 block truncate text-xs text-muted-foreground underline decoration-dotted underline-offset-2 transition hover:text-foreground"
                    title={result.feed.url}
                    data-refresh-status-feed-url
                  >
                    {result.feed.url}
                  </a>

                  <Show
                    when={parseRefreshErrorSummaries(result.errorSummaryJson)[0]}
                    keyed
                  >
                    {(error: ParsedRefreshError) => (
                      <p class="mt-1 text-xs text-destructive" data-refresh-status-feed-error>
                        <span class="font-semibold">{formatRefreshErrorCodeLabel(error.code)}.</span> {error.message}
                      </p>
                    )}
                  </Show>
                </li>
              )}
            </For>
          </ul>
        </Show>

        <div class="mt-4 flex justify-end">
          <form method="dialog">
            <button
              type="submit"
              class="inline-flex items-center gap-1 rounded-md border border-border bg-background px-3 py-1.5 text-xs font-semibold text-foreground transition hover:bg-accent hover:text-accent-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            >
              Dismiss
            </button>
          </form>
        </div>
      </div>
    </dialog>
  );
}
