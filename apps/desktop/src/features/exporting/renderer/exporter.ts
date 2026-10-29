/**
 * Exports a project's edit as one video file. Each frame is drawn through a `Stage`, as the preview draws it, from
 * frames decoded straight from the recordings, then encoded with WebCodecs; the audio is mixed a stretch at a time
 * and kept a little ahead, so the file interleaves the two.
 */
import {
  AudioBufferSource,
  CanvasSource,
  Mp4OutputFormat,
  Output,
  QUALITY_HIGH,
  StreamTarget,
  type StreamTargetChunk,
  WebMOutputFormat,
  canEncodeAudio,
  canEncodeVideo,
} from "mediabunny";
import type { CaptionStyle } from "#features/transcription/domain/captions";
import type { CaptionLine } from "#media-engine/renderer/captions";
import type { Annotations } from "#features/editing/domain/annotations";
import type { AudioGains, AudioLevels, AudioSources } from "#features/editing/domain/audioSettings";
import type { VisualLayer } from "#features/editing/domain/visualLayers";
import type { RecordingBackdrop } from "#project-document/domain/recording";
import type { CameraTreatment } from "#media-engine/renderer/background";
import { Stage, type StageImage } from "#media-engine/renderer/stage";
import {
  type Part,
  clipIndexAt,
  fileTime,
  followerAt,
  followsWindow,
  partIndexAt,
  toRecording,
} from "#media-engine/renderer/timeline";
import { AudioMix } from "./audio.ts";
import { FrameReader } from "#media-engine/renderer/frames";
import {
  type ExportRange,
  type ExportSettings,
  VIDEO_FORMATS,
  aspectOf,
  exportSize,
  frameCount,
  isTransparent,
  isVideoFormat,
  rangeWithin,
} from "./settings.ts";

const SAMPLE_RATE = 48_000;
/** How much audio is mixed at a time, in samples. */
const AUDIO_STRETCH = SAMPLE_RATE * 2;
/** How far ahead of the video the audio is kept, in seconds. */
const AUDIO_LEAD = 1;
/** How many video files are kept open at once. */
const OPEN_READERS = 8;

/** What's exported: the project's edit as the player has it. */
export interface ExportSource {
  parts: Part[];
  captions?: CaptionLine[];
  captionStyle?: CaptionStyle;
  backgrounds?: Record<string, CameraTreatment>;
  backdrops?: Record<string, RecordingBackdrop>;
  duration: number;
  /** The stage's own width / height, for the original shape. */
  aspect: number;
  annotations: (recordingId: string) => Annotations | undefined;
  audioLevels?: AudioLevels;
  /** What leveling multiplies each audio track by. */
  audioGains?: AudioGains;
  /** Where each audio track's file is read from, such as its cleaned copy. */
  audioSources?: AudioSources;
  layers?: (recordingId: string) => VisualLayer[] | undefined;
}

export interface ExportOptions {
  /** The stretch of the project exported; all of it without one. */
  range?: ExportRange | null;
  /** Called after each frame. */
  onProgress?: (done: number, total: number) => void;
  signal?: AbortSignal;
}

/**
 * Exports `source`, or the range asked for, to `writable`. Rejects, with the file left incomplete, if it fails or
 * `signal` aborts.
 */
