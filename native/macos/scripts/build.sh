#!/bin/sh
# Builds the recorder, transcriber, background and audio helpers and signs them (ad-hoc by default; set SIGN_IDENTITY for a real identity).
set -eu
cd "$(dirname "$0")/.."

CONFIG="${CONFIG:-release}"
swift build -c "$CONFIG"
BIN_PATH="$(swift build -c "$CONFIG" --show-bin-path)"
BIN="$BIN_PATH/recorder-helper"
# Notarization needs a secure timestamp, which ad-hoc signatures can't carry.
if [ -n "${SIGN_IDENTITY:-}" ]; then TIMESTAMP=--timestamp; else TIMESTAMP=--timestamp=none; fi

codesign --force --options runtime "$TIMESTAMP" \
    --entitlements Resources/recorder-helper.entitlements \
    --sign "${SIGN_IDENTITY:--}" "$BIN"
codesign --force --options runtime "$TIMESTAMP" --sign "${SIGN_IDENTITY:--}" "$BIN_PATH/transcriber-helper"
codesign --force --options runtime "$TIMESTAMP" --sign "${SIGN_IDENTITY:--}" "$BIN_PATH/background-helper"
codesign --force --options runtime "$TIMESTAMP" --sign "${SIGN_IDENTITY:--}" "$BIN_PATH/audio-helper"

echo "$BIN"
