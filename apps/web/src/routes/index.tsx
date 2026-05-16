import { createFileRoute } from "@tanstack/solid-router";

import AppShell from "@/components/app-shell";

export const Route = createFileRoute("/")({
  component: App,
});

function App() {
  return <AppShell mode="catalog" />;
}
