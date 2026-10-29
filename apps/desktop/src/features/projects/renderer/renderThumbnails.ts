/**
 * Draws a project's thumbnails in the thumbnail window: its video at each of `THUMBNAIL_FRACTIONS`, through the same
 * stage as the editor's preview and export, so they show what the video does. Captions are left out of the frames
 * and sent along on their own, so the grid can show the caption wherever the pointer is.
 */
import type { BackgroundState } from "#features/background-removal/contracts/backgroundRemoval";
import {
  DEFAULT_CAPTION_SETTINGS,
  type TranscriptionState,
} from "#features/transcription/domain/captions";
import {
  THUMBNAIL_FRACTIONS,
  THUMBNAIL_SIZE,
  type ThumbnailRender,
} from "../contracts/thumbnails.ts";
import { drawStills } from "#features/exporting/renderer/exporter";
import { FrameReader } from "#media-engine/renderer/frames";
import { videoPieces, videoSource } from "#media-engine/renderer/source";
import { mediaDuration } from "#media-engine/renderer/player.svelte";
import {
  type Part,
  type Timeline,
  buildTimeline,
  clipIndexAt,
  fileTime,
  followsWindow,
  sequence,
  withCuts,
} from "#media-engine/renderer/timeline";
import { upgradeProject } from "#project-document/renderer/projectUpgrade";
import type { Project, Recording } from "#project-document/domain/recording";

/** How the frames are compressed, from 0 to 1. */
const QUALITY = 0.82;
/** The stage's shape while following a window, as the player has it. */
const FOLLOW_ASPECT = 16 / 9;

/** Renders `stored`'s thumbnails, or null when its video has nothing in it to show. */
export async function renderThumbnails(stored: Project): Promise<ThumbnailRender | null> {
  const project = upgradeProject(stored);
  const recorded = project.recordings.filter((recording) => recording.directory);
  const timelines = new Map<string, Timeline>();
  // As the player does, recordings that can't be read are left out.
  await Promise.all(
    recorded.map(async (recording) => {
      try {
        const timeline = await buildTimeline(
          await window.chord.desktop.recording.load(recording.directory!),
          mediaDuration,
        );
        if (timeline) timelines.set(recording.id, timeline);
      } catch (error) {
        console.warn(`Couldn't load ${recording.directory} for its thumbnails:`, error);
      }
    }),
  );
  const { parts, duration } = sequence(
    videoPieces(project).flatMap(({ cuts, ...piece }) => {
      const timeline = timelines.get(piece.recordingId);
      return timeline
        ? [{ ...piece, timeline: cuts?.length ? withCuts(timeline, cuts) : timeline }]
        : [];
    }),
  );
  if (parts.length === 0 || !(duration > 0)) return null;

  const [transcripts, backgrounds] = await Promise.all([
    states<TranscriptionState>(recorded, (directory) =>
      window.chord.desktop.transcription.get(directory),
    ),
    states<BackgroundState>(
      recorded.filter((recording) => recording.hasCamera),
      (directory) => window.chord.desktop.background.get(directory),
    ),
  ]);
  const aspect = await stageAspect(parts);
  const source = videoSource(project, { parts, duration, aspect }, transcripts, backgrounds);
  const { width, height } = fitted(aspect);
  const frames: ThumbnailRender["frames"] = [];
  await drawStills(
    source,
    width,
    height,
    THUMBNAIL_FRACTIONS.map((fraction) => fraction * duration),
    async (canvas, time) => {
      frames.push({ time, image: await jpeg(canvas) });
    },
  );
  return {
    duration,
    aspect,
    frames,
    captions: (source.captions ?? []).map((line) => ({
      start: line.start,
      end: line.end,
      words: line.words.map(({ text, start }) => ({ text, start })),
    })),
    captionStyle: project.captions?.style ?? DEFAULT_CAPTION_SETTINGS.style,
  };
}

/** Each recording's job state, by session folder. One that can't be read is left out, as if never run. */
async function states<T>(
  recordings: Recording[],
  get: (directory: string) => Promise<T>,
): Promise<Record<string, T>> {
  const entries = await Promise.all(
    recordings.map(async ({ directory }) => {
      try {
        return [[directory!, await get(directory!)] as const];
      } catch {
        return [];
      }
    }),
  );
  return Object.fromEntries(entries.flat());
}

/**
 * The stage's own shape, as the player takes it: a followed window's, or that of the first piece's leading video.
 */
async function stageAspect(parts: Part[]): Promise<number> {
  if (followsWindow(parts)) return FOLLOW_ASPECT;
  const part = parts[0]!;
  const { lead, clips } = part.timeline;
  if (lead !== "screen" && lead !== "camera") return 16 / 9;
  const clip = clips[clipIndexAt(clips, part.start)];
  if (!clip) return 16 / 9;
  const reader = new FrameReader(clip.url);
  try {
    const sample = await reader.at(fileTime(clip, part.start));
    return sample && sample.displayHeight > 0 ? sample.displayWidth / sample.displayHeight : 16 / 9;
  } finally {
    await reader.close();
  }
}

/** The largest size of the video's shape within `THUMBNAIL_SIZE`, in even pixels. */
function fitted(aspect: number): { width: number; height: number } {
  const { width, height } = THUMBNAIL_SIZE;
  const even = (value: number) => Math.max(2, Math.round(value / 2) * 2);
  return aspect >= width / height
    ? { width, height: even(width / aspect) }
    : { width: even(height * aspect), height };
}

function jpeg(canvas: HTMLCanvasElement): Promise<Uint8Array> {
  return new Promise((resolve, reject) =>
    canvas.toBlob(
      (blob) => {
        if (blob) void blob.arrayBuffer().then((buffer) => resolve(new Uint8Array(buffer)), reject);
        else reject(new Error("The thumbnail couldn't be encoded"));
      },
      "image/jpeg",
      QUALITY,
    ),
  );
}

/** Answers the main process's renders, one at a time. */
export function startThumbnailRenderer(): void {
  const renderer = window.chord.thumbnailRenderer;
  let queue: Promise<void> = Promise.resolve();
  renderer.onRender((id, project) => {
    queue = queue.then(async () => {
      try {
        await renderer.result(id, { ok: true, result: await renderThumbnails(project) });
      } catch (error) {
        await renderer.result(id, {
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    });
  });
  renderer.ready();
}
