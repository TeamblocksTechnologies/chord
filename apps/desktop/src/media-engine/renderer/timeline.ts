/**
 * Lays a recording's tracks out for playback. One track leads: the screen, else the camera, else the audio. Its
 * segments play end to end, skipping pauses and gaps; the other tracks follow it on session time.
 */
import type {
  BoundsSample,
  CursorKind,
  InputEvent,
  KeyModifier,
  ManifestTrack,
  Mark,
  MouseButton,
  Rect,
  RecordedWindow,
  TrackKind,
} from "@teamblocks.dev/chord-recorder-protocol";
import type { AnnotationSpan } from "#features/editing/domain/annotations";
import type { EffectKind } from "#features/editing/domain/visualLayers";
import { keptRanges, type Cut, type Kept } from "#features/editing/domain/cuts";
import { type LoadedSession, mediaUrl } from "../contracts/playback.ts";
import type { ClipLayout } from "#features/editing/domain/clipLayout";
import type { CameraLayout } from "#project-document/domain/recording";
import type { ShownSample } from "./camera.ts";

/** A segment file. `start` and `duration` are on session time; `offset` is where it starts on the playback timeline. */
export interface Clip {
  url: string;
  /** Its name in the session folder. */
  file: string;
  start: number;
  duration: number;
  offset: number;
  /** Recorded in `focusedWindow` mode, so the camera follows its bounds. */
  focused: boolean;
  /** Screen clips: what the video shows, in global display coordinates. */
  region?: Rect;
  /**
   * Pinned window clips: the part of the frame the window was in over the clip, as fractions of its width and
   * height. Missing where it never showed on the clip's display.
   */
  crop?: Rect;
  /** Where in its file it starts, when a cut left out the file's beginning. */
  fileStart?: number;
  /** A cut ends it before its file ends, so the file plays on past it. */
  endsEarly?: true;
}

/** Where the cursor was from `time` on. A `cut` begins a clip, so a trail doesn't join across it. */
export interface CursorSample {
  time: number;
  x: number;
  y: number;
  cut?: true;
}

/**
 * The cursor's shape from `time` on: an image in the session folder, `width` by `height` points, with its hotspot
 * `hotspotX`, `hotspotY` points from its top left. `kind` names a standard system cursor. A `cut` begins a clip.
 */
export interface ShapeSample {
  time: number;
  image?: string;
  width: number;
  height: number;
  hotspotX: number;
  hotspotY: number;
  kind?: CursorKind;
  cut?: true;
}

/** A mouse button held from `time` until `end`, pressed at `x`, `y`. */
export interface ClickPress {
  time: number;
  end: number;
  button: MouseButton;
  x: number;
  y: number;
}

/** A key that matters, held from `time` until `end`. */
export interface KeyPress {
  time: number;
  end: number;
  key: number;
  modifiers: KeyModifier[];
}

/** The recorded mouse and keys on a recording's playback timeline, cut where its clips are. */
export interface PlaybackInput {
  cursor: CursorSample[];
  clicks: ClickPress[];
  keys: KeyPress[];
  /** Missing from sessions recorded before shapes were. */
  shapes?: ShapeSample[];
  /** The shapes' images, loaded, by file. One that couldn't be loaded is missing. */
  images?: Record<string, CanvasImageSource>;
}

export interface VideoSource {
  id: string;
  kind: "screen" | "camera";
  index: number;
  clips: Clip[];
  lead: boolean;
  /** A pinned window's track: the window, as it was when pinned. */
  window?: RecordedWindow;
}

/** A mark added while recording, on the playback timeline. */
export interface TimelineMark {
  id: string;
  time: number;
  kind: string;
  note?: string;
}

export interface Timeline {
  /** Every recorded video feed, including the leading track. */
  video?: VideoSource[];
  lead: TrackKind;
  /** The leading track's segments, end to end. */
  clips: Clip[];
  duration: number;
  /** When the screen leads: the recorded display's frame, and what was shown on it on the playback timeline. */
  screen?: { area: Rect; samples: ShownSample[] };
  /** When the screen leads, the camera's segments. */
  camera: Clip[];
  /** The audio tracks that don't lead. */
  audio: { kind: TrackKind; clips: Clip[] }[];
  /** When the screen leads and the mouse and keys were recorded. */
  input?: PlaybackInput;
  /** Marks added while recording, in order. */
  marks?: TimelineMark[];
}

