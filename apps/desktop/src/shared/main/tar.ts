import { gunzipSync } from "node:zlib";

/**
 * The files of a gzipped tar archive, by base name, for those named in `wanted`. Reads ustar archives whose paths fit
 * in the header, which is what the model releases are; links, directories and everything else are skipped.
 */
export function extractTarGz(archive: Buffer, wanted: readonly string[]): Map<string, Buffer> {
  const tar = gunzipSync(archive);
  const found = new Map<string, Buffer>();
  for (let offset = 0; offset + 512 <= tar.length;) {
    const header = tar.subarray(offset, offset + 512);
    // Two empty blocks end an archive.
    if (header.every((byte) => byte === 0)) break;
    const name = cString(header, 0, 100);
    const size = parseInt(cString(header, 124, 12).trim() || "0", 8);
    if (!Number.isFinite(size) || size < 0) throw new Error("The archive is damaged");
    const type = String.fromCharCode(header[156] ?? 0);
    offset += 512;
    if (offset + size > tar.length) throw new Error("The archive is damaged");
    const base = name.split("/").at(-1)!;
    if ((type === "0" || type === "\0") && wanted.includes(base) && !found.has(base))
      found.set(base, Buffer.from(tar.subarray(offset, offset + size)));
    offset += Math.ceil(size / 512) * 512;
  }
  return found;
}

function cString(buffer: Buffer, start: number, length: number): string {
  const field = buffer.subarray(start, start + length);
  const end = field.indexOf(0);
  return field.subarray(0, end < 0 ? length : end).toString("utf8");
}
