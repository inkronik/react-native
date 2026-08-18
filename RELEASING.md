# Releasing

Releases are manual and artifact-based. Local publication and long-lived npm tokens are not supported.

## Preconditions

- The native capture ADR is accepted.
- The complete emulator native failure-mode acceptance matrix passes for the target release build. Physical-device parity is required before a
  stable-parity declaration, not before the first package release.
- Collector ingestion, offline acknowledgement, Expo Build, and EAS Update artifacts are verified.
- The SDK-to-artifact-CLI release/build-ID contract is recorded. Source map and native debug artifact upload remain the responsibility of the
  separate explicit CLI and do not run during package installation.
- CI, CodeQL, audit with the documented patched exception, package inspection, consumer installation, and React Native 0.65 Android/iOS boundary
  builds pass.
- The npm environment is protected and configured for Trusted Publishing from `.github/workflows/release.yaml`.

## Workflow

Run the GitHub `Release` workflow with `dry_run: true` first. Stable versions use `main`; prereleases use `rc`. The workflow calculates a Conventional
Commit version without changing source history, versions the checked-out source only inside the job, verifies and packs it, hashes the tarball, and
uploads the exact artifact. Separate compatibility jobs check out the recorded source SHA and must pass before a GitHub release can be created.

Only after reviewing the dry run and parity evidence may the workflow be run with `dry_run: false` and `native_parity_approved: true`. Separate jobs
create the GitHub release at the recorded source SHA and publish the downloaded, checksum-verified tarball through npm OIDC.

Never publish from a pull request, developer laptop, different tarball, or mutable branch reference. Never merge a pull request as part of release
automation.
