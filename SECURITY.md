# Security Policy

## Reporting a vulnerability

Do not open a public issue for a suspected vulnerability. Report it privately through GitHub Security Advisories for this repository.

Include the affected version, reproduction steps, impact, and any proposed mitigation. Do not include production credentials, payment data, or
customer telemetry in the report.

## Supported versions

Before the first stable release, only the latest release candidate is supported. Security fixes will be released from reviewed source and through
the repository's npm Trusted Publishing workflow.

## Security defaults

The SDK does not collect screenshots, view hierarchy, session replay, request/response bodies, cookies, authorization headers, query values, email,
name, or IP address by default. Applications must provide only a public mobile ingest key; server-side Inkronik keys must never be bundled into a
mobile application.

## Patched development dependencies

`braces@3.0.3` has no upstream fixed release for GHSA-vfj7-8cjw-p6xm. The committed Bun patch rejects nesting at depth 100 in its parser and recursive
AST walkers. The audit excludes this advisory only after `verify-security-patches.mjs` verifies that all four public operations reject excessive
nesting and ordinary brace expansion still works. This package is used by build/example tooling and is not shipped as an SDK runtime dependency.
Remove the patch and advisory exclusion when an upstream fixed release is available.

`basic-ftp` is pinned to `6.2.3` for the release tooling's indirect FTP adapter to address GHSA-c475-qrg2-pj4r. It is not an SDK runtime dependency.
