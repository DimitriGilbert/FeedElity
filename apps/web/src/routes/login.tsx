import { createFileRoute } from "@tanstack/solid-router";
import { createSignal, Match, Switch } from "solid-js";

import SignInForm from "@/components/sign-in-form";
import SignUpForm from "@/components/sign-up-form";

export const Route = createFileRoute("/login")({
  validateSearch: (search: Record<string, unknown>) => ({
    redirect: typeof search.redirect === "string" ? search.redirect : undefined,
  }),
  component: RouteComponent,
});

function RouteComponent() {
  const [showSignIn, setShowSignIn] = createSignal(true);

  return (
    <Switch>
      <Match when={showSignIn()}>
        <SignInForm onSwitchToSignUp={() => setShowSignIn(false)} />
      </Match>
      <Match when={!showSignIn()}>
        <SignUpForm onSwitchToSignIn={() => setShowSignIn(true)} />
      </Match>
    </Switch>
  );
}