/** How long a segment the helper didn't finish (it crashed) runs, from its file. */
export type Probe = (url: string) => Promise<number>;

/** Null when the recording has nothing to play. */
export async function buildTimeline(
  session: LoadedSession,
  probe: Probe,
): Promise<Timeline | null> {
  // Pinned windows' tracks follow the mode's screen tracks, so a screen track leads and is the first of its kind.
  const tracks = session.manifest.tracks
    .filter((track) => track.segments.length > 0)
    .sort((a, b) => Number(!!a.window) - Number(!!b.window));
  const screen = tracks.find((track) => track.kind === "screen" && track.display && !track.window);
  const camera = tracks.find((track) => track.kind === "camera");
  const audio = tracks.filter(
    (track) => track.kind === "microphone" || track.kind === "systemAudio",
  );
  const lead = screen ?? camera ?? audio[0];
  if (!lead) return null;

  const clips = await placeClips(session.directory, lead, probe);
  if (clips.length === 0) return null;
  const video = await Promise.all(
    tracks
      .filter((track) => track.kind === "screen" || track.kind === "camera")
      .map(async (track) => ({
        id: track.id,
        kind: track.kind as "screen" | "camera",
        index: tracks.filter((other) => other.kind === track.kind).indexOf(track),
        clips:
          track === lead
            ? clips
            : await placeClips(session.directory, track, probe, session.bounds[track.id]),
        lead: track === lead,
        ...(track.window && { window: track.window }),
      })),
  );
  return {
    video,
    lead: lead.kind,
    clips,
    duration: clips.reduce((total, clip) => total + clip.duration, 0),
    marks: marksOnPlayback(clips, session.manifest.marks ?? []),
    ...(lead === screen && {
      screen: {
        area: screen.display!.frame,
        samples: toPlaybackTime(clips, session.bounds[screen.id] ?? [], screen.display!.frame),
      },
    }),
    ...(lead === screen &&
      session.input.length > 0 && {
        input: {
          ...inputOnPlayback(clips, session.input),
          images: await cursorImages(session.directory, session.input),
        },
      }),
    camera:
      video.find((source) => source.kind === "camera" && source.index === 0 && !source.lead)
        ?.clips ?? [],
    audio: await Promise.all(
      audio
        .filter((track) => track !== lead)
        .map(async (track) => ({
          kind: track.kind,
          clips: await placeClips(session.directory, track, probe),
        })),
    ),
  };
}

/** Loads the cursor shapes' images. Ones that can't be loaded are left out, to be drawn as the standard pointer. */
async function cursorImages(
  directory: string,
  events: InputEvent[],
): Promise<Record<string, CanvasImageSource>> {
  if (typeof createImageBitmap !== "function") return {};
  const files = new Set(
    events.flatMap((event) => (event.type === "cursor" && event.image ? [event.image] : [])),
  );
  const loaded = await Promise.all(
    [...files].map(async (file) => {
      try {
        const response = await fetch(mediaUrl(directory, file));
        if (!response.ok) return [];
        return [[file, await createImageBitmap(await response.blob())] as const];
      } catch {
        return [];
      }
    }),
  );
  return Object.fromEntries(loaded.flat());
}

/** Lays a track's segments end to end. A pinned window's clips are cropped to where its `bounds` put it. */
async function placeClips(
  directory: string,
  track: ManifestTrack,
  probe: Probe,
  bounds: BoundsSample[] = [],
): Promise<Clip[]> {
  const clips: Clip[] = [];
  let offset = 0;
  for (const segment of track.segments) {
    const url = mediaUrl(directory, segment.file);
    const duration = segment.end !== undefined ? segment.end - segment.start : await probe(url);
    if (!(duration > 0)) continue;
    const crop =
      track.window && track.display
        ? cropOf(bounds, track.display.frame, segment.start, segment.start + duration)
        : undefined;
    clips.push({
      url,
      file: segment.file,
      start: segment.start,
      duration,
      offset,
      focused: segment.screenMode?.type === "focusedWindow",
      ...(track.display && { region: regionOf(track, segment.screenMode) }),
      ...(crop && { crop }),
    });
    offset += duration;
  }
  return clips;
}

