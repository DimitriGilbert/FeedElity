import { createFileRoute } from "@tanstack/react-router";

import { DocsLayout } from "~/components/docs-layout";

export const Route = createFileRoute("/docs/user-guide")({
  head: () => ({
    meta: [
      { title: "User Guide - FeedElity Docs" },
      {
        name: "description",
        content:
          "Learn how to use FeedElity. Subscriptions, browsing, playlists, favorites, and settings.",
      },
    ],
  }),
  component: UserGuidePage,
});

function UserGuidePage() {
  return (
    <DocsLayout>
      <main className="max-w-3xl">
        <h1 className="text-4xl font-bold tracking-tight text-neutral-50">
          User Guide
        </h1>
        <p className="mt-6 text-lg leading-relaxed text-neutral-400">
          Documentation for using FeedElity is coming soon.
        </p>
      </main>
    </DocsLayout>
  );
}
