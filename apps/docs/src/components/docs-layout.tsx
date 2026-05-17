import type { ReactNode } from "react";

import { Link, useRouterState } from "@tanstack/react-router";

interface DocsLayoutProps {
  children: ReactNode;
}

interface NavItem {
  label: string;
  to: string;
}

const navItems: NavItem[] = [
  { label: "Getting Started", to: "/docs/getting-started" },
  { label: "Self-Hosting", to: "/docs/self-hosting" },
  { label: "User Guide", to: "/docs/user-guide" },
  { label: "Developer Docs", to: "/docs/developer" },
];

function DocsLayout({ children }: DocsLayoutProps) {
  const router = useRouterState();
  const currentPath = router.location.pathname;

  return (
    <div className="mx-auto flex max-w-6xl gap-8 px-6 pt-24 pb-24">
      <aside className="hidden w-56 shrink-0 md:block">
        <nav className="sticky top-24 flex flex-col gap-1">
          <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-neutral-500">
            Documentation
          </p>
          {navItems.map((item) => {
            const isActive = currentPath === item.to;
            return (
              <Link
                key={item.to}
                to={item.to}
                className={`rounded-md px-3 py-2 text-sm transition-colors ${
                  isActive
                    ? "bg-neutral-800/60 font-medium text-neutral-50"
                    : "text-neutral-400 hover:bg-neutral-800/30 hover:text-neutral-200"
                }`}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>
      </aside>

      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

export { DocsLayout };