/**
 * Everywhere a window's bounds put it on `display` from `start` to `end`, as fractions of the display. Undefined
 * where it was never on it.
 */
export function cropOf(
  bounds: readonly BoundsSample[],
  display: Rect,
  start: number,
  end: number,
): Rect | undefined {
  const shown = bounds.filter(
    (sample, i) => sample.time < end && (sample.time >= start || !(bounds[i + 1]?.time <= start)),
  );
  let box: { left: number; top: number; right: number; bottom: number } | undefined;
  for (const { frame } of shown) {
    if (!frame) continue;
    const left = Math.max(frame.x, display.x),
      top = Math.max(frame.y, display.y);
    const right = Math.min(frame.x + frame.width, display.x + display.width),
      bottom = Math.min(frame.y + frame.height, display.y + display.height);
    if (right <= left || bottom <= top) continue;
    box = box
      ? {
          left: Math.min(box.left, left),
          top: Math.min(box.top, top),
          right: Math.max(box.right, right),
          bottom: Math.max(box.bottom, bottom),
        }
      : { left, top, right, bottom };
  }
  return (
    box && {
      x: (box.left - display.x) / display.width,
      y: (box.top - display.y) / display.height,
      width: (box.right - box.left) / display.width,
      height: (box.bottom - box.top) / display.height,
    }
  );
}

/** What a screen track's segment shows: its display, or in `area` mode the track's area of it. */
function regionOf(
  track: ManifestTrack,
  mode: ManifestTrack["segments"][number]["screenMode"],
): Rect {
  const { frame, id } = track.display!;
  // `area-2-screen-1` records the second of the mode's areas on its display.
  const nth = Number(/^area-(\d+)-/.exec(track.id)?.[1]);
  const area =
    mode?.type === "area" && nth > 0
      ? mode.areas.filter((a) => a.displayId === id)[nth - 1]
      : undefined;
  return area
    ? { x: frame.x + area.x, y: frame.y + area.y, width: area.width, height: area.height }
    : frame;
}

type ButtonEvent = Extract<InputEvent, { button: MouseButton }>;

/** The clip playing at session time `time`, if one was. */
function clipAtSession(clips: Clip[], time: number): Clip | undefined {
  return clips.find((clip) => time >= clip.start && time < clip.start + clip.duration);
}

/**
 * Moves the recorded mouse and keys onto the playback timeline. Whatever happened while no clip was recording is
 * left out; a press still held when its clip ends is let go there.
 */
export function inputOnPlayback(clips: Clip[], events: InputEvent[]): PlaybackInput {
  const input: PlaybackInput = { cursor: [], clicks: [], keys: [] };
  const moves = events.filter((event) => event.type === "move");
  const shapes = events.filter((event) => event.type === "cursor");
  const shape = (event: (typeof shapes)[number], time: number, cut?: true): ShapeSample => ({
    time,
    width: event.width,
    height: event.height,
    hotspotX: event.hotspotX,
    hotspotY: event.hotspotY,
    ...(event.image && { image: event.image }),
    ...(event.kind && { kind: event.kind }),
    ...(cut && { cut }),
  });
  if (shapes.length > 0) input.shapes = [];
  for (const clip of clips) {
    const end = clip.start + clip.duration;
    const before = moves.findLast((move) => move.time <= clip.start);
    if (before) input.cursor.push({ time: clip.offset, x: before.x, y: before.y, cut: true });
    for (const move of moves) {
      if (move.time > clip.start && move.time < end)
        input.cursor.push({ time: clip.offset + move.time - clip.start, x: move.x, y: move.y });
    }
    if (!input.shapes) continue;
    const shown = shapes.findLast((event) => event.time <= clip.start);
    if (shown) input.shapes.push(shape(shown, clip.offset, true));
    for (const event of shapes) {
      if (event.time > clip.start && event.time < end)
        input.shapes.push(shape(event, clip.offset + event.time - clip.start));
    }
  }
  /** `time` on the playback timeline, and when the clip it's in ends. */
  const place = (time: number) => {
    const clip = clipAtSession(clips, time);
    return clip && { time: clip.offset + time - clip.start, until: clip.offset + clip.duration };
  };
  const held = new Map<MouseButton, ButtonEvent>();
  const press = (down: ButtonEvent, end: number) => {
    const at = place(down.time);
    if (at)
      input.clicks.push({
        time: at.time,
        end: Math.min(at.time + end - down.time, at.until),
        button: down.button,
        x: down.x,
        y: down.y,
      });
  };
  for (const event of events) {
    if (event.type === "down") held.set(event.button, event);
    else if (event.type === "up") {
      const down = held.get(event.button);
      held.delete(event.button);
      if (down) press(down, event.time);
    } else if (event.type === "key") {
      const at = place(event.time);
      if (at)
        input.keys.push({
          time: at.time,
          end: Math.min(at.time + event.duration, at.until),
          key: event.key,
          modifiers: event.modifiers,
        });
    }
  }
  for (const down of held.values()) press(down, Infinity);
  input.clicks.sort((a, b) => a.time - b.time);
  return input;
}

