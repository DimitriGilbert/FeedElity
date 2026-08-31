import type { FeedHealthEntry } from "@FeedElity/api";
import { For, Show, createEffect, createMemo, createSignal } from "solid-js";
import TriangleAlert from "lucide-solid/icons/triangle-alert";
import UserX from "lucide-solid/icons/user-x";
import Users from "lucide-solid/icons/users";
import X from "lucide-solid/icons/x";

import { ConfirmDialog } from "./confirm-dialog";
import {
  formatFeedHealthLastSuccess,
  formatRefreshErrorCodeLabel,
  parseRefreshErrorSummaries,
  sortFeedHealthEntries,
  type ParsedRefreshError,
} from "./app-shell.contract";
import { SourceIconBadge } from "./source-indicator";

export interface FeedHealthDialogProps {
  readonly open: boolean;
  readonly entries: readonly FeedHealthEntry[];
  readonly loading: boolean;
  readonly busy: boolean;
  readonly loadErrorMessage: string | null;
  readonly actionErrorMessage: string | null;
  readonly onClose: () => void;
  // Called only after the in-dialog confirm dialog has been accepted. The
  // parent owns the bulkUnsubscribe procedure call and the reload fan-out.
  readonly onUnsubscribeCreators: (creatorIds: readonly string[]) => void;
}

interface PendingUnsubscribe {
  readonly creatorIds: readonly string[];
  readonly targetLabel: string;
}

// Feeds count as failing for the bulk action once a normal refresh failed this
// many consecutive times — a single transient blip is not worth unsubscribing.
const bulkUnsubscribeFailureThreshold = 2;

const actionButtonClass =
  "inline-flex items-center gap-1 rounded-md border border-destructive/40 bg-background px-2 py-1 text-xs font-semibold text-destructive transition hover:bg-destructive/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-60";

function feedLabel(entry: FeedHealthEntry): string {
  return entry.feedTitle ?? entry.feedUrl;
}

/**
 * Confirm title for a staged unsubscribe: singular for a single creator,
 * count-named plural for the bulk action so the destructive scope is spelled
 * out before confirmation.
 */
function unsubscribeConfirmTitle(pending: PendingUnsubscribe | null): string {
  if (pending === null || pending.creatorIds.length === 1) {
    return "Unsubscribe from creator?";
  }
  return `Unsubscribe ${pending.creatorIds.length} creators?`;
}

/**
 * Native dialog-based feed health dashboard. Lists every catalog feed with its
 * refresh health (failure streak, last success age, last error) and offers
 * destructive unsubscribe actions for creators whose feeds keep failing. Rows
 * arrive unfiltered from the parent's feedHealth resource and are sorted here;
 * the parent owns data fetching and the unsubscribe procedure call.
 */
