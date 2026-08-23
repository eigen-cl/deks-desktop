import assert from "node:assert/strict";
import test from "node:test";
import {
  DEKS_IMAGE_LIMITS,
  DeksImageError,
  inspectAndNormalizeDeksImage,
  sniffDeksImageMediaType,
} from "@deks-js/document";

const encode = (value) => new TextEncoder().encode(value);

function png(width, height) {
  const ihdr = new Uint8Array(13);
  new DataView(ihdr.buffer).setUint32(0, width, false);
  new DataView(ihdr.buffer).setUint32(4, height, false);
  ihdr.set([8, 6, 0, 0, 0], 8);
  const chunk = (type, data) => {
    const result = new Uint8Array(12 + data.byteLength);
    new DataView(result.buffer).setUint32(0, data.byteLength, false);
    result.set(encode(type), 4);
    result.set(data, 8);
    return result;
  };
  const parts = [new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", new Uint8Array()), chunk("IEND", new Uint8Array())];
  const bytes = new Uint8Array(parts.reduce((total, part) => total + part.byteLength, 0));
  let offset = 0;
  for (const part of parts) { bytes.set(part, offset); offset += part.byteLength; }
  return bytes;
}

test("Desktop exposes the canonical cross-host image limits", () => {
  assert.deepEqual(DEKS_IMAGE_LIMITS, {
    rasterMediaTypes: ["image/png", "image/jpeg", "image/gif", "image/webp"],
    svgMediaType: "image/svg+xml",
    maxRasterBytes: 50_000_000,
    maxSvgBytes: 5_000_000,
    maxWidth: 16_384,
    maxHeight: 16_384,
    maxLogicalPixels: 40_000_000,
    maxFrames: 200,
    maxAggregatePixels: 100_000_000,
    maxSvgNodes: 10_000,
    maxSvgDepth: 64,
    maxSvgAttributes: 100_000,
    maxSvgPathCharacters: 2_000_000,
  });
});

test("Desktop rejects a raster truncated before its required terminator", () => {
  const complete = png(10, 10);
  assert.throws(() => inspectAndNormalizeDeksImage(complete.subarray(0, complete.byteLength - 1)), (error) => {
    assert.ok(error instanceof DeksImageError);
    return error.code === "asset_media_type_unsupported";
  });
});

test("Desktop emits byte-identical canonical SVG and derives its real type", () => {
  const source = encode(`
    <svg height="50px" width="100" xmlns="http://www.w3.org/2000/svg">
      <defs><linearGradient id="paint"><stop offset="0" stop-color="#fff"/><stop offset="1" stop-color="#000"/></linearGradient></defs>
      <title>A &amp; B</title>
      <g fill="url(#paint)" opacity=".5"><path d="M0 0 L100 50 Z"/></g>
    </svg>
  `);
  const expected = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 50"><defs><linearGradient id="paint"><stop offset="0" stop-color="#fff"/><stop offset="1" stop-color="#000"/></linearGradient></defs><title>A &amp; B</title><g fill="url(#paint)" opacity="0.5"><path d="M0 0 L100 50 Z"/></g></svg>';

  assert.equal(sniffDeksImageMediaType(source), "image/svg+xml");
  const inspected = inspectAndNormalizeDeksImage(source);
  assert.deepEqual({ mediaType: inspected.mediaType, width: inspected.width, height: inspected.height }, {
    mediaType: "image/svg+xml", width: 100, height: 50,
  });
  assert.equal(new TextDecoder().decode(inspected.bytes), expected);
  assert.deepEqual(inspectAndNormalizeDeksImage(inspected.bytes).bytes, inspected.bytes);
});

test("Desktop rejects unsafe SVG and over-complex or lying raster input with stable host codes", () => {
  const unsafe = encode('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"><script>alert(1)</script></svg>');
  assert.throws(() => inspectAndNormalizeDeksImage(unsafe), (error) => {
    assert.ok(error instanceof DeksImageError);
    return error.code === "asset_unsafe";
  });

  assert.throws(() => inspectAndNormalizeDeksImage(png(8_000, 5_001)), (error) => {
    assert.ok(error instanceof DeksImageError);
    return error.code === "asset_too_complex";
  });

  assert.throws(() => inspectAndNormalizeDeksImage(png(10, 10), "image/jpeg"), (error) => {
    assert.ok(error instanceof DeksImageError);
    return error.code === "asset_media_type_unsupported";
  });
});
