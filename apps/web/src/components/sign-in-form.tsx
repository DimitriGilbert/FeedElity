import { createForm } from "@tanstack/solid-form";
import { useNavigate } from "@tanstack/solid-router";
import { createSignal, For, Show } from "solid-js";
import z from "zod";

import { authClient } from "@/lib/auth-client";

export default function SignInForm({ onSwitchToSignUp }: { onSwitchToSignUp: () => void }) {
  const [submitError, setSubmitError] = createSignal<string | null>(null);
  const navigate = useNavigate({
    from: "/",
  });

  const form = createForm(() => ({
    defaultValues: {
      email: "",
      password: "",
    },
    onSubmit: async ({ value }) => {
      setSubmitError(null);
      await authClient.signIn.email(
        {
          email: value.email,
          password: value.password,
        },
        {
          onSuccess: () => {
            navigate({
              to: "/dashboard",
            });
          },
          onError: (error) => {
            setSubmitError(error.error.message);
          },
        },
      );
    },
    validators: {
      onSubmit: z.object({
        email: z.email("Invalid email address"),
        password: z.string().min(8, "Password must be at least 8 characters"),
      }),
    },
  }));

  return (
    <div class="mx-auto mt-10 w-full max-w-md p-6 text-foreground">
      <h1 class="mb-6 text-center text-2xl font-semibold tracking-tight">Welcome back</h1>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          e.stopPropagation();
          form.handleSubmit();
        }}
        class="space-y-4"
      >
        <div>
          <form.Field name="email">
            {(field) => (
              <div class="space-y-2">
                <label for={field().name} class="text-sm font-medium text-muted-foreground">Email</label>
                <input
                  id={field().name}
                  name={field().name}
                  type="email"
                  value={field().state.value}
                  onBlur={field().handleBlur}
                  onInput={(e) => field().handleChange(e.currentTarget.value)}
                  class="w-full border border-input bg-background p-2 text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                />
                <For each={field().state.meta.errors}>
                  {(error) => <p class="text-sm text-destructive">{error?.message}</p>}
                </For>
              </div>
            )}
          </form.Field>
        </div>

        <div>
          <form.Field name="password">
            {(field) => (
              <div class="space-y-2">
                <label for={field().name} class="text-sm font-medium text-muted-foreground">Password</label>
                <input
                  id={field().name}
                  name={field().name}
                  type="password"
                  value={field().state.value}
                  onBlur={field().handleBlur}
                  onInput={(e) => field().handleChange(e.currentTarget.value)}
                  class="w-full border border-input bg-background p-2 text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                />
                <For each={field().state.meta.errors}>
                  {(error) => <p class="text-sm text-destructive">{error?.message}</p>}
                </For>
              </div>
            )}
          </form.Field>
        </div>

        <form.Subscribe>
          {(state) => (
            <button
              type="submit"
              class="w-full border border-border bg-primary p-2 font-semibold text-primary-foreground hover:bg-accent hover:text-accent-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:opacity-50"
              disabled={!state().canSubmit || state().isSubmitting}
            >
              {state().isSubmitting ? "Submitting..." : "Sign In"}
            </button>
          )}
        </form.Subscribe>
        <Show when={submitError()}>
          {(message) => <p class="text-sm text-destructive" role="alert">{message()}</p>}
        </Show>
      </form>

      <div class="mt-4 text-center">
        <button
          type="button"
          onClick={onSwitchToSignUp}
          class="text-sm text-muted-foreground hover:text-foreground hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          Need an account? Sign up
        </button>
      </div>
    </div>
  );
}
