import { webRuntimeConfig } from "@FeedElity/env/web";
import { createAuthClient } from "better-auth/solid";

export const authClient = createAuthClient({
  baseURL: webRuntimeConfig.serverUrl,
});
