import { Link } from "@tanstack/react-router";

import { Separator } from "~/components/ui/separator";

function Footer() {
  return (
    <footer className="border-t border-neutral-800/50 bg-neutral-950">
      <div className="mx-auto max-w-6xl px-6 py-16">
        <div className="flex flex-col items-start justify-between gap-10 md:flex-row md:items-center">
          <div>
            <Link
              to="/"
              className="text-lg font-bold tracking-tight text-neutral-50"
            >
              FeedElity
            </Link>
            <p className="mt-2 max-w-xs text-sm text-neutral-500">
              Personal-first, video-oriented RSS client. Self-hosted, private,
              modern.
            </p>
          </div>

          <nav className="flex flex-col gap-3 text-sm">
            <a
              href="#features"
              className="text-neutral-400 transition-colors hover:text-neutral-50"
            >
              Features
            </a>
            <Link
              to="/docs/getting-started"
              className="text-neutral-400 transition-colors hover:text-neutral-50"
            >
              Documentation
            </Link>
            <a
              href="https://github.com/anomalyco/FeedElity"
              target="_blank"
              rel="noopener noreferrer"
              className="text-neutral-400 transition-colors hover:text-neutral-50"
            >
              GitHub
            </a>
          </nav>
        </div>

        <Separator className="my-10" />

        <div className="flex flex-col items-center justify-between gap-4 text-xs text-neutral-600 sm:flex-row">
          <p>Open source under the MIT License.</p>
          <p>
            &copy; {new Date().getFullYear()} FeedElity contributors.
          </p>
        </div>
      </div>
    </footer>
  );
}

export { Footer };
