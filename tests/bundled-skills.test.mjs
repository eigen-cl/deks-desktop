import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";

const bundle = new URL("../bundled-skills/skills/", import.meta.url);
const SKILLS = ["deks-presentations", "design-deks-presentations"];

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

test("el bundle trae las dos skills revisadas completas", async () => {
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
  const tools = files.get("deks-presentations/references/tools.md");

  // Los nombres viejos vivieron aquí una versión entera después de que la API
  // cambiara, enseñándole al agente a llamar a algo que ya no existe.
  for (const retired of ["in_preset", "out_preset", "set_transition_override"]) {
    assert.doesNotMatch(motion, new RegExp(retired), `motion.md todavía nombra ${retired}`);
    assert.doesNotMatch(tools, new RegExp(retired), `tools.md todavía nombra ${retired}`);
  }
  for (const current of ["duration_beats", "delay_ms", "clear_motion", "set_motion"]) {
    assert.ok(`${motion}${tools}`.includes(current), `falta ${current} en las skills`);
  }
});

test("las skills enseñan el elemento number y la animación crop", async () => {
  const motion = files.get("design-deks-presentations/references/motion.md");
  const tools = files.get("deks-presentations/references/tools.md");

  assert.match(tools, /"kind": "crop"/);
  assert.match(tools, /animate_magnitude/);
  assert.match(tools, /symbol_position/);
  assert.match(tools, /decimal_separator/);
  assert.match(motion, /crop/);
  assert.match(motion, /How to animate a figure/);
  // La regla que motivó el cambio: el texto no se desvanece cuando lo reemplaza
  // otro texto en la misma posición.
  assert.match(motion, /How to animate text/);
  assert.match(motion, /same position/i);
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
