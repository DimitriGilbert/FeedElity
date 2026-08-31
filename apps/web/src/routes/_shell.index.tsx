import { createFileRoute } from "@tanstack/solid-router";

// Renders nothing by design: "/" is the catalog and must stay reachable from
// the header Catalog link, the logo, and the `g c` shortcut. The one-time
// "reopen the last section" redirect lives in the shell layout, so a persisted
// library mode can never trap a signed-in user away from the catalog.
export const Route = createFileRoute("/_shell/")({
  component: RouteComponent,
});

function RouteComponent() {
  return null;
}
