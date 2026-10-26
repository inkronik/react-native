# Security patches and exceptions

## `image-size` CVE-2025-71329 and CVE-2025-71330

Status: resolved by upstream version `2.0.4`; no audit exception or local patch.

Both advisories were fixed in `2.0.3`. The workspace pins `image-size` to `2.0.4`. Its locked Metro `0.83.8` no longer depends on `image-size`, so
there is no transitive `1.x` copy to patch. The old `image-size@1.2.1` patch and both audit ignores have been removed.

The audit checks that malformed ICNS entries and zero-sized JXL/HEIF boxes are rejected and a valid PNG is still parsed. The probe runs in a child
process with a five-second deadline so an infinite-loop regression fails the gate. See
[GHSA-5p2g-fcmc-qvqq](https://github.com/advisories/GHSA-5p2g-fcmc-qvqq) and
[GHSA-w3rx-r6r6-pgpr](https://github.com/advisories/GHSA-w3rx-r6r6-pgpr).

## `braces` depth hardening

The [GHSA-vfj7-8cjw-p6xm advisory](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm) has been withdrawn, and the audit no longer ignores it.
The existing `braces@3.0.3` patch remains as depth-limit hardening for parsing, compilation, expansion and stringification, including externally
supplied ASTs. `scripts/verify-security-patches.mjs` still verifies all these entrypoints and ordinary brace expansion.

## PostCSS

Expo's Metro configuration requested a vulnerable PostCSS range. The workspace overrides it to exact version `8.5.29`, which is newer than the
patched versions for CVE-2026-45623 and CVE-2026-73646. No audit exception is used.
