import { existsSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const rootDir = resolve(import.meta.dir, "..");
const nativeDir = join(rootDir, ".native", "linux-x64");
const rpmDir = join(nativeDir, "rpms");
const extractedDir = join(nativeDir, "extracted");
const libDir = join(extractedDir, "usr", "lib64");

const requiredLibraries = ["libayatana-appindicator3.so.1", "libayatana-indicator3.so.7", "libayatana-ido3-0.4.so.0"] as const;

const rpmPackages = ["libayatana-appindicator-gtk3", "libayatana-indicator-gtk3", "libayatana-ido-gtk3"] as const;

function run(command: readonly string[], options: { readonly cwd?: string } = {}): void {
  const result = Bun.spawnSync(command, {
    cwd: options.cwd,
    stdout: "inherit",
    stderr: "inherit",
  });

  if (!result.success) {
    throw new Error(`Command failed: ${command.join(" ")}`);
  }
}

function commandExists(command: string): boolean {
  const result = Bun.spawnSync(["sh", "-c", `command -v ${command}`], {
    stdout: "ignore",
    stderr: "ignore",
  });

  return result.success;
}

function hasPreparedLibraries(): boolean {
  return requiredLibraries.every((library) => existsSync(join(libDir, library)));
}

if (process.platform !== "linux" || process.arch !== "x64") {
  process.exit(0);
}

if (hasPreparedLibraries()) {
  process.exit(0);
}

if (!commandExists("dnf") || !commandExists("rpm2cpio") || !commandExists("cpio")) {
  throw new Error(
    "Linux desktop builds need Ayatana appindicator libraries. Install libayatana-appindicator-gtk3, or provide dnf, rpm2cpio, and cpio so this script can prepare user-local libraries.",
  );
}

mkdirSync(rpmDir, { recursive: true });
mkdirSync(extractedDir, { recursive: true });

run(["dnf", "download", "--destdir", rpmDir, ...rpmPackages]);

for (const packageName of rpmPackages) {
  const rpmPath = new Bun.Glob(`${packageName}-*.x86_64.rpm`).scanSync({ cwd: rpmDir }).next().value;
  if (typeof rpmPath !== "string") {
    throw new Error(`Downloaded RPM not found for ${packageName}`);
  }

  mkdirSync(dirname(join(extractedDir, rpmPath)), { recursive: true });
  run(["sh", "-c", `rpm2cpio ${JSON.stringify(join(rpmDir, rpmPath))} | cpio -idmu -D ${JSON.stringify(extractedDir)}`]);
}

if (!hasPreparedLibraries()) {
  throw new Error(`Ayatana libraries were not prepared in ${libDir}`);
}
