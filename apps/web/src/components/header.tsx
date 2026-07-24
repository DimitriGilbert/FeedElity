import { Link } from "@tanstack/solid-router";
import { For } from "solid-js";
import Rss from "lucide-solid/icons/rss";

import UserMenu from "./user-menu";

export interface ShellNavigationLink {
  readonly to: "/" | "/dashboard";
  readonly label: string;
  readonly helper: string;
}

export const shellNavigationLinks: readonly ShellNavigationLink[] = [
  { to: "/", label: "Catalog", helper: "Browse" },
  { to: "/dashboard", label: "Library", helper: "Saved" },
] as const;

export const focusVisibleClass = "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";

export const shellNavigationLinkClass = `inline-flex items-center px-3 py-1.5 text-sm font-medium text-muted-foreground transition hover:bg-accent hover:text-accent-foreground ${focusVisibleClass}`;

export default function Header() {
  return (
    <header class="relative z-10 border-b border-border bg-background text-foreground">
      <div class="flex h-12 items-center gap-3 px-4">
        <Link to="/" class={`group flex items-center gap-2 ${focusVisibleClass}`} aria-label="FeedElity RSS reader shell">
          <span class="grid h-7 w-7 place-items-center rounded-md border border-border bg-card text-primary transition-colors group-hover:text-accent-foreground">
            <Rss size={15} stroke-width={2} aria-hidden="true" />
          </span>
          <span class="leading-none">
            <span class="block text-sm font-semibold tracking-tight text-foreground">FeedElity</span>
            <span class="sr-only">Video RSS reader</span>
          </span>
        </Link>
        <nav class="flex min-w-0 items-center gap-1 overflow-x-auto" aria-label="Primary navigation">
          <For each={shellNavigationLinks}>
            {(link) => (
              <Link
                to={link.to}
                class={shellNavigationLinkClass}
                activeProps={{ class: `bg-accent text-accent-foreground ${focusVisibleClass}` }}
              >
                <span class="font-medium leading-none">{link.label}</span>
                <span class="sr-only">{link.helper}</span>
              </Link>
            )}
          </For>
        </nav>
        <div class="ml-auto flex items-center">
          <UserMenu />
        </div>
      </div>
    </header>
  );
}
