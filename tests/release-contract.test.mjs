import assert from "node:assert/strict";
import { lstat, readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { assertReleaseContract, parseStableTag, verifyBundledSkills } from "../scripts/release-contract.mjs";

const root = new URL("..", import.meta.url);
// La versión se lee del manifiesto, no se repite aquí: un número copiado se
// queda atrás en el bump y rompe el release justo cuando ya no hay vuelta atrás.
const { version } = JSON.parse(await readFile(new URL("package.json", root), "utf8"));

test("release tags are stable SemVer and match npm, Cargo and Tauri metadata", async () => {
  assert.equal(parseStableTag("v0.2.0"), "0.2.0");
  assert.throws(() => parseStableTag("0.2.0"), /release_tag_invalid/);
  assert.throws(() => parseStableTag("v0.2.0-beta.1"), /release_tag_invalid/);
  await assert.doesNotReject(assertReleaseContract(root, `v${version}`));
  // Una versión distinta de la declarada debe fallar cerrado.
  await assert.rejects(assertReleaseContract(root, "v9.9.9"), /release_version_mismatch/);
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
    "@deks-js/document": "2.0.0",
    "@deks-js/render-preview": "2.0.0",
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
  assert.match(workflow, /node scripts\/assemble-release-assets\.mjs/);
  assert.match(workflow, /--input downloaded-artifacts/);
  assert.match(workflow, /--output release-files/);
  assert.match(workflow, /--tag "\$GITHUB_REF_NAME"/);
  assert.match(workflow, /--published-at "\$PUBLISHED_AT"/);
  assert.match(workflow, /--release-url "\$RELEASE_URL"/);
  assert.match(workflow, /SHA256SUMS\.txt/);
  assert.match(workflow, /latest\.json/);
  assert.match(workflow, /gh release create/);
  // La release sale completa o no sale: sin borrador que alguien tenga que
  // terminar a mano, y sin camino que publique un DMG sin notarizar.
  assert.match(workflow, /--verify-tag --latest/);
  assert.doesNotMatch(workflow, /--draft/);
  assert.match(workflow, /spctl --assess --type execute/);
  // Tauri grapa la app; el contenedor hay que notarizarlo y graparlo aparte, y
  // la verificación exige los dos tickets, no uno.
  assert.match(workflow, /xcrun notarytool submit "\$dmg_path"/);
  assert.match(workflow, /xcrun stapler staple "\$dmg_path"/);
  assert.match(workflow, /xcrun stapler validate "\$mounted_app"/);
  assert.match(workflow, /xcrun stapler validate "\$dmg_path"/);
  assert.match(workflow, /codesign --verify --strict "\$dmg_path"/);
  assert.doesNotMatch(workflow, /notarize=(true|false)/);
  assert.match(workflow, /refs\/tags\/\$GITHUB_REF_NAME:refs\/tags\/\$GITHUB_REF_NAME/);
  assert.match(workflow, /main:refs\/remotes\/origin\/main --no-tags/);
  assert.doesNotMatch(workflow, /pull_request:/);

  const publishJob = workflow.slice(workflow.indexOf("\n  publish:"));
  assert.match(publishJob, /actions\/setup-node@[a-f0-9]+/);
  assert.match(publishJob, /node-version: 22/);
  assert.ok(
    publishJob.indexOf("actions/setup-node@") < publishJob.indexOf("node scripts/assemble-release-assets.mjs"),
    "publish must install the pinned Node runtime before assembling release assets",
  );
});
