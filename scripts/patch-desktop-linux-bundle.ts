import { cpSync, existsSync, mkdirSync, readdirSync, renameSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";

const rootDir = resolve(import.meta.dir, "..");
const artifactsDir = join(rootDir, "apps", "desktop", "artifacts");
const ayatanaLibDir = join(rootDir, ".native", "linux-x64", "extracted", "usr", "lib64");
const bunNodeModulesDir = join(rootDir, "node_modules", ".bun");

const requiredLibraries = ["libayatana-appindicator3.so.1", "libayatana-indicator3.so.7", "libayatana-ido3-0.4.so.0"] as const;

if (process.platform !== "linux" || process.arch !== "x64") {
  process.exit(0);
}

if (!existsSync(artifactsDir)) {
  throw new Error(`Artifacts directory does not exist: ${artifactsDir}`);
}

const libsqlNativePackageDir = findLibsqlNativePackageDir();

const zstdAvailable = Bun.which("zstd") !== null;
if (!zstdAvailable) {
  throw new Error("zstd CLI is required to repack .tar.zst artifacts. Install zstd.");
}

const artifactFiles = readdirSync(artifactsDir).filter((f) => f.endsWith(".tar.zst"));

if (artifactFiles.length === 0) {
  throw new Error(`No .tar.zst artifacts found in ${artifactsDir}`);
}

for (const artifactFile of artifactFiles) {
  const artifactPath = join(artifactsDir, artifactFile);
  const stagingDir = join(artifactsDir, `.patch-staging-${Date.now()}`);

  console.log(`Patching artifact: ${artifactFile}`);

  mkdirSync(stagingDir, { recursive: true });

  const extractProc = Bun.spawnSync([
    "tar",
    "--zstd",
    "-xf",
    artifactPath,
    "-C",
    stagingDir,
  ], { stdout: "inherit", stderr: "inherit" });
  if (!extractProc.success) {
    throw new Error(`Failed to extract ${artifactFile}`);
  }

  const appDirs = readdirSync(stagingDir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => join(stagingDir, e.name));

  let patched = false;

  for (const appDir of appDirs) {
    const binDir = join(appDir, "bin");
    const bunAppDir = join(appDir, "Resources", "app", "bun");

    if (!existsSync(binDir)) {
      continue;
    }

    for (const library of requiredLibraries) {
      const source = join(ayatanaLibDir, library);
      if (!existsSync(source)) {
        throw new Error(`Prepared Ayatana library is missing: ${source}`);
      }
      cpSync(source, join(binDir, library));
    }

    if (existsSync(bunAppDir)) {
      const libsqlTargetDir = join(bunAppDir, "node_modules", "@libsql", "linux-x64-gnu");
      mkdirSync(libsqlTargetDir, { recursive: true });
      cpSync(libsqlNativePackageDir, libsqlTargetDir, { recursive: true });
    }

    patched = true;
    console.log(`  Patched ${binDir}`);
  }

  if (!patched) {
    console.log(`  No app directories found to patch in ${artifactFile}, skipping`);
    rmSync(stagingDir, { recursive: true, force: true });
    continue;
  }

  rmSync(artifactPath, { force: true });
  const tempArtifactPath = `${artifactPath}.tmp`;

  const recompressProc = Bun.spawnSync([
    "tar",
    "--zstd",
    "-cf",
    tempArtifactPath,
    "-C",
    stagingDir,
    ".",
  ], { stdout: "inherit", stderr: "inherit" });
  if (!recompressProc.success) {
    throw new Error(`Failed to recompress ${artifactFile}`);
  }

  renameSync(tempArtifactPath, artifactPath);

  rmSync(stagingDir, { recursive: true, force: true });
  console.log(`  Repacked: ${artifactFile}`);
}

console.log("All artifacts patched.");

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

  throw new Error(
    `libSQL native package was not found under ${bunNodeModulesDir}. Expected @libsql+linux-x64-gnu@*/node_modules/@libsql/linux-x64-gnu.`,
  );
}