export async function exportVideo(
  source: ExportSource,
  settings: ExportSettings,
  writable: WritableStream<StreamTargetChunk>,
  options: ExportOptions = {},
): Promise<void> {
  if (!isVideoFormat(settings.format)) throw new Error("Not a video file type");
  const format = VIDEO_FORMATS[settings.format];
  const aspect = aspectOf(settings.aspect, source.aspect);
  const { width, height } = exportSize(aspect, settings.resolution);
  const transparent = isTransparent(settings);
  const frameRate = settings.frameRate;
  const range = rangeWithin(options.range, source.duration);
  const frames = frameCount(range.end - range.start, frameRate);
  const samples = Math.round((range.end - range.start) * SAMPLE_RATE);
  /** Where the range starts in the project's mix. */
  const firstSample = Math.round(range.start * SAMPLE_RATE);

  if (!(await canEncodeVideo(format.video, { width, height, quality: QUALITY_HIGH }))) {
    throw new Error(`This computer can't encode ${format.label} video at ${width} × ${height}`);
  }
  const mix = new AudioMix(
    source.parts,
    SAMPLE_RATE,
    source.audioLevels,
    source.audioGains,
    source.audioSources,
  );
  const hasAudio = mix.spans.length > 0;
  if (
    hasAudio &&
    !(await canEncodeAudio(format.audio, {
      numberOfChannels: 2,
      sampleRate: SAMPLE_RATE,
      quality: QUALITY_HIGH,
    }))
  ) {
    throw new Error(`This computer can't encode ${format.label} audio`);
  }

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d")!;
  const stage = new Stage(aspect);
  stage.backdrop = transparent ? "none" : followsWindow(source.parts) ? "gradient" : "black";
  stage.annotations = source.annotations;
  stage.layers = source.layers;
  stage.backgrounds = source.backgrounds ?? {};
  stage.backdrops = source.backdrops ?? {};
  stage.captions = settings.captions ? (source.captions ?? []) : [];
  stage.captionStyle = source.captionStyle ?? "lines";

  const output = new Output({
    // Space for the index is kept at the start, so players can start before the whole file has loaded.
    format:
      format.extension === "mp4"
        ? new Mp4OutputFormat({ fastStart: "reserve" })
        : new WebMOutputFormat(),
    target: new StreamTarget(writable, { chunked: true }),
  });
  const video = new CanvasSource(canvas, {
    codec: format.video,
    quality: QUALITY_HIGH,
    alpha: transparent ? "keep" : "discard",
  });
  output.addVideoTrack(video, { frameRate, maximumPacketCount: frames + 16 });
  const audio = hasAudio
    ? new AudioBufferSource({ codec: format.audio, quality: QUALITY_HIGH })
    : undefined;
  // One packet per 512 samples at most, with room to spare.
  if (audio)
    output.addAudioTrack(audio, { maximumPacketCount: Math.ceil((samples / 512) * 1.33) + 64 });

  const readers = new Readers();
  let mixed = 0;
  const mixUntil = async (until: number) => {
    while (audio && mixed < Math.min(until, samples)) {
      const to = Math.min(mixed + AUDIO_STRETCH, samples);
      await audio.add(await mix.render(firstSample + mixed, firstSample + to));
      mixed = to;
    }
  };
  try {
    await output.start();
    for (let frame = 0; frame < frames; frame++) {
      options.signal?.throwIfAborted();
      const time = frame / frameRate;
      await mixUntil(Math.ceil((time + AUDIO_LEAD) * SAMPLE_RATE));
      await drawFrame(stage, context, source.parts, range.start + time, readers);
      await video.add(time, 1 / frameRate);
      options.onProgress?.(frame + 1, frames);
    }
    await mixUntil(samples);
    options.signal?.throwIfAborted();
    await output.finalize();
  } catch (error) {
    if (output.state !== "finalized") await output.cancel();
    throw error;
  } finally {
    await readers.close();
    mix.dispose();
  }
}

/** How stills differ from the defaults: the shape followed windows are framed at, and whether captions are drawn. */
export interface StillOptions {
  /** The stage's width / height, if not the source's own. */
  aspect?: number;
  captions?: boolean;
}

/**
 * Draws `source` at each of `times` on a `width` by `height` canvas, with no captions unless asked, handing each frame
 * to `still` while it's showing. For stills like thumbnails: the same frames an export draws there.
 */
export async function drawStills(
  source: ExportSource,
  width: number,
  height: number,
  times: number[],
  still: (canvas: HTMLCanvasElement, time: number) => Promise<void>,
  signal?: AbortSignal,
  options: StillOptions = {},
): Promise<void> {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d")!;
  const stage = new Stage(options.aspect ?? source.aspect);
  stage.backdrop = followsWindow(source.parts) ? "gradient" : "black";
  stage.annotations = source.annotations;
  stage.layers = source.layers;
  stage.backgrounds = source.backgrounds ?? {};
  stage.backdrops = source.backdrops ?? {};
  stage.captions = options.captions ? (source.captions ?? []) : [];
  stage.captionStyle = source.captionStyle ?? "lines";
  const readers = new Readers();
  try {
    for (const time of times) {
      signal?.throwIfAborted();
      await drawFrame(stage, context, source.parts, time, readers);
      await still(canvas, time);
    }
  } finally {
    await readers.close();
  }
}

