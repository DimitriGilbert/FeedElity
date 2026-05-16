import type { SourceType } from "@FeedElity/api";
import CirclePlay from "lucide-solid/icons/circle-play";
import RadioTower from "lucide-solid/icons/radio-tower";
import SquarePlay from "lucide-solid/icons/square-play";
import { Match, Show, Switch, createMemo } from "solid-js";

import { formatSourceLabel } from "./app-shell.contract";

export type SourceIndicatorContext = "content" | "feed";

export function formatSourceIndicatorLabel(sourceType: SourceType, context: SourceIndicatorContext, sourceCount?: number): string {
  const sourceLabel = formatSourceLabel(sourceType);
  if (context === "feed") {
    return `${sourceLabel} feed source`;
  }

  if (sourceCount === undefined || sourceCount <= 1) {
    return `${sourceLabel} content source`;
  }

  return `${sourceLabel} primary content source, ${sourceCount} source records available`;
}

function SourceTypeIcon(props: { readonly sourceType: SourceType }) {
  const iconClass = "h-3.5 w-3.5";
  return (
    <Switch>
      <Match when={props.sourceType === "youtube"}>
        <SquarePlay class={iconClass} aria-hidden="true" />
      </Match>
      <Match when={props.sourceType === "odysee"}>
        <CirclePlay class={iconClass} aria-hidden="true" />
      </Match>
      <Match when={props.sourceType === "peertube"}>
        <RadioTower class={iconClass} aria-hidden="true" />
      </Match>
    </Switch>
  );
}

export function SourceIconBadge(props: { readonly sourceType: SourceType; readonly context: SourceIndicatorContext; readonly sourceCount?: number }) {
  const label = createMemo(() => formatSourceIndicatorLabel(props.sourceType, props.context, props.sourceCount));
  return (
    <span
      class="inline-flex shrink-0 items-center gap-1 border border-border bg-background px-1 py-0.5 text-muted-foreground"
      role="img"
      aria-label={label()}
      title={label()}
    >
      <SourceTypeIcon sourceType={props.sourceType} />
      <Show when={props.sourceCount !== undefined && props.sourceCount > 1}>
        <span class="text-[0.62rem] font-semibold tabular-nums" aria-hidden="true">
          ×{props.sourceCount}
        </span>
      </Show>
    </span>
  );
}
