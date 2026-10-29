// Native frame bridge check, no downloaded model needed: node src/features/background-removal/tests/integration/background-native.ts (ffmpeg required).
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
const data = mkdtempSync(join(tmpdir(), "chord-native-mask-"));
const helper = resolve(
  import.meta.dirname,
  "../../../../../../../native/macos/.build/release/background-helper",
);
const source = join(data, "camera.mp4");
const output = join(data, "mask.mp4");
async function main() {
  execFileSync("ffmpeg", [
    "-v",
    "error",
    "-y",
    "-f",
    "lavfi",
    "-i",
    "color=black:size=320x180:rate=4:duration=1",
    "-vf",
    "drawbox=x=0:y=0:w=320:h=60:color=red:t=fill",
    "-pix_fmt",
    "yuv420p",
    source,
  ]);
  const info = JSON.parse(execFileSync(helper, ["info", source], { encoding: "utf8" }));
  assert.deepEqual(info, { width: 320, height: 180, duration: 1 });
  const child = spawn(helper, ["mask", source, output, "320", "192"]);
  let errors = "";
  child.stderr.on("data", (chunk) => (errors += chunk));
  const closed = new Promise<void>((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code) => (code === 0 ? resolve() : reject(new Error(errors))));
  });
  const iterator = child.stdout[Symbol.asyncIterator]();
  let pending = Buffer.alloc(0);
  async function read(count: number) {
    while (pending.length < count) {
      const next = await iterator.next();
      assert.ok(!next.done, "Complete native frame");
      pending = Buffer.concat([pending, next.value]);
    }
    const result = pending.subarray(0, count);
    pending = pending.subarray(count);
    return result;
  }
  const timestamps = [];
  for (;;) {
    const header = await read(12);
    const count = header.readUInt32LE(8);
    if (!count) break;
    timestamps.push(header.readDoubleLE(0));
    const bgra = await read(count);
    const mask = Buffer.alloc(320 * 192);
    for (let i = 0; i < mask.length; i++) mask[i] = bgra[i * 4 + 2]; // Red foreground becomes alpha, preserving native row orientation.
    assert.ok(
      mask[20 * 320 + 160] > 220,
      "Top of the camera frame stays at the top of the inference tensor",
    );
    assert.ok(mask[170 * 320 + 160] < 10, "Bottom of the frame stays at the bottom");
    child.stdin.write(mask);
  }
  child.stdin.end();
  await closed;
  assert.deepEqual(timestamps, [0, 0.25, 0.5, 0.75]);
  const probe = JSON.parse(
    execFileSync(
      "ffprobe",
      [
        "-v",
        "error",
        "-show_entries",
        "stream=width,height,nb_frames:format=duration",
        "-of",
        "json",
        output,
      ],
      { encoding: "utf8" },
    ),
  );
  assert.equal(probe.format.duration, "1.000000");
  assert.equal(probe.streams[0].nb_frames, "4");
  const pixels = execFileSync("ffmpeg", [
    "-v",
    "error",
    "-ss",
    "0.5",
    "-i",
    output,
    "-frames:v",
    "1",
    "-f",
    "rawvideo",
    "-pix_fmt",
    "gray",
    "-",
  ]);
  assert.ok(
    pixels[20 * 320 + 160] > 220 && pixels[170 * 320 + 160] < 10,
    "Encoded mask keeps the original frame orientation",
  );
  console.log(
    "PASS: native camera decoding, model-sized BGRA frames, source timestamps, frame count, duration and encoded mask orientation",
  );
}
main()
  .then(() => rmSync(data, { recursive: true, force: true }))
  .catch((error) => {
    console.error(error);
    rmSync(data, { recursive: true, force: true });
    process.exit(1);
  });
