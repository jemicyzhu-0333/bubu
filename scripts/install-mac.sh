#!/usr/bin/env bash
# Install / update / uninstall 小步 (bubu) on macOS from the project's GitHub
# Releases (the same assets the download page links: bubu-<ver>-mac-<arch>-*.dmg
# and SHA256SUMS.txt).  Usage:
#   curl -fsSL https://raw.githubusercontent.com/jemicyzhu-0333/bubu/main/scripts/install-mac.sh | bash
#   ... | bash -s -- --update     # upgrade an installed copy in place (rolls back on failure)
#   ... | bash -s -- --check      # report installed vs latest (exit 0 current, 10 update available)
#   ... | bash -s -- --uninstall
# Environment overrides (testing / mirrors):
#   BUBU_REPO (owner/name), BUBU_TAG (release tag; default: newest release with a
#   matching Mac asset), BUBU_API (GitHub API base), BUBU_APPS_DIR (install dir;
#   default /Applications if writable, else ~/Applications), BUBU_NO_LAUNCH=1.
# curl downloads carry no quarantine attribute, so nothing is removed and
# system security settings are not changed.
set -euo pipefail
SYS_APPS="${BUBU_SYSTEM_APPS_DIR:-/Applications}"  # override only for tests

APP_NAME="小步.app"
BUNDLE_ID="com.bubu.app"
REPO="${BUBU_REPO:-jemicyzhu-0333/bubu}"
TAG="${BUBU_TAG:-}"
API="${BUBU_API:-https://api.github.com}"

tmp="" staged="" backup="" target="" tag="" asset=""

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
  if [ -w "$SYS_APPS" ]; then printf '%s\n' "$SYS_APPS"; else printf '%s/Applications\n' "$HOME"; fi
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
  for dir in "$SYS_APPS" "$HOME/Applications" ${BUBU_APPS_DIR:+"$BUBU_APPS_DIR"}; do
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

# Installed copy: first of BUBU_APPS_DIR, /Applications, ~/Applications.
installed_app() {
  local dir
  for dir in ${BUBU_APPS_DIR:+"$BUBU_APPS_DIR"} "$SYS_APPS" "$HOME/Applications"; do
    if [ -d "$dir/$APP_NAME" ]; then printf '%s\n' "$dir/$APP_NAME"; return 0; fi
  done
  return 1
}

app_version() {
  plutil -extract CFBundleShortVersionString raw -o - "$1/Contents/Info.plist" 2>/dev/null
}

# version_cmp A B -> prints -1, 0 or 1 (semver: 1.2.3 > 1.2.3-dev.9 > 1.2.3-dev.4)
version_cmp() {
  awk -v a="${1#v}" -v b="${2#v}" '
    function cmpid(x, y) {
      if (x ~ /^[0-9]+$/ && y ~ /^[0-9]+$/) return (x + 0 < y + 0) ? -1 : (x + 0 > y + 0)
      if (x ~ /^[0-9]+$/) return -1
      if (y ~ /^[0-9]+$/) return 1
      return (x < y) ? -1 : (x > y)
    }
    BEGIN {
      ia = index(a, "-"); ib = index(b, "-")
      ca = ia ? substr(a, 1, ia - 1) : a; pa = ia ? substr(a, ia + 1) : ""
      cb = ib ? substr(b, 1, ib - 1) : b; pb = ib ? substr(b, ib + 1) : ""
      na = split(ca, x, "."); nb = split(cb, y, ".")
      for (i = 1; i <= (na > nb ? na : nb); i++) { r = cmpid(x[i] + 0, y[i] + 0); if (r) { print r; exit } }
      if (pa == "" && pb == "") { print 0; exit }
      if (pa == "") { print 1; exit }
      if (pb == "") { print -1; exit }
      na = split(pa, x, "."); nb = split(pb, y, ".")
      for (i = 1; i <= (na < nb ? na : nb); i++) { r = cmpid(x[i], y[i]); if (r) { print r; exit } }
      print (na < nb) ? -1 : (na > nb)
    }'
}

latest() {
  read -r tag asset <<<"$(resolve_asset)" || true
  [ -n "${asset:-}" ] || die "no macOS ${ARCH} build found in ${REPO} releases${TAG:+ (tag $TAG)}"
}

cleanup() {
  if [ -n "${backup:-}" ] && [ -d "$backup" ]; then
    rm -rf "${target:?}"
    mv "$backup" "$target" && printf 'error: update failed; previous version restored at %s\n' "$target" >&2
  fi
  if [ -n "${staged:-}" ]; then rm -rf "$staged"; fi
  if [ -n "${tmp:-}" ]; then hdiutil detach -quiet "$tmp/mnt" >/dev/null 2>&1 || true; rm -rf "$tmp"; fi
}
trap cleanup EXIT

