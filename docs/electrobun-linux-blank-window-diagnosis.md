# Electrobun Linux Blank Window Diagnosis

## Incident Summary

The FeedElity desktop app opened a native window, but the web UI was visually blank. The title bar appeared and the window background was dark, but no app chrome, header, navigation, catalog, or content columns were visible.

The issue was not a backend startup failure and not a Solid app mount failure. The app JavaScript was running and calling the local backend, but the Linux native renderer path was not painting the UI correctly.

The fix was to make the Linux Electrobun build actually use CEF instead of the GTK-only/native Linux wrapper, and to wire a dev-only DevTools shortcut through Electrobun's `BrowserView` API.

## User-Visible Symptom

The desktop app displayed an empty dark window with the title `FeedElity`.

The usual Electron shortcut did not work:

```text
Ctrl+Shift+I does not open DevTools
```

That shortcut behavior was misleading because Electrobun does not automatically provide Electron's DevTools shortcut. DevTools must be opened through Electrobun's webview API, for example `mainWindow.webview.openDevTools()` or `mainWindow.webview.toggleDevTools()`.

## Decisive Runtime Clues

These exact strings were important.

The app was using the GTK-only native wrapper on Linux:

```text
Using GTK-only native wrapper for Linux
```

The native wrapper confirmed GTK mode again:

```text
Updated libNativeWrapper.so for GTK-only mode
```

The renderer/compositor was failing to allocate buffers:

```text
Failed to create GBM buffer of size 1280x820: Invalid argument
Failed to create GBM buffer of size 1280x820: Invalid argument
```

There was also an X11/GLX error:

```text
X11 Error: GLXBadWindow (code 170)
```

The backend did start successfully:

```text
Server started at http://localhost:50000
```

The web app mounted and executed API requests:

```text
<-- OPTIONS /rpc/catalog/creators
--> OPTIONS /rpc/catalog/creators 204 0ms
<-- OPTIONS /rpc/catalog/contentItems
--> OPTIONS /rpc/catalog/contentItems 204 0ms
<-- POST /rpc/catalog/creators
<-- POST /rpc/catalog/contentItems
--> POST /rpc/catalog/contentItems 200 8ms
--> POST /rpc/catalog/creators 200 16ms
<-- GET /api/auth/get-session
--> GET /api/auth/get-session 200 3ms
```

Those API calls are produced by mounted UI code, specifically the catalog shell and user/session UI. This ruled out the common causes "the backend never started", "the page did not load", and "Solid never mounted".

After the fix, the build output changed to the expected CEF path:

```text
Using CEF (with weak linking) native wrapper for Linux
CEF dependencies found for linux-x64, using cached version
Copied CEF library to cef subdirectory: libcef.so
```

That was the strongest verification that Electrobun was no longer building/running the GTK-only native wrapper.

## Code Clues

The misleading configuration was in `apps/desktop/electrobun.config.ts`.

Before the fix:

```ts
linux: {
  bundleCEF: false,
  defaultRenderer: "cef",
},
```

This looked like it selected CEF because `defaultRenderer` was set to `"cef"`, but `bundleCEF: false` caused Electrobun's Linux build to choose the GTK-only native wrapper. On Linux, the wrapper choice is controlled by whether CEF is bundled.

After the fix:

```ts
linux: {
  bundleCEF: true,
  defaultRenderer: "cef",
},
```

The `BrowserWindow` creation was also made explicit in `apps/desktop/src/bun/index.ts`:

```ts
const mainWindow = new BrowserWindow({
  title: "FeedElity",
  url: mainView.url,
  renderer: "cef",
  frame: {
    width: 1280,
    height: 820,
    x: 120,
    y: 120,
  },
});
```

The dev-only DevTools shortcut was wired explicitly:

```ts
if (mainView.channel === "dev") {
  GlobalShortcut.register("CommandOrControl+Shift+I", () => {
    mainWindow.webview.toggleDevTools();
  });

  if (process.env.FEELITY_DESKTOP_OPEN_DEVTOOLS === "1") {
    mainWindow.webview.openDevTools();
  }
}
```

## Root Cause

The Linux desktop app was configured in a contradictory way: `defaultRenderer: "cef"` requested CEF as the renderer, but `bundleCEF: false` selected the GTK-only Linux native wrapper.

