# Inkronik React Native SDK

Security-first error monitoring and trace correlation for React Native and Expo applications.

> **Development status:** the package has not been released. The JavaScript/Hermes milestone, native capture engines, deterministic
> emulator/simulator matrix, and Expo prebuild/autolinking contract are implemented. Android and iOS initialize before JavaScript, persist bounded
> events for restart delivery, and retain the opaque `setUser` snapshot. Physical-device coverage follows the first release.
> Do not replace a production native crash reporter with this repository yet.

## Target compatibility

The supported peer range is React Native `>=0.65.0` with React `>=17.0.0`. The compatibility boundary is built from the packed public artifact on
both Android and iOS using React Native `0.65.0` and React `17.0.2`. The destructive development target separately verifies React Native `0.83.4`,
React `19.2.0`, Hermes, and New Architecture interoperability.

Expo is optional and is not a runtime dependency. A clean prebuild from the packed SDK is verified with Expo `55.0.29`, React Native `0.83.10`,
React `19.2.0`, and the exact official `expo-template-bare-minimum@55.0.41` template. Installed SDK dependencies and native source dependencies are
exact. Peer dependency ranges express the public compatibility contract.

## Application API

```tsx
import { ErrorBoundary, captureException, init, setUser } from '@inkronik/react-native'

init({
    collectorUrl: 'https://collector.inkronik.codemask.dev',
    publicIngestKey: 'public_mobile_project_key',
    projectId: 'mobile-app',
    release: 'com.example.mobile@1.2.3+42',
    environment: 'production',
    tracePropagationTargets: ['https://api.example.com'],
})

setUser({ id: authenticatedAccount.uuid })

try {
    await performPayment()
} catch (error) {
    captureException({ error, context: { tags: { operation: 'payment' } } })
    throw error
}

const Root = () => (
    <ErrorBoundary fallback={<FatalErrorScreen />}>
        <App />
    </ErrorBoundary>
)
```

Call `clearUser()` during logout. Only an opaque ID is supported; the API has no email, name, IP, or arbitrary identity fields.

Unhandled React Native JavaScript errors and Hermes promise rejections are captured without replacing the application's previous global error
handler. Repeated capture of the same `Error` object is deduplicated for a bounded window, and bounded `Error.cause` chains are retained after
sanitization.

## Native capture baseline

The native layer uses React Native's stable bridge API so it works with classic architecture projects and through legacy-module interoperability in
New Architecture projects. Autolinking does not require application Codegen. The native layer receives no collector URL or ingest key and performs
no network requests. Native events are written to an application-private, bounded queue and are deleted only after the JavaScript transport
receives a successful collector response.

| Platform    | Captured automatically                                                                                                                                                                                                                                     | Explicit handled API                                                                           | Current limitation                                                                                                          |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Android 21+ | JVM uncaught exceptions before JS; immediate `SIGILL`/`SIGTRAP`/`SIGABRT`/`SIGBUS`/`SIGFPE`/`SIGSEGV` journals with bounded frames on API 21-30; historical JVM/native exits and ANRs on API 30+; decoded system tombstone frames and build IDs on API 31+ | `InkronikNative.captureHandledException(context, error, mechanism)`                            | API 21-29 has no OS-owned historical exit source for failures that cannot run a handler, including `SIGKILL` and power loss |
| iOS 12+     | Immediate Mach exception, POSIX signal, C++ exception, and `NSException` recording; delayed MetricKit crash and hang diagnostics on iOS 13+ with bounded frames                                                                                            | `InkronikNative.captureHandledError(_:mechanism:)` and `captureHandledException(_:mechanism:)` | Destructive physical-device coverage is scheduled after the first release                                                   |

Android initializes with a non-exported `ContentProvider`; iOS registers MetricKit and the low-level recorder at image load. The Android JVM handler
always delegates to the previous handler after attempting its bounded write. iOS uses the exact `KSCrash/Recording` `2.5.1` source dependency with
all sink/network modules excluded; its review, checksum, and minimized data contract are documented in
[`docs/native-dependencies.md`](docs/native-dependencies.md).