# Downloads the release DMG for $tag/$asset, checks sha256 and the signature,
# leaves it mounted at $tmp/mnt.
fetch_verified() {
  local base want got
  base="https://github.com/${REPO}/releases/download/${tag}"
  tmp="$(mktemp -d)"
  say "downloading ${asset} (${tag})"
  curl -fsSL --retry 3 -o "$tmp/$asset" "${BUBU_BASE_URL:-$base}/$asset" || die "download failed: $asset"
  curl -fsSL --retry 3 -o "$tmp/SHA256SUMS.txt" "${BUBU_BASE_URL:-$base}/SHA256SUMS.txt" || die "SHA256SUMS.txt download failed"
  want="$(awk -v f="$asset" '{n=$2; sub(/^\*/, "", n)} n == f {print $1; exit}' "$tmp/SHA256SUMS.txt")"
  got="$(shasum -a 256 "$tmp/$asset" | awk '{print $1}')"
  [ -n "$want" ] && [ "$want" = "$got" ] || die "sha256 mismatch for $asset (expected ${want:-none}, got $got)"
  say "sha256 ok"
  mkdir -p "$tmp/mnt"
  hdiutil attach -quiet -nobrowse -readonly -mountpoint "$tmp/mnt" "$tmp/$asset" || die "could not open $asset"
  [ -d "$tmp/mnt/$APP_NAME" ] || die "disk image does not contain $APP_NAME"
  codesign --verify --deep --strict "$tmp/mnt/$APP_NAME" || die "code signature of the download is invalid"
}

install() {
  local dest
  latest
  fetch_verified
  dest="$(apps_dir)"
  mkdir -p "$dest"
  quit_running
  rm -rf "${dest:?}/$APP_NAME"
  ditto "$tmp/mnt/$APP_NAME" "$dest/$APP_NAME"
  codesign --verify --deep --strict "$dest/$APP_NAME" || die "installed app failed signature verification"
  say "installed $tag to $dest/$APP_NAME"
  if [ -z "${BUBU_NO_LAUNCH:-}" ]; then open "$dest/$APP_NAME"; fi
}

check() {
  local app current cmp
  app="$(installed_app)" || { say "小步 is not installed (run without options to install)"; exit 1; }
  current="$(app_version "$app")" || die "cannot read the version of $app"
  latest
  cmp="$(version_cmp "$current" "$tag")"
  if [ "$cmp" -ge 0 ]; then
    say "小步 $current is up to date (latest release: $tag)"
    return 0
  fi
  say "update available: $current -> ${tag#v}"
  return 10
}

update() {
  local current status=0 dir new
  target="$(installed_app)" || die "小步 is not installed; run the installer without --update first"
  current="$(app_version "$target")" || die "cannot read the version of $target"
  latest
  if [ "$(version_cmp "$current" "$tag")" -ge 0 ]; then
    say "小步 $current is up to date (latest release: $tag)"
    return 0
  fi
  say "updating $current -> ${tag#v}"
  fetch_verified
  dir="$(dirname "$target")"
  # Stage next to the target so the swap is a same-volume rename.
  staged="$dir/.$APP_NAME.new.$$"
  ditto "$tmp/mnt/$APP_NAME" "$staged" || die "could not stage the new version in $dir"
  codesign --verify --deep --strict "$staged" || die "staged app failed signature verification"
  quit_running || status=$?
  [ "$status" = 0 ] || die "could not quit the running app"
  backup="$dir/.$APP_NAME.old.$$"
  mv "$target" "$backup" || { backup=""; die "could not move the old version aside"; }
  mv "$staged" "$target" || die "could not move the new version into place"
  staged=""
  codesign --verify --deep --strict "$target" || die "updated app failed signature verification"
  new="$(app_version "$target")" || die "cannot read the updated version"
  [ "$(version_cmp "$new" "$tag")" = 0 ] || die "updated app reports $new, expected ${tag#v}"
  rm -rf "$backup"; backup=""
  say "updated to $new at $target (user data untouched)"
  if [ -z "${BUBU_NO_LAUNCH:-}" ]; then open "$target"; fi
}

case "${1:-}" in
  ""|--install) install ;;
  --update) update ;;
  --check) check ;;
  --uninstall) uninstall ;;
  -h|--help) sed -n '2,16p' "$0" 2>/dev/null || true ;;
  *) die "unknown option: $1 (use --update, --check, --uninstall or --help)" ;;
esac