/** Moves marks onto the playback timeline. One added while paused is where the recording picks up again. */
export function marksOnPlayback(clips: Clip[], marks: readonly Mark[]): TimelineMark[] {
  const end = clips.reduce((total, clip) => total + clip.duration, 0);
  return marks
    .map((mark) => {
      const clip = clips.find((clip) => mark.time < clip.start + clip.duration);
      return { ...mark, time: clip ? clip.offset + Math.max(mark.time - clip.start, 0) : end };
    })
    .sort((a, b) => a.time - b.time);
}

/** Where a clip's playback time `local` is in its file. */
export function fileTime(clip: Clip, local: number): number {
  return (clip.fileStart ?? 0) + Math.min(Math.max(local - clip.offset, 0), clip.duration);
}

/**
 * A recording's timeline with `cuts` (in order, apart) left out as if it was paused there: its leading clips are cut
 * where they are and close up, and what was shown and the mouse and keys move with them. Following tracks keep to
 * session time, so they follow as they do across a pause.
 */
export function withCuts(timeline: Timeline, cuts: readonly Cut[]): Timeline {
  if (cuts.length === 0) return timeline;
  const kept = keptRanges(cuts, timeline.duration);
  const clips = kept.flatMap((range) =>
    timeline.clips.flatMap((clip): Clip[] => {
      const from = Math.max(range.start, clip.offset);
      const to = Math.min(range.end, clip.offset + clip.duration);
      if (to - from <= 1e-6) return [];
      return [
        {
          ...clip,
          start: clip.start + from - clip.offset,
          duration: to - from,
          offset: range.offset + from - range.start,
          fileStart: fileTime(clip, from),
          ...(to < clip.offset + clip.duration - 1e-6 && { endsEarly: true as const }),
        },
      ];
    }),
  );
  return {
    ...timeline,
    clips,
    ...(timeline.video && {
      video: timeline.video.map((source) => (source.lead ? { ...source, clips } : source)),
    }),
    duration: clips.reduce((total, clip) => total + clip.duration, 0),
    ...(timeline.marks && { marks: keptMarks(timeline.marks, kept) }),
    ...(timeline.screen && {
      screen: { area: timeline.screen.area, samples: keptSamples(timeline.screen.samples, kept) },
    }),
    ...(timeline.input && {
      input: {
        ...timeline.input,
        cursor: keptSamples(timeline.input.cursor, kept),
        clicks: keptPresses(timeline.input.clicks, kept),
        keys: keptPresses(timeline.input.keys, kept),
        ...(timeline.input.shapes && { shapes: keptSamples(timeline.input.shapes, kept) }),
      },
    }),
  };
}

/** The marks in what's kept, where they are once the cuts close up. */
function keptMarks(marks: TimelineMark[], kept: Kept[]): TimelineMark[] {
  return marks.flatMap((mark) => {
    const range = kept.find(
      (range) => mark.time >= range.start - 1e-9 && mark.time <= range.end + 1e-9,
    );
    return range
      ? [
          {
            ...mark,
            time:
              range.offset +
              Math.min(Math.max(mark.time - range.start, 0), range.end - range.start),
          },
        ]
      : [];
  });
}

