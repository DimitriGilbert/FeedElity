import { cpSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { resolve } from "node:path";

const args = process.argv.slice(2);
const domainIndex = args.indexOf("--domain");
const domain = domainIndex !== -1 && args[domainIndex + 1]
  ? args[domainIndex + 1]
  : "feedelity.dbuild.dev";

const repoRoot = resolve(import.meta.dirname, "..");
const distDir = resolve(repoRoot, "apps/docs/dist/client");

function run(command: string, args: string[]): number {
  const proc = Bun.spawnSync([command, ...args], {
    cwd: repoRoot,
    stdio: ["inherit", "inherit", "inherit"],
  });
  if (proc.exitCode !== 0) {
    console.error(`Failed: ${command} ${args.join(" ")}`);
    process.exit(proc.exitCode ?? 1);
  }
  return proc.exitCode;
}

function getOutput(command: string, args: string[]): string {
  const proc = Bun.spawnSync([command, ...args], {
    cwd: repoRoot,
    stdout: "pipe",
    stderr: "pipe",
  });
  if (proc.exitCode !== 0) {
    console.error(`Failed: ${command} ${args.join(" ")}`);
    process.exit(proc.exitCode ?? 1);
  }
  return proc.stdout.toString().trim();
}

console.log("Building docs site...");
run("bun", ["run", "build", "--filter", "docs"]);

const gitStatus = getOutput("git", ["status", "--porcelain", "-uno"]);
if (gitStatus.length > 0) {
  console.error("Working tree has uncommitted changes. Commit or stash before deploying.");
  process.exit(1);
}

const originalBranch = getOutput("git", ["rev-parse", "--abbrev-ref", "HEAD"]);

const tempDir = resolve(repoRoot, ".gh-pages-temp");
rmSync(tempDir, { recursive: true, force: true });
mkdirSync(tempDir, { recursive: true });
cpSync(distDir, tempDir, { recursive: true });

writeFileSync(resolve(tempDir, "CNAME"), `${domain}\n`);

const branchExists = getOutput("git", ["branch", "--list", "gh-pages"]);

run("git", ["checkout", "--orphan", "gh-pages"]);
run("git", ["rm", "-rf", "."]);
cpSync(tempDir, repoRoot, { recursive: true });
rmSync(tempDir, { recursive: true, force: true });

run("git", ["add", "-A"]);
run("git", ["commit", "-m", "Deploy docs site"]);
run("git", ["push", "origin", "gh-pages", "--force"]);

if (branchExists) {
  run("git", ["checkout", originalBranch]);
} else {
  run("git", ["checkout", originalBranch]);
  run("git", ["branch", "-D", "gh-pages"]);
}

console.log(`Docs deployed to gh-pages branch (domain: ${domain})`);
