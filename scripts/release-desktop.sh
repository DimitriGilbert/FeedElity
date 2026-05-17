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
ROOT_PACKAGE_JSON="${REPO_ROOT}/package.json"

echo "--- Release: ${TAG} (dry=${DRY}) ---"

# 1. Check tools
for cmd in gh git bun sed; do
  if ! command -v "$cmd" &>/dev/null; then
    echo "Error: '${cmd}' is required but not found in PATH"
    exit 1
  fi
done

# 2. Check clean git tree (allow untracked files)
if ! git -C "$REPO_ROOT" diff --quiet HEAD 2>/dev/null; then
  echo "Error: working tree has staged or unstaged changes to tracked files."
  echo "  Commit or stash before releasing."
  git -C "$REPO_ROOT" status --short
  exit 1
fi

# 3. Type check
echo "--- Running check-types ---"
if ! bun run check-types; then
  echo "Error: type check failed"
  exit 1
fi

# 4. Bump version in electrobun.config.ts
CURRENT_APP_VERSION="$(grep -oP 'version:\s*"\K[^"]+' "$ELECTROBUN_CONFIG")"
if [[ "$CURRENT_APP_VERSION" == "$VERSION" ]]; then
  echo "--- electrobun.config.ts already at ${VERSION}, skipping bump ---"
else
  echo "--- Bumping electrobun.config.ts: ${CURRENT_APP_VERSION} -> ${VERSION} ---"
  sed -i "s|version: \"${CURRENT_APP_VERSION}\"|version: \"${VERSION}\"|" "$ELECTROBUN_CONFIG"
fi

# 5. Bump version in root package.json
CURRENT_PKG_VERSION="$(grep -oP '"version":\s*"\K[^"]+' "$ROOT_PACKAGE_JSON")"
if [[ "$CURRENT_PKG_VERSION" != "$VERSION" ]]; then
  echo "--- Bumping package.json: ${CURRENT_PKG_VERSION} -> ${VERSION} ---"
  sed -i "s|\"version\": \"${CURRENT_PKG_VERSION}\"|\"version\": \"${VERSION}\"|" "$ROOT_PACKAGE_JSON"
fi

# 6. Build desktop app
echo "--- Building desktop app ---"
if ! bun run build:desktop; then
  echo "Error: desktop build failed"
  exit 1
fi

# 7. Verify artifacts
ARTIFACTS_DIR="${REPO_ROOT}/apps/desktop/artifacts"
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

echo "--- Artifacts verified ---"
ls -lh "$ARTIFACTS_DIR"/stable-linux-x64-*

# 8. Git commit + tag
git -C "$REPO_ROOT" add "$ELECTROBUN_CONFIG" "$ROOT_PACKAGE_JSON"

if git -C "$REPO_ROOT" diff --cached --quiet; then
  echo "--- No version changes to commit ---"
else
  COMMIT_MSG="release: ${TAG}"
  if $DRY; then
    echo "--- [DRY] Would commit: ${COMMIT_MSG} ---"
    git -C "$REPO_ROOT" diff --cached --stat
  else
    git -C "$REPO_ROOT" commit -m "$COMMIT_MSG"
  fi
fi

TAG_EXISTS=false
if git -C "$REPO_ROOT" tag -l "$TAG" | grep -q .; then
  TAG_EXISTS=true
  echo "--- Tag ${TAG} already exists ---"
fi

if $DRY; then
  echo "--- [DRY] Would create tag: ${TAG} ---"
  if ! $TAG_EXISTS; then
    echo "--- [DRY] Would push: git push origin main --follow-tags ---"
  fi
  echo "--- [DRY] Would create GitHub release: ${TAG} ---"
  echo "    Artifacts:"
  for artifact in "${REQUIRED_ARTIFACTS[@]}"; do
    echo "      ${ARTIFACTS_DIR}/${artifact}"
  done
  echo ""
  echo "--- [DRY] Done. No commits, tags, pushes, or releases were made. ---"
  # Restore version files if we bumped them and are in dry-run
  if [[ "$CURRENT_APP_VERSION" != "$VERSION" ]]; then
    sed -i "s|version: \"${VERSION}\"|version: \"${CURRENT_APP_VERSION}\"|" "$ELECTROBUN_CONFIG"
    echo "--- [DRY] Restored electrobun.config.ts to ${CURRENT_APP_VERSION} ---"
  fi
  if [[ "$CURRENT_PKG_VERSION" != "$VERSION" ]]; then
    sed -i "s|\"version\": \"${VERSION}\"|\"version\": \"${CURRENT_PKG_VERSION}\"|" "$ROOT_PACKAGE_JSON"
    echo "--- [DRY] Restored package.json to ${CURRENT_PKG_VERSION} ---"
  fi
  git -C "$REPO_ROOT" checkout -- "$ELECTROBUN_CONFIG" "$ROOT_PACKAGE_JSON" 2>/dev/null || true
  exit 0
fi

if ! $TAG_EXISTS; then
  git -C "$REPO_ROOT" tag -a "$TAG" -m "Release ${TAG}"
fi

echo "--- Pushing to origin ---"
git -C "$REPO_ROOT" push origin main --follow-tags

# 9. Create GitHub release
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
