import { describe, expect, test } from "bun:test";

import { appendRuntimePath, parseDesktopLocalPortConfig, parseDesktopRemoteServerConfig, parseWebRuntimeConfig } from "./runtime";

describe("web runtime config", () => {
  test("defaults browser-local mode and normalizes the server URL", () => {
    const config = parseWebRuntimeConfig({ VITE_SERVER_URL: "http://localhost:3002/" });

    expect(config).toEqual({
      mode: "local",
      serverUrl: "http://localhost:3002",
      rpcUrl: "http://localhost:3002/rpc",
    });
  });

  test("accepts explicit web and desktop modes", () => {
    expect(
      parseWebRuntimeConfig({
        VITE_RUNTIME_MODE: "web",
        VITE_SERVER_URL: "https://api.feedelity.example",
      }).mode,
    ).toBe("web");
    expect(
      parseWebRuntimeConfig({
        VITE_RUNTIME_MODE: "desktop-local",
        VITE_SERVER_URL: "http://127.0.0.1:3002",
      }).mode,
    ).toBe("desktop-local");
    expect(
      parseWebRuntimeConfig({
        VITE_RUNTIME_MODE: "desktop-remote",
        VITE_SERVER_URL: "https://api.feedelity.example",
      }).mode,
    ).toBe("desktop-remote");
  });

  test("rejects invalid server URLs", () => {
    expect(() => parseWebRuntimeConfig({ VITE_SERVER_URL: "file:../../local.db" })).toThrow();
  });
});

describe("runtime URL paths", () => {
  test("appends paths without preserving accidental trailing slashes", () => {
    expect(appendRuntimePath("http://localhost:3002///", "/rpc")).toBe("http://localhost:3002/rpc");
  });
});

describe("desktop local port config", () => {
  test("defaults to the deterministic non-3000 desktop port", () => {
    expect(parseDesktopLocalPortConfig()).toBe(3217);
  });

  test("accepts an explicit valid desktop port", () => {
    expect(parseDesktopLocalPortConfig({ FEELITY_DESKTOP_PORT: "33217" })).toBe(33217);
  });

  test("rejects port 3000 and invalid port values", () => {
    expect(() => parseDesktopLocalPortConfig({ FEELITY_DESKTOP_PORT: "3000" })).toThrow();
    expect(() => parseDesktopLocalPortConfig({ FEELITY_DESKTOP_PORT: "70000" })).toThrow();
  });
});

describe("desktop remote server config", () => {
  test("normalizes an explicit HTTP(S) remote server URL", () => {
    expect(parseDesktopRemoteServerConfig({ FEELITY_DESKTOP_REMOTE_SERVER_URL: "https://api.feedelity.example///" })).toBe(
      "https://api.feedelity.example",
    );
  });

  test("rejects missing and non-HTTP(S) remote server URLs", () => {
    expect(() => parseDesktopRemoteServerConfig({})).toThrow();
    expect(() => parseDesktopRemoteServerConfig({ FEELITY_DESKTOP_REMOTE_SERVER_URL: "file:///tmp/feedelity.db" })).toThrow();
  });
});
