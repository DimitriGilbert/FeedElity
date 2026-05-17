import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/docs/getting-started")({
  head: () => ({
    meta: [
      { title: "Getting Started - FeedElity Docs" },
      {
        name: "description",
        content:
          "Get started with FeedElity. Installation, configuration, and first steps.",
      },
    ],
  }),
  component: GettingStartedPage,
});

function GettingStartedPage() {
  return (
    <main className="mx-auto max-w-3xl px-6 pt-32 pb-24">
      <h1 className="text-4xl font-bold tracking-tight text-neutral-50">
        Getting Started
      </h1>
      <p className="mt-6 text-lg leading-relaxed text-neutral-400">
        FeedElity is a personal-first, video-oriented RSS client. Documentation
        is coming soon.
      </p>
    </main>
  );
}
