import { createForm } from "@tanstack/solid-form";
import { useNavigate, useSearch } from "@tanstack/solid-router";
import { createSignal, For, Show } from "solid-js";
import z from "zod";

import { getPostAuthRedirect, signInWithEmailPassword } from "@/lib/auth-helpers";
import { client } from "@/utils/orpc";

interface MigratedPasswordSetupFormProps {
  readonly onSwitchToSignIn: () => void;
}

export default function MigratedPasswordSetupForm(props: MigratedPasswordSetupFormProps) {
  const [submitError, setSubmitError] = createSignal<string | null>(null);
  const navigate = useNavigate({
    from: "/login",
  });
  const search = useSearch({ from: "/login" });

  const form = createForm(() => ({
    defaultValues: {
      email: "",
      name: "",
      password: "",
    },
    onSubmit: async ({ value }) => {
      setSubmitError(null);
      const trimmedName = value.name.trim();
      const email = value.email.trim().toLowerCase();

      try {
        await client.auth.setupMigratedPassword({
          email,
          password: value.password,
          ...(trimmedName.length === 0 ? {} : { name: trimmedName }),
        });
        await signInWithEmailPassword({ email, password: value.password }, () => {
          navigate({
            to: getPostAuthRedirect(search().redirect),
            search: { redirect: undefined },
          });
        });
      } catch (error) {
        setSubmitError(error instanceof Error ? error.message : "Password setup failed.");
      }
    },
    validators: {
      onSubmit: z.object({
        email: z.email("Invalid email address"),
        name: z.string(),
        password: z.string().min(8, "Password must be at least 8 characters"),
      }),
    },
  }));

  return (
    <div class="mx-auto mt-10 w-full max-w-md p-6 text-foreground">
      <h1 class="mb-3 text-center text-2xl font-semibold tracking-tight">Set your password</h1>
      <p class="mb-6 text-center text-sm leading-6 text-muted-foreground">
        Use this for accounts imported from the old FeedElity export. Enter the same email address and choose a new password.
      </p>

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
          <form.Field name="name">
            {(field) => (
              <div class="space-y-2">
                <label for={field().name} class="text-sm font-medium text-muted-foreground">Display name</label>
                <input
                  id={field().name}
                  name={field().name}
                  value={field().state.value}
                  onBlur={field().handleBlur}
                  onInput={(e) => field().handleChange(e.currentTarget.value)}
                  class="w-full border border-input bg-background p-2 text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                />
                <p class="text-xs text-muted-foreground">Optional. Leave blank to keep the imported name.</p>
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
                <label for={field().name} class="text-sm font-medium text-muted-foreground">New password</label>
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
              {state().isSubmitting ? "Setting password..." : "Set Password and Sign In"}
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
          onClick={props.onSwitchToSignIn}
          class="text-sm text-muted-foreground hover:text-foreground hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          Back to sign in
        </button>
      </div>
    </div>
  );
}
