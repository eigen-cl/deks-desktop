import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";

const bundle = new URL("../bundled-skills/skills/", import.meta.url);
const SKILLS = [
  "deks-cloud-mcp",
  "deks-desktop-mcp",
  "deks-motion-patterns",
  "deks-presentations",
  "design-deks-presentations",
];

async function tree(root) {
  const files = new Map();
  const walk = async (relative) => {
    for (const entry of await readdir(new URL(relative, root), { withFileTypes: true })) {
      const child = join(relative, entry.name);
      if (entry.isDirectory()) await walk(`${child}/`);
      else files.set(child, await readFile(new URL(child, root), "utf8"));
    }
  };
  await walk("./");
  return files;
}

const files = await tree(bundle);

test("el bundle trae las cinco skills revisadas completas", async () => {
  for (const skill of SKILLS) {
    assert.ok(files.has(`${skill}/SKILL.md`), `falta ${skill}/SKILL.md`);
    // Una skill sin sus referencias es una skill que promete un método y no lo
    // entrega: el agente lee el índice y se queda sin las reglas.
    const references = [...files.keys()].filter((path) => path.startsWith(`${skill}/references/`));
    assert.ok(references.length > 0, `${skill} no trae referencias`);
    for (const [path, content] of files) {
      if (!path.startsWith(skill)) continue;
      assert.ok(content.trim().length > 0, `${path} está vacío`);
    }
  }
});

test("las skills describen el contrato de movimiento vigente, no el anterior", async () => {
  const motion = files.get("design-deks-presentations/references/motion.md");
  const tools = files.get("deks-cloud-mcp/references/tools.md");
  const contract = files.get("deks-presentations/references/motion-contract.md");

  // Los nombres viejos vivieron aquí una versión entera después de que la API
  // cambiara, enseñándole al agente a llamar a algo que ya no existe. El único
  // lugar donde pueden nombrarse es advirtiendo que no se envíen.
  for (const retired of ["set_transition_override"]) {
    for (const [name, text] of [["motion.md", motion], ["tools.md", tools], ["motion-contract.md", contract]]) {
      assert.doesNotMatch(text, new RegExp(retired), `${name} todavía nombra ${retired}`);
    }
  }
  for (const [name, text] of [["motion.md", motion], ["tools.md", tools], ["motion-contract.md", contract]]) {
    assert.doesNotMatch(text, /in_preset|out_preset|duration_multiplier/, `${name} todavía nombra los presets retirados`);
  }

  for (const current of ["duration_beats", "delay_ms", "clear_motion", "set_motion"]) {
    assert.ok(`${motion}${tools}`.includes(current), `falta ${current} en las skills`);
  }
});

test("las skills enseñan que la espera tiene dos unidades y que se suman", async () => {
  const motion = files.get("design-deks-presentations/references/motion.md");
  const tools = files.get("deks-cloud-mcp/references/tools.md");
  const contract = files.get("deks-presentations/references/motion-contract.md");

  // Enseñar que el retardo es sólo milisegundos costó una versión de cadenas
  // que se desincronizaban al cambiar el tempo del deck y no fallaba nada.
  for (const [name, text] of [["motion.md", motion], ["tools.md", tools], ["motion-contract.md", contract]]) {
    assert.match(text, /delay_beats|delayBeats/, `${name} no enseña el retardo musical`);
  }
  assert.match(contract, /motionBeatMs \* delayBeats \+ delayMs/);
  assert.match(tools, /motion_beat_ms \* delay_beats \+ delay_ms/);
});

test("las skills enseñan el elemento number y las dos animaciones enmascaradas", async () => {
  const motion = files.get("design-deks-presentations/references/motion.md");
  const tools = files.get("deks-cloud-mcp/references/tools.md");
  const model = files.get("deks-presentations/references/document-model.md");
  const contract = files.get("deks-presentations/references/motion-contract.md");

  assert.match(tools, /"kind": "crop"/);
  assert.match(tools, /animate_magnitude/);
  assert.match(tools, /symbol_position/);
  assert.match(tools, /decimal_separator/);
  assert.match(model, /animateMagnitude/);
  assert.match(model, /symbolPosition/);
  assert.match(model, /decimalSeparator/);

  // `crop` y `wipe` son la alternativa al fundido y vivieron sin documentar.
  for (const [name, text] of [["motion.md", motion], ["motion-contract.md", contract], ["tools.md", tools]]) {
    assert.match(text, /crop/, `${name} no documenta crop`);
    assert.match(text, /wipe/, `${name} no documenta wipe`);
  }
  assert.match(motion, /How to animate a figure/);
  // La regla que motivó el cambio: el texto no se desvanece cuando lo reemplaza
  // otro texto en la misma posición.
  assert.match(motion, /How to animate text/);
  assert.match(motion, /same position/i);
});

