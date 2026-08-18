# Native destructive crash harness

This test-only harness deliberately terminates or blocks a React Native process to verify Inkronik restart capture. It is outside the npm package,
has no production export, is disabled by native code outside debug builds, and must never be linked into an application release target.

## Acceptance contract

For each immediate case, the harness:

1. persists the armed case and sets a case-specific opaque user ID;
2. triggers the native failure from a debug-only module;
3. relaunches the isolated application after the process terminates;
4. replaces only the configured collector endpoint with an in-process `202` fixture response;
5. validates platform, mechanism, crash-time user, release, decoded-frame requirements, address format, data minimization, and absence of private image
   paths;
6. polls the native queue and passes only after the accepted event ID has been acknowledged and removed.

The fixture collector never opens a socket and refuses every unexpected Inkronik envelope. Non-collector fetches continue through the original
implementation.

## Android test-app wiring

Add the fixture as a local module in the debug test application only:

```groovy
// settings.gradle
include(":inkronik_crash_fixture")
project(":inkronik_crash_fixture").projectDir = file("../../fixtures/native-crash-harness/android")
```

```groovy
// app/build.gradle
dependencies {
  debugImplementation project(":inkronik_crash_fixture")
}
```

Register `InkronikCrashFixturePackage()` after the autolinked packages in the test application's `MainApplication`. Use
`fixtures/native-crash-harness/App.tsx` as its root component.

The automated runner covers the owned signal journal on API 24-30 and decoded system tombstones on API 31+. For `android.anr`, it waits for
ActivityManager to confirm the ANR and selects the system dialog's stable `android:id/aerr_close` action so Android records `REASON_ANR`; it does
not reinterpret a harness `force-stop` as an ANR. API 30 can verify the native exit reason but cannot provide decoded tombstone frames through
`ApplicationExitInfo`. Physical-device parity is recorded after the first release.

## iOS test-app wiring

Add the fixture pod to the debug test target only:

```ruby
pod "InkronikNativeCrashFixture", :path => "../../fixtures/native-crash-harness", :configurations => ["Debug"]
```

Run `pod install`, use `fixtures/native-crash-harness/App.tsx` as the root component, and run on a physical iOS device without an attached debugger.
The immediate low-level cases are checked after manual relaunch. `ios.hang` is explicitly marked `os-delayed`: MetricKit controls delivery, so the
app may need to be relaunched again after the diagnostic becomes available.

## Commands

```bash
bun run test:native-harness
bun run pack:check
node scripts/run-native-crash-harness.mjs --platform android --case all --confirm-destructive --device <emulator-id>
node scripts/run-native-crash-harness.mjs --platform ios --case all --confirm-destructive --device <simulator-udid>
```

`pack:check` proves that `fixtures/` and its destructive symbols are absent from the publishable tarball.
