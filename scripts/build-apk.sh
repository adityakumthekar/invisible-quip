#!/usr/bin/env bash
#
# Build the Quip Remote APK.
#
# JAVA_HOME and ANDROID_HOME are resolved here rather than assumed from the
# shell: the JDK is a keg-only Homebrew formula, so it is deliberately not on
# PATH, and Android Studio is not installed at all — only the SDK it would
# otherwise manage. Anyone cloning this repo gets a working build or a clear
# statement of what is missing, instead of a Gradle stack trace.

set -euo pipefail

if [[ -z "${JAVA_HOME:-}" ]]; then
  for candidate in \
    /opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home \
    /opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home \
    /usr/local/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home; do
    if [[ -d "$candidate" ]]; then
      export JAVA_HOME="$candidate"
      break
    fi
  done
fi

if [[ -z "${JAVA_HOME:-}" || ! -x "${JAVA_HOME}/bin/java" ]]; then
  echo "error: no JDK found." >&2
  echo "  Install one with:  brew install openjdk@21" >&2
  echo "  Or set JAVA_HOME to an existing JDK 17+." >&2
  exit 1
fi

export ANDROID_HOME="${ANDROID_HOME:-$HOME/Library/Android/sdk}"
if [[ ! -d "$ANDROID_HOME" ]]; then
  echo "error: Android SDK not found at $ANDROID_HOME" >&2
  echo "  Install the SDK, or set ANDROID_HOME to where it lives." >&2
  exit 1
fi
export ANDROID_SDK_ROOT="$ANDROID_HOME"

# Gradle finds the SDK through this file, not the environment.
echo "sdk.dir=$ANDROID_HOME" > android/local.properties

echo "==> Building the web bundle"
npm run build:remote

echo "==> Syncing into the Android project"
npx cap sync android

echo "==> Assembling the APK"
(cd android && ./gradlew --no-daemon assembleDebug)

APK="android/app/build/outputs/apk/debug/app-debug.apk"
if [[ ! -f "$APK" ]]; then
  echo "error: gradle reported success but $APK is missing" >&2
  exit 1
fi

echo
echo "APK ready: $APK"
echo
echo "Install it with a USB cable and debugging on:"
echo "  \"$ANDROID_HOME/platform-tools/adb\" install -r $APK"
echo
echo "Or copy that file to the phone and open it."
