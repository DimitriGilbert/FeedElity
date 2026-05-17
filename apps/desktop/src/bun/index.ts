import { BrowserWindow, GlobalShortcut, Updater } from "electrobun/bun";

import { addDesktopRuntimeQuery, startConfiguredDesktopBackend, type DesktopRuntimeConfig } from "./local-backend";

const DEV_SERVER_PORT = 3001;
const DEV_SERVER_URL = `http://localhost:${DEV_SERVER_PORT}`;

interface MainViewResolution {
  readonly channel: string;
  readonly url: string;
}

// Check if the web dev server is running for HMR
async function getMainViewUrl(config: DesktopRuntimeConfig): Promise<MainViewResolution> {
  const channel = await Updater.localInfo.channel();
  if (channel === "dev") {
    try {
      await fetch(DEV_SERVER_URL, { method: "HEAD" });
      return { channel, url: addDesktopRuntimeQuery(DEV_SERVER_URL, config) };
    } catch (error) {
      if (error instanceof Error) {
        console.warn(`Desktop HMR probe failed, falling back to packaged static view: ${error.message}`);
      } else {
        throw new Error(`Desktop HMR probe failed with an unknown error: ${String(error)}`);
      }
    }
  }

  if (config.mode === "desktop-local") {
    return { channel, url: addDesktopRuntimeQuery(`${config.serverUrl}/`, config) };
  }

  return { channel, url: addDesktopRuntimeQuery("views://mainview/index.html", config) };
}

async function startDesktopApp(): Promise<void> {
  const startedBackend = await startConfiguredDesktopBackend();
  const mainView = await getMainViewUrl(startedBackend.config);

  const mainWindow = new BrowserWindow({
    title: "FeedElity",
    url: mainView.url,
    renderer: "cef",
    frame: {
      width: 1440,
      height: 900,
      x: 120,
      y: 120,
    },
  });

  if (mainView.channel === "dev") {
    GlobalShortcut.register("CommandOrControl+Shift+I", () => {
      mainWindow.webview.toggleDevTools();
    });

    if (process.env.FEELITY_DESKTOP_OPEN_DEVTOOLS === "1") {
      mainWindow.webview.openDevTools();
    }
  }
}

try {
  await startDesktopApp();
} catch (error) {
  console.error(`FeedElity desktop failed to start: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