export function FeedHealthDialog(props: FeedHealthDialogProps) {
  const [dialogRef, setDialogRef] = createSignal<HTMLDialogElement | null>(null);
  const [pendingUnsubscribe, setPendingUnsubscribe] = createSignal<PendingUnsubscribe | null>(null);
  // Reference instant for the "last success Xd ago" labels, pinned per open so
  // the ages do not drift while the dialog stays open.
  const [healthNow, setHealthNow] = createSignal<Date>(new Date());

  // Drive the native dialog open/closed state idempotently. showModal()/close()
  // throw InvalidStateError if called in the wrong state, so guard each call.
  createEffect(() => {
    const dialog = dialogRef();
    if (dialog === null) {
      return;
    }

    const shouldOpen = props.open;
    if (shouldOpen && !dialog.open) {
      setHealthNow(new Date());
      dialog.showModal();
    } else if (!shouldOpen && dialog.open) {
      dialog.close();
    }
  });

  const sortedEntries = createMemo(() => sortFeedHealthEntries(props.entries));
  const failedCreatorIds = createMemo(() => {
    const creatorIds = new Set<string>();
    for (const entry of sortedEntries()) {
      if (entry.consecutiveFailureCount >= bulkUnsubscribeFailureThreshold) {
        creatorIds.add(entry.creatorId);
      }
    }
    return [...creatorIds];
  });
  const lastSuccessLabel = (entry: FeedHealthEntry): string => formatFeedHealthLastSuccess(entry.lastSuccessAt, healthNow());

  const stageCreatorUnsubscribe = (entry: FeedHealthEntry) => {
    if (props.busy) {
      return;
    }

    setPendingUnsubscribe({ creatorIds: [entry.creatorId], targetLabel: entry.creatorDisplayName });
  };

  const stageFailedCreatorsUnsubscribe = () => {
    if (props.busy) {
      return;
    }

    const creatorIds = failedCreatorIds();
    const count = creatorIds.length;
    setPendingUnsubscribe({
      creatorIds,
      targetLabel: `${count} failing-feed creator${count === 1 ? "" : "s"}`,
    });
  };

  // Single path from "confirm clicked" to the destructive call: the pending
  // intent is consumed (closing the confirm dialog) and forwarded once.
  const confirmPendingUnsubscribe = () => {
    const pending = pendingUnsubscribe();
    if (pending === null) {
      return;
    }

    setPendingUnsubscribe(null);
    props.onUnsubscribeCreators(pending.creatorIds);
  };

  return (
    <>
      <dialog
        ref={(element) => setDialogRef(element)}
        id="feed-health-dashboard"
        aria-label="Feed health"
        class="m-auto w-[min(40rem,92vw)] rounded-lg border border-border bg-popover p-0 text-popover-foreground opacity-0 backdrop:bg-background/80 open:opacity-100"
        onClose={() => props.onClose()}
      >
        <div class="flex items-center justify-between gap-2 border-b border-border px-4 py-3">
          <h2 class="flex items-center gap-2 text-sm font-semibold text-foreground">
            <TriangleAlert class="h-4 w-4 text-destructive" aria-hidden="true" />
            Feed health
          </h2>
          <form method="dialog">
            <button
              type="submit"
              class="inline-flex items-center justify-center rounded-md p-1 text-muted-foreground transition hover:bg-accent hover:text-accent-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
              aria-label="Close feed health"
              title="Close"
            >
              <X class="h-4 w-4" />
            </button>
          </form>
        </div>

        <div class="max-h-[80dvh] overflow-y-auto px-4 py-3">
          <p class="text-xs text-muted-foreground" data-feed-health-summary>
            Refresh health for every catalog feed, most failures first. Unsubscribing removes only your subscription;
            the catalog stays public.
          </p>

          <Show when={props.loadErrorMessage}>
            {(message) => (
              <p class="mt-2 text-xs text-destructive" data-feed-health-load-error>
                {message()}
              </p>
            )}
          </Show>
          <Show when={props.actionErrorMessage}>
            {(message) => (
              <p class="mt-2 text-xs text-destructive" data-feed-health-error>
                {message()}
              </p>
            )}
          </Show>

          <Show
            when={!props.loading || sortedEntries().length > 0}
            fallback={
              <p class="mt-3 text-xs text-muted-foreground" data-feed-health-loading>
                Loading feed health.
              </p>
            }
          >
            <Show
              when={sortedEntries().length > 0}
              fallback={
                <p class="mt-3 text-xs text-muted-foreground" data-feed-health-empty>
                  No feed health data yet. Run a refresh to collect feed results.
                </p>
              }
            >
              <ul class="mt-3 space-y-2" aria-label="Feed health entries">
                <For each={sortedEntries()}>
                  {(entry) => {
                    const isFailing = entry.consecutiveFailureCount > 0;
                    const lastError = parseRefreshErrorSummaries(entry.lastErrorSummaryJson)[0];

                    return (
                      <li
                        class="rounded-md border border-border bg-card px-3 py-2 text-card-foreground"
                        data-feed-health-row={entry.feedId}
                        data-feed-health-row-state={isFailing ? "failing" : "healthy"}
                      >
                        <span class="flex min-w-0 items-center gap-2">
                          <span class="truncate text-sm font-semibold" data-feed-health-row-creator>
                            {entry.creatorDisplayName}
                          </span>
                          <span data-feed-health-row-chip>
                            <SourceIconBadge sourceType={entry.sourceType} context="feed" />
                          </span>
                          <span
                            class={`ml-auto inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-[0.68rem] font-semibold ${
                              isFailing
                                ? "border-destructive/40 bg-destructive/10 text-destructive"
                                : "border-border bg-muted text-muted-foreground"
                            }`}
                            data-feed-health-row-status
                          >
                            {isFailing ? "failing" : "healthy"}
                          </span>
                        </span>

                        <span class="mt-0.5 block truncate text-xs font-medium" title={feedLabel(entry)} data-feed-health-row-title>
                          {feedLabel(entry)}
                        </span>
                        <a
                          href={entry.feedUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          class="block truncate text-xs text-muted-foreground underline decoration-dotted underline-offset-2 transition hover:text-foreground"
                          title={entry.feedUrl}
                          data-feed-health-row-url
                        >
                          {entry.feedUrl}
                        </a>

                        <span class="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                          <span data-feed-health-row-last-success>
                            last success {lastSuccessLabel(entry)}
                          </span>
                          <Show when={isFailing}>
                            <span class="inline-flex items-center gap-1" data-feed-health-row-failure-count>
                              <Show when={entry.consecutiveFailureCount >= bulkUnsubscribeFailureThreshold}>
                                <TriangleAlert class="h-3.5 w-3.5 text-destructive" aria-hidden="true" />
                              </Show>
                              {entry.consecutiveFailureCount} failed in a row
                            </span>
                          </Show>
                        </span>

                        <Show when={lastError} keyed>
                          {(error: ParsedRefreshError) => (
                            <p class="mt-1 text-xs text-destructive" data-feed-health-row-error>
                              <span class="font-semibold">{formatRefreshErrorCodeLabel(error.code)}.</span> {error.message}
                            </p>
                          )}
                        </Show>

                        <span class="mt-2 flex justify-end">
                          <button
                            type="button"
                            class={actionButtonClass}
                            aria-label={`Unsubscribe from ${entry.creatorDisplayName}`}
                            title="Unsubscribe creator"
                            data-feed-health-row-unsubscribe={entry.creatorId}
                            disabled={props.busy}
                            onClick={() => stageCreatorUnsubscribe(entry)}
                          >
                            <UserX class="h-3.5 w-3.5" aria-hidden="true" />
                            Unsubscribe creator
                          </button>
                        </span>
                      </li>
                    );
                  }}
                </For>
              </ul>
            </Show>
          </Show>

          <div class="mt-4 flex items-center justify-between gap-2">
            <button
              type="button"
              class={actionButtonClass}
              aria-label="Unsubscribe creators with failing feeds"
              title="Unsubscribe failed-feed creators"
              data-feed-health-unsubscribe-failed
              disabled={props.busy || failedCreatorIds().length === 0}
              onClick={() => stageFailedCreatorsUnsubscribe()}
            >
              <Users class="h-3.5 w-3.5" aria-hidden="true" />
              Unsubscribe failed-feed creators ({failedCreatorIds().length})
            </button>
            <form method="dialog">
              <button
                type="submit"
                class="inline-flex items-center gap-1 rounded-md border border-border bg-background px-3 py-1.5 text-xs font-semibold text-foreground transition hover:bg-accent hover:text-accent-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
              >
                Close
              </button>
            </form>
          </div>
        </div>
      </dialog>

      <ConfirmDialog
        open={pendingUnsubscribe() !== null}
        title={unsubscribeConfirmTitle(pendingUnsubscribe())}
        body={`This removes your subscription to ${pendingUnsubscribe()?.targetLabel ?? "the selected creators"}. Their feeds stay in the public catalog and health list.`}
        confirmLabel="Unsubscribe"
        onConfirm={confirmPendingUnsubscribe}
        onCancel={() => setPendingUnsubscribe(null)}
      />
    </>
  );
}
