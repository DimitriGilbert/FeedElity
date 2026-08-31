import { createFileRoute, useLocation, useNavigate } from "@tanstack/solid-router";
import { createEffect, createMemo, onMount } from "solid-js";

import AppShell from "@/components/app-shell";
import { persistLocalValue, readPersistedLocalValue, shellModeLocalStorageKey, toPersistedShellMode } from "@/components/app-shell.contract";
import type { ShellMode } from "@/components/app-shell.contract";
import { authClient } from "@/lib/auth-client";

export const Route = createFileRoute("/_shell")({
  component: ShellLayout,
});

function ShellLayout() {
  const location = useLocation();
  const navigate = useNavigate();
  const mode = createMemo<ShellMode>(() => (location().pathname.startsWith("/dashboard") ? "library" : "catalog"));

  // Device-local record (F7, decision D9) of the mode the user last viewed.
  // The layout's one-time mount redirect below reads it to reopen the last
  // section when a session exists; search text and other ephemeral state stay
  // unpersisted.
  createEffect(() => {
    persistLocalValue(shellModeLocalStorageKey, mode());
  });

  // One-time "reopen the last section" redirect: a signed-in user whose
  // persisted mode is "library" is moved to /dashboard once per app mount.
  // It lives here — not in the index route's beforeLoad — so "/" stays
  // reachable through the header Catalog link, the logo, and the `g c`
  // shortcut after the app has opened. Loop safety: this layout route stays
  // mounted across child navigations, so the flag below never re-arms and a
  // later visit to "/" can never bounce back; the session gate means the
  // target's own beforeLoad (anonymous → /login) cannot fire, so no redirect
  // chain ever starts.
  let didInitialSectionRedirect = false;
  onMount(() => {
    if (didInitialSectionRedirect) {
      return;
    }
    didInitialSectionRedirect = true;

    const redirectToLastSection = async () => {
      const session = await authClient.getSession();
      if (
        session.data &&
        toPersistedShellMode(readPersistedLocalValue(shellModeLocalStorageKey)) === "library" &&
        location().pathname !== "/dashboard"
      ) {
        void navigate({ to: "/dashboard", replace: true });
      }
    };

    void redirectToLastSection();
  });

  return <AppShell mode={mode()} />;
}