/** Samples of where something was from `time` on, in what's kept; each kept stretch cuts in to what was there as it starts. */
function keptSamples<T extends { time: number; cut?: boolean }>(samples: T[], kept: Kept[]): T[] {
  return kept.flatMap((range) => {
    const before = samples.findLast((sample) => sample.time <= range.start + 1e-9);
    const within = samples.filter(
      (sample) => sample.time > range.start + 1e-9 && sample.time < range.end,
    );
    return [
      ...(before ? [{ ...before, time: range.offset, cut: true } as T] : []),
      ...within.map((sample) => ({ ...sample, time: range.offset + sample.time - range.start })),
    ];
  });
}

/** Presses that start in what's kept, let go where their stretch ends. */
function keptPresses<T extends { time: number; end: number }>(presses: T[], kept: Kept[]): T[] {
  return kept.flatMap((range) =>
    presses
      .filter((press) => press.time >= range.start && press.time < range.end)
      .map((press) => ({
        ...press,
        time: range.offset + press.time - range.start,
        end: range.offset + Math.min(press.end, range.end) - range.start,
      })),
  );
}

/** The leading clip playing at playback `time`. */
export function clipIndexAt(clips: Clip[], time: number): number {
  return Math.max(
    0,
    clips.findLastIndex((clip) => clip.offset <= time),
  );
}

/** How far a follower may start after the leading clip and still show its first frame until then, in seconds. */
const LEAD_IN = 1;

/**
 * Where a follower track is at session time `time`: its clip and the time within it. Just before a clip starts, its
 * first frame holds (`early`), since tracks start a moment apart. Undefined where it wasn't recording.
 */
export function followerAt(
  clips: Clip[],
  time: number,
): { clip: Clip; time: number; early: boolean } | undefined {
  const clip = clips.find((c) => time >= c.start - LEAD_IN && time < c.start + c.duration);
  return clip && { clip, time: Math.max(0, time - clip.start), early: time < clip.start };
}

/**
 * Moves bounds samples onto the playback timeline. Each clip cuts in to whatever was shown when it began; clips
 * not recorded in `focusedWindow` mode show the whole display.
 */
export function toPlaybackTime(
  clips: Clip[],
  bounds: BoundsSample[],
  display: Rect,
): ShownSample[] {
  const samples: ShownSample[] = [];
  for (const clip of clips) {
    if (!clip.focused) {
      samples.push({ time: clip.offset, frame: display, cut: true });
      continue;
    }
    const end = clip.start + clip.duration;
    const before = bounds.findLast((sample) => sample.time <= clip.start);
    samples.push({ time: clip.offset, frame: before?.frame, window: before?.window, cut: true });
    for (const sample of bounds) {
      if (sample.time > clip.start && sample.time < end) {
        samples.push({
          time: clip.offset + sample.time - clip.start,
          frame: sample.frame,
          window: sample.window,
        });
      }
    }
  }
  return samples;
}

/** One piece of the project's edit, placed on the project's timeline. */
export interface Part {
  pieceId: string;
  recordingId: string;
  /** Where it starts on the project's timeline. */
  offset: number;
  /** What of the recording it plays, on the recording's own timeline. */
  start: number;
  end: number;
  timeline: Timeline;
  cameraLayout?: CameraLayout;
  layout?: ClipLayout;
}

/**
 * A piece of a recording to play. Without `start` and `end`, the whole recording; without `id`, the recording's;
 * without `offset`, after everything before it.
 */
export interface Placed {
  id?: string;
  recordingId: string;
  timeline: Timeline;
  start?: number;
  end?: number | null;
  offset?: number;
  cameraLayout?: CameraLayout;
  layout?: ClipLayout;
}

/**
 * Places a project's pieces on its timeline, in order, so earlier ones are on top where they overlap. Gaps between
 * them play nothing. Pieces with nothing left of their recording are left out.
 */
export function sequence(pieces: Placed[]): { parts: Part[]; duration: number } {
  const parts: Part[] = [];
  let duration = 0;
  for (const {
    id,
    recordingId,
    timeline,
    start = 0,
    end = null,
    offset,
    cameraLayout,
    layout,
  } of pieces) {
    const to = Math.min(end ?? timeline.duration, timeline.duration);
    const from = Math.min(Math.max(start, 0), to);
    if (to - from <= 1e-6) continue;
    const at = Math.max(offset ?? duration, 0);
    parts.push({
      pieceId: id ?? recordingId,
      recordingId,
      offset: at,
      start: from,
      end: to,
      timeline,
      ...(cameraLayout && { cameraLayout }),
      ...(layout && { layout }),
    });
    duration = Math.max(duration, at + to - from);
  }
  return { parts, duration };
}

