## Changes

- Search and choose from the complete built-in Lucide icon catalogue without downloading icons at
  editing or presentation time.
- Add and edit diamond shapes directly in Desktop.
- Choose any of nine anchor points for an element and rotate, move or resize it around that point
  without making it jump when the anchor changes.
- Keep text content and alignment consistent across slides while animating typography, colour and
  four-sided padding on each slide.
- Open existing DEKS files through the codec v2 migration and surface legacy text conflicts instead
  of silently discarding them.
- See when a persistent element uses Morph and therefore does not run its configured Crop entrance
  or exit.

## Verification

- `docker compose run --rm desktop npm run verify`
- `docker compose run --rm rust cargo test --no-default-features`
- `docker compose run --rm -e GITHUB_REF_NAME=v0.11.0 desktop npm run release:validate`
- Download the installer for your platform and `SHA256SUMS.txt` from the release, then verify the
  matching checksum before installation.
- macOS artifacts are signed, notarized and stapled. Windows and Linux artifacts are compiled
  packages; this release does not claim platform signing for them.
- The in-app update channel remains inactive until the repository signing key pair is configured;
  until then, updating remains a manual download.
