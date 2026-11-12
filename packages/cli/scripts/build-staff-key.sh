#!/bin/sh
# Builds the staff access key helper (native/staff-key) as a universal macOS binary into
# dist/native/superwall-staff-key, where the CLI looks for it.
#
# Signing is opt-in and only for releases (native/staff-key/README.md, "Releasing"):
#   SUPERWALL_STAFF_KEY_SIGN_IDENTITY="Developer ID Application: … (TEAMID)"  signs it
#   SUPERWALL_STAFF_KEY_NOTARY_PROFILE=<notarytool keychain profile>          notarizes it
set -eu

if [ "$(uname -s)" != "Darwin" ]; then
  echo "build-staff-key: the staff key helper builds on macOS only" >&2
  exit 1
fi

cd "$(dirname "$0")/.."
swift build -c release --arch arm64 --arch x86_64 --package-path native/staff-key
mkdir -p dist/native
cp native/staff-key/.build/apple/Products/Release/superwall-staff-key dist/native/superwall-staff-key
chmod 755 dist/native/superwall-staff-key

if [ -n "${SUPERWALL_STAFF_KEY_SIGN_IDENTITY:-}" ]; then
  codesign --force --options runtime --timestamp \
    --identifier com.superwall.cli.staff-key \
    --sign "$SUPERWALL_STAFF_KEY_SIGN_IDENTITY" dist/native/superwall-staff-key
  codesign --verify --strict --verbose=2 dist/native/superwall-staff-key
fi

if [ -n "${SUPERWALL_STAFF_KEY_NOTARY_PROFILE:-}" ]; then
  [ -n "${SUPERWALL_STAFF_KEY_SIGN_IDENTITY:-}" ] || { echo "build-staff-key: notarizing needs a signed binary" >&2; exit 1; }
  zip="$(mktemp -d)/superwall-staff-key.zip"
  ditto -c -k --keepParent dist/native/superwall-staff-key "$zip"
  xcrun notarytool submit "$zip" --keychain-profile "$SUPERWALL_STAFF_KEY_NOTARY_PROFILE" --wait
fi

echo "built dist/native/superwall-staff-key"
