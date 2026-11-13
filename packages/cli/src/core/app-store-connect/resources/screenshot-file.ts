import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { basename, extname } from "node:path";

export type ScreenshotFormat = "png" | "jpeg";

export interface ScreenshotFile {
  name: string;
  bytes: Uint8Array;
  checksum: string;
  format: ScreenshotFormat;
  width: number;
  height: number;
}

const EXTENSIONS: Record<string, ScreenshotFormat> = { ".png": "png", ".jpg": "jpeg", ".jpeg": "jpeg" };
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const JPEG_FRAME_MARKERS = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);
const JPEG_STANDALONE_MARKERS = new Set([0x01, 0xd0, 0xd1, 0xd2, 0xd3, 0xd4, 0xd5, 0xd6, 0xd7, 0xd8]);

interface Dimensions {
  width: number;
  height: number;
}

function startsWith(bytes: Uint8Array, prefix: readonly number[]): boolean {
  return prefix.every((byte, index) => bytes[index] === byte);
}

function uint16(bytes: Uint8Array, offset: number): number {
  return (bytes[offset]! << 8) | bytes[offset + 1]!;
}

function uint32(bytes: Uint8Array, offset: number): number {
  return ((bytes[offset]! << 24) | (bytes[offset + 1]! << 16) | (bytes[offset + 2]! << 8) | bytes[offset + 3]!) >>> 0;
}

function formatOf(bytes: Uint8Array): ScreenshotFormat | undefined {
  if (startsWith(bytes, PNG_SIGNATURE)) return "png";
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return "jpeg";
  return undefined;
}

function pngDimensions(bytes: Uint8Array): Dimensions | undefined {
  if (bytes.length < 24) return undefined;
  if (String.fromCharCode(...bytes.slice(12, 16)) !== "IHDR") return undefined;
  return { width: uint32(bytes, 16), height: uint32(bytes, 20) };
}

function jpegDimensions(bytes: Uint8Array): Dimensions | undefined {
  let offset = 2;
  while (offset + 1 < bytes.length) {
    if (bytes[offset] !== 0xff) return undefined;
    const marker = bytes[offset + 1]!;
    if (marker === 0xff) {
      offset += 1;
      continue;
    }
    if (JPEG_STANDALONE_MARKERS.has(marker)) {
      offset += 2;
      continue;
    }
    if (offset + 4 > bytes.length) return undefined;
    const length = uint16(bytes, offset + 2);
    if (length < 2) return undefined;
    if (JPEG_FRAME_MARKERS.has(marker)) {
      if (offset + 9 > bytes.length) return undefined;
      return { height: uint16(bytes, offset + 5), width: uint16(bytes, offset + 7) };
    }
    offset += 2 + length;
  }
  return undefined;
}

export function inspectScreenshot(name: string, bytes: Uint8Array): { format: ScreenshotFormat } & Dimensions {
  const expected = EXTENSIONS[extname(name).toLowerCase()];
  if (!expected) throw new Error(`${name} isn't a .png, .jpg or .jpeg file. App Store review screenshots must be PNG or JPEG.`);
  const format = formatOf(bytes);
  if (!format) throw new Error(`${name} isn't a PNG or JPEG image. Export it again as PNG or JPEG.`);
  if (format !== expected) {
    const actual = format === "png" ? "PNG" : "JPEG";
    throw new Error(`${name} holds a ${actual} image but its extension says otherwise. Rename it to .${format === "png" ? "png" : "jpg"}.`);
  }
  const dimensions = format === "png" ? pngDimensions(bytes) : jpegDimensions(bytes);
  if (!dimensions || dimensions.width === 0 || dimensions.height === 0) {
    throw new Error(`${name} is damaged or cut short: its image size can't be read. Export it again.`);
  }
  return { format, ...dimensions };
}

export function readScreenshotFile(path: string): ScreenshotFile {
  const name = basename(path);
  const bytes = new Uint8Array(readFileSync(path));
  return { name, bytes, checksum: createHash("md5").update(bytes).digest("hex"), ...inspectScreenshot(name, bytes) };
}
