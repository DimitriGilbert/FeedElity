import { createFileRoute, redirect } from "@tanstack/solid-router";

import AppShell from "@/components/app-shell";
import { authClient } from "@/lib/auth-client";

export const Route = createFileRoute("/dashboard")({
  component: RouteComponent,
  beforeLoad: async ({ location }) => {
    const session = await authClient.getSession();
    if (!session.data) {
      redirect({
        to: "/login",
        search: {
          redirect: location.href,
        },
        throw: true,
      });
    }
    return { session };
  },
});

function RouteComponent() {
  return <AppShell mode="library" />;
}
