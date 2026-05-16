import { expect, test } from "bun:test";

function installBrowserGlobals() {
  const documentStub = {
    addEventListener: (_eventName: string) => {},
    removeEventListener: (_eventName: string) => {},
    getElementById: (_id: string) => null,
    importNode: (node: { cloneNode: (deep?: boolean) => unknown }) => node.cloneNode(true),
    createElement: (_tagName: string) => ({
      cloneNode: (_deep?: boolean) => ({}),
      content: {
        firstChild: {
          cloneNode: (_deep?: boolean) => ({}),
        },
      },
      innerHTML: "",
    }),
  };

  const windowStub = {
    addEventListener: (_eventName: string) => {},
    removeEventListener: (_eventName: string) => {},
    document: documentStub,
    history: {
      state: null,
      pushState: (_state: unknown, _title: string, _url?: string | URL | null) => {},
      replaceState: (_state: unknown, _title: string, _url?: string | URL | null) => {},
    },
    location: new URL("http://localhost/"),
  };

  Object.defineProperty(globalThis, "document", { value: documentStub, configurable: true });
  Object.defineProperty(globalThis, "window", { value: windowStub, configurable: true });
}

test("web bootstrap initializes the app router without rendering at import time", async () => {
  installBrowserGlobals();

  const { routeTree } = await import("./routeTree.gen");
  const { App, createAppRouter } = await import("./main");
  const router = createAppRouter();

  expect(typeof App).toBe("function");
  expect(router.options.routeTree).toBe(routeTree);
  expect(router.options.defaultPreload).toBe("intent");
  expect(router.routesByPath["/"].fullPath).toBe("/");
  expect(router.routesByPath["/dashboard"].fullPath).toBe("/dashboard");
  expect(router.routesByPath["/login"].fullPath).toBe("/login");
  expect(Object.keys(router.routesByPath)).not.toContain("/todos");
});
