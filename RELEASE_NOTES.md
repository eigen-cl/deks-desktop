## Changes

- Package DEKS Desktop for macOS, Windows and Linux.
- Include the reviewed DEKS operation and presentation-design skills with explicit, no-overwrite installation.
- Include an installable local MCP runtime for revision-safe agent editing and read-only slide preview QA.
- Add signed and notarized universal macOS distribution plus SHA-256 checksums for every installer.

## Verification

- Download the installer for your platform and `SHA256SUMS.txt` from this release.
- Run `sha256sum -c SHA256SUMS.txt --ignore-missing` from the download directory.
- macOS artifacts are signed, notarized and stapled. Windows and Linux artifacts are compiled packages; this release does not claim platform signing for them.
