import { beforeAll, expect, test } from "bun:test";

beforeAll(() => {
  process.env.RUNTIME_MODE = "local";
  process.env.DATABASE_URL = "file::memory:";
  process.env.BETTER_AUTH_SECRET = "server-smoke-test-secret-minimum-32";
  process.env.BETTER_AUTH_URL = "http://localhost:3002";
  process.env.CORS_ORIGIN = "http://localhost:3001";
  process.env.PORT = "3002";
  process.env.NODE_ENV = "test";
});

test("server bootstrap responds to the health endpoint", async () => {
  const { app } = await import("./index");

  const response = await app.request("/");

  expect(response.status).toBe(200);
  expect(await response.text()).toBe("OK");
});
