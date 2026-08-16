import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { assembleReleaseAssets } from "../scripts/assemble-release-assets.mjs";

const TAG = "v0.2.0";
const PUBLISHED_AT = "2026-08-16T14:30:00.000Z";
const RELEASE_URL = `https://github.com/eigen-cl/deks-desktop/releases/tag/${TAG}`;

const SOURCE_ASSETS = [
  ["macos-universal/DEKS Desktop_0.2.0_universal.dmg", "macos-dmg"],
  ["windows-x64/DEKS Desktop_0.2.0_x64-setup.exe", "windows-exe"],
  ["windows-x64/DEKS Desktop_0.2.0_x64_en-US.msi", "windows-msi"],
  ["linux-x64/DEKS Desktop_0.2.0_amd64.deb", "linux-deb"],
  ["linux-x64/deks-desktop_0.2.0_amd64.AppImage", "linux-appimage"],
  ["linux-x64/deks-desktop-0.2.0-1.x86_64.rpm", "linux-rpm"],
];

const EXPECTED_ASSETS = [
  ["deks-desktop-macos-universal.dmg", "macos", "universal", "dmg", "macos-dmg"],
  ["deks-desktop-windows-x64.exe", "windows", "x64", "exe", "windows-exe"],
  ["deks-desktop-windows-x64.msi", "windows", "x64", "msi", "windows-msi"],
  ["deks-desktop-linux-x64.deb", "linux", "x64", "deb", "linux-deb"],
  ["deks-desktop-linux-x64.AppImage", "linux", "x64", "appimage", "linux-appimage"],
  ["deks-desktop-linux-x64.rpm", "linux", "x64", "rpm", "linux-rpm"],
];

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

async function createFixture(sourceAssets = SOURCE_ASSETS) {
  const fixtureRoot = await mkdtemp(join(tmpdir(), "deks-release-assets-"));
  const inputDirectory = join(fixtureRoot, "downloaded-artifacts");
  const outputDirectory = join(fixtureRoot, "release-files");
  for (const [relativePath, contents] of sourceAssets) {
    const directory = join(inputDirectory, relativePath.split("/").slice(0, -1).join("/"));
    await mkdir(directory, { recursive: true });
    await writeFile(join(inputDirectory, relativePath), contents);
  }
  return { fixtureRoot, inputDirectory, outputDirectory };
}

async function assemble(fixture) {
  return assembleReleaseAssets({
    inputDirectory: fixture.inputDirectory,
    outputDirectory: fixture.outputDirectory,
    tag: TAG,
    publishedAt: PUBLISHED_AT,
    releaseUrl: RELEASE_URL,
  });
}

test("six native Tauri bundles become stable downloads with checksums and latest metadata", async (context) => {
  const fixture = await createFixture();
  context.after(() => rm(fixture.fixtureRoot, { recursive: true, force: true }));

  await assemble(fixture);

  assert.deepEqual((await readdir(fixture.outputDirectory)).sort(), [
    "SHA256SUMS.txt",
    "deks-desktop-linux-x64.AppImage",
    "deks-desktop-linux-x64.deb",
    "deks-desktop-linux-x64.rpm",
    "deks-desktop-macos-universal.dmg",
    "deks-desktop-windows-x64.exe",
    "deks-desktop-windows-x64.msi",
    "latest.json",
  ]);

  for (const [filename, , , , contents] of EXPECTED_ASSETS) {
    assert.equal(await readFile(join(fixture.outputDirectory, filename), "utf8"), contents);
  }

  const checksumLines = (await readFile(join(fixture.outputDirectory, "SHA256SUMS.txt"), "utf8"))
    .trimEnd()
    .split("\n");
  assert.deepEqual(checksumLines, EXPECTED_ASSETS
    .map(([filename, , , , contents]) => `${sha256(contents)}  ${filename}`)
    .sort());
  for (const line of checksumLines) assert.match(line, /^[a-f0-9]{64}  \S+$/);

  const metadata = JSON.parse(await readFile(join(fixture.outputDirectory, "latest.json"), "utf8"));
  assert.deepEqual(metadata, {
    schemaVersion: 1,
    version: "0.2.0",
    tag: TAG,
    publishedAt: PUBLISHED_AT,
    releaseUrl: RELEASE_URL,
    assets: EXPECTED_ASSETS.map(([filename, platform, arch, kind, contents]) => ({
      platform,
      arch,
      kind,
      url: `https://github.com/eigen-cl/deks-desktop/releases/download/${TAG}/${filename}`,
      sha256: sha256(contents),
      size: Buffer.byteLength(contents),
    })),
  });
  for (const asset of metadata.assets) assert.match(asset.sha256, /^[a-f0-9]{64}$/);
});

test("a missing required bundle rejects the release before writing output", async (context) => {
  const fixture = await createFixture(SOURCE_ASSETS.filter(([path]) => !path.endsWith(".rpm")));
  context.after(() => rm(fixture.fixtureRoot, { recursive: true, force: true }));

  await assert.rejects(assemble(fixture), /release_asset_missing:linux-x64-rpm/);
  await assert.rejects(readdir(fixture.outputDirectory), { code: "ENOENT" });
});

test("two bundles with the same classification reject the release before writing output", async (context) => {
  const fixture = await createFixture([
    ...SOURCE_ASSETS,
    ["macos-universal/DEKS Desktop_0.2.0_copy_universal.dmg", "duplicate-macos-dmg"],
  ]);
  context.after(() => rm(fixture.fixtureRoot, { recursive: true, force: true }));

  await assert.rejects(assemble(fixture), /release_asset_duplicate:macos-universal-dmg/);
  await assert.rejects(readdir(fixture.outputDirectory), { code: "ENOENT" });
});

test("an unknown file rejects the release instead of silently publishing it", async (context) => {
  const fixture = await createFixture([
    ...SOURCE_ASSETS,
    ["linux-x64/debug-symbols.tar.gz", "unknown"],
  ]);
  context.after(() => rm(fixture.fixtureRoot, { recursive: true, force: true }));

  await assert.rejects(assemble(fixture), /release_asset_unknown:debug-symbols\.tar\.gz/);
  await assert.rejects(readdir(fixture.outputDirectory), { code: "ENOENT" });
});
