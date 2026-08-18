# Inkronik React Native integration patterns

Read only the sections matching the target application.

## Compatibility and installation

Read `@inkronik/react-native` peer dependencies before editing the target. Compare its exact Expo, React Native, and React versions with the target lockfile.

Install an explicit released version with the repository's existing package manager:

```bash
bun add @inkronik/react-native@0.1.0
npm install --save-exact @inkronik/react-native@0.1.0
yarn add --exact @inkronik/react-native@0.1.0
```

Replace `0.1.0` with the release selected by the user or required by compatibility. If no compatible release exists, stop. Do not bypass peer-dependency checks.

After installation, inspect the installed package for `android/` and `ios/` before making any native-coverage claim. Bare React Native projects use
autolinking without application Codegen. Expo projects require a development build or prebuild/EAS native target; Expo Go is not sufficient. If the
native sources are absent or the target native build fails, integrate JavaScript capture only and retain the application's existing native
protection.

The Android package compiles its owned crash journal from source. Confirm CMake `3.22.1` and either the SDK default NDK `27.1.12297006` or the
application's centrally managed `ndkVersion` are available. API 21-30 uses immediate signal journals; API 31+ uses system tombstones. The iOS pod
resolves the exact reviewed recording dependency through CocoaPods. Neither native implementation receives collector credentials or performs
network requests.

## Initialization

Initialize once in the earliest application-owned JavaScript entrypoint, before importing modules that start application work. Resolve values through the target repository's existing configuration mechanism.

```ts
import { init } from '@inkronik/react-native'

init({
    collectorUrl: 'https://collector.inkronik.codemask.dev',
    publicIngestKey: mobileTelemetry.publicIngestKey,
    projectId: mobileTelemetry.projectId,
    release: mobileTelemetry.release,
    environment: mobileTelemetry.environment,
    tracePropagationTargets: ['https://api.example.com'],
})
```

The collector URL is a base URL; do not append an ingestion path. Build `release` from the target application's stable bundle/package identifier, version, and build/update identifier. Never invent a value that cannot be reproduced by the release pipeline.

For Expo, inspect `app.config.*`, `app.json`, EAS profiles, Expo Updates, and the actual entrypoint. For bare React Native, inspect `index.js`/`index.ts`, native bundle identifiers, build numbers, and build configuration. Do not assume importing an `App` component is early enough when the entrypoint performs work first.

## Authenticated user lifecycle

Use the authenticated principal already established by the application. Select one stable opaque account/user UUID; do not decode credentials again.

```ts
import { clearUser, setUser } from '@inkronik/react-native'

export const syncInkronikUser = (userId: string | undefined): void => {
    if (userId === undefined || userId === '') {
        clearUser()
        return
    }

    setUser({ id: userId })
}
```

Call this from the existing authentication state transition, not during every render. Clear the old user before or atomically with an account switch. Add a test proving queued events retain the user snapshot from capture time.

## React error boundary

Place one boundary near the application root and preserve the existing fallback UI:

```tsx
import { ErrorBoundary } from '@inkronik/react-native'

export const Root = () => (
    <ErrorBoundary fallback={<FatalErrorScreen />}>
        <App />
    </ErrorBoundary>
)
```

Do not add nested boundaries solely for telemetry. Feature boundaries are valid when they already isolate failures; verify they do not cause the same error to be captured again at the root.

## Handled exceptions

Pass the original thrown value so stack and exception identity survive:

```ts
import { captureException } from '@inkronik/react-native'

try {
    await submitOperation()
} catch (error) {
    captureException({ error, context: { tags: { operation: 'submit' } } })
    throw error
}
```

Before retaining the rethrow, trace the caller and global capture path. If the same exception is predictably captured later, capture it only at the owning boundary or add verified deduplication. Never attach payment payloads, credentials, headers, or arbitrary domain objects as context.

## Mobile-to-API correlation

List exact trusted API origins only:

```ts
tracePropagationTargets: ['https://api.example.com']
```

Verify with a request test that the trusted API receives a valid W3C `traceparent`; the collector, analytics providers, CDNs, and an attacker-controlled lookalike origin must not receive it. The API must resolve authenticated user identity from its own credentials rather than trusting a mobile telemetry header.

The SDK instruments Fetch and XMLHttpRequest when trusted targets are present. If the application has an existing global network patch, verify
wrapper ordering and teardown before enabling both. Do not manually add a second `traceparent` implementation.

## React Navigation

Connect the adapter to the root navigation container and return the current route object directly:

```tsx
import { createReactNavigationInstrumentation } from '@inkronik/react-native'

const instrumentation = createReactNavigationInstrumentation({
    getCurrentRoute: () => navigationRef.getCurrentRoute(),
})

<NavigationContainer
    ref={navigationRef}
    onReady={instrumentation.onReady}
    onStateChange={instrumentation.onStateChange}
>
    <AppNavigator />
</NavigationContainer>
```

Do not pass route params or the full navigation state into context. Verify that repeated state changes for the same route do not create duplicate
breadcrumbs and that query/fragment-like suffixes in custom route names are removed.

## Shutdown and application lifecycle

Use `flush({ timeoutMs })` for a bounded best-effort flush when the application has an explicit background or termination hook. Use `shutdown({ timeoutMs })` only when tearing down the SDK instance; it restores global request instrumentation and requires a new `init()` before later capture.

The JavaScript queue applies count, byte, expiry, and capped retry bounds. It is memory-only. Do not block UI transitions indefinitely and do not
promise delivery from a force-killed process without verified native persistence.
