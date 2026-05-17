import { authClient } from "@/lib/auth-client";

export interface EmailPasswordValue {
  readonly email: string;
  readonly password: string;
}

export function getPostAuthRedirect(redirect: string | undefined): string {
  if (redirect === undefined || !redirect.startsWith("/") || redirect.startsWith("//") || redirect.startsWith("/login")) {
    return "/dashboard";
  }

  return redirect;
}

export function signInWithEmailPassword(value: EmailPasswordValue, onSuccess: () => void): Promise<void> {
  return new Promise((resolve, reject) => {
    authClient.signIn.email(
      {
        email: value.email,
        password: value.password,
      },
      {
        onSuccess: () => {
          onSuccess();
          resolve();
        },
        onError: (error) => {
          reject(new Error(error.error.message));
        },
      },
    );
  });
}
