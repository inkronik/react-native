---
name: integrate-inkronik-react-native
description: Install, configure, migrate, or audit @inkronik/react-native in a React Native or Expo application. Use when adding Inkronik error capture, React ErrorBoundary handling, opaque authenticated-user context, release metadata, or allowlisted W3C request correlation; when reviewing an existing mobile integration; or when preparing a safe migration from an existing error-monitoring setup. Do not use for server-side Node.js or browser-only applications.
---

# Integrate Inkronik React Native

Integrate the SDK without leaking credentials or personal data, breaking application error behavior, or claiming unsupported native coverage.

## Workflow

1. Read the target repository instructions before editing.
2. Inspect the package manifest, lockfile, package manager, Expo and React Native versions, Hermes/New Architecture settings, app entrypoint, native folders, Expo config, authentication lifecycle, API origins, release/build metadata, tests, and existing monitoring code.
3. Read [references/integration-patterns.md](references/integration-patterns.md) before choosing the integration path.
4. Compare the target toolchain with the SDK peer dependencies. Stop and report an incompatibility instead of forcing dependency resolution.
5. State whether the app is Expo managed/prebuild or bare React Native, where initialization will run, how release/build values are resolved, which exact API origins receive trace context, and which opaque authenticated-user ID is used.
6. Implement the smallest complete integration. Initialize once, preserve application error behavior, update user state on login/logout, connect request and navigation instrumentation only where required, and avoid duplicate boundaries or manual captures.
7. Add or update focused tests, then run the target repository's required format, lint, type, test, native-build, and Expo prebuild checks. Report anything that could not be verified.

## Integration rules

- Install an exact released `@inkronik/react-native` version with the target repository's package manager. Never use `latest`, a range, a Git branch, or a local link unless the user explicitly requests development integration.
- Use React Native autolinking for bare Android/iOS projects. On Android, verify that the consumer build can resolve CMake `3.22.1` and either the
  SDK default NDK `27.1.12297006` or the application's centrally managed `ndkVersion`. On iOS, run the repository's normal CocoaPods install.
- Expo Go cannot load this native SDK. Use an Expo development build or EAS/prebuild target and verify the generated native projects.
- Use only a public mobile ingest key in client configuration. Never place an administrative key, server ingest key, access token, cookie, or authentication credential in the bundle.
- Source configuration from the target application's established Expo/environment mechanism. Do not commit real environment-specific values when the repository expects deployment configuration.
- Call `init()` once at the earliest safe JavaScript entrypoint. Do not initialize during component rendering or on every navigation/authentication change.
- Configure `tracePropagationTargets` with exact HTTPS origins for trusted application APIs. Do not use wildcard, substring, path, or collector entries.
- Use a stable opaque application-owned identifier with `setUser({ id })` after authentication and call `clearUser()` on logout or account switch. Do not send email, name, phone, tokens, or arbitrary profile fields.
- Install one top-level `ErrorBoundary` without changing the application's intended fallback behavior.
- Capture handled exceptions with the original error object. Do not reduce them to `error.message`; do not both capture and rethrow into another known capture path without deduplication evidence.
- Preserve request bodies, headers, abort signals, response handling, and thrown errors when request tracing is enabled.
- Let the SDK instrument both Fetch and XMLHttpRequest by default when trace targets are configured. Disable either patch only after proving the application does not use that transport or owns a conflicting reversible patch.
- When React Navigation is present, connect `createReactNavigationInstrumentation` to the root container and expose only `getCurrentRoute()`. Never copy route params into telemetry.
- Do not remove an existing native crash reporter until the installed Inkronik version demonstrably includes native Android/iOS capture, restart delivery, and symbolication for the target release build.
- Do not ship two immediate signal/Mach crash recorders in the same migration build. Validate Inkronik in a dedicated release variant, then switch
  recorders atomically after restart delivery and symbolication pass on physical devices.
- Do not claim native crash, ANR, hang, watchdog, or offline guarantees from JavaScript-only verification.
- Keep source-map and native debug-artifact upload outside this package. Use the separate explicit Inkronik artifact CLI when it is available; do
  not add an npm install hook or an ad hoc upload script containing credentials.
- Keep screenshots, view hierarchy, replay, request/response bodies, headers, cookies, query values, and clipboard data out of telemetry.

## Verification evidence

Verify behavior rather than compilation alone:

- initialization occurs exactly once before application work that should be captured;
- one handled JavaScript exception produces one sanitized envelope without changing propagation;
- the React boundary captures once and renders the existing fallback;
- login, logout, and account switch produce the correct immutable user snapshots;
- only allowlisted API origins receive `traceparent`, while collector and third-party requests do not;
- allowlisted Fetch and XMLHttpRequest calls produce client spans whose ID is the API server span's parent ID;
- navigation transitions record only sanitized route names and never route parameters;
- no authorization, cookie, query value, request body, or personal user field reaches captured events;
- retryable failures remain bounded by queue count, event/envelope bytes, expiry, and capped backoff;
- shutdown or background lifecycle handling flushes within a bounded timeout where the application requires it;
- packed release builds and, when applicable, Expo prebuild/EAS configuration still succeed.
- Android API 21-30 crash tests deliver `android.native-signal` after restart, while API 31+ tests deliver OS tombstone data; in both paths verify
  crash-time user/release correlation, minimized frames, and queue acknowledgement only after collector acceptance.

If a live collector or release build is unavailable, add focused tests around configuration, user lifecycle, capture calls, and request headers, then clearly identify the remaining live verification.
