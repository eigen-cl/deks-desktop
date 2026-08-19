# Releasing DEKS Desktop

DEKS Desktop publishes only from an annotated stable SemVer tag `vX.Y.Z` that points to the current
`origin/main`. The tag version must exactly match `package.json`, `src-tauri/Cargo.toml` and
`src-tauri/tauri.conf.json`.

## Release outputs

The tag workflow builds these native packages before creating one GitHub Release:

- macOS universal DMG (`arm64` + `x86_64`), signed with Developer ID, notarized and stapled;
- Windows x64 NSIS EXE and MSI packages;
- Linux x64 DEB, AppImage and RPM packages;
- one `SHA256SUMS.txt` generated after all native finalization;
- one schema-v1 `latest.json` with the tag, version, release URL and immutable per-tag asset URLs,
  sizes and required SHA-256 digests.

The release job renames the native output to this stable public contract:

```text
deks-desktop-macos-universal.dmg
deks-desktop-windows-x64.exe
deks-desktop-windows-x64.msi
deks-desktop-linux-x64.deb
deks-desktop-linux-x64.AppImage
deks-desktop-linux-x64.rpm
SHA256SUMS.txt
latest.json
```

GitHub resolves a stable installer link such as
`https://github.com/eigen-cl/deks-desktop/releases/latest/download/deks-desktop-macos-universal.dmg`
to the asset in the current public release. The machine-readable feed is
`https://github.com/eigen-cl/deks-desktop/releases/latest/download/latest.json`. A tag release is the
only event that refreshes these downloads; pushes to `main` still run CI without publishing.

Windows and Linux packages are not described as signed until platform signing is implemented and
verified. The final publish job runs only after validation and all three native build jobs succeed.

Publishing a tag is the only manual step. Everything after it — validation, signing, notarization,
stapling, checksums, the manifest and the public GitHub Release — happens in CI with no human
handoff. There is no draft state to finish by hand: either the release comes out complete, or it
does not come out.

## Required GitHub configuration

All six Actions secrets are required. Never place their values in Git, release notes, issue text or
command output.

macOS Developer ID signature:

- `CSC_LINK` or `MACOS_CSC_LINK` — base64 PKCS#12 Developer ID Application certificate, exported
  with its private key;
- `CSC_KEY_PASSWORD` or `MACOS_CSC_KEY_PASSWORD` — the export password;
- `CSC_NAME` or `MACOS_CSC_NAME` — the full identity, e.g. `Developer ID Application: NAME (TEAMID)`.

Apple notarization, through an App Store Connect API key with the Developer role or higher:

- `APPLE_API_KEY_BASE64` — base64 of the downloaded `.p8`;
- `APPLE_API_KEY_ID` — the Key ID, which is also the suffix of the `.p8` filename;
- `APPLE_API_ISSUER` — the Issuer UUID above the key table, not the Team ID.

A missing credential fails the release during validation, before any runner starts building. This is
deliberate: a signed but unnotarized DMG is a DMG Gatekeeper refuses to open, so publishing one would
advertise a download nobody can use.

The Apple API key is decoded into a mode-0600 file under the runner's temporary directory, is
available only to the macOS job and is deleted in an `always()` cleanup step. GitHub's scoped token
is exposed only to the final release job.

Tauri notarizes and staples the `.app`; the DMG that carries it is signed but arrives without a
ticket of its own. The macOS job therefore submits the container to `notarytool` and staples it
before verifying anything. Without that, Gatekeeper has to ask Apple on first launch — fine on a
connected machine, and a failure on the one that just downloaded the installer to set itself up.

The job then verifies what it produced before anything is published: `codesign` on the mounted app
and on the DMG, `spctl --assess` against the Gatekeeper policy, and `xcrun stapler validate` for both
tickets. A DMG that fails any of these never reaches the release.

### Optional signed update channel

The in-app updater stays off until the repository variable `DESKTOP_UPDATER_READY` is `true` and both
`TAURI_SIGNING_PRIVATE_KEY` and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` plus `TAURI_UPDATER_PUBKEY`
exist. A partial key pair fails the release rather than publishing update artifacts no client can
install. Releases publish normally with the channel off; they simply omit `updater.json`.

## Local gates and tag handoff

Run the portable checks in Docker:

```bash
docker compose run --rm desktop npm run verify
docker compose run --rm rust cargo test --no-default-features
docker compose run --rm -e GITHUB_REF_NAME=v0.4.0 desktop npm run release:validate
```

For a native packaging smoke test, install the official Tauri prerequisites for that host OS, then
run one matching command:

```bash
npm run tauri -- build --target universal-apple-darwin --bundles dmg
npm run tauri -- build --bundles nsis,msi
npm run tauri -- build --bundles deb,appimage,rpm
```

Cross-platform installers are intentionally produced in GitHub's native runners, not emulated in
Docker. macOS release builds additionally require Xcode command-line tools, both Rust Darwin targets
and the configured signing/notarization credentials.

After the release branch is reviewed, merged and revalidated, create and push the annotated tag from
the exact `origin/main` commit. This repository intentionally does not provide a command that creates
or pushes the tag as a side effect of validation.
