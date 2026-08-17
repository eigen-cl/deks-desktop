## Changes

- Start from a new home that shows recent local presentations and lets you add the folders you
  already use.
- Create widescreen, standard or square presentations directly in the default DEKS folder.
- Edit slides in a Desktop-native workspace with a slide rail, canvas, inspector and presentation
  mode while keeping files compatible with DEKS Web.
- Insert and edit text, shapes, lines, icons and images through the same portable DEKS format.
- Import PNG, JPEG, GIF and WebP images into the presentation folder so projects remain movable and
  self-contained.
- Undo and redo confirmed edits one command at a time without breaking revision-safe collaboration
  with local agents.
- Use the complete interface in Spanish or English and keep the selected language between launches.
- Let local agents add image assets and render those images in slide preview QA without granting
  access to arbitrary filesystem paths.

## Verification

- `docker compose run --rm desktop npm run verify`
- `docker compose run --rm rust cargo test --no-default-features`
- `docker compose run --rm -e GITHUB_REF_NAME=v0.4.0 desktop npm run release:validate`
- Download the installer for your platform and `SHA256SUMS.txt` from the release, then verify the
  matching checksum before installation.
- macOS artifacts are signed, notarized and stapled. Windows and Linux artifacts are compiled
  packages; this release does not claim platform signing for them.
- The in-app update channel remains inactive until the repository signing key pair is configured;
  until then, updating remains a manual download.
