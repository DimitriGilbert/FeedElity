import { createFileRoute } from "@tanstack/solid-router";
import { createSignal, Match, Switch } from "solid-js";

import MigratedPasswordSetupForm from "@/components/migrated-password-setup-form";
import SignInForm from "@/components/sign-in-form";
import SignUpForm from "@/components/sign-up-form";

export const Route = createFileRoute("/login")({
  validateSearch: (search: Record<string, unknown>) => ({
    redirect: typeof search.redirect === "string" ? search.redirect : undefined,
  }),
  component: RouteComponent,
});

function RouteComponent() {
  const [authMode, setAuthMode] = createSignal<"sign-in" | "sign-up" | "password-setup">("sign-in");

  return (
    <Switch>
      <Match when={authMode() === "sign-in"}>
        <SignInForm onSwitchToPasswordSetup={() => setAuthMode("password-setup")} onSwitchToSignUp={() => setAuthMode("sign-up")} />
      </Match>
      <Match when={authMode() === "sign-up"}>
        <SignUpForm onSwitchToSignIn={() => setAuthMode("sign-in")} />
      </Match>
      <Match when={authMode() === "password-setup"}>
        <MigratedPasswordSetupForm onSwitchToSignIn={() => setAuthMode("sign-in")} />
      </Match>
    </Switch>
  );
}