On Linux, Electrobun documentation recommends bundling CEF. Without CEF, Electrobun uses GTK/WebKit/native webviews, which are more dependent on the host graphics stack and have limitations. In this case, the runtime emitted GBM and GLX errors and rendered a blank window even though the web app was loaded and executing.

The core issue was therefore renderer selection and Linux graphics/webview compatibility, not application data flow.

## Secondary Suspect

The web app CSS uses modern OKLCH colors through Tailwind v4 theme variables:

```css
:root {
  --background: oklch(0.145 0.052 259);
  --foreground: oklch(0.93 0.035 102);
}

body {
  background-color: var(--background);
  color: var(--foreground);
}
```

This could have contributed if GTK/WebKit rejected modern CSS color syntax. However, the decisive fix was to use CEF on Linux. CSS fallback work should only be considered if native GTK/WebKit support is intentionally required.

## Why The API Logs Changed The Diagnosis

If the page had failed to load, there would be no app-originated API traffic.

The presence of these requests proved the UI runtime was alive:

```text
POST /rpc/catalog/creators
POST /rpc/catalog/contentItems
GET /api/auth/get-session
```

That moved the diagnosis away from server startup, route loading, Vite build output, and database migration, and toward rendering/painting/compositing.

## Fix Applied

Changed `apps/desktop/electrobun.config.ts`:

```diff
linux: {
-  bundleCEF: false,
+  bundleCEF: true,
  defaultRenderer: "cef",
},
```

Changed `apps/desktop/src/bun/index.ts`:

```diff
-import { BrowserWindow, Updater } from "electrobun/bun";
+import { BrowserWindow, GlobalShortcut, Updater } from "electrobun/bun";
```

Changed window creation:

```diff
-new BrowserWindow({
+const mainWindow = new BrowserWindow({
   title: "FeedElity",
-  url,
+  url: mainView.url,
+  renderer: "cef",
   frame: {
```

Added dev DevTools support:

```ts
GlobalShortcut.register("CommandOrControl+Shift+I", () => {
  mainWindow.webview.toggleDevTools();
});
```

Added optional automatic DevTools open:

```ts
if (process.env.FEELITY_DESKTOP_OPEN_DEVTOOLS === "1") {
  mainWindow.webview.openDevTools();
}
```

## Verification Commands

TypeScript verification passed:

```sh
bun --filter desktop check-types
```

Desktop tests passed:

```sh
bun --filter desktop test
```

Result:

```text
14 pass
0 fail
```

Desktop build passed:

```sh
bun --filter desktop build
```

Important successful build output:

```text
Using CEF (with weak linking) native wrapper for Linux
CEF dependencies found for linux-x64, using cached version
Copied CEF library to cef subdirectory: libcef.so
```

## Reusable Diagnostic Heuristic

For Electrobun blank windows on Linux, do not assume the app failed to start. First classify the failure:

1. If there are no backend logs and no HTTP requests, investigate backend startup, migration, port conflicts, or window URL construction.
2. If backend starts and app-originated requests are visible, the web app likely mounted; investigate renderer, paint, CSS compatibility, GPU/compositor, and DevTools access.
3. If logs contain `Using GTK-only native wrapper for Linux`, check `bundleCEF` immediately.
4. If logs contain `Failed to create GBM buffer`, suspect Linux graphics/native-webview rendering, especially with GTK/WebKit.
5. If `defaultRenderer: "cef"` is present but `bundleCEF: false` is also present, treat that as contradictory on Linux.
6. Do not rely on `Ctrl+Shift+I` behaving like Electron. Wire `webview.openDevTools()` or `webview.toggleDevTools()` explicitly.

## Knowledge Base Rule

When an Electrobun Linux app displays a blank window but API requests from the web UI are visible, prioritize renderer/compositor diagnosis over app bootstrap diagnosis.

The high-signal log combination is:

```text
Using GTK-only native wrapper for Linux
Failed to create GBM buffer of size ...: Invalid argument
POST /rpc/...
GET /api/auth/get-session
```

That combination means: native GTK renderer is active, graphics allocation is failing, but the web app JavaScript is running. The likely fix is to bundle and select CEF on Linux.