On API 21-30 the package compiles an Inkronik-owned crash journal from source for `arm64-v8a`, `armeabi-v7a`, `x86`, and `x86_64`. The signal path
wakes a dedicated native writer and persists only the signal, fault address, crash-time identity/release snapshot, bounded instruction addresses,
image basenames, and GNU build IDs. It never stores registers, raw stack memory, maps, logs, open files, arbitrary context, or transport secrets.
On API 31+ this handler is disabled in favor of the OS tombstone API.

The explicit native APIs are intended for errors that native application code handles and would otherwise swallow. JavaScript errors should use
the JavaScript API so deduplication remains effective.

## Destructive native verification

[`fixtures/native-crash-harness`](fixtures/native-crash-harness) contains debug-only Android and iOS modules that deliberately trigger the supported
failure modes. The harness validates restart delivery, crash-time user and release correlation, decoded-frame minimization, and removal from the
native queue only after a collector `2xx`. It is excluded from the npm package, Android has no release variant, and iOS removes trigger bodies when
`DEBUG` is disabled. Never link it into a production target.

## Request correlation

`tracePropagationTargets` accepts exact HTTPS origins only. Fetch and XMLHttpRequest calls to those origins receive a W3C `traceparent` header and
produce bounded client spans plus safe breadcrumbs. The SDK does not add user identity, cookies, authorization, `baggage`, query values, or
request/response bodies. The Node SDK continues the trace and resolves the authenticated user independently on the server.

For React Navigation, connect route lifecycle events without passing route parameters:

```tsx
import { createReactNavigationInstrumentation } from '@inkronik/react-native'

const navigationInstrumentation = createReactNavigationInstrumentation({
    getCurrentRoute: () => navigationRef.getCurrentRoute(),
})

<NavigationContainer
    ref={navigationRef}
    onReady={navigationInstrumentation.onReady}
    onStateChange={navigationInstrumentation.onStateChange}
>
    <AppNavigator />
</NavigationContainer>
```

Only the sanitized route name is recorded; route parameters are never read.

## Privacy defaults

- no screenshots, view hierarchy, replay, attachments, profiling, request/response bodies, headers, cookies, query values, storage, or clipboard;
- URLs lose credentials, query, fragment, and identifier-like path segments before queueing;
- sensitive keys and token-shaped text are redacted before the in-memory/native queue;
- values, depth, stack, breadcrumb count, context count, and queue count are bounded;
- individual events and envelopes have byte limits, stale in-memory items expire, and transient delivery failures use capped exponential backoff;
- SDK operational errors do not escape into the host application;
- collector configuration accepts a public mobile ingest key only and requires HTTPS outside explicit localhost development.

## Development

```bash
bun install --frozen-lockfile
bun run audit
bun run test
bun run test:native-harness
bun run typecheck
bun run typecheck:native-harness
bun run check:lint
bun run check:lint:native-harness
bun run check:format
bun run build
bun run check:expo-prebuild
bun run pack:check
bun run check:compatibility:rn-0.65:android
bun run check:compatibility:rn-0.65:ios
```

The two documented `image-size` advisories are accepted only with an applied local regression patch because upstream has no fixed npm release. See
[`docs/security-exceptions.md`](docs/security-exceptions.md). No other high-severity audit result is ignored.

Source maps and native debug artifacts are intentionally not uploaded by this package or an install lifecycle script. A separate, explicit
Inkronik CLI will perform one-time artifact uploads; this SDK already emits the release, distribution, addresses, and build IDs needed to correlate
those artifacts.

## Release policy

The release workflow defaults to a dry run, publishes the exact verified tarball through npm Trusted Publishing, and requires an explicit native
parity approval for non-dry releases. The accepted native capture ADR records the evidence required for the initial package release; every release
must still pass its own workflow gates.
