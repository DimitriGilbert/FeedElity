#!/usr/bin/env bash
set -euo pipefail

usage() {
  echo "Usage: $0 <version> [--dry]"
  echo "  e.g. $0 0.1.0"
  echo "       $0 0.2.0 --dry"
  exit 1
}

if [[ $# -lt 1 ]]; then
  usage
fi

VERSION="$1"
DRY=false
if [[ "${2:-}" == "--dry" ]]; then
  DRY=true
fi

if [[ ! "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "Error: version must be semver (e.g. 0.1.0), got: $VERSION"
  exit 1
fi

TAG="v${VERSION}"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
ELECTROBUN_CONFIG="${REPO_ROOT}/apps/desktop/electrobun.config.ts"
ARTIFACTS_DIR="${REPO_ROOT}/apps/desktop/artifacts"

echo "--- Release: ${TAG} (dry=${DRY}) ---"

for cmd in gh git bun sed zstd; do
  if ! command -v "$cmd" &>/dev/null; then
    echo "Error: '${cmd}' is required but not found in PATH"
    exit 1
  fi
done

if ! git -C "$REPO_ROOT" diff --quiet HEAD 2>/dev/null; then
  echo "Error: working tree has staged or unstaged changes to tracked files."
  echo "  Commit or stash before releasing."
  git -C "$REPO_ROOT" status --short
  exit 1
fi

echo "--- Running check-types ---"
if ! bun run check-types; then
  echo "Error: type check failed"
  exit 1
fi

CURRENT_APP_VERSION="$(grep -oP 'version:\s*"\K[^"]+' "$ELECTROBUN_CONFIG")"
if [[ "$CURRENT_APP_VERSION" == "$VERSION" ]]; then
  echo "--- electrobun.config.ts already at ${VERSION}, skipping bump ---"
else
  echo "--- Bumping electrobun.config.ts: ${CURRENT_APP_VERSION} -> ${VERSION} ---"
  sed -i "s|version: \"${CURRENT_APP_VERSION}\"|version: \"${VERSION}\"|" "$ELECTROBUN_CONFIG"
fi

echo "--- Building desktop app ---"
if ! bun run build:desktop; then
  echo "Error: desktop build failed"
  exit 1
fi

echo "--- Patching artifacts (ayatana libs + libsql native) ---"
if ! bun "${SCRIPT_DIR}/patch-desktop-linux-bundle.ts"; then
  echo "Error: artifact patching failed"
  exit 1
fi

REQUIRED_ARTIFACTS=(
  "stable-linux-x64-FeedElity.tar.zst"
  "stable-linux-x64-FeedElity-Setup.tar.gz"
  "stable-linux-x64-update.json"
)

for artifact in "${REQUIRED_ARTIFACTS[@]}"; do
  if [[ ! -f "${ARTIFACTS_DIR}/${artifact}" ]]; then
    echo "Error: expected artifact not found: ${ARTIFACTS_DIR}/${artifact}"
    exit 1
  fi
done

sync
echo "--- Verifying ayatana libs in artifact ---"
if ! tar --zstd -tf "${ARTIFACTS_DIR}/stable-linux-x64-FeedElity.tar.zst" | grep -q "libayatana-appindicator3"; then
  echo "Error: libayatana-appindicator3.so.1 is missing from the artifact!"
  echo "  The patch step did not inject the native libraries."
  exit 1
fi
echo "--- Artifacts verified ---"
ls -lh "$ARTIFACTS_DIR"/stable-linux-x64-*

if $DRY; then
  echo ""
  echo "--- [DRY] Would commit version bump and create tag: ${TAG} ---"
  echo "--- [DRY] Would push: git push origin main --follow-tags ---"
  echo "--- [DRY] Would create GitHub release: ${TAG} ---"
  echo "    Artifacts:"
  for artifact in "${REQUIRED_ARTIFACTS[@]}"; do
    echo "      ${ARTIFACTS_DIR}/${artifact}"
  done
  echo ""
  echo "--- [DRY] Restoring version files ---"
  git -C "$REPO_ROOT" checkout -- "$ELECTROBUN_CONFIG"
  echo "--- [DRY] Done. No commits, tags, pushes, or releases were made. ---"
  exit 0
fi

git -C "$REPO_ROOT" add "$ELECTROBUN_CONFIG"

if git -C "$REPO_ROOT" diff --cached --quiet; then
  echo "--- No version changes to commit ---"
else
  git -C "$REPO_ROOT" commit -m "release: ${TAG}"
fi

if git -C "$REPO_ROOT" tag -l "$TAG" | grep -q .; then
  echo "Error: tag ${TAG} already exists. Delete it first or use a different version."
  exit 1
fi

git -C "$REPO_ROOT" tag -a "$TAG" -m "Release ${TAG}"

echo "--- Pushing to origin ---"
git -C "$REPO_ROOT" push origin main --follow-tags

echo "--- Creating GitHub release: ${TAG} ---"
RELEASE_ARGS=(
  "$TAG"
  --title "$TAG"
  --notes "Release $TAG"
)

for artifact in "${REQUIRED_ARTIFACTS[@]}"; do
  RELEASE_ARGS+=("${ARTIFACTS_DIR}/${artifact}")
done

gh release create "${RELEASE_ARGS[@]}"

echo "--- Release ${TAG} published! ---"
