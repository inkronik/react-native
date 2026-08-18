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
