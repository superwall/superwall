import { readFileSync } from "node:fs";
import { deflateRawSync } from "node:zlib";
import { type AscIndex, writeCachedIndex } from "@/core/app-store-connect/api/spec";

type ZipEntry = { name: string; data: Buffer; deflate?: boolean; extra?: number };

export function buildZip(entries: ZipEntry[], options: { comment?: number; badDirectory?: boolean } = {}): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name);
    const body = entry.deflate ? deflateRawSync(entry.data) : entry.data;
    const extra = Buffer.alloc(entry.extra ?? 0);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(entry.deflate ? 8 : 0, 8);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(extra.length, 28);
    locals.push(local, name, extra, body);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(options.badDirectory ? 0xdeadbeef : 0x02014b50, 0);
    central.writeUInt16LE(entry.deflate ? 8 : 0, 10);
    central.writeUInt32LE(body.length, 20);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(extra.length, 30);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, name, extra);
    offset += local.length + name.length + extra.length + body.length;
  }
  const directory = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(directory.length, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(options.comment ?? 0, 20);
  return Buffer.concat([...locals, directory, eocd, Buffer.alloc(options.comment ?? 0)]);
}

export function serveZip(zip: Buffer, status = 200): string[] {
  const urls: string[] = [];
  globalThis.fetch = (async (input: Parameters<typeof fetch>[0]) => {
    urls.push(String(input));
    return new Response(new Uint8Array(zip), { status });
  }) as typeof fetch;
  return urls;
}

export const ASC_FIXTURE: AscIndex = JSON.parse(
  readFileSync(new URL("../fixtures/asc-index.json", import.meta.url), "utf8"),
);

export function useAscIndex(index: AscIndex = ASC_FIXTURE): void {
  writeCachedIndex(index);
}
