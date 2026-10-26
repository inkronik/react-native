#!/usr/bin/env bash
set -euo pipefail

# Google's command-line tools 20.0 preserve the RN 0.65 compatibility toolchain.
# The archive was checked against Google's repository metadata before pinning SHA-256.
readonly android_tools_version=14742923
readonly android_tools_sha256=04453066b540409d975c676d781da1477479dde3761310f1a7eb92a1dfb15af7
readonly android_tools_directory="${RUNNER_TEMP:?}/inkronik-android-tools"
readonly android_tools_archive="${android_tools_directory}/command-line-tools.zip"
readonly android_sdk_root="${ANDROID_HOME:?}"

mkdir -p "$android_tools_directory"
curl --fail --silent --show-error --location --retry 3 \
    "https://dl.google.com/android/repository/commandlinetools-linux-${android_tools_version}_latest.zip" \
    --output "$android_tools_archive"
printf '%s  %s\n' "$android_tools_sha256" "$android_tools_archive" | sha256sum --check --strict
unzip -q "$android_tools_archive" -d "$android_tools_directory"

readonly android_sdkmanager="${android_tools_directory}/cmdline-tools/bin/sdkmanager"
printf 'y\n%.0s' {1..100} | "$android_sdkmanager" --sdk_root="$android_sdk_root" --licenses >/dev/null
"$android_sdkmanager" --sdk_root="$android_sdk_root" --install 'ndk;27.1.12297006' 'cmake;3.22.1'

printf 'ANDROID_SDK_ROOT=%s\n' "$android_sdk_root" >> "${GITHUB_ENV:?}"
printf '%s\n' "${android_tools_directory}/cmdline-tools/bin" "${android_sdk_root}/platform-tools" >> "${GITHUB_PATH:?}"
