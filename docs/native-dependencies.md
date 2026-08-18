# Native dependency review

## Inkronik Android signal journal

- Purpose: immediate low-level crash capture on Android API 21-30, where direct application access to system tombstones is unavailable.
- Source: owned C++ source under `android/src/main/cpp`; no third-party crash runtime, prebuilt binary, or downloaded artifact.
- Build inputs: Android NDK `27.1.12297006` and CMake `3.22.1` by default. A host application may provide its centrally managed `ndkVersion`.
- Architectures: `arm64-v8a`, `armeabi-v7a`, `x86`, and `x86_64` through the Android Gradle Plugin ABI selection.
- Network behavior: none. The native library never receives the collector URL or ingest key.
- Install behavior: compiled by the consumer Android build; no npm lifecycle script or runtime download.

The handler covers `SIGILL`, `SIGTRAP`, `SIGABRT`, `SIGBUS`, `SIGFPE`, and `SIGSEGV`, delegates to the previously installed handler, and is disabled
on API 31+, where Inkronik uses the OS tombstone API. It wakes a dedicated native writer and creates a fixed-size, CRC-protected, mode-`0600`
journal in the application's backup-excluded private storage. On restart Kotlin validates the exact length, version, checksum, UTF-8, signal and
frame bounds, persists a minimized event to the normal native queue, and removes the raw journal.

The journal contains only signal metadata, fault address, crash timestamp, bounded instruction/image addresses, image basenames, GNU build IDs,
and the explicitly configured opaque user/release/distribution/environment snapshot. It excludes registers, stack bytes, memory dumps, full image
paths, process maps, logs, open files, breadcrumbs, tags, arbitrary application context, and transport configuration. The library is built with
hidden visibility, stack protection, RELRO, immediate binding, non-executable stack, a single `JNI_OnLoad` export, and 16 KiB page alignment.

## KSCrash Recording 2.5.1

- Purpose: crash-safe iOS Mach exception, POSIX signal, C++ exception, and `NSException` recording.
- CocoaPods dependency: `KSCrash/Recording`, exact version `2.5.1`.
- Upstream source revision: `95a8895d75f3c22aa9ad9f2a15d2fbd97b0a55e2`.
- Source archive SHA-256: `3b427333a643b683ec5121b5eb74538e89783dfc9e3780fc5af578c5b1dc1d44`.
- License: MIT; the required notice is included in `NOTICE`.
- Included scope: `Recording` and its `RecordingCore`/`Core` requirements only.
- Excluded scope: installation adapters, sinks, filters, networking, boot-time monitoring, disk-space monitoring, and UI.
- Install behavior: standard CocoaPods source resolution; no lifecycle script or runtime binary download.
- Network behavior: none. Inkronik reads the local report store and sends only a minimized event through its own JavaScript transport after restart.

The recorder is configured with memory introspection, queue-name search, console logs, deadlock watchdog, and `SIGTERM` capture disabled. At most five
raw reports are retained in an application-private, backup-excluded directory with iOS file protection. Conversion retains only the crash type,
signal/Mach codes, an opaque user ID snapshot, and at most 200 frames containing a symbol, image basename, addresses, and image UUID. Registers,
stack memory, notable objects, logs, full image paths, open files, and arbitrary application context are not copied into the Inkronik event. A raw
report is deleted only after the minimized event is persisted successfully.

The source revision and archive checksum are evidence for review and reproducibility. CocoaPods resolves the exact published version; release CI
must additionally verify the lockfile and generated SBOM before publication.
