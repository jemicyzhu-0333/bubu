#!/usr/bin/env bash
# CI gate (macOS runner): verify the packaged app's code signature end to end
# and print the evidence.  Fails on any invalid or inconsistent signature.
#   scripts/verify-macos-signature.sh <path/to/小步.app> [path/to/installer.dmg]
# It never changes system policy.  The quarantine check works on a scratch copy.
set -euo pipefail
APP="${1:?usage: verify-macos-signature.sh <app> [dmg]}"
DMG="${2:-}"
fail=0
section() { printf '\n=== %s ===\n' "$*"; }
bad() { printf 'FAIL: %s\n' "$*"; fail=1; }

section "codesign -dv --verbose=4 (top level)"
codesign -dv --verbose=4 "$APP" 2>&1 || bad "cannot read top-level signature"

section "codesign --verify --deep --strict"
codesign --verify --deep --strict --verbose=2 "$APP" 2>&1 || bad "deep strict verification failed"

section "entitlements"
codesign -d --entitlements - --xml "$APP" 2>/dev/null | plutil -p - 2>/dev/null || echo "(none)"

section "nested code: every bundle and Mach-O must verify and share one signer"
top_sig="$(codesign -dv "$APP" 2>&1 | awk -F= '/^Signature=|^Authority=/{print $2; exit}')"
top_team="$(codesign -dv "$APP" 2>&1 | awk -F= '/^TeamIdentifier=/{print $2}')"
printf 'top-level signer: %s, team: %s\n' "${top_sig:-?}" "${top_team:-?}"
count=0
while IFS= read -r -d '' item; do
  case "$item" in
    *.framework|*.app|*.dylib|*.node) ;;
    *) file -b "$item" | grep -q 'Mach-O' || continue ;;
  esac
  count=$((count + 1))
  info="$(codesign -dv "$item" 2>&1)" || { bad "unsigned: ${item#"$APP"/}"; continue; }
  sig="$(printf '%s\n' "$info" | awk -F= '/^Signature=|^Authority=/{print $2; exit}')"
  team="$(printf '%s\n' "$info" | awk -F= '/^TeamIdentifier=/{print $2}')"
  codesign --verify --strict "$item" >/dev/null 2>&1 || bad "strict verify: ${item#"$APP"/}"
  if [ "$sig" != "$top_sig" ] || [ "$team" != "$top_team" ]; then
    bad "inconsistent signer ($sig/$team): ${item#"$APP"/}"
  fi
done < <(find "$APP/Contents" \( -name '*.framework' -o -name '*.app' -o -name '*.dylib' -o -name '*.node' -o -type f -perm -u+x \) -print0)
printf 'nested code objects checked: %d\n' "$count"

section "ditto zip round trip keeps the signature"
tmp="$(mktemp -d)"; trap 'hdiutil detach -quiet "$tmp/mnt" >/dev/null 2>&1 || true; rm -rf "$tmp"' EXIT
ditto -c -k --sequesterRsrc --keepParent "$APP" "$tmp/app.zip"
ditto -x -k "$tmp/app.zip" "$tmp/unzipped"
if codesign --verify --deep --strict "$tmp/unzipped/$(basename "$APP")"; then echo "zip round trip: valid"
else bad "signature broken after ditto zip round trip"; fi

if [ -n "$DMG" ]; then
  section "simulated browser download (quarantined DMG copy)"
  cp "$DMG" "$tmp/q.dmg"
  xattr -w com.apple.quarantine "0083;$(printf '%x' "$(date +%s)");Safari;" "$tmp/q.dmg"
  mkdir -p "$tmp/mnt"
  hdiutil attach -quiet -nobrowse -readonly -mountpoint "$tmp/mnt" "$tmp/q.dmg"
  ditto "$tmp/mnt/$(basename "$APP")" "$tmp/qapp/$(basename "$APP")"
  qa="$tmp/qapp/$(basename "$APP")"
  printf 'quarantine on copy: %s\n' "$(xattr -p com.apple.quarantine "$qa" 2>/dev/null || echo none)"
  if codesign --verify --deep --strict "$qa" 2>&1; then
    echo "quarantined copy signature: valid -> Gatekeeper shows 'cannot verify developer' (Open Anyway in Privacy & Security), not 'damaged'"
  else
    bad "quarantined copy signature invalid -> users would see 'is damaged'"
  fi
  printf 'spctl (informational): '; spctl --assess --type execute -vv "$qa" 2>&1 || true
  if command -v syspolicy_check >/dev/null 2>&1; then
    section "syspolicy_check distribution (informational)"; syspolicy_check distribution "$qa" 2>&1 || true
  fi
fi

section "result"
if [ "$fail" = 0 ]; then echo "SIGNATURE GATE: PASS"; else echo "SIGNATURE GATE: FAIL"; exit 1; fi
