#!/usr/bin/env bash
# Install / update / uninstall 小步 (bubu) on macOS from the project's GitHub
# Releases (the same assets the download page links: bubu-<ver>-mac-<arch>-*.dmg
# and SHA256SUMS.txt).  Usage:
#   curl -fsSL https://raw.githubusercontent.com/jemicyzhu-0333/bubu/main/scripts/install-mac.sh | bash
#   ... | bash -s -- --uninstall
# Environment overrides (testing / mirrors):
#   BUBU_REPO (owner/name), BUBU_TAG (release tag; default: newest release with a
#   matching Mac asset), BUBU_API (GitHub API base), BUBU_APPS_DIR (install dir;
#   default /Applications if writable, else ~/Applications), BUBU_NO_LAUNCH=1.
# curl downloads carry no quarantine attribute, so nothing is removed and
# system security settings are not changed.
set -euo pipefail

APP_NAME="小步.app"
BUNDLE_ID="com.bubu.app"
REPO="${BUBU_REPO:-jemicyzhu-0333/bubu}"
TAG="${BUBU_TAG:-}"
API="${BUBU_API:-https://api.github.com}"

say() { printf '==> %s\n' "$*"; }
die() { printf 'error: %s\n' "$*" >&2; exit 1; }

[ "$(uname -s)" = "Darwin" ] || die "this installer only supports macOS"

case "$(uname -m)" in
  arm64) ARCH=arm64 ;;
  x86_64) ARCH=x64 ;;
  *) die "unsupported CPU architecture: $(uname -m)" ;;
esac

apps_dir() {
  if [ -n "${BUBU_APPS_DIR:-}" ]; then printf '%s\n' "$BUBU_APPS_DIR"; return; fi
  if [ -w /Applications ]; then printf '/Applications\n'; else printf '%s/Applications\n' "$HOME"; fi
}

quit_running() {
  if pgrep -f "${APP_NAME}/Contents/MacOS/" >/dev/null 2>&1; then
    say "quitting running 小步"
    osascript -e "tell application id \"${BUNDLE_ID}\" to quit" >/dev/null 2>&1 || true
    for _ in 1 2 3 4 5 6 7 8 9 10; do
      pgrep -f "${APP_NAME}/Contents/MacOS/" >/dev/null 2>&1 || return 0
      sleep 1
    done
    pkill -f "${APP_NAME}/Contents/MacOS/" >/dev/null 2>&1 || true
  fi
}

uninstall() {
  quit_running
  local removed=0 dir
  for dir in /Applications "$HOME/Applications" ${BUBU_APPS_DIR:+"$BUBU_APPS_DIR"}; do
    if [ -d "$dir/$APP_NAME" ]; then
      rm -rf "${dir:?}/$APP_NAME" && say "removed $dir/$APP_NAME" && removed=1
    fi
  done
  [ "$removed" = 1 ] || say "小步 is not installed"
  say "user data in ~/Library/Application Support is kept"
}

# Prints "<tag> <asset-name>" for the newest release (or BUBU_TAG) that has a
# DMG for this architecture.  Plain text parsing: no jq dependency.
resolve_asset() {
  local url json
  if [ -n "$TAG" ]; then url="$API/repos/$REPO/releases/tags/$TAG"; else url="$API/repos/$REPO/releases?per_page=20"; fi
  json="$(curl -fsSL --retry 3 -H 'Accept: application/vnd.github+json' "$url")" || die "cannot query releases: $url"
  printf '%s\n' "$json" | tr ',' '\n' | awk -v arch="$ARCH" '
    /"tag_name"[[:space:]]*:/ { sub(/.*"tag_name"[[:space:]]*:[[:space:]]*"/, ""); sub(/".*/, ""); tag = $0 }
    /"name"[[:space:]]*:/ && tag != "" {
      n = $0; sub(/.*"name"[[:space:]]*:[[:space:]]*"/, "", n); sub(/".*/, "", n)
      if (n ~ ("^bubu-.*-mac-" arch "(-[a-z-]+)?\\.dmg$")) { print tag, n; exit }
    }'
}

install() {
  local dest tag asset base want got mnt
  # global: the EXIT trap runs after this function returns
  read -r tag asset <<<"$(resolve_asset)" || true
  [ -n "${asset:-}" ] || die "no macOS ${ARCH} build found in ${REPO} releases${TAG:+ (tag $TAG)}"
  base="https://github.com/${REPO}/releases/download/${tag}"
  tmp="$(mktemp -d)"
  trap 'hdiutil detach -quiet "$tmp/mnt" >/dev/null 2>&1 || true; rm -rf "$tmp"' EXIT
  say "downloading ${asset} (${tag})"
  curl -fsSL --retry 3 -o "$tmp/$asset" "${BUBU_BASE_URL:-$base}/$asset" || die "download failed: $asset"
  curl -fsSL --retry 3 -o "$tmp/SHA256SUMS.txt" "${BUBU_BASE_URL:-$base}/SHA256SUMS.txt" || die "SHA256SUMS.txt download failed"
  want="$(awk -v f="$asset" '{n=$2; sub(/^\*/, "", n)} n == f {print $1; exit}' "$tmp/SHA256SUMS.txt")"
  got="$(shasum -a 256 "$tmp/$asset" | awk '{print $1}')"
  [ -n "$want" ] && [ "$want" = "$got" ] || die "sha256 mismatch for $asset (expected ${want:-none}, got $got)"
  say "sha256 ok"

  mnt="$tmp/mnt"; mkdir -p "$mnt"
  hdiutil attach -quiet -nobrowse -readonly -mountpoint "$mnt" "$tmp/$asset" || die "could not open $asset"
  [ -d "$mnt/$APP_NAME" ] || die "disk image does not contain $APP_NAME"
  codesign --verify --deep --strict "$mnt/$APP_NAME" || die "code signature of the download is invalid"

  dest="$(apps_dir)"
  mkdir -p "$dest"
  quit_running
  rm -rf "${dest:?}/$APP_NAME"
  ditto "$mnt/$APP_NAME" "$dest/$APP_NAME"
  hdiutil detach -quiet "$mnt" >/dev/null 2>&1 || true
  codesign --verify --deep --strict "$dest/$APP_NAME" || die "installed app failed signature verification"
  say "installed $tag to $dest/$APP_NAME"
  if [ -z "${BUBU_NO_LAUNCH:-}" ]; then open "$dest/$APP_NAME"; fi
}

case "${1:-}" in
  ""|--install) install ;;
  --uninstall) uninstall ;;
  -h|--help) sed -n '2,14p' "$0" 2>/dev/null || true ;;
  *) die "unknown option: $1 (use --uninstall or --help)" ;;
esac
