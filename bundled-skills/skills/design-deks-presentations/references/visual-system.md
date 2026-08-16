# Visual system

## Choose palette roles

An explicit brand or user guide takes priority. Otherwise:

1. Call `recommend_palettes(intent, mode, limit)` for a small set of complete examples.
2. Compare the candidates against narrative tone, background mode, and contrast checks.
3. Choose one system and apply its roles and paired `on_colors` together.
4. If `background`, `primary`, or `secondary` anchors are already fixed, call `complete_palette(intent, mode, background, primary, secondary, reserve_semantic_colors)` instead. Preserve valid anchors exactly. Treat a contrast failure as a design decision to resolve, not permission to mutate the anchors silently.
5. Persist all six returned roles with `set_presentation_palette` using the latest revision. For a new deck, create first and call the setter at returned revision `1`; never assume `create_presentation` accepted palette input. In an existing deck, update explicit slide and element colors separately when they should adopt the new system.
6. Re-render after applying or changing colors.

Use the six base roles consistently: `background`, `text`, `subtext`, `primary`, `secondary`, and `accent`. Prefer nearby/cohesive hues or controlled neutral relationships over a rainbow of unrelated accents. Create hierarchy with scale, spacing, weight, opacity, and surface contrast before adding more colors.

Keep semantic status colors separate by default:

- green: success, approved, healthy;
- red: failure, blocked, destructive, critical;
- yellow: attention, warning, unresolved.

Treat this mapping as adaptable guidance, not a universal cultural rule. Confirm accessibility, avoid color-only communication, and remap when a supplied system requires it. If `reserve_semantic_colors` is false, document why and preserve status clarity by another channel.

## Compose consistently

- Design on the presentation canvas returned by DEKS; use absolute coordinates and consistent margins.
- Establish one focal point, a restrained type scale, and predictable alignment.
- Use Poppins or Roboto, the supported font families.
- Name elements semantically: `Hero title`, `Policy decision`, `Source note`, not `Rectangle 12`.
- Use color, size, and density to expose the reading order. Avoid equal emphasis across every object.
- Keep content inside the canvas. Treat accidental collisions and harmful text wrapping as design defects.

## Use visual assets intentionally

- Query `list_assets` before asking for new media. Use existing workspace assets when relevant.
- Ask the user to upload missing media in the DEKS web app; MCP does not upload assets.
- Query `list_icon_catalog` by meaning. Use one icon family unless a deliberate change conveys a new visual language.
- Prefer native DEKS shapes and catalog-backed icons for vector artwork that must scale or animate
  without losing quality.
- Use SVG only when it is a trusted or sanitized asset and the active editor, preview and export
  pipeline all support it. DEKS Cloud does not currently accept arbitrary SVG uploads; never fetch,
  paste or recommend an untrusted SVG as a workaround.
- Keep photographs and other inherently raster media in a suitable raster format instead of
  converting them mechanically to SVG.
