## Changes

- Run on the published DEKS Core 1.0 contract: canonical documents, canonical MCP commands and
  previews rendered without an intermediate format.
- Open folders written by earlier versions: they are upgraded in memory, so a local project is never
  lost to the format change.
- Check for a signed update on launch and offer it without blocking local work. Downloading stays an
  explicit decision, and the signature is verified before anything is installed.
- Use the canonical DEKS brand, typefaces and colour tokens instead of an app-specific variant.
- Package DEKS Desktop for macOS, Windows and Linux.
- Include the reviewed DEKS operation and presentation-design skills with explicit, no-overwrite installation.
- Include an installable local MCP runtime for revision-safe agent editing and read-only slide preview QA.
- Add signed and notarized universal macOS distribution plus SHA-256 checksums for every installer.

## Verification

- Download the installer for your platform and `SHA256SUMS.txt` from this release.
- Run `sha256sum -c SHA256SUMS.txt --ignore-missing` from the download directory.
- macOS artifacts are signed, notarized and stapled. Windows and Linux artifacts are compiled packages; this release does not claim platform signing for them.
- The in-app update channel stays inactive until its signing key pair is configured for the repository. Until then this release publishes installers only, and updating is a manual download.
