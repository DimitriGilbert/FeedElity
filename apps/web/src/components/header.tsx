import { Link } from "@tanstack/solid-router";
import { For } from "solid-js";

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

export const shellNavigationLinkClass = `group border border-border bg-background px-2.5 py-1.5 text-muted-foreground transition duration-200 hover:bg-accent hover:text-accent-foreground ${focusVisibleClass}`;

export default function Header() {
  return (
    <header class="relative z-10 border-b border-border bg-background text-foreground">
      <div class="flex min-h-12 flex-col gap-2 px-3 py-2 sm:px-4 md:flex-row md:items-center md:justify-between md:py-0">
        <div class="flex items-center gap-3">
          <Link to="/" class={`group flex items-center gap-3 ${focusVisibleClass}`} aria-label="FeedElity RSS reader shell">
            <span class="grid h-7 w-7 place-items-center border border-border bg-primary text-[0.7rem] font-semibold tracking-tight text-primary-foreground transition-colors duration-200 group-hover:bg-accent group-hover:text-accent-foreground">
              FE
            </span>
            <span class="leading-none">
              <span class="block text-sm font-semibold tracking-[0.14em] text-foreground">FeedElity</span>
              <span class="sr-only">Video RSS reader</span>
            </span>
          </Link>
        </div>
        <nav class="flex min-w-0 gap-2 overflow-x-auto text-sm" aria-label="Primary navigation">
          <For each={shellNavigationLinks}>
            {(link) => (
              <Link
                to={link.to}
                class={shellNavigationLinkClass}
                activeProps={{ class: `bg-accent text-accent-foreground ${focusVisibleClass}` }}
              >
                <span class="block font-medium leading-none">{link.label}</span>
                <span class="sr-only">{link.helper}</span>
              </Link>
            )}
          </For>
        </nav>
        <div class="flex items-center gap-2 md:justify-end">
          <UserMenu />
        </div>
      </div>
    </header>
  );
}
