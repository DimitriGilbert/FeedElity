import { Menu, X } from "lucide-react";
import { useState } from "react";

import { Link } from "@tanstack/react-router";

import { Button } from "~/components/ui/button";

function Nav() {
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <header className="fixed top-0 z-50 w-full border-b border-neutral-800/50 bg-neutral-950/80 backdrop-blur-xl">
      <nav className="mx-auto flex h-16 max-w-6xl items-center justify-between px-6">
        <Link
          to="/"
          className="text-xl font-bold tracking-tight text-neutral-50 transition-colors hover:text-neutral-300"
        >
          FeedElity
        </Link>

        <div className="hidden items-center gap-8 md:flex">
          <a
            href="#features"
            className="text-sm text-neutral-400 transition-colors hover:text-neutral-50"
          >
            Features
          </a>
          <Link
            to="/docs/getting-started"
            className="text-sm text-neutral-400 transition-colors hover:text-neutral-50"
          >
            Docs
          </Link>
          <a
            href="https://github.com/anomalyco/FeedElity"
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm text-neutral-400 transition-colors hover:text-neutral-50"
          >
            GitHub
          </a>
        </div>

        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" asChild>
            <a
              href="https://github.com/anomalyco/FeedElity"
              target="_blank"
              rel="noopener noreferrer"
            >
              <svg
                className="size-4"
                fill="currentColor"
                viewBox="0 0 24 24"
                aria-hidden="true"
              >
                <path
                  fillRule="evenodd"
                  d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z"
                  clipRule="evenodd"
                />
              </svg>
              <span className="hidden sm:inline">GitHub</span>
            </a>
          </Button>

          <Button
            variant="ghost"
            size="icon"
            className="md:hidden"
            onClick={() => setMobileOpen((prev) => !prev)}
            aria-label={mobileOpen ? "Close menu" : "Open menu"}
          >
            {mobileOpen ? <X className="size-5" /> : <Menu className="size-5" />}
          </Button>
        </div>
      </nav>

      {mobileOpen && (
        <div className="border-t border-neutral-800/50 bg-neutral-950/95 backdrop-blur-xl md:hidden">
          <div className="mx-auto flex max-w-6xl flex-col gap-4 px-6 py-4">
            <a
              href="#features"
              className="text-sm text-neutral-400 transition-colors hover:text-neutral-50"
              onClick={() => setMobileOpen(false)}
            >
              Features
            </a>
            <Link
              to="/docs/getting-started"
              className="text-sm text-neutral-400 transition-colors hover:text-neutral-50"
              onClick={() => setMobileOpen(false)}
            >
              Docs
            </Link>
            <a
              href="https://github.com/anomalyco/FeedElity"
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm text-neutral-400 transition-colors hover:text-neutral-50"
              onClick={() => setMobileOpen(false)}
            >
              GitHub
            </a>
          </div>
        </div>
      )}
    </header>
  );
}

export { Nav };
