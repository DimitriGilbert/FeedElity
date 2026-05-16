import { BrowserWindow, Updater } from "electrobun/bun";

import { addDesktopRuntimeQuery, startConfiguredDesktopBackend } from "./local-backend";

const DEV_SERVER_PORT = 3001;
const DEV_SERVER_URL = `http://localhost:${DEV_SERVER_PORT}`;
const startedBackend = await startConfiguredDesktopBackend();

// Check if the web dev server is running for HMR
async function getMainViewUrl(): Promise<string> {
  const channel = await Updater.localInfo.channel();
  if (channel === "dev") {
    try {
      await fetch(DEV_SERVER_URL, { method: "HEAD" });
      return addDesktopRuntimeQuery(DEV_SERVER_URL, startedBackend.config);
    } catch (error) {
      if (!(error instanceof Error)) {
        throw new Error(`Desktop HMR probe failed with an unknown error: ${String(error)}`);
      }
    }
  }

  if (startedBackend.config.mode === "desktop-local") {
    return addDesktopRuntimeQuery(`${startedBackend.config.serverUrl}/`, startedBackend.config);
  }

  return addDesktopRuntimeQuery("views://mainview/index.html", startedBackend.config);
}

const url = await getMainViewUrl();

new BrowserWindow({
  title: "FeedElity",
  url,
  frame: {
    width: 1280,
    height: 820,
    x: 120,
    y: 120,
  },
});
