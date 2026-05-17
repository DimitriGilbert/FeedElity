import { BrowserWindow, GlobalShortcut, Updater } from "electrobun/bun";

import { addDesktopRuntimeQuery, startConfiguredDesktopBackend } from "./local-backend";

const DEV_SERVER_PORT = 3001;
const DEV_SERVER_URL = `http://localhost:${DEV_SERVER_PORT}`;
const startedBackend = await startConfiguredDesktopBackend();

interface MainViewResolution {
  readonly channel: string;
  readonly url: string;
}

// Check if the web dev server is running for HMR
async function getMainViewUrl(): Promise<MainViewResolution> {
  const channel = await Updater.localInfo.channel();
  if (channel === "dev") {
    try {
      await fetch(DEV_SERVER_URL, { method: "HEAD" });
      return { channel, url: addDesktopRuntimeQuery(DEV_SERVER_URL, startedBackend.config) };
    } catch (error) {
      if (!(error instanceof Error)) {
        throw new Error(`Desktop HMR probe failed with an unknown error: ${String(error)}`);
      }
    }
  }

  if (startedBackend.config.mode === "desktop-local") {
    return { channel, url: addDesktopRuntimeQuery(`${startedBackend.config.serverUrl}/`, startedBackend.config) };
  }

  return { channel, url: addDesktopRuntimeQuery("views://mainview/index.html", startedBackend.config) };
}

const mainView = await getMainViewUrl();

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

if (mainView.channel === "dev") {
  GlobalShortcut.register("CommandOrControl+Shift+I", () => {
    mainWindow.webview.toggleDevTools();
  });

  if (process.env.FEELITY_DESKTOP_OPEN_DEVTOOLS === "1") {
    mainWindow.webview.openDevTools();
  }
}
