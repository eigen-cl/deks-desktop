## Changes

- Start from a new home that shows recent local presentations with their real rendered cover slide
  and lets you add the folders you already use.
- Create widescreen, standard, square or custom presentations, with their palette, from a single
  dialog; they are born in the default DEKS folder.
- Find language, folders and agent setup together in Settings instead of competing with the first
  screen.
- Edit slides in a Desktop-native workspace with rendered slide thumbnails, a live canvas, snapping
  guides, zoom, context menus, an element inventory and a tabbed inspector, while keeping files
  compatible with DEKS Web.
- See the element itself follow the pointer while dragging or resizing, with alignment to the canvas,
  to a configurable grid and to other elements; hold Alt to ignore snapping and Escape to cancel.
- Play the declared transition when moving between neighbouring slides while editing, and turn it
  off in the editor settings.
- Set the slide's in, out and morph motion at the foot of the slide panel; every property you do not
  touch keeps inheriting from the document.
- Delete a presentation from the home with a right click; it moves to the system trash after a
  confirmation that names it.
- Present without chrome: the controls sleep and reappear on pointer movement, hover or focus, and
  images now render in presentation mode.
- Reuse an element that already exists on another slide instead of creating a second identity, so
  transitions keep interpolating between its checkpoints.
- Install the bundled skills into the global folder of the agents detected on this machine, grouped
  by family, and generate the exact local MCP configuration for each format without ever writing
  inside another program's configuration.
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
- `docker compose run --rm -e GITHUB_REF_NAME=v0.5.0 desktop npm run release:validate`
- Download the installer for your platform and `SHA256SUMS.txt` from the release, then verify the
  matching checksum before installation.
- macOS artifacts are signed, notarized and stapled. Windows and Linux artifacts are compiled
  packages; this release does not claim platform signing for them.
- The in-app update channel remains inactive until the repository signing key pair is configured;
  until then, updating remains a manual download.
