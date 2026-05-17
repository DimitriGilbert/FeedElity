import { cpSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";

const rootDir = resolve(import.meta.dir, "..");
const desktopBuildDir = join(rootDir, "apps", "desktop", "build");
const ayatanaLibDir = join(rootDir, ".native", "linux-x64", "extracted", "usr", "lib64");
const bunNodeModulesDir = join(rootDir, "node_modules", ".bun");

const requiredLibraries = ["libayatana-appindicator3.so.1", "libayatana-indicator3.so.7", "libayatana-ido3-0.4.so.0"] as const;

if (process.platform !== "linux" || process.arch !== "x64") {
  process.exit(0);
}

if (!existsSync(desktopBuildDir)) {
  throw new Error(`Desktop build directory does not exist: ${desktopBuildDir}`);
}

const libsqlNativePackageDir = findLibsqlNativePackageDir();

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

function findLibsqlNativePackageDir(): string {
  if (!existsSync(bunNodeModulesDir)) {
    throw new Error(`Bun node_modules directory is missing: ${bunNodeModulesDir}`);
  }

  for (const entry of readdirSync(bunNodeModulesDir, { withFileTypes: true })) {
    if (!entry.isDirectory() || !entry.name.startsWith("@libsql+linux-x64-gnu@")) {
      continue;
    }

    const packageDir = join(bunNodeModulesDir, entry.name, "node_modules", "@libsql", "linux-x64-gnu");
    if (existsSync(packageDir)) {
      return packageDir;
    }
  }

  throw new Error(`libSQL native package was not found under ${bunNodeModulesDir}. Expected @libsql+linux-x64-gnu@*/node_modules/@libsql/linux-x64-gnu.`);
}
