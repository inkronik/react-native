# ADR 0001: Native crash capture architecture

Status: accepted for the initial package release  
Date: 2026-08-17

## Context

Capturing failures after a React Native process or JavaScript runtime becomes unstable requires native signal handling, thread capture, unwinding,
and crash-safe persistence. Incorrect implementations can deadlock, corrupt reports, or fail inside an already damaged process.

## Decision so far

The SDK owns the JavaScript API, event model, privacy layer, transport, tracing, native bridge, release metadata, artifact tooling, and collector
protocol. Native code owns only early capture and a bounded restart queue. It never receives transport credentials and never sends a network
request.

The native baseline combines platform-owned diagnostics, an owned minimal Android signal journal, and one narrowly scoped, source-resolved iOS
recorder:

- a non-exported Android `ContentProvider` installs the JVM uncaught handler before JavaScript and delegates to the previous handler;
- Android `ApplicationExitInfo` records historical JVM/native exit reasons and ANRs on API 30+, with bounded ANR traces;
- on API 31+, a bounded owned protobuf reader extracts only the crashed thread, signal metadata, frame addresses, image basenames, and build IDs
  from the system tombstone; it ignores registers, memory dumps, logs, mappings, open files, and abort messages;
- on API 21-30, an Inkronik-owned source-built handler records six fatal signals to a fixed-size CRC-protected journal through a dedicated native
  worker; it snapshots bounded instruction addresses, image basenames, build IDs, and explicit crash-time identity/release metadata without
  persisting registers, raw stack memory, maps, logs, open files, or arbitrary context;
- iOS uses exactly `KSCrash/Recording` 2.5.1 for immediate Mach exception, signal, C++ exception, and `NSException` recording, with no sink or network
  modules and privacy-heavy capture options disabled;
- an iOS MetricKit subscriber records OS-provided crash and hang diagnostics on iOS 13+;
- public Kotlin/Java and Objective-C/Swift-compatible APIs record handled native failures;
- platform-private, bounded event files survive process restart and are acknowledged only after accepted delivery through the JavaScript transport;
- the bridge uses React Native's stable bridge API, including New Architecture legacy-module interoperability, and snapshots only an opaque user
  ID plus bounded release metadata.

Low-level native capture remains isolated behind the Inkronik-owned restart queue. It is independent from upload and receives no collector
configuration or ingest credential.

## Security gates

1. Exact source revision/version, license, maintainership, security history, and checksum are recorded.
2. No install-time binary download or lifecycle script is required.
3. Native crash-recording code performs no network request; only the Inkronik transport can send an event.
4. Crash files are bounded, application-sandboxed, minimal, and acknowledged before deletion.
5. The crash path performs only async-signal-safe operations where required and never executes JavaScript.
6. Only the explicitly supported opaque user ID and release metadata are copied into native crash state as bounded snapshots. Breadcrumbs, tags,
   arbitrary context, transport credentials, and privacy-heavy process state are excluded.
7. Android/iOS artifacts are reproducible or fetched from a checksum-pinned trusted registry through normal platform dependency resolution.
8. The current React Native New Architecture build passes destructive crash and restart-delivery tests, and the packed artifact passes clean Expo
   prebuild/autolinking verification.

## Implemented evidence

- Public configuration and mobile-key validation;
- structured JavaScript exception/message envelope;
- JavaScript/Hermes stack parsing;
- pre-queue redaction and hard payload bounds;
- opaque `setUser({ id })` with no email/name/IP fields;
- React error boundary;
- uncaught JavaScript and available unhandled-rejection hooks;
- exact-origin W3C `traceparent` injection without user identity or `baggage`;
- collector isolation and bounded in-memory delivery;
- the packed public artifact bundles and compiles its Android library and iOS pod against the oldest supported React Native 0.65.0 and React
  17.0.2 boundary;
- Android Kotlin compilation succeeds in both the React Native 0.65.0 compatibility fixture and an autolinked React Native 0.83.4 test
  application;
- Android native tombstone and signal-journal parsing have focused malformed-input and data-minimization tests and the complete Android unit-test
  target passes;
- the owned Android native library builds for all four Android ABIs with hidden symbols, stack protection, RELRO, immediate binding,
  non-executable stack, and 16 KiB page alignment; the package contains source rather than prebuilt native binaries;
- an Android 11/API 30 ARM64 emulator completed real crash → process death → restart → collector → acknowledgement flows for JVM uncaught,
  `SIGSEGV`, `abort()`, and C++ termination; the three native cases delivered 4, 5, and 14 minimized frames respectively with the crash-time user
  and release snapshot;
- an Android 7/API 24 ARM64 emulator completed the owned `SIGSEGV` journal → process death → restart → collector → acknowledgement flow with 35
  minimized frames, proving the runtime path at the harness application's lower API boundary without relying on `ApplicationExitInfo`;
- an Android 16/API 36 ARM64 emulator completed JVM uncaught and all three native failure flows through the API 31+ system-tombstone path, with
  69, 69, and 62 minimized native frames; its ActivityManager-confirmed ANR was closed through the system dialog, recorded as `REASON_ANR`, and
  delivered and acknowledged after restart;
- KSCrash 2.5.1 resolves through CocoaPods, its native target builds, and its exact source revision, archive checksum, license, included subspecs,
  and disabled capture features are recorded;
- a debug-only destructive harness covers JVM uncaught exceptions, Android native signals/abort/C++ termination/ANR, and iOS signals/abort/C++/
  `NSException`/hang; its validator requires crash-time user and release correlation, minimized decoded frames, and post-2xx native acknowledgement;
- iOS pod installation and autolinking succeed against React Native 0.65.0 and 0.83.4, and all Objective-C/Objective-C++ bridge sources compile;
- an iOS 26.5 ARM64 Simulator completed `SIGSEGV`, `abort()`, `NSException`, and C++ exception → process death → restart → collector →
  acknowledgement flows with 21, 21, 20, and 29 minimized frames respectively; MetricKit hang delivery remains an explicitly OS-delayed contract;
- the packed public tarball completes a clean Expo 55.0.29 prebuild from the exact official `expo-template-bare-minimum@55.0.41` template with
  React Native 0.83.10 and React 19.2.0; Expo Autolinking resolves the installed tarball's Android library and iOS podspec, and the fixture records
  development, internal simulator, and production EAS Build profiles without submitting a cloud build;
- native restart events are deduplicated in the JavaScript queue and native files are acknowledged only after a 2xx response;
- the native bridge receives cache/release settings only, never the collector URL or public ingest key;
- the release/distribution/build-ID contract is compatible with the separate explicit artifact-upload CLI; this package performs no source-map or
  native debug artifact upload during installation or runtime;
- CI and release workflows include React Native 0.65.0 Android and iOS boundary builds; release creation is gated on both jobs.

## Post-first-release evidence

- Record the destructive harness matrix from physical release-like device builds before declaring stable device parity.

The deterministic first-release evidence has passed, so this ADR is accepted for the initial package release. Physical-device evidence is
deliberately a post-first-release gate and remains required before declaring stable device parity. Each release must still pass the CI, dry-run,
artifact, and approval gates in `RELEASING.md`.
