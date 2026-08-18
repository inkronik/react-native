# React Native compatibility fixture

This fixture is materialized in a temporary directory by `scripts/check-react-native-compatibility.mjs`. It verifies the oldest supported React
Native release with its own pinned React version and Android Gradle wrapper. Installs disable lifecycle scripts, the requested versions are checked
against an internal allowlist, npm uses an isolated temporary cache, and the generated project is deleted after every run.

The fixture bundles the public JavaScript entrypoint and compiles the Android library or iOS pod. The main native crash harness separately verifies
the latest React Native release and destructive restart delivery. Xcode compatibility definitions in the fixture apply only to React Native 0.65's
historical Folly dependency; they are not shipped in the SDK pod.
