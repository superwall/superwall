import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { inspectScreenshot, readScreenshotFile } from "@/core/app-store-connect/resources/screenshot-file";
import { jpegBytes, pngBytes } from "../../../helpers/images";

const dir = mkdtempSync(join(tmpdir(), "asc-shot-file-"));

function write(name: string, bytes: Uint8Array): string {
  const path = join(dir, name);
  writeFileSync(path, bytes);
  return path;
}

test("a PNG is read with its size, format and MD5 checksum", () => {
  const bytes = pngBytes(1290, 2796);
  const file = readScreenshotFile(write("review.png", bytes));
  assert.deepEqual(file, {
    name: "review.png",
    bytes,
    checksum: createHash("md5").update(bytes).digest("hex"),
    format: "png",
    width: 1290,
    height: 2796,
  });
});

test("a JPEG is read with its size, under .jpg and .jpeg in any case", () => {
  assert.deepEqual(inspectScreenshot("review.jpg", jpegBytes(844, 1834)), { format: "jpeg", width: 844, height: 1834 });
  assert.deepEqual(inspectScreenshot("review.JPEG", jpegBytes(1242, 2688)), { format: "jpeg", width: 1242, height: 2688 });
});

test("a JPEG with fill bytes and restart markers before its frame is still read", () => {
  const plain = jpegBytes(640, 1136);
  const padded = new Uint8Array([0xff, 0xd8, 0xff, 0xff, 0xd0, ...plain.slice(2)]);
  assert.deepEqual(inspectScreenshot("review.jpg", padded), { format: "jpeg", width: 640, height: 1136 });
});

test("a file whose extension isn't .png, .jpg or .jpeg is refused", () => {
  assert.throws(() => inspectScreenshot("review.heic", pngBytes(10, 10)), {
    message: "review.heic isn't a .png, .jpg or .jpeg file. App Store review screenshots must be PNG or JPEG.",
  });
});

test("a file that isn't a PNG or JPEG is refused", () => {
  assert.throws(() => inspectScreenshot("review.png", new TextEncoder().encode("0123456789")), {
    message: "review.png isn't a PNG or JPEG image. Export it again as PNG or JPEG.",
  });
});

test("an extension that doesn't match the bytes is refused", () => {
  assert.throws(() => inspectScreenshot("review.png", jpegBytes(10, 10)), {
    message: "review.png holds a JPEG image but its extension says otherwise. Rename it to .jpg.",
  });
  assert.throws(() => inspectScreenshot("review.jpg", pngBytes(10, 10)), {
    message: "review.jpg holds a PNG image but its extension says otherwise. Rename it to .png.",
  });
});

test("a cut short or damaged image is refused", () => {
  const damaged = "is damaged or cut short: its image size can't be read. Export it again.";
  const png = pngBytes(10, 10);
  assert.throws(() => inspectScreenshot("a.png", png.slice(0, 20)), { message: `a.png ${damaged}` });
  const noHeader = png.slice();
  noHeader[12] = 0x58;
  assert.throws(() => inspectScreenshot("b.png", noHeader), { message: `b.png ${damaged}` });
  assert.throws(() => inspectScreenshot("c.png", pngBytes(0, 10)), { message: `c.png ${damaged}` });
  const jpeg = jpegBytes(10, 10);
  assert.throws(() => inspectScreenshot("d.jpg", jpeg.slice(0, 3)), { message: `d.jpg ${damaged}` });
  assert.throws(() => inspectScreenshot("e.jpg", jpeg.slice(0, 22)), { message: `e.jpg ${damaged}` });
  assert.throws(() => inspectScreenshot("f.jpg", jpeg.slice(0, 26)), { message: `f.jpg ${damaged}` });
  const badLength = jpeg.slice();
  badLength[5] = 0x01;
  assert.throws(() => inspectScreenshot("g.jpg", badLength), { message: `g.jpg ${damaged}` });
  const noMarker = jpeg.slice();
  noMarker[20] = 0x00;
  assert.throws(() => inspectScreenshot("h.jpg", noMarker), { message: `h.jpg ${damaged}` });
  assert.throws(() => inspectScreenshot("i.jpg", new Uint8Array([0xff, 0xd8, 0xff, 0xd9])), { message: `i.jpg ${damaged}` });
});