/** Draws the stage at project `time`. */
async function drawFrame(
  stage: Stage,
  context: CanvasRenderingContext2D,
  parts: Part[],
  time: number,
  readers: Readers,
): Promise<void> {
  const part = parts[partIndexAt(parts, time)];
  if (!part) return stage.draw(context, { part: null });
  const { lead, clips, camera: cameraClips } = part.timeline;
  const local = toRecording(part, time);
  const clip = clips[clipIndexAt(clips, local)]!;
  const clipTime = fileTime(clip, local);
  const opened: VideoFrame[] = [];
  const frameAt = async (url: string, at: number) => {
    const sample = await readers.get(url).at(at);
    const frame = sample?.toVideoFrame() ?? null;
    if (frame) opened.push(frame);
    return frame;
  };
  try {
    let screen: VideoFrame | null = null;
    let camera: VideoFrame | null = null;
    let cameraFile: string | undefined;
    let cameraTime = 0;
    if (lead === "screen") {
      screen = await frameAt(clip.url, clipTime);
      // The camera follows on session time.
      const follower = followerAt(cameraClips, clip.start + local - clip.offset);
      if (follower) {
        camera = await frameAt(follower.clip.url, follower.time);
        cameraFile = follower.clip.file;
        cameraTime = follower.time;
      }
    } else if (lead === "camera") {
      camera = await frameAt(clip.url, clipTime);
      cameraFile = clip.file;
      cameraTime = clipTime;
    }
    const treatment = stage.backgrounds[part.recordingId];
    const maskUrl =
      cameraFile && treatment?.settings.enabled ? treatment.masks[cameraFile] : undefined;
    const mask = maskUrl ? await frameAt(maskUrl, cameraTime) : null;
    if (maskUrl && !mask)
      throw new Error(
        "This recording's foreground masks could not be decoded. Process its background again.",
      );
    const feeds: Record<string, StageImage | null> = {};
    const masks: Record<string, StageImage | null> = {};
    for (const source of part.timeline.video ?? []) {
      if (source.lead || (source.kind === "camera" && source.index === 0)) continue;
      const follower = followerAt(source.clips, clip.start + local - clip.offset);
      if (!follower) continue;
      const frame = await frameAt(follower.clip.url, follower.time);
      feeds[source.id] = frame && imageOf(frame);
      const url =
        source.kind === "camera" && treatment?.settings.enabled
          ? treatment.masks[follower.clip.file]
          : undefined;
      if (url) {
        const mask = await frameAt(url, follower.time);
        if (!mask)
          throw new Error(
            "This recording's foreground masks could not be decoded. Process its background again.",
          );
        masks[source.id] = imageOf(mask);
      }
    }
    stage.draw(context, {
      part,
      clip,
      time: local,
      screen,
      camera: camera && imageOf(camera),
      mask: mask && imageOf(mask),
      feeds,
      masks,
    });
  } finally {
    for (const frame of opened) frame.close();
  }
}

function imageOf(frame: VideoFrame): StageImage {
  return {
    image: frame,
    width: frame.displayWidth,
    height: frame.displayHeight,
    time: frame.timestamp / 1e6,
  };
}

/** A reader for each video file, keeping the ones read most recently open. */
class Readers {
  #open = new Map<string, FrameReader>();

  get(url: string): FrameReader {
    let reader = this.#open.get(url);
    if (reader) this.#open.delete(url);
    else reader = new FrameReader(url);
    this.#open.set(url, reader);
    if (this.#open.size > OPEN_READERS) {
      const [oldest, least] = this.#open.entries().next().value!;
      this.#open.delete(oldest);
      void least.close();
    }
    return reader;
  }

  async close(): Promise<void> {
    await Promise.all([...this.#open.values()].map((reader) => reader.close()));
    this.#open.clear();
  }
}