/** Whether any of `parts` follows a window, so the stage frames it on a backdrop. */
export function followsWindow(parts: Part[]): boolean {
  return parts.some((part) => part.timeline.clips.some((clip) => clip.focused));
}

/** How long a part plays. */
export function lengthOf(part: Part): number {
  return part.end - part.start;
}

/** Project `time` on the part's recording's own timeline. */
export function toRecording(part: Part, time: number): number {
  return part.start + time - part.offset;
}

/** Time `local` on the part's recording's own timeline, on the project's. */
export function toProject(part: Part, local: number): number {
  return part.offset + local - part.start;
}

/** The part playing at project `time`: the first there, as it's on top. -1 where none is. */
export function partIndexAt(parts: Part[], time: number): number {
  return parts.findIndex((part) => time >= part.offset && time < part.offset + lengthOf(part));
}

/** Where a part plays: from `from` to `to` on the project's timeline. */
export interface Showing {
  part: Part;
  from: number;
  to: number;
}

/** A mark where it is on the project's timeline. */
export interface PlacedMark extends TimelineMark {
  pieceId: string;
  recordingId: string;
}

/** The marks in what each part plays, on the project's timeline, in order. */
export function marksOf(parts: Part[]): PlacedMark[] {
  return parts
    .flatMap((part) =>
      (part.timeline.marks ?? [])
        .filter((mark) => mark.time >= part.start - 1e-9 && mark.time <= part.end + 1e-9)
        .map((mark) => ({
          ...mark,
          time: toProject(part, mark.time),
          pieceId: part.pieceId,
          recordingId: part.recordingId,
        })),
    )
    .sort((a, b) => a.time - b.time);
}

/** Where each part plays, in time order: wherever it's on top, as earlier parts cover later ones. */
export function showingOf(parts: Part[]): Showing[] {
  const showing: Showing[] = [];
  /** What earlier parts cover, in order, apart from one another. */
  let covered: { from: number; to: number }[] = [];
  for (const part of parts) {
    const [start, end] = [part.offset, part.offset + lengthOf(part)];
    let from = start;
    for (const range of covered) {
      if (range.to <= from) continue;
      if (range.from >= end) break;
      if (range.from > from) showing.push({ part, from, to: range.from });
      from = Math.max(from, range.to);
    }
    if (end > from) showing.push({ part, from, to: end });
    covered = [...covered, { from: start, to: end }]
      .sort((a, b) => a.from - b.from)
      .reduce<{ from: number; to: number }[]>((joined, range) => {
        const last = joined.at(-1);
        if (last && range.from <= last.to) last.to = Math.max(last.to, range.to);
        else joined.push({ ...range });
        return joined;
      }, []);
  }
  return showing.filter(({ from, to }) => to - from > 1e-6).sort((a, b) => a.from - b.from);
}

/**
 * The edit with piece `pieceId` cut in two at project `time`; the second half gets id `id` and goes right after it.
 * Undefined where the piece isn't there, or where either half would be shorter than `shortest` seconds.
 */
export function splitAt(
  parts: Part[],
  pieceId: string,
  time: number,
  id: string,
  shortest = 0,
): Part[] | undefined {
  const index = parts.findIndex(
    (part) => part.pieceId === pieceId && time > part.offset && time < part.offset + lengthOf(part),
  );
  const part = parts[index];
  if (!part) return undefined;
  const at = toRecording(part, time);
  if (at - part.start < shortest || part.end - at < shortest) return undefined;
  return [
    ...parts.slice(0, index),
    { ...part, end: at },
    { ...part, pieceId: id, offset: time, start: at },
    ...parts.slice(index + 1),
  ];
}

/**
 * Snaps dragged `edges` to the nearest of `targets` within `distance`, all in seconds. `shift` moves the edges
 * there; `at` is the target snapped to. Undefined where none is close enough.
 */
export function snap(
  edges: number[],
  targets: number[],
  distance: number,
): { shift: number; at: number } | undefined {
  let best: { shift: number; at: number } | undefined;
  for (const edge of edges) {
    for (const target of targets) {
      const shift = target - edge;
      if (Math.abs(shift) <= distance && (!best || Math.abs(shift) < Math.abs(best.shift)))
        best = { shift, at: target };
    }
  }
  return best;
}

