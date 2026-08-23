export declare const DEKS_DESKTOP_FILE_LIMITS: Readonly<{
  maxArchiveBytes: 95_000_000;
  maxUncompressedBytes: 90_000_000;
}>;

export declare function assertDeksArchivePhysicalSize(value: number | Uint8Array): void;
export declare function assertDeksArchiveExpandedSize(
  document: unknown,
  assets: readonly Array<{ id: string; contentHash?: string; bytes: Uint8Array }>,
): void;