test("el método distingue desplazamiento, crop y wipe y escalona por bandas", async () => {
  const design = files.get("design-deks-presentations/SKILL.md");
  const motion = files.get("design-deks-presentations/references/motion.md");
  const patterns = files.get("deks-motion-patterns/references/catalog.md");
  const guidance = `${design}\n${motion}\n${patterns}`;

  assert.match(guidance, /fixed mask/i, "crop debe describir contenido que viaja dentro de una máscara fija");
  assert.match(guidance, /mask edge/i, "wipe debe describir el borde de la máscara en movimiento");
  assert.match(guidance, /visual bands/i, "el stagger debe agrupar por bandas visuales");
  assert.match(guidance, /same (?:row|baseline)/i, "los elementos alineados deben compartir inicio");
  assert.doesNotMatch(guidance, /ordinary text[^.\n]*(?:only|with) fade or no movement/i);
});

test("cada host tiene su propia skill y ninguna enseña las tools de la otra", async () => {
  const cloud = files.get("deks-cloud-mcp/SKILL.md");
  const desktop = files.get("deks-desktop-mcp/SKILL.md");

  assert.match(cloud, /api-deks\.eigen\.cl\/mcp\//);
  assert.match(cloud, /OAuth/);
  assert.match(cloud, /resource_limit_reached/);

  // El envoltorio es distinto en cada host y confundirlos es el error más caro:
  // el agente llama a algo que no existe y culpa al servidor.
  assert.match(desktop, /path_not_authorized/);
  assert.match(desktop, /add_asset/);
  assert.match(desktop, /kebab-case/);
  assert.match(desktop, /add-element-state/);
  assert.match(desktop, /What does not exist here/);
  assert.doesNotMatch(desktop, /api-deks\.eigen\.cl/);

  // La skill de especificación tiene que enrutar a las dos, no elegir una.
  const spec = files.get("deks-presentations/SKILL.md");
  assert.match(spec, /\$deks-cloud-mcp/);
  assert.match(spec, /\$deks-desktop-mcp/);
});

test("el método enseña a construir una presentación, no sólo a auditarla", async () => {
  const design = files.get("design-deks-presentations/SKILL.md");
  const narrative = files.get("design-deks-presentations/references/narrative.md");
  const patterns = files.get("deks-motion-patterns/references/catalog.md");

  // Pensar las diapositivas como narración y abstraer el tema en tópicos es el
  // método; sin eso la skill sólo sabía revisar lo ya hecho.
  assert.match(design, /narration/i);
  assert.match(design, /topics/i);
  assert.match(narrative, /Advancing inside a narration/);
  assert.match(narrative, /Moving from one narration to the next/);

  // El patrón estrella: una línea de una lista que asciende a título.
  assert.match(patterns, /Promotion to title/);
  for (const pattern of ["Staggered exit", "Text relay", "Progress bar", "Counting figure", "Accumulation", "Replacement", "Travelling protagonist", "Narrative zoom", "Focus by dimming", "Before and after", "Section protagonist"]) {
    assert.ok(patterns.includes(pattern), `el catálogo no trae «${pattern}»`);
  }
});

/**
 * El bundle es una copia literal de `deks-plugin`. Se comprueba por hash y no
 * por lectura: la copia ya se quedó una versión atrás una vez, con nombres de
 * API retirados, y nadie lo notó hasta que un agente los usó.
 */
test("el bundle es idéntico a las skills publicadas en deks-plugin", async (t) => {
  const plugin = new URL("../../deks-plugin/skills/", import.meta.url);
  let published;
  try {
    published = await tree(plugin);
  } catch {
    t.skip("deks-plugin no está junto a este repo en este entorno");
    return;
  }

  const digest = (map) => [...map.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([path, content]) => `${path}:${createHash("sha256").update(content).digest("hex")}`);

  assert.deepEqual(digest(files), digest(published));
});