/** A file on the project's timeline, from `start` to `end`. */
export interface Block {
  file: string;
  url: string;
  /** Time within the source file where this visible piece begins. */
  sourceStart: number;
  start: number;
  end: number;
  /** Trimmed off: part of its recording the part doesn't play, shown where it would be. */
  trimmed?: true;
  /** Runs on from the block before it, cut where the part starts or ends. */
  joinsBefore?: true;
  /** Runs on into the block after it. */
  joinsAfter?: true;
}

/** One layer of a part: one of its recording's tracks. */
export interface Layer {
  kind: TrackKind;
  /** Which of the recording's tracks of `kind` it is, from 0. */
  index: number;
  /** A pinned window's track: the window, as it was when pinned. */
  window?: RecordedWindow;
  blocks: Block[];
}

const LAYER_ORDER: TrackKind[] = ["screen", "camera", "microphone", "systemAudio"];

/** Every file a part plays, by layer, where it plays on the project's timeline. */
export function layersOf(part: Part): Layer[] {
  const layers: Layer[] = [];
  const add = (kind: TrackKind, index: number, blocks: Block[], window?: RecordedWindow) => {
    const placed = blocks.flatMap((block) => clipToPart(part, block));
    if (placed.length > 0) layers.push({ kind, index, ...(window && { window }), blocks: placed });
  };
  const { lead, clips, camera, audio } = part.timeline;
  add(
    lead,
    0,
    clips.map((clip) => ({
      file: clip.file,
      url: clip.url,
      sourceStart: clip.fileStart ?? 0,
      start: clip.offset,
      end: clip.offset + clip.duration,
    })),
  );
  // The leading track is the first of its kind.
  const counts = new Map<TrackKind, number>([[lead, 1]]);
  for (const track of [
    ...(part.timeline.video
      ? part.timeline.video.filter((source) => !source.lead)
      : [{ kind: "camera" as const, clips: camera }]),
    ...audio,
  ] as { kind: TrackKind; clips: Clip[]; window?: RecordedWindow }[]) {
    const index = counts.get(track.kind) ?? 0;
    counts.set(track.kind, index + 1);
    add(track.kind, index, placeFollower(part.timeline, track.clips), track.window);
  }
  return layers.sort(
    (a, b) => LAYER_ORDER.indexOf(a.kind) - LAYER_ORDER.indexOf(b.kind) || a.index - b.index,
  );
}

/** Where on the project's timeline what's trimmed off a part shows: from `from` to `to`. */
export interface TrimBounds {
  from: number;
  to: number;
}

/**
 * Every file of a part's whole recording, by layer, where it would play around the part. Blocks are cut where the
 * part starts and ends; what's outside it is `trimmed`, and only shown `within` its bounds.
 */
export function wholeLayersOf(
  part: Part,
  within: TrimBounds = { from: -Infinity, to: Infinity },
): Layer[] {
  const from = part.offset;
  const to = part.offset + lengthOf(part);
  const whole = { ...part, offset: toProject(part, 0), start: 0, end: part.timeline.duration };
  return layersOf(whole).map((layer) => ({
    ...layer,
    blocks: layer.blocks.flatMap((block) => {
      const cuts = [
        cutBlock(block, Math.max(block.start, within.from), Math.min(block.end, from), true),
        cutBlock(block, Math.max(block.start, from), Math.min(block.end, to), false),
        cutBlock(block, Math.max(block.start, to), Math.min(block.end, within.to), true),
      ].flat();
      return cuts.map((cut, i) => ({
        ...cut,
        ...(i > 0 && { joinsBefore: true }),
        ...(i < cuts.length - 1 && { joinsAfter: true }),
      }));
    }),
  }));
}

/**
 * Where what's trimmed off `part` shows among the other pieces of its recording, so they don't cover each other:
 * up to the next piece's start, and from where the piece before it, with what's trimmed off its end, stops.
 */
