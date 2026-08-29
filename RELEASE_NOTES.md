## Changes

- Organize related elements in named folders without changing their absolute position, style or
  animation. Overlaps inside the same logical group no longer create collision noise; overlaps
  across groups still do.
- Write a script and record, listen to, replace or remove narration for each slide entirely on the
  device. Audio and timing stay embedded in the portable `.deks` file instead of being uploaded.
- Present a deck with narration after one explicit start gesture. DEKS respects each slide's pauses,
  cancels stale audio when navigating and advances when the narration ends.
- Configure document, slide and element motion with clear inherited values, including entrance,
  exit, Morph and timing in beats.
- Open codec-v2 files and save them as portable codec v3 presentations with logical groups and
  narration audio.
- Let a local agent create and manage logical groups, add WAV or MP3 narration and update slide
  narration through the bundled offline MCP.

## Verification

- `docker compose run --rm desktop npm run verify`
- `docker compose run --rm rust cargo test --no-default-features`
- `docker compose run --rm -e GITHUB_REF_NAME=v0.12.0 desktop npm run release:validate`
- Download the installer for your platform and `SHA256SUMS.txt` from the release, then verify the
  matching checksum before installation.
- macOS artifacts are signed, notarized and stapled. Windows and Linux artifacts are compiled
  packages; this release does not claim platform signing for them.
- The in-app update channel remains inactive until the repository signing key pair is configured;
  until then, updating remains a manual download.
