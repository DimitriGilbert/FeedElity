import type { QueryClient } from "@tanstack/solid-query";
import { Outlet, createRootRouteWithContext } from "@tanstack/solid-router";
import { Show, Suspense, lazy } from "solid-js";

import Header from "@/components/header";

import type { orpc } from "../utils/orpc";

export interface RouterContext {
  orpc: typeof orpc;
  queryClient: QueryClient;
}

export const Route = createRootRouteWithContext<RouterContext>()({
  component: RootComponent,
});

// Lazy so the devtools code is code-split into its own chunk; the DEV gate
// keeps the chunk unloaded (and absent from the main bundle) in production.
const DevTools = lazy(() => import("@/components/dev-tools"));

function RootComponent() {
  return (
    <>
      <div class="grid min-h-dvh w-dvw grid-rows-[auto_1fr] overflow-hidden lg:h-dvh">
        <Header />
        <Outlet />
      </div>
      <Show when={import.meta.env.DEV}>
        <Suspense>
          <DevTools />
        </Suspense>
      </Show>
    </>
  );
}
