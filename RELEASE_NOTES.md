## Changes

- Open presentations written by an earlier version again. A file from 0.4.0 to
  0.7.0 is already canonical, so it skipped the migration for pre-1.0 projects,
  and the newer contract then rejected it for a motion property it could not
  have declared. The missing property is inherited instead; whatever the file
  does declare is left untouched.

- Add a number element: a figure that carries a magnitude rather than a string
  of digits, so it can count towards its value on the same curve that moves it.
  Three toggles on the element say which of enter, change and exit count. Its
  format — decimals, separators, symbol and where the symbol sits — is written
  into the file, never taken from the language of the machine that opens it.
- Add two curtain animations that avoid the fade. `crop` moves the content
  inside the element's own box, so one text can replace another in the same
  place without the two dissolving through each other. `wipe` is the opposite:
  the element stays still and the mask edge travels over it, uncovering
  something already there.
- Add a delay in beats beside the one in milliseconds. They add up. In beats it
  follows the deck's tempo, so "start when the previous one ends" survives a
  change of rhythm; in milliseconds it pins an exact instant.

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
- Connect an AI harness in one click: Settings → Agents lists only what is actually installed on
  this machine and offers "Install globally" or "Install into a folder", each of which sets up the
  local MCP server and its skills together — a partial install cannot do the job.
- Keep installed folders current by themselves: every update re-copies the skills into the folders
  you asked DEKS to maintain, and a folder you removed or deleted simply stops being maintained.
- Have the MCP entry written for you instead of pasted by hand. DEKS merges only its own `deks`
  entry, leaves every other server and setting untouched, and saves a backup of the original file
  next to it before its first write. A collapsed manual snippet remains for clients DEKS cannot
  detect.
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
