export const DEKS_DESKTOP_FILE_LIMITS = Object.freeze({
  maxArchiveBytes: 95_000_000,
  maxUncompressedBytes: 90_000_000,
});

export function assertDeksArchivePhysicalSize(value) {
  const size = typeof value === "number" ? value : value.byteLength;
  if (!Number.isSafeInteger(size) || size < 0 || size > DEKS_DESKTOP_FILE_LIMITS.maxArchiveBytes) {
    throw new Error("deks_file_too_large");
  }
}

export function assertDeksArchiveExpandedSize(document, assets) {
  let total = new TextEncoder().encode(JSON.stringify(document)).byteLength;
  const seen = new Set();
  for (const asset of assets) {
    // Core packages one file per content hash. Before Core has produced a hash
    // (new host bytes), falling back to id is deliberately conservative.
    const uniqueKey = asset.contentHash ? `hash:${asset.contentHash}` : `id:${asset.id}`;
    if (seen.has(uniqueKey)) continue;
    seen.add(uniqueKey);
    total += asset.bytes.byteLength;
    if (total > DEKS_DESKTOP_FILE_LIMITS.maxUncompressedBytes) throw new Error("deks_file_too_large");
  }
  if (total > DEKS_DESKTOP_FILE_LIMITS.maxUncompressedBytes) throw new Error("deks_file_too_large");
}
