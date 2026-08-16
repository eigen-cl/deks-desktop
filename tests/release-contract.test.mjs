import assert from "node:assert/strict";
import { lstat, readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { assertReleaseContract, parseStableTag, verifyBundledSkills } from "../scripts/release-contract.mjs";

const root = new URL("..", import.meta.url);

test("release tags are stable SemVer and match npm, Cargo and Tauri metadata", async () => {
  assert.equal(parseStableTag("v0.2.0"), "0.2.0");
  assert.throws(() => parseStableTag("0.2.0"), /release_tag_invalid/);
  assert.throws(() => parseStableTag("v0.2.0-beta.1"), /release_tag_invalid/);
  await assert.doesNotReject(assertReleaseContract(root, "v0.2.0"));
});

test("the package contract enables native bundles and embeds only the two reviewed skills", async () => {
  const config = JSON.parse(await readFile(new URL("src-tauri/tauri.conf.json", root), "utf8"));
  assert.equal(config.bundle.active, true);
  assert.equal(config.bundle.targets, "all");
  assert.deepEqual(config.bundle.icon, [
    "icons/32x32.png", "icons/128x128.png", "icons/128x128@2x.png", "icons/icon.icns", "icons/icon.ico",
  ]);
  assert.deepEqual(config.bundle.resources, {
    "../LICENSE": "bundled-mcp/LICENSE",
    "../bundled-mcp/": "bundled-mcp/",
    "../bundled-skills/": "bundled-skills/",
    "../mcp/": "bundled-mcp/mcp/",
  });

  const report = await verifyBundledSkills(root);
  assert.deepEqual(report.skills, ["deks-presentations", "design-deks-presentations"]);
  assert.equal(report.source.repository, "https://github.com/eigen-cl/deks-plugin");
  assert.equal(report.source.version, "0.1.7");
  for (const relativePath of report.files) {
    assert.equal((await lstat(join(new URL("bundled-skills/", root).pathname, relativePath))).isSymbolicLink(), false);
  }
});

test("the installed MCP payload is self-contained apart from documented Node and Chromium prerequisites", async () => {
  const packageJson = JSON.parse(await readFile(new URL("bundled-mcp/package.json", root), "utf8"));
  assert.deepEqual(packageJson.engines, { node: ">=22" });
  assert.equal(packageJson.scripts.start, "node mcp/server.mjs");
  assert.equal(packageJson.scripts["install-browser"], "playwright install chromium");
  assert.deepEqual(packageJson.dependencies, {
    "@deks-js/document": "0.4.0",
    "@deks-js/render-preview": "0.2.3",
    "playwright": "1.62.1",
  });
  const readme = await readFile(new URL("bundled-mcp/README.md", root), "utf8");
  assert.match(readme, /Node\.js 22/);
  assert.match(readme, /npm ci --omit=dev/);
  assert.match(readme, /npm run install-browser/);
});

test("release workflow builds all desktop platforms, notarizes macOS and publishes checksums", async () => {
  const workflow = await readFile(new URL(".github/workflows/release.yml", root), "utf8");
  for (const platform of ["macos-14", "windows-2022", "ubuntu-24.04"]) assert.match(workflow, new RegExp(platform));
  for (const credential of [
    "CSC_LINK", "CSC_KEY_PASSWORD", "CSC_NAME", "APPLE_API_KEY_BASE64",
    "APPLE_API_KEY_ID", "APPLE_API_ISSUER",
  ]) assert.match(workflow, new RegExp(`secrets\\.${credential}`));
  assert.match(workflow, /--target universal-apple-darwin --bundles dmg/);
  assert.match(workflow, /--bundles nsis,msi/);
  assert.match(workflow, /--bundles deb,appimage,rpm/);
  assert.match(workflow, /hdiutil attach/);
  assert.match(workflow, /codesign --verify --deep --strict \"\$mounted_app\"/);
  assert.doesNotMatch(workflow, /bundle\/macos\/\*\.app/);
  assert.match(workflow, /normalized=\$\{filename\/\/ \/\.\}/);
  assert.match(workflow, /find downloaded-artifacts -type f -print0/);
  assert.match(workflow, /SHA256SUMS\.txt/);
  assert.match(workflow, /gh release create/);
  assert.match(workflow, /--draft/);
  assert.match(workflow, /refs\/tags\/\$GITHUB_REF_NAME:refs\/tags\/\$GITHUB_REF_NAME/);
  assert.match(workflow, /main:refs\/remotes\/origin\/main --no-tags/);
  assert.doesNotMatch(workflow, /pull_request:/);
});
