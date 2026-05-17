import { createFileRoute } from "@tanstack/react-router";

import { DocsLayout } from "~/components/docs-layout";

export const Route = createFileRoute("/docs/developer")({
  head: () => ({
    meta: [
      { title: "Developer Docs - FeedElity Docs" },
      {
        name: "description",
        content:
          "Developer documentation for FeedElity. Architecture, contributing, and extending the platform.",
      },
    ],
  }),
  component: DeveloperPage,
});

function DeveloperPage() {
  return (
    <DocsLayout>
      <main className="max-w-3xl">
        <h1 className="text-4xl font-bold tracking-tight text-neutral-50">
          Developer Docs
        </h1>
        <p className="mt-6 text-lg leading-relaxed text-neutral-400">
          Developer documentation for FeedElity is coming soon.
        </p>
      </main>
    </DocsLayout>
  );
}
