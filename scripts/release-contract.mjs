import { createHash } from "node:crypto";
import { lstat, readFile, readdir } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join, relative, resolve, sep } from "node:path";

const STABLE_TAG = /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const EXPECTED_SKILLS = [
  "deks-cloud-mcp",
  "deks-desktop-mcp",
  "deks-motion-patterns",
  "deks-presentations",
  "design-deks-presentations",
];
const CANONICAL_ICON_SHA256 = "750a06b4d6f1e7474f72320ed886038b22d8a0bf2979a6acd3fa5a43a8b7a4f3";

function rootPath(root) {
  return root instanceof URL ? fileURLToPath(root) : resolve(root);
}

export function parseStableTag(tag) {
  const match = STABLE_TAG.exec(tag ?? "");
  if (!match) throw new Error("release_tag_invalid");
  return match.slice(1).join(".");
}

async function filesBelow(path, prefix = "") {
  const entries = await readdir(path, { withFileTypes: true });
  const files = [];
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const relativePath = join(prefix, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`bundled_skill_symlink:${relativePath}`);
    if (entry.isDirectory()) files.push(...await filesBelow(join(path, entry.name), relativePath));
    else if (entry.isFile()) files.push(relativePath.split(sep).join("/"));
    else throw new Error(`bundled_skill_entry_invalid:${relativePath}`);
  }
  return files;
}

export async function verifyBundledSkills(root) {
  const repositoryRoot = rootPath(root);
  const bundleRoot = join(repositoryRoot, "bundled-skills");
  const manifest = JSON.parse(await readFile(join(bundleRoot, "manifest.json"), "utf8"));
  const skills = [...manifest.skills].sort();
  if (JSON.stringify(skills) !== JSON.stringify(EXPECTED_SKILLS)) throw new Error("bundled_skills_invalid");

  const actual = (await filesBelow(join(bundleRoot, "skills"))).map((path) => `skills/${path}`);
  const declared = Object.keys(manifest.sha256).sort();
  if (JSON.stringify(actual.sort()) !== JSON.stringify(declared)) throw new Error("bundled_skill_manifest_incomplete");
  for (const path of declared) {
    if (path.startsWith("/") || path.split("/").includes("..")) throw new Error("bundled_skill_path_invalid");
    const candidate = resolve(bundleRoot, path);
    if (!candidate.startsWith(`${bundleRoot}${sep}`)) throw new Error("bundled_skill_path_invalid");
    const metadata = await lstat(candidate);
    if (!metadata.isFile() || metadata.isSymbolicLink()) throw new Error(`bundled_skill_file_invalid:${path}`);
    const digest = createHash("sha256").update(await readFile(candidate)).digest("hex");
    if (digest !== manifest.sha256[path]) throw new Error(`bundled_skill_hash_mismatch:${path}`);
  }
  return { source: manifest.source, skills, files: declared };
}

const UPDATER_ENDPOINT = "https://github.com/eigen-cl/deks-desktop/releases/latest/download/updater.json";
const UPDATER_PUBKEY_PLACEHOLDER = "REPLACE_WITH_TAURI_UPDATER_PUBLIC_KEY";

/**
 * El canal de actualización vive en dos archivos: la configuración base declara
 * el endpoint, y una superposición aporta la clave pública real y los artefactos
 * firmados sólo cuando CI tiene el secreto. Ambos deben apuntar al mismo lugar,
 * y el marcador de la clave nunca puede quedar activo en la base.
 */
export async function assertUpdateChannel(repositoryRoot, tauri) {
  const overlay = JSON.parse(
    await readFile(join(repositoryRoot, "src-tauri/tauri.updater.conf.json"), "utf8"),
  );
  if (tauri.plugins?.updater?.endpoints?.[0] !== UPDATER_ENDPOINT) throw new Error("updater_endpoint_invalid");
  if (overlay.plugins?.updater?.endpoints?.[0] !== UPDATER_ENDPOINT) throw new Error("updater_endpoint_mismatch");
  if (overlay.bundle?.createUpdaterArtifacts !== true) throw new Error("updater_artifacts_disabled");
  // Firmar en cada build sin clave rompería un release; el artefacto firmado es
  // exclusivo de la superposición.
  if (tauri.bundle?.createUpdaterArtifacts !== undefined) throw new Error("updater_artifacts_in_base_config");
  if (tauri.plugins?.updater?.pubkey === UPDATER_PUBKEY_PLACEHOLDER) throw new Error("updater_placeholder_in_base_config");
  if (overlay.plugins?.updater?.pubkey !== UPDATER_PUBKEY_PLACEHOLDER) throw new Error("updater_overlay_pubkey_committed");
}

export async function assertReleaseContract(root, tag) {
  const repositoryRoot = rootPath(root);
  const version = parseStableTag(tag);
  const packageJson = JSON.parse(await readFile(join(repositoryRoot, "package.json"), "utf8"));
  const tauri = JSON.parse(await readFile(join(repositoryRoot, "src-tauri/tauri.conf.json"), "utf8"));
  const cargo = await readFile(join(repositoryRoot, "src-tauri/Cargo.toml"), "utf8");
  const cargoVersion = /^version\s*=\s*"([^"]+)"/m.exec(cargo)?.[1];
  if (packageJson.version !== version || tauri.version !== version || cargoVersion !== version) {
    throw new Error("release_version_mismatch");
  }
  if (tauri.bundle?.active !== true || tauri.bundle?.targets !== "all") throw new Error("native_bundles_disabled");
  const expectedIcons = ["icons/32x32.png", "icons/128x128.png", "icons/128x128@2x.png", "icons/icon.icns", "icons/icon.ico"];
  if (JSON.stringify(tauri.bundle?.icon) !== JSON.stringify(expectedIcons)) throw new Error("native_icons_invalid");
  for (const icon of expectedIcons) {
    if (!(await lstat(join(repositoryRoot, "src-tauri", icon))).isFile()) throw new Error(`native_icon_missing:${icon}`);
  }
  await assertUpdateChannel(repositoryRoot, tauri);
  const iconDigest = createHash("sha256").update(await readFile(join(repositoryRoot, "src-tauri/icons/icon.png"))).digest("hex");
  if (iconDigest !== CANONICAL_ICON_SHA256) throw new Error("canonical_icon_mismatch");
  await verifyBundledSkills(repositoryRoot);
  return { version };
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  await assertReleaseContract(repositoryRoot, process.env.GITHUB_REF_NAME ?? process.argv[2]);
  process.stdout.write("Release contract valid\n");
}
