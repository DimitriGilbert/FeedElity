import { useNavigate, Link } from "@tanstack/solid-router";
import { createSignal, Show } from "solid-js";

import { authClient } from "@/lib/auth-client";

const focusVisibleClass = "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";

export default function UserMenu() {
  const navigate = useNavigate();
  const session = authClient.useSession();
  const [isMenuOpen, setIsMenuOpen] = createSignal(false);

  return (
    <div class="relative inline-block text-left">
      <Show when={session().isPending}>
        <div class="h-8 w-28 animate-pulse border border-border bg-muted" />
      </Show>

      <Show when={!session().isPending && !session().data}>
        <Link
          to="/login"
          class={`inline-flex min-h-8 items-center border border-border bg-primary px-3 text-sm font-semibold text-primary-foreground transition duration-200 hover:bg-accent hover:text-accent-foreground ${focusVisibleClass}`}
        >
          Sign in
        </Link>
      </Show>

      <Show when={!session().isPending && session().data}>
        <button
          type="button"
          class={`inline-flex min-h-8 items-center border border-border bg-primary px-3 text-sm font-medium text-primary-foreground transition duration-200 hover:bg-accent hover:text-accent-foreground ${focusVisibleClass}`}
          onClick={() => setIsMenuOpen(!isMenuOpen())}
        >
          {session().data?.user.name}
        </button>

        <Show when={isMenuOpen()}>
          <div class="absolute right-0 mt-2 w-64 border border-border bg-popover p-2 text-popover-foreground">
            <div class="bg-muted px-3 py-3 text-sm text-muted-foreground">{session().data?.user.email}</div>
            <button
              type="button"
              class={`mt-2 w-full border border-border px-4 py-2 text-center text-sm text-foreground transition duration-200 hover:text-destructive ${focusVisibleClass}`}
              onClick={() => {
                setIsMenuOpen(false);
                authClient.signOut({
                  fetchOptions: {
                    onSuccess: () => {
                      navigate({ to: "/" });
                    },
                  },
                });
              }}
            >
              Sign Out
            </button>
          </div>
        </Show>
      </Show>
    </div>
  );
}
