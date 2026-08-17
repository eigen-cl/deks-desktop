import assert from "node:assert/strict";
import test from "node:test";
import { assembleUpdaterManifest, platformOf } from "../scripts/assemble-updater-manifest.mjs";

const base = "https://github.com/eigen-cl/deks-desktop/releases/download/v0.3.0";

test("reconoce el artefacto de actualización de cada plataforma", () => {
  assert.equal(platformOf("DEKS Desktop.app.tar.gz"), "darwin-universal");
  assert.equal(platformOf("deks-desktop_x64-setup.nsis.zip"), "windows-x86_64");
  assert.equal(platformOf("deks-desktop.AppImage.tar.gz"), "linux-x86_64");
  // Un instalador no es un artefacto de actualización.
  assert.equal(platformOf("deks-desktop-macos-universal.dmg"), undefined);
});

test("el manifiesto declara versión, fecha y una URL firmada por plataforma", () => {
  const manifest = assembleUpdaterManifest({
    version: "0.3.0",
    notes: "DEKS Desktop v0.3.0",
    publishedAt: "2026-08-17T00:00:00Z",
    releaseBaseUrl: base,
    entries: [
      { fileName: "DEKS Desktop.app.tar.gz", signature: "firma-macos\n" },
      { fileName: "deks-desktop.AppImage.tar.gz", signature: "firma-linux" },
    ],
  });

  assert.equal(manifest.version, "0.3.0");
  assert.equal(manifest.pub_date, "2026-08-17T00:00:00Z");
  assert.deepEqual(Object.keys(manifest.platforms), ["darwin-universal", "linux-x86_64"]);
  assert.equal(manifest.platforms["darwin-universal"].signature, "firma-macos");
  assert.equal(
    manifest.platforms["darwin-universal"].url,
    `${base}/DEKS Desktop.app.tar.gz`,
  );
});

test("falla cerrado ante una firma vacía, una plataforma desconocida o sin artefactos", () => {
  const build = (entries) => () => assembleUpdaterManifest({
    version: "0.3.0", notes: "n", publishedAt: "2026-08-17T00:00:00Z", releaseBaseUrl: base, entries,
  });

  // Una firma vacía publicaría una actualización que ningún cliente aceptaría,
  // y peor: anunciaría una versión que nadie puede instalar.
  assert.throws(build([{ fileName: "DEKS Desktop.app.tar.gz", signature: "  " }]), /updater_signature_missing/);
  assert.throws(build([{ fileName: "notas.txt", signature: "x" }]), /updater_platform_unknown/);
  assert.throws(build([]), /updater_artifacts_missing/);
  assert.throws(
    build([
      { fileName: "DEKS Desktop.app.tar.gz", signature: "a" },
      { fileName: "DEKS Desktop.app.tar.gz", signature: "b" },
    ]),
    /updater_platform_duplicated/,
  );
});

test("rechaza una versión que no es SemVer estable", () => {
  assert.throws(
    () => assembleUpdaterManifest({
      version: "v0.3", notes: "n", publishedAt: "2026-08-17T00:00:00Z", releaseBaseUrl: base,
      entries: [{ fileName: "DEKS Desktop.app.tar.gz", signature: "a" }],
    }),
    /updater_version_invalid/,
  );
});
