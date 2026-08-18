# Expo prebuild fixture

This source-only fixture is copied to a temporary directory by `scripts/check-expo-prebuild.mjs`. The check packs the public SDK, installs it with
exact Expo/React Native dependencies while lifecycle scripts are disabled, and runs a clean Expo prebuild from an exact official template.

The generated native projects are not committed. The check requires Expo Autolinking to resolve the installed tarball's Android library and iOS
podspec, and verifies the EAS Build profiles used by the fixture. It does not submit a cloud build, change Expo account state, upload source maps,
or require signing credentials.
