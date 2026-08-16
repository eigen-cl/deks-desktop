# Releasing DEKS Desktop

DEKS Desktop publishes only from an annotated stable SemVer tag `vX.Y.Z` that points to the current
`origin/main`. The tag version must exactly match `package.json`, `src-tauri/Cargo.toml` and
`src-tauri/tauri.conf.json`.

## Release outputs

The tag workflow builds these native packages before creating one GitHub Release:

- macOS universal DMG (`arm64` + `x86_64`), signed with Developer ID, notarized and stapled;
- Windows x64 NSIS EXE and MSI packages;
- Linux x64 DEB, AppImage and RPM packages;
- one `SHA256SUMS.txt` generated after all native finalization.

Windows and Linux packages are not described as signed until platform signing is implemented and
verified. The final publish job runs only after validation and all three native build jobs succeed.

## Required GitHub configuration

Configure these Actions secret names for the required macOS signature. Never place their values in
Git, release notes, issue text or command output:

- `CSC_LINK` or `MACOS_CSC_LINK` — base64 PKCS#12 Developer ID certificate;
- `CSC_KEY_PASSWORD` or `MACOS_CSC_KEY_PASSWORD`;
- `CSC_NAME` or `MACOS_CSC_NAME`;
CI notarization is optional only as a complete trio: `APPLE_API_KEY_BASE64`, `APPLE_API_KEY_ID` and
`APPLE_API_ISSUER`. A partial trio fails validation. With all three present, CI notarizes and verifies
the ticket before publishing. With none present, CI still requires and verifies the Developer ID
signature but creates a **draft** GitHub Release; it never presents the unnotarized DMG as complete.

When configured, the Apple API key is decoded into a mode-0600 file under the runner's temporary
directory, is available only to the macOS job and is deleted in an `always()` cleanup step. GitHub's
scoped token is exposed only to the final release job.

### Current local-notarization handoff

Until the App Store Connect API trio is configured in GitHub, use the already provisioned local
keychain profile `forger-notary` to finish the draft. These commands operate on the exact downloaded
DMG and never print the profile's credentials:

```bash
DEKS_DMG_PATH="/absolute/path/to/DEKS Desktop_VERSION_universal.dmg"
xcrun notarytool submit "$DEKS_DMG_PATH" \
  --keychain-profile forger-notary --wait
xcrun stapler staple "$DEKS_DMG_PATH"
xcrun stapler validate "$DEKS_DMG_PATH"
codesign --verify --verbose=2 "$DEKS_DMG_PATH"
```

Download every draft asset into one clean directory, replace the DMG there, regenerate the aggregate
checksum after stapling, then replace only those two draft assets:

```bash
shasum -a 256 -- *.dmg *.exe *.msi *.deb *.AppImage *.rpm > SHA256SUMS.txt
gh release upload vX.Y.Z "$DEKS_DMG_PATH" SHA256SUMS.txt --clobber
gh release edit vX.Y.Z --draft=false --latest
```

Before the final `gh release edit`, inspect the notarization result and checksum locally. Do not mark
the release complete if `notarytool` is not `Accepted` or `stapler validate` fails.

## Local gates and tag handoff

Run the portable checks in Docker:

```bash
docker compose run --rm desktop npm run verify
docker compose run --rm rust cargo test --no-default-features
docker compose run --rm -e GITHUB_REF_NAME=v0.2.0 desktop npm run release:validate
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
