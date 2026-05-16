import { cpSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";

const rootDir = resolve(import.meta.dir, "..");
const desktopBuildDir = join(rootDir, "apps", "desktop", "build");
const ayatanaLibDir = join(rootDir, ".native", "linux-x64", "extracted", "usr", "lib64");
const libsqlNativePackageDir = join(
  rootDir,
  "node_modules",
  ".bun",
  "@libsql+linux-x64-gnu@0.5.22",
  "node_modules",
  "@libsql",
  "linux-x64-gnu",
);

const requiredLibraries = ["libayatana-appindicator3.so.1", "libayatana-indicator3.so.7", "libayatana-ido3-0.4.so.0"] as const;

if (process.platform !== "linux" || process.arch !== "x64") {
  process.exit(0);
}

if (!existsSync(desktopBuildDir)) {
  throw new Error(`Desktop build directory does not exist: ${desktopBuildDir}`);
}

if (!existsSync(libsqlNativePackageDir)) {
  throw new Error(`libSQL native package is missing: ${libsqlNativePackageDir}`);
}

const appDirs = readdirSync(desktopBuildDir, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => join(desktopBuildDir, entry.name));

for (const appDir of appDirs) {
  const entries = readdirSync(appDir, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }

    const bundleRoot = join(appDir, entry.name);
    const binDir = join(bundleRoot, "bin");
    const bunAppDir = join(bundleRoot, "Resources", "app", "bun");
    if (!existsSync(binDir) || !existsSync(bunAppDir)) {
      continue;
    }

    for (const library of requiredLibraries) {
      const source = join(ayatanaLibDir, library);
      if (!existsSync(source)) {
        throw new Error(`Prepared Ayatana library is missing: ${source}`);
      }

      cpSync(source, join(binDir, library));
    }

    const libsqlTargetDir = join(bunAppDir, "node_modules", "@libsql", "linux-x64-gnu");
    mkdirSync(libsqlTargetDir, { recursive: true });
    cpSync(libsqlNativePackageDir, libsqlTargetDir, { recursive: true });
  }
}
