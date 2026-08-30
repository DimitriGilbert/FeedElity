import { createFileRoute } from "@tanstack/solid-router";

export const Route = createFileRoute("/_shell/")({
  component: RouteComponent,
});

function RouteComponent() {
  return null;
}
