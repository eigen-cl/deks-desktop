import { readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

/**
 * Construye el manifiesto que consume `tauri-plugin-updater`.
 *
 * Es distinto de `latest.json`, que describe los instaladores para una persona.
 * Éste describe los artefactos de actualización firmados para la app, y cada
 * plataforma debe traer su firma: sin ella el cliente rechaza la descarga.
 */

/** Plataformas Tauri derivadas del nombre del artefacto de actualización. */
export function platformOf(fileName) {
  if (/\.app\.tar\.gz$/.test(fileName)) return "darwin-universal";
  if (/_x64-setup\.nsis\.zip$/.test(fileName) || /\.msi\.zip$/.test(fileName)) return "windows-x86_64";
  if (/\.AppImage\.tar\.gz$/.test(fileName)) return "linux-x86_64";
  return undefined;
}

export function assembleUpdaterManifest({ version, notes, publishedAt, entries, releaseBaseUrl }) {
  if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error("updater_version_invalid");
  if (entries.length === 0) throw new Error("updater_artifacts_missing");

  const platforms = {};
  for (const { fileName, signature } of entries) {
    const platform = platformOf(fileName);
    if (!platform) throw new Error(`updater_platform_unknown:${fileName}`);
    if (!signature.trim()) throw new Error(`updater_signature_missing:${fileName}`);
    if (platforms[platform]) throw new Error(`updater_platform_duplicated:${platform}`);
    platforms[platform] = {
      signature: signature.trim(),
      url: `${releaseBaseUrl}/${fileName}`,
    };
  }
  return { version, notes, pub_date: publishedAt, platforms };
}

async function main() {
  const values = new Map();
  const args = process.argv.slice(2);
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index];
    if (!key?.startsWith("--") || args[index + 1] === undefined) throw new Error("updater_arguments_invalid");
    values.set(key.slice(2), args[index + 1]);
  }
  const input = values.get("input");
  const output = values.get("output");
  const tag = values.get("tag") ?? "";
  const releaseBaseUrl = values.get("release-base-url");
  if (!input || !output || !releaseBaseUrl) throw new Error("updater_arguments_invalid");

  const names = await readdir(input, { recursive: true, withFileTypes: true });
  const entries = [];
  for (const entry of names) {
    if (!entry.isFile() || !entry.name.endsWith(".sig")) continue;
    const fileName = entry.name.replace(/\.sig$/, "");
    entries.push({
      fileName,
      signature: await readFile(join(entry.parentPath ?? entry.path, entry.name), "utf8"),
    });
  }

  const manifest = assembleUpdaterManifest({
    version: tag.replace(/^v/, ""),
    notes: values.get("notes") ?? `DEKS Desktop ${tag}`,
    publishedAt: values.get("published-at") ?? new Date().toISOString(),
    entries,
    releaseBaseUrl,
  });
  await writeFile(join(output, "updater.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  console.log(`updater.json listo con ${Object.keys(manifest.platforms).length} plataformas`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
