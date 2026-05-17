import { writeFileSync } from "node:fs";
import { resolve } from "node:path";

const args = process.argv.slice(2);
const domainIndex = args.indexOf("--domain");
const domain =
  domainIndex !== -1 && args[domainIndex + 1]
    ? args[domainIndex + 1]
    : "feedelity.dbuild.dev";

const repoRoot = resolve(import.meta.dirname, "..");
const distDir = resolve(repoRoot, "apps/docs/dist/client");

writeFileSync(resolve(distDir, "CNAME"), `${domain}\n`);

console.log(`Deploying docs from ${distDir} to gh-pages (domain: ${domain})`);

const proc = Bun.spawnSync(
  [
    "npx",
    "gh-pages",
    "-d",
    distDir,
    "-m",
    "Deploy docs site",
    "--nojekyll",
  ],
  {
    cwd: repoRoot,
    stdio: ["inherit", "inherit", "inherit"],
  },
);

if (proc.exitCode !== 0) {
  console.error("gh-pages deploy failed");
  process.exit(proc.exitCode ?? 1);
}

console.log(`Docs deployed to gh-pages branch (domain: ${domain})`);
