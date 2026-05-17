import { createFileRoute } from "@tanstack/react-router";

import { Hero } from "~/components/hero";
import { Features } from "~/components/features";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "FeedElity - Self-Hosted Video RSS Client" },
      {
        name: "description",
        content:
          "Follow creators across YouTube, Odysee, and PeerTube in one fast, self-hosted interface. No tracking, no algorithms, just your content.",
      },
    ],
  }),
  component: HomePage,
});

function HomePage() {
  return (
    <main>
      <Hero />
      <Features />
    </main>
  );
}
