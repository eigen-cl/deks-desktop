import assert from "node:assert/strict";
import test from "node:test";
import {
  assertDeksArchiveExpandedSize,
  assertDeksArchivePhysicalSize,
  DEKS_DESKTOP_FILE_LIMITS,
} from "../shared/deks-file-limits.mjs";

test("Desktop enforces the portable physical boundary before host transfer", () => {
  assert.doesNotThrow(() => assertDeksArchivePhysicalSize(DEKS_DESKTOP_FILE_LIMITS.maxArchiveBytes));
  assert.throws(() => assertDeksArchivePhysicalSize(DEKS_DESKTOP_FILE_LIMITS.maxArchiveBytes + 1), /deks_file_too_large/);
});

test("Desktop counts UTF-8 JSON and unique expanded assets after the Core read", () => {
  const bytes = { byteLength: 45_000_000 };
  assert.doesNotThrow(() => assertDeksArchiveExpandedSize({ name: "ñ" }, [
    { id: "one", contentHash: "same-hash", bytes },
    { id: "two", contentHash: "same-hash", bytes },
  ]));
  assert.throws(() => assertDeksArchiveExpandedSize({}, [
    { id: "one", bytes },
    { id: "two", bytes },
    { id: "three", bytes: { byteLength: 1 } },
  ]), /deks_file_too_large/);
});
