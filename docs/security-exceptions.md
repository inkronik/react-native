# Temporary security exceptions

## `image-size` CVE-2025-71329 and CVE-2025-71330

Status: temporary, build tooling only  
Review on every dependency update and no later than 2026-09-17.

React Native `0.83.4` brings Metro `0.83.3`, which resolves `image-size@1.2.1`. The upstream project is archived and the GitHub advisories list no
patched npm version. The vulnerable package is not shipped as runtime code by `@inkronik/react-native`; Metro uses it only while building an
application.

The lockfile applies `patches/image-size@1.2.1.patch`. The existing package already guards zero-sized ISO boxes used by its HEIF/JXL parsers. The
Inkronik patch adds strict ICNS entry bounds and rejects zero/undersized entries, closing the remaining non-advancing loop. CI executes
`scripts/verify-security-patches.mjs` after the audit and fails if the patch is missing or ineffective.

The two GHSA IDs are ignored by the audit command only together with this local regression check. They must be removed from the ignore list as soon as Metro
replaces `image-size` or a maintained patched package is available.

## PostCSS

Expo's Metro configuration requested a vulnerable PostCSS range. The workspace overrides it to exact version `8.5.26`, which is newer than the
patched versions for CVE-2026-45623 and CVE-2026-73646. No audit exception is used.
