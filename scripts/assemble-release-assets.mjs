import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const STABLE_TAG = /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

const ASSET_CONTRACTS = [
  {
    id: "macos-universal-dmg",
    filename: "deks-desktop-macos-universal.dmg",
    platform: "macos",
    arch: "universal",
    kind: "dmg",
    matches: (name) => name.endsWith(".dmg") && name.includes("universal"),
  },
  {
    id: "windows-x64-exe",
    filename: "deks-desktop-windows-x64.exe",
    platform: "windows",
    arch: "x64",
    kind: "exe",
    matches: (name) => name.endsWith(".exe") && hasX64Architecture(name),
  },
  {
    id: "windows-x64-msi",
    filename: "deks-desktop-windows-x64.msi",
    platform: "windows",
    arch: "x64",
    kind: "msi",
    matches: (name) => name.endsWith(".msi") && hasX64Architecture(name),
  },
  {
    id: "linux-x64-deb",
    filename: "deks-desktop-linux-x64.deb",
    platform: "linux",
    arch: "x64",
    kind: "deb",
    matches: (name) => name.endsWith(".deb") && hasX64Architecture(name),
  },
  {
    id: "linux-x64-appimage",
    filename: "deks-desktop-linux-x64.AppImage",
    platform: "linux",
    arch: "x64",
    kind: "appimage",
    matches: (name) => name.endsWith(".appimage") && hasX64Architecture(name),
  },
  {
    id: "linux-x64-rpm",
    filename: "deks-desktop-linux-x64.rpm",
    platform: "linux",
    arch: "x64",
    kind: "rpm",
    matches: (name) => name.endsWith(".rpm") && hasX64Architecture(name),
  },
];

function hasX64Architecture(name) {
  return /(?:^|[._-])(x64|x86_64|amd64)(?:[._-]|$)/.test(name);
}

async function filesBelow(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await filesBelow(path));
    else if (entry.isFile()) files.push(path);
    else throw new Error(`release_asset_unknown:${entry.name}`);
  }
  return files;
}

function releaseCoordinates(tag, releaseUrl, publishedAt) {
  const tagMatch = STABLE_TAG.exec(tag ?? "");
  if (!tagMatch) throw new Error("release_tag_invalid");
  if (typeof publishedAt !== "string" || Number.isNaN(Date.parse(publishedAt))) {
    throw new Error("release_published_at_invalid");
  }

  const parsed = new URL(releaseUrl);
  const suffix = `/releases/tag/${tag}`;
  if (parsed.protocol !== "https:" || parsed.hostname !== "github.com" || !parsed.pathname.endsWith(suffix)) {
    throw new Error("release_url_invalid");
  }
  const repositoryPath = parsed.pathname.slice(0, -suffix.length);
  if (!/^\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repositoryPath)) {
    throw new Error("release_url_invalid");
  }
  return {
    version: tagMatch.slice(1).join("."),
    downloadBaseUrl: `https://github.com${repositoryPath}/releases/download/${tag}`,
  };
}

async function classifiedAssets(inputDirectory) {
  const inputRoot = resolve(inputDirectory);
  const paths = await filesBelow(inputRoot);
  const classified = new Map();

  for (const path of paths) {
    const name = basename(path);
    const normalizedName = name.toLowerCase();
    const matches = ASSET_CONTRACTS.filter((contract) => contract.matches(normalizedName));
    if (matches.length !== 1) throw new Error(`release_asset_unknown:${name}`);
    const [contract] = matches;
    if (classified.has(contract.id)) throw new Error(`release_asset_duplicate:${contract.id}`);
    classified.set(contract.id, { contract, path });
  }

  for (const contract of ASSET_CONTRACTS) {
    if (!classified.has(contract.id)) throw new Error(`release_asset_missing:${contract.id}`);
  }
  return ASSET_CONTRACTS.map((contract) => classified.get(contract.id));
}

async function sha256(path) {
  return createHash("sha256").update(await readFile(path)).digest("hex");
}

export async function assembleReleaseAssets({
  inputDirectory,
  outputDirectory,
  tag,
  publishedAt,
  releaseUrl,
}) {
  const { version, downloadBaseUrl } = releaseCoordinates(tag, releaseUrl, publishedAt);
  const sourceAssets = await classifiedAssets(inputDirectory);
  const outputRoot = resolve(outputDirectory);

  try {
    await stat(outputRoot);
    throw new Error("release_output_exists");
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }

  const assets = [];
  for (const { contract, path } of sourceAssets) {
    const metadata = await stat(path);
    const digest = await sha256(path);
    if (!/^[a-f0-9]{64}$/.test(digest)) throw new Error(`release_asset_sha256_invalid:${contract.id}`);
    assets.push({
      platform: contract.platform,
      arch: contract.arch,
      kind: contract.kind,
      url: `${downloadBaseUrl}/${contract.filename}`,
      sha256: digest,
      size: metadata.size,
      sourcePath: path,
      filename: contract.filename,
    });
  }

  await mkdir(outputRoot);
  for (const asset of assets) await copyFile(asset.sourcePath, join(outputRoot, asset.filename));

  const checksum = assets
    .map((asset) => `${asset.sha256}  ${asset.filename}`)
    .sort()
    .join("\n");
  await writeFile(join(outputRoot, "SHA256SUMS.txt"), `${checksum}\n`, "utf8");

  const manifest = {
    schemaVersion: 1,
    version,
    tag,
    publishedAt,
    releaseUrl,
    assets: assets.map(({ platform, arch, kind, url, sha256: digest, size }) => ({
      platform,
      arch,
      kind,
      url,
      sha256: digest,
      size,
    })),
  };
  await writeFile(join(outputRoot, "latest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  return manifest;
}

function parseArguments(argumentsList) {
  const values = new Map();
  for (let index = 0; index < argumentsList.length; index += 2) {
    const key = argumentsList[index];
    const value = argumentsList[index + 1];
    if (!key?.startsWith("--") || value === undefined) throw new Error("release_arguments_invalid");
    values.set(key.slice(2), value);
  }
  for (const key of ["input", "output", "tag", "published-at", "release-url"]) {
    if (!values.get(key)) throw new Error(`release_argument_missing:${key}`);
  }
  return values;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const values = parseArguments(process.argv.slice(2));
  await assembleReleaseAssets({
    inputDirectory: values.get("input"),
    outputDirectory: values.get("output"),
    tag: values.get("tag"),
    publishedAt: values.get("published-at"),
    releaseUrl: values.get("release-url"),
  });
  process.stdout.write("Release assets assembled\n");
}
