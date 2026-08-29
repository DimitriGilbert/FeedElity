import { QueryClientProvider } from "@tanstack/solid-query";
import { RouterProvider, createRouter } from "@tanstack/solid-router";
import { render } from "solid-js/web";

import "./styles.css";
import { routeTree } from "./routeTree.gen";
import { orpc, queryClient } from "./utils/orpc";

export function createAppRouter() {
  return createRouter({
    routeTree,
    defaultPreload: "intent",
    scrollRestoration: true,
    defaultPreloadStaleTime: 30_000,
    context: { orpc, queryClient },
  });
}

const router = createAppRouter();

declare module "@tanstack/solid-router" {
  interface Register {
    router: typeof router;
  }
}

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  );
}

const rootElement = globalThis.document?.getElementById("app");
if (rootElement !== undefined && rootElement !== null) {
  render(() => <App />, rootElement);
}
