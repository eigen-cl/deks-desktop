## Changes

- Choose **System**, **Español** or **English** from Settings on the home screen or in the editor.
- Follow the device's primary language when **System** is selected, including changes made while
  DEKS Desktop is open.
- Translate the complete visible interface, dialogs, editor controls, Presenter labels, activity and
  update messages between Spanish and English.
- Remember the language preference locally and restore the last confirmed choice if saving it fails.
- Create interface-generated slide and element names in the active language while leaving existing
  presentation content and the portable `.deks` format unchanged.

## Verification

- `docker compose run --rm desktop npm run verify`
- `docker compose run --rm rust cargo test --no-default-features`
- `docker compose run --rm -e GITHUB_REF_NAME=v0.10.0 desktop npm run release:validate`
- Download the installer for your platform and `SHA256SUMS.txt` from the release, then verify the
  matching checksum before installation.
- macOS artifacts are signed, notarized and stapled. Windows and Linux artifacts are compiled
  packages; this release does not claim platform signing for them.
- The in-app update channel remains inactive until the repository signing key pair is configured;
  until then, updating remains a manual download.
