#!/usr/bin/env bash
set -euo pipefail

usage() {
  echo "Usage: $0 <version> <artifacts-dir> [--dry]"
  echo "  e.g. $0 0.1.0 ./release-artifacts/v0.1.0 --dry"
  echo "       $0 0.1.0 ./release-artifacts/v0.1.0"
  exit 1
}

if [[ $# -lt 2 ]]; then
  usage
fi

VERSION="$1"
ARTIFACTS_INPUT_DIR="$2"
DRY=false
if [[ "${3:-}" == "--dry" ]]; then
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
ARTIFACTS_DIR="$(cd "$ARTIFACTS_INPUT_DIR" && pwd)"

echo "--- Publish desktop release: ${TAG} (dry=${DRY}) ---"
echo "--- Artifacts dir: ${ARTIFACTS_DIR} ---"

for cmd in gh git grep find sort; do
  if ! command -v "$cmd" &>/dev/null; then
    echo "Error: '${cmd}' is required but not found in PATH"
    exit 1
  fi
done

if [[ ! -d "$ARTIFACTS_DIR" ]]; then
  echo "Error: artifacts directory does not exist: $ARTIFACTS_DIR"
  exit 1
fi

if ! git -C "$REPO_ROOT" diff --quiet HEAD 2>/dev/null; then
  echo "Error: working tree has staged or unstaged changes to tracked files."
  echo "  Commit or stash before publishing. Untracked files are allowed."
  git -C "$REPO_ROOT" status --short
  exit 1
fi

CONFIG_VERSION="$(grep -oP 'version:\s*"\K[^"]+' "$ELECTROBUN_CONFIG")"
if [[ "$CONFIG_VERSION" != "$VERSION" ]]; then
  echo "Error: electrobun.config.ts version is ${CONFIG_VERSION}, expected ${VERSION}."
  echo "  Build artifacts and release tag must use the same version."
  exit 1
fi

mapfile -t ARTIFACTS < <(find "$ARTIFACTS_DIR" -maxdepth 1 -type f | sort)
if [[ "${#ARTIFACTS[@]}" -eq 0 ]]; then
  echo "Error: no files found in artifacts directory: $ARTIFACTS_DIR"
  exit 1
fi

TARBALL_COUNT=0
UPDATE_JSON_COUNT=0
for artifact in "${ARTIFACTS[@]}"; do
  case "$artifact" in
    *.tar.zst) TARBALL_COUNT=$((TARBALL_COUNT + 1)) ;;
    *-update.json) UPDATE_JSON_COUNT=$((UPDATE_JSON_COUNT + 1)) ;;
  esac
done

if [[ "$TARBALL_COUNT" -eq 0 ]]; then
  echo "Error: expected at least one .tar.zst desktop artifact."
  exit 1
fi

if [[ "$UPDATE_JSON_COUNT" -eq 0 ]]; then
  echo "Error: expected at least one *-update.json artifact."
  exit 1
fi

echo "--- Files to publish ---"
for artifact in "${ARTIFACTS[@]}"; do
  ls -lh "$artifact"
done

if git -C "$REPO_ROOT" tag -l "$TAG" | grep -q .; then
  echo "Error: tag ${TAG} already exists. Delete it first or use a different version."
  exit 1
fi

if gh release view "$TAG" &>/dev/null; then
  echo "Error: GitHub release ${TAG} already exists. Delete it first or use a different version."
  exit 1
fi

if $DRY; then
  echo ""
  echo "--- [DRY] Would create tag: ${TAG} at current HEAD ---"
  git -C "$REPO_ROOT" rev-parse --short HEAD
  echo "--- [DRY] Would push: git push origin main --follow-tags ---"
  echo "--- [DRY] Would create GitHub release ${TAG} with ${#ARTIFACTS[@]} files ---"
  exit 0
fi

git -C "$REPO_ROOT" tag -a "$TAG" -m "Release ${TAG}"

echo "--- Pushing tag to origin ---"
git -C "$REPO_ROOT" push origin main --follow-tags

echo "--- Creating GitHub release: ${TAG} ---"
RELEASE_ARGS=(
  "$TAG"
  --title "$TAG"
  --notes "Release $TAG"
)

for artifact in "${ARTIFACTS[@]}"; do
  RELEASE_ARGS+=("$artifact")
done

gh release create "${RELEASE_ARGS[@]}"

echo "--- Release ${TAG} published! ---"
