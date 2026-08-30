import { SolidQueryDevtools } from "@tanstack/solid-query-devtools";
import { TanStackRouterDevtools } from "@tanstack/solid-router-devtools";

// Dev-only debugging overlay. __root.tsx lazy-imports this module and renders
// it only while import.meta.env.DEV is true, so the devtools packages stay in
// their own chunk and never ship code in the production main bundle.
export default function DevTools() {
  return (
    <>
      <SolidQueryDevtools />
      <TanStackRouterDevtools />
    </>
  );
}
