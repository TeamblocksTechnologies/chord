/**
 * A still of the edit at one moment: the frame the preview shows there, drawn through the same stage as an export
 * at the recording's own pixels, and encoded as a PNG.
 */
import { type ExportSource, drawStills } from "./exporter.ts";
import { FrameReader } from "#media-engine/renderer/frames";
import { clipIndexAt, fileTime, partIndexAt, toRecording } from "#media-engine/renderer/timeline";

/** How close to the end of the video a still may be taken, in seconds: the end itself has no frame. */
const END = 0.001;

/**
 * The largest size of shape `aspect` that fits within `native` pixels, in whole pixels, so nothing is enlarged: a
 * wider shape keeps the width, a taller one the height.
 */
export function stillSize(
  aspect: number,
  native: { width: number; height: number },
): { width: number; height: number } {
  const whole = (value: number) => Math.max(1, Math.round(value));
  return aspect >= native.width / native.height
    ? { width: whole(native.width), height: whole(native.width / aspect) }
    : { width: whole(native.height * aspect), height: whole(native.height) };
}

/** The pixels of what leads the video at `time`, or null where there's no picture: audio alone, or nothing yet decoded. */
async function nativeSize(
  source: ExportSource,
  time: number,
): Promise<{ width: number; height: number } | null> {
  const part = source.parts[partIndexAt(source.parts, time)];
  if (!part) return null;
  const { lead, clips } = part.timeline;
  if (lead !== "screen" && lead !== "camera") return null;
  const local = toRecording(part, time);
  const clip = clips[clipIndexAt(clips, local)];
  if (!clip) return null;
  const reader = new FrameReader(clip.url);
  try {
    const sample = await reader.at(fileTime(clip, local));
    return sample && sample.displayWidth > 0 && sample.displayHeight > 0
      ? { width: sample.displayWidth, height: sample.displayHeight }
      : null;
  } finally {
    await reader.close();
  }
}

/**
 * The PNG of `source` at project `time`, shaped `aspect` (width / height) and as large as the leading video's pixels
 * allow, with the caption showing if `captions`. Rejects where there's no frame to draw.
 */
export async function renderStill(
  source: ExportSource,
  time: number,
  aspect: number,
  captions: boolean,
): Promise<Uint8Array> {
  const at = Math.min(Math.max(time, 0), Math.max(source.duration - END, 0));
  const native = await nativeSize(source, at);
  if (!native) throw new Error("There's no frame at this time");
  const { width, height } = stillSize(aspect, native);
  let png: Uint8Array | undefined;
  await drawStills(
    source,
    width,
    height,
    [at],
    async (canvas) => {
      png = await encode(canvas);
    },
    undefined,
    { aspect: width / height, captions },
  );
  if (!png) throw new Error("The frame couldn't be drawn");
  return png;
}

function encode(canvas: HTMLCanvasElement): Promise<Uint8Array> {
  return new Promise((resolve, reject) =>
    canvas.toBlob((blob) => {
      if (blob) void blob.arrayBuffer().then((buffer) => resolve(new Uint8Array(buffer)), reject);
      else reject(new Error("The frame couldn't be encoded"));
    }, "image/png"),
  );
}
