## Changes

- Use one portable `.deks` file as the complete project in Desktop, Web and Cloud. Images are
  embedded in the archive, while local locks, activity and idempotency stay in hidden sibling state
  outside the portable file.
- Create, open and save `.deks` files atomically with revision and archive-fingerprint checks so the
  editor and local MCP can collaborate without silently overwriting each other.
- Migrate an older expanded project folder into a verified neighboring `.deks` file without deleting
  or rewriting the source folder.
- Import PNG, JPEG, GIF and WebP images up to 50 MB, plus canonical static SVG up to 5 MB, under the
  same byte, dimension, frame and complexity limits used by Web and Cloud.
- Render sanitized embedded SVG consistently in the editor, Presenter and local MCP previews through
  the released DEKS Core 4.2 document and renderer packages.
- Reject a physical `.deks` over 95 MB before transferring it into the app and enforce a 90 MB
  expanded document-and-assets boundary before opening or writing it.
- Teach the bundled agent skills the portable file contract, shared image limits and the difference
  between file bounds, Cloud workspace quotas and the Cloud MCP export transport ceiling.

## Verification

- `docker compose run --rm desktop npm run verify`
- `docker compose run --rm rust cargo test --no-default-features`
- `docker compose run --rm -e GITHUB_REF_NAME=v0.9.0 desktop npm run release:validate`
- Download the installer for your platform and `SHA256SUMS.txt` from the release, then verify the
  matching checksum before installation.
- macOS artifacts are signed, notarized and stapled. Windows and Linux artifacts are compiled
  packages; this release does not claim platform signing for them.
- The in-app update channel remains inactive until the repository signing key pair is configured;
  until then, updating remains a manual download.
