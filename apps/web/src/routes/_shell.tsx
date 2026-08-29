import { createFileRoute, useLocation } from "@tanstack/solid-router";
import { createMemo } from "solid-js";

import AppShell from "@/components/app-shell";
import type { ShellMode } from "@/components/app-shell.contract";

export const Route = createFileRoute("/_shell")({
  component: ShellLayout,
});

function ShellLayout() {
  const location = useLocation();
  const mode = createMemo<ShellMode>(() => (location().pathname.startsWith("/dashboard") ? "library" : "catalog"));

  return <AppShell mode={mode()} />;
}
