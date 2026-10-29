import assert from "node:assert/strict";
import { test } from "node:test";
import { gzipSync } from "node:zlib";
import { extractTarGz } from "./tar.ts";

function entry(name: string, contents: Buffer, type = "0"): Buffer {
  const header = Buffer.alloc(512);
  header.write(name, 0, "utf8");
  header.write("0000644\0", 100, "ascii");
  header.write(contents.length.toString(8).padStart(11, "0") + "\0", 124, "ascii");
  header.write(type, 156, "ascii");
  header.write("ustar\0" + "00", 257, "ascii");
  return Buffer.concat([header, contents, Buffer.alloc((512 - (contents.length % 512)) % 512)]);
}

const archive = (...entries: Buffer[]) => gzipSync(Buffer.concat([...entries, Buffer.alloc(1024)]));

test("files named by base name come out of whatever folders they are in, and the rest are skipped", () => {
  const big = Buffer.alloc(1300, 7);
  const files = extractTarGz(
    archive(
      entry("tmp/export/", Buffer.alloc(0), "5"),
      entry("tmp/export/enc.onnx", big),
      entry("tmp/export/config.ini", Buffer.from("[df]\nsr = 48000\n")),
      entry("tmp/export/link", Buffer.alloc(0), "2"),
      entry("tmp/export/df_dec.onnx", Buffer.from("small")),
    ),
    ["enc.onnx", "df_dec.onnx", "missing.onnx"],
  );
  assert.deepEqual([...files.keys()].sort(), ["df_dec.onnx", "enc.onnx"]);
  assert.deepEqual(files.get("enc.onnx"), big);
  assert.equal(files.get("df_dec.onnx")!.toString(), "small");
});

test("an archive cut short, or not an archive at all, is refused", () => {
  const whole = Buffer.concat([entry("a/enc.onnx", Buffer.alloc(2000, 1)), Buffer.alloc(1024)]);
  assert.throws(() => extractTarGz(gzipSync(whole.subarray(0, 700)), ["enc.onnx"]), /damaged/);
  assert.throws(() => extractTarGz(Buffer.from("not gzip"), ["enc.onnx"]));
});

test("an empty archive has nothing", () => {
  assert.equal(extractTarGz(archive(), ["enc.onnx"]).size, 0);
});
