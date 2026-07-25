// Docker HEALTHCHECK for the FeedElity server.
//
// Probes the server's root health route ("GET /" -> 200 "OK") over the in-container
// port. Exits 0 when healthy (docker considers the container up), 1 otherwise.
// Uses Bun's fetch with a short timeout so a wedged server is flagged unhealthy.
const port = process.env.PORT ?? "31001";
const url = `http://127.0.0.1:${port}/`;

try {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 3000);

  const response = await fetch(url, { signal: controller.signal });
  clearTimeout(timeout);

  if (response.ok) {
    process.exit(0);
  }
  console.error(`healthcheck: unexpected status ${response.status} from ${url}`);
  process.exit(1);
} catch (error) {
  console.error(`healthcheck: request to ${url} failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