export function trimBoundsOf(pieces: Part[], part: Part): TrimBounds {
  const from = part.offset;
  const to = part.offset + lengthOf(part);
  const bounds = { from: -Infinity, to: Infinity };
  for (const other of pieces) {
    if (other.pieceId === part.pieceId) continue;
    const end = other.offset + lengthOf(other);
    if (end <= from + 1e-6)
      bounds.from = Math.max(
        bounds.from,
        Math.min(toProject(other, other.timeline.duration), from),
      );
    else if (other.offset >= to - 1e-6) bounds.to = Math.min(bounds.to, other.offset);
  }
  return bounds;
}

/** One of a recording's layers across all of its pieces; each block is tagged with the piece it's in. */
export interface GroupLayer extends Omit<Layer, "blocks"> {
  blocks: (Block & { pieceId: string })[];
}

/** The layers of a recording's pieces together, with each piece cut where it starts and ends. */
export function groupLayersOf(pieces: Part[]): GroupLayer[] {
  const layers = new Map<string, GroupLayer>();
  for (const part of pieces) {
    for (const { kind, index, window, blocks } of wholeLayersOf(part, trimBoundsOf(pieces, part))) {
      const key = `${kind}:${index}`;
      const layer = layers.get(key) ?? { kind, index, ...(window && { window }), blocks: [] };
      layers.set(key, layer);
      layer.blocks.push(...blocks.map((block) => ({ ...block, pieceId: part.pieceId })));
    }
  }
  return [...layers.values()].sort(
    (a, b) => LAYER_ORDER.indexOf(a.kind) - LAYER_ORDER.indexOf(b.kind) || a.index - b.index,
  );
}

/** What of `block` is between `start` and `end`. */
function cutBlock(block: Block, start: number, end: number, trimmed: boolean): Block[] {
  if (end - start <= 1e-6) return [];
  return [
    {
      ...block,
      sourceStart: block.sourceStart + start - block.start,
      start,
      end,
      ...(trimmed && { trimmed: true as const }),
    },
  ];
}

/** A block on the recording's own timeline, cut to what the part plays and moved onto the project's timeline. */
function clipToPart(part: Part, block: Block): Block[] {
  const from = Math.max(block.start, part.start);
  const to = Math.min(block.end, part.end);
  if (to - from <= 1e-6) return [];
  return [
    {
      ...block,
      sourceStart: block.sourceStart + from - block.start,
      start: toProject(part, from),
      end: toProject(part, to),
    },
  ];
}

/** Where a following track's clips play on the recording's timeline: wherever they overlap a leading clip. */
function placeFollower(timeline: Timeline, clips: Clip[]): Block[] {
  const blocks: Block[] = [];
  for (const clip of clips) {
    // Where the last piece of this file ended on session time, so pieces that run on are joined.
    let joined: number | undefined;
    for (const lead of timeline.clips) {
      const from = Math.max(clip.start, lead.start);
      const to = Math.min(clip.start + clip.duration, lead.start + lead.duration);
      if (to <= from) continue;
      const start = lead.offset + from - lead.start;
      const last = blocks.at(-1);
      if (last && joined !== undefined && Math.abs(from - joined) < 1e-6)
        last.end = start + to - from;
      else
        blocks.push({
          file: clip.file,
          url: clip.url,
          sourceStart: from - clip.start,
          start,
          end: start + to - from,
        });
      joined = to;
    }
  }
  return blocks;
}

/** One of an effect's spans, on the project's timeline. `index` is its place in the recording's spans. */
export interface SpanBlock {
  pieceId: string;
  recordingId: string;
  index: number;
  start: number;
  end: number;
}

/** Where an effect is on, on the project's timeline, in the parts it can be drawn over. */
export function spanBlocks(
  parts: Part[],
  annotations: (
    recordingId: string,
  ) => Partial<Record<EffectKind, readonly AnnotationSpan[]>> | undefined,
  kind: EffectKind,
): SpanBlock[] {
  return parts.flatMap((part) => {
    if (!part.timeline.input) return [];
    return (annotations(part.recordingId)?.[kind] ?? []).flatMap((span, index) => {
      const [from, to] = [Math.max(span.start, part.start), Math.min(span.end, part.end)];
      return to > from
        ? [
            {
              pieceId: part.pieceId,
              recordingId: part.recordingId,
              index,
              start: toProject(part, from),
              end: toProject(part, to),
            },
          ]
        : [];
    });
  });
}
