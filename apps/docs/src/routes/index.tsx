import { createFileRoute } from "@tanstack/react-router";

import { Hero } from "~/components/hero";
import { Features } from "~/components/features";
import { buildSeo } from "~/lib/seo";
import screenshotUrl from "../../public/screenshot.webp";

export const Route = createFileRoute("/")({
  head: () =>
    buildSeo({
      title: "FeedElity - Self-Hosted Video RSS Client",
      description:
        "Follow creators across YouTube, Odysee, and PeerTube in one fast, self-hosted interface. No tracking, no algorithms, just your content.",
      pathname: "/",
    }),
  component: HomePage,
});

function HomePage() {
  return (
    <main>
      <Hero />
      <section className="relative border-b border-neutral-800/50 bg-neutral-950">
        <div className="mx-auto max-w-6xl px-6 py-16 md:py-24">
          <div className="overflow-hidden rounded-xl border border-neutral-800 shadow-2xl shadow-blue-500/5">
            <img
              src={screenshotUrl}
              alt="FeedElity three-column interface with a video opened in the viewer"
              width={1280}
              height={577}
              loading="lazy"
              className="block w-full"
            />
          </div>
        </div>
      </section>
      <Features />
    </main>
  );
}
