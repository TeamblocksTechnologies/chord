/**
 * Plays a project's edit, pieces of its recordings placed on one timeline. Where pieces overlap the one on top plays;
 * between them nothing does, and frames keep time. Within a piece, the leading track's element is the clock, and the other tracks are kept in step with it each frame. Each frame is drawn to a canvas
 * through a `Stage`: the screen through a virtual camera that zooms in on what `focusedWindow` mode showed (see
 * `camera.ts`), the pointer effects from the recorded mouse and keys (see `effects.ts`), and the camera.
 */
import type { CaptionStyle } from "#features/transcription/domain/captions";
import type { CaptionLine } from "./captions.ts";
import type { Annotations } from "#features/editing/domain/annotations";
import type { LoadedSession } from "../contracts/playback.ts";
import type { Cut } from "#features/editing/domain/cuts";
import type { AudioGains, AudioLevels, AudioSources } from "#features/editing/domain/audioSettings";
import type { VisualLayer } from "#features/editing/domain/visualLayers";
import type { ClipLayout } from "#features/editing/domain/clipLayout";
import type { CameraLayout, RecordingBackdrop } from "#project-document/domain/recording";
import type { CameraTreatment } from "./background.ts";
import type { ExportSource } from "#features/exporting/renderer/exporter";
import { Stage, type FeedPlacement, type StageImage } from "./stage.ts";
import {
  type Clip,
  type Part,
  type Timeline,
  buildTimeline,
  clipIndexAt,
  fileTime,
  followerAt,
  followsWindow,
  lengthOf,
  partIndexAt,
  sequence,
  toProject,
  toRecording,
  withCuts,
} from "./timeline.ts";

/** The stage's own shape while following a window. */
const FOLLOW_ASPECT = 16 / 9;
/** How far a following track may drift from the leading one before it's moved back, in seconds. */
const DRIFT = 0.1;
/**
 * How far before where it was put a media element can report being, in seconds. Elements keep time in whole
 * microseconds, so one just moved to where a piece on top ends reads a hair before it, back in that piece.
 */
const ROUNDING = 1e-5;

/** The elements a player plays through. The view owns them. */
export interface PlayerElements {
  /** The screen recording's frame source; kept in the document but not shown. */
  screen: HTMLVideoElement;
  canvas: HTMLCanvasElement;
  camera: HTMLVideoElement;
  /** Leads recordings with only audio. */
  audio: HTMLAudioElement;
}

/** A recording to play: its id and session folder. */
export interface PlayerRecording {
  id: string;
  directory: string;
}

/**
 * A piece of the edit to play. With `cuts`, its recording plays with them left out, and `start` and `end` are where it
 * plays once they close up.
 */
export interface PlayerPiece {
  id: string;
  recordingId: string;
  start: number;
  end: number | null;
  offset?: number;
  cameraLayout?: CameraLayout;
  layout?: ClipLayout;
  cuts?: Cut[];
}

export class Player {
  parts = $state.raw<Part[]>([]);
  /** The piece playing now; null between pieces. */
  part = $state.raw<Part | null>(null);
  duration = $state(0);
  loading = $state(true);
  error = $state<string | null>(null);
  playing = $state(false);
  time = $state(0);
  /** The stage's own width / height, from what's recorded. It may be shown at another; see `frame`. */
  aspect = $state(16 / 9);
  /** How loud the preview plays, from 0 to 1. Only the preview: an export is unaffected. */
  volume = $state(1);
  muted = $state(false);
  /** How fast the preview plays. Only the preview: an export is unaffected. */
  rate = $state(1);
  /** Saved source levels, separate from the preview's master volume. */
  audioLevels: AudioLevels = () => 1;
  /** What leveling multiplies each source by. A volume stops at 1, so a gain above it is applied in Web Audio. */
  audioGains: AudioGains = () => 1;
  /** Where each source's audio plays from: its recorded file, or the copy with its noise reduced. Read as it plays. */
  audioSources: AudioSources = (_recording, _kind, _index, url) => url;
  /**
   * Stretches of the timeline playing skips, in order and apart. One the playhead is put into plays on to its end, so
   * what's skipped can still be watched.
   */
  skips: Cut[] = [];
  /** The skipped stretch the playhead was put into, playing through. */
  #through: Cut | null = null;

  #elements: PlayerElements;
  #loaded = new Map<string, Timeline>();
  /** Each recording's timeline with its cuts left out, as last played, so the same cuts keep the same timeline. */
  #cut = new Map<string, { cuts: string; timeline: Timeline }>();
  /** Frames followed windows at the stage's shape, as shown. */
  #stage = new Stage(FOLLOW_ASPECT);
  /** Set while moving on to what plays next, so it's only done once. */
  #switching = false;
  /** When the last frame was, from `requestAnimationFrame`. */
  #lastFrame = performance.now();
  #followers: HTMLAudioElement[] = [];
  /** Made when a source first needs a gain other than 1; before then the elements play as they always did. */
  #audio?: AudioContext;
  #gainNodes = new Map<HTMLMediaElement, GainNode>();
  #mask = document.createElement("video");
  #videos: { element: HTMLVideoElement; mask: HTMLVideoElement }[] = [];
  #partIndex = -1;
  #clipIndex = -1;
  #frameRequest = 0;
  /** Set while dragging the scrubber, so following tracks stay on the exact frame. */
  #scrubbing = false;
  #destroyed = false;

  constructor(elements: PlayerElements) {
    this.#elements = elements;
    this.#mask.crossOrigin = "anonymous";
    this.#mask.muted = true;
    this.#mask.playsInline = true;
    // Chromium can report HAVE_ENOUGH_DATA for a detached video while drawImage reads empty pixels.
    this.#mask.className = "pointer-events-none absolute size-px opacity-0";
    this.#mask.setAttribute("aria-hidden", "true");
    elements.camera.parentElement?.append(this.#mask);
    // Web Audio only plays media from a CORS-enabled source, and a gain can be added to the audio at any time.
    elements.screen.crossOrigin =
      elements.camera.crossOrigin =
      elements.audio.crossOrigin =
        "anonymous";
    for (const element of [elements.screen, elements.camera, elements.audio])
      element.addEventListener("ended", this.#onEnded);
  }

  get lead() {
    return this.part?.timeline.lead;
  }

  /** When each recording's pointer effects are on. Read every frame, so changes show at once. */
  set annotations(annotations: (recordingId: string) => Annotations | undefined) {
    this.#stage.annotations = annotations;
  }

  get annotations(): (recordingId: string) => Annotations | undefined {
    return this.#stage.annotations;
  }

  set layers(layers: (recordingId: string) => VisualLayer[] | undefined) {
    this.#stage.layers = layers;
  }

  /** Shows every recorded video feed side by side rather than each piece's layout. */
  set showsEveryFeed(shows: boolean) {
    this.#stage.showsEveryFeed = shows;
  }
  /** Where the frame on show placed each feed of its layout, in canvas pixels. */
  get placements(): FeedPlacement[] {
    return this.#stage.placements;
  }

  set backgrounds(backgrounds: Record<string, CameraTreatment>) {
    this.#stage.backgrounds = backgrounds;
  }

  set backdrops(backdrops: Record<string, RecordingBackdrop>) {
    this.#stage.backdrops = backdrops;
  }

  set captions(captions: CaptionLine[]) {
    this.#stage.captions = captions;
  }

  set captionStyle(style: CaptionStyle) {
    this.#stage.captionStyle = style;
  }

  /** Loads `recordings` and plays `pieces` of them, skipping any that can't be played. Fails only when none can. */
  async load(
    recordings: PlayerRecording[],
    pieces: PlayerPiece[],
    read: (directory: string) => Promise<LoadedSession>,
    initialTime = 0,
  ): Promise<void> {
    try {
      let failure: unknown = new Error("This project has no recordings to play");
      const loaded = await Promise.all(
        recordings.map(async ({ id, directory }) => {
          try {
            const timeline = await buildTimeline(await read(directory), mediaDuration);
            return timeline && { recordingId: id, timeline };
          } catch (error) {
            failure = error;
            return null;
          }
        }),
      );
      if (this.#destroyed) return;
      for (const recording of loaded) {
        if (!recording) continue;
        this.#loaded.set(recording.recordingId, recording.timeline);
      }
      if (this.#loaded.size === 0) throw failure;
      const timelines = [...this.#loaded.values()];
      this.#followers = Array.from(
        { length: Math.max(...timelines.map((timeline) => timeline.audio.length)) },
        () => {
          const element = new Audio();
          element.crossOrigin = "anonymous";
          return element;
        },
      );
      const count = Math.max(...timelines.map((timeline) => this.#extraSources(timeline).length));
      this.#videos = Array.from({ length: count }, () => {
        const create = () => {
          const video = document.createElement("video");
          video.crossOrigin = "anonymous";
          video.muted = true;
          video.playsInline = true;
          video.className = "pointer-events-none absolute size-px opacity-0";
          video.setAttribute("aria-hidden", "true");
          this.#elements.camera.parentElement?.append(video);
          return video;
        };
        return { element: create(), mask: create() };
      });
      this.#arrange(pieces);
      if (this.parts.length > 0) {
        // The stage takes its shape from the first piece, wherever it is.
        await this.seek(this.parts[0]!.offset);
        this.aspect = this.#stageAspect();
        await this.seek(initialTime);
      }
      this.#frameRequest = requestAnimationFrame(this.#frame);
    } catch (error) {
      this.error = message(error);
    } finally {
      this.loading = false;
    }
  }

  /** Plays `pieces` from now on, staying where it was on the timeline where it can. */
  async arrange(pieces: PlayerPiece[]): Promise<void> {
    if (this.loading || this.error) return;
    const time = this.time;
    const previous = this.part;
    this.#arrange(pieces);
    const partIndex = this.#partAt(time);
    const part = this.parts[partIndex];
    // Layout edits (and edits elsewhere) keep the current media and decoded frame when its timing is unchanged.
    // Even seeking to the same time can discard that frame while Chromium decodes it again.
    if (
      part &&
      previous &&
      part.timeline === previous.timeline &&
      part.start === previous.start &&
      part.end === previous.end &&
      part.offset === previous.offset
    ) {
      this.#partIndex = partIndex;
      this.part = part;
      return;
    }
    // Timing changes resolve the active part and clip again before seeking.
    this.#partIndex = this.#clipIndex = -1;
    if (this.parts.length === 0) {
      this.pause();
      this.part = null;
      this.time = 0;
      return;
    }
    await this.seek(Math.min(time, this.duration));
  }

  #arrange(pieces: PlayerPiece[]): void {
    const { parts, duration } = this.sequence(pieces);
    this.parts = parts;
    this.duration = duration;
    // A followed window floats on a backdrop; whole recordings sit on black.
    this.#stage.backdrop = followsWindow(parts) ? "gradient" : "black";
  }

  /** How `pieces` would play, such as to export them, without playing them. */
  sequence(pieces: PlayerPiece[]): { parts: Part[]; duration: number } {
    return sequence(
      pieces.flatMap(({ cuts, ...piece }) => {
        const timeline = this.timeline(piece.recordingId, cuts);
        return timeline ? [{ ...piece, timeline }] : [];
      }),
    );
  }

  /** A loaded recording's timeline, with `cuts` left out. */
  timeline(recordingId: string, cuts: Cut[] = []): Timeline | undefined {
    const timeline = this.#loaded.get(recordingId);
    if (!timeline || cuts.length === 0) return timeline;
    const key = JSON.stringify(cuts);
    const cached = this.#cut.get(recordingId);
    if (cached?.cuts === key) return cached.timeline;
    const cut = withCuts(timeline, cuts);
    this.#cut.set(recordingId, { cuts: key, timeline: cut });
    return cut;
  }

  /**
   * What the player shows, as something to draw again: its arrangement and the effects, backgrounds and captions on
   * its stage now, so a still of it matches the preview.
   */
  source(): ExportSource {
    const stage = this.#stage;
    return {
      parts: this.parts,
      duration: this.duration,
      aspect: this.aspect,
      annotations: stage.annotations,
      layers: stage.layers,
      backgrounds: stage.backgrounds,
      backdrops: stage.backdrops,
      captions: stage.captions,
      captionStyle: stage.captionStyle,
    };
  }

  /** Frames followed windows at `aspect`, the stage's width / height as it's shown. */
  frame(aspect: number): void {
    this.#stage.aspect = aspect;
  }

  destroy(): void {
    this.#destroyed = true;
    cancelAnimationFrame(this.#frameRequest);
    for (const element of [
      this.#elements.screen,
      this.#elements.camera,
      this.#elements.audio,
      this.#mask,
      ...this.#videoElements(),
      ...this.#followers,
    ]) {
      element.pause();
      element.removeAttribute("src");
      element.load();
    }
    this.#mask.remove();
    for (const element of this.#videoElements()) element.remove();
    void this.#audio?.close();
  }

  toggle(): void {
    if (this.playing) this.pause();
    else this.play();
  }

  play(): void {
    if (this.parts.length === 0) return;
    if (this.time >= this.duration - 0.05) void this.seek(0);
    this.playing = true;
    if (this.part)
      void this.#lead()
        .play()
        .catch(() => {});
  }

  pause(): void {
    this.playing = false;
    this.#pauseAll();
  }

  async seek(time: number): Promise<void> {
    if (this.parts.length === 0) return;
    time = Math.min(Math.max(time, 0), this.duration);
    this.time = time;
    this.#through = this.skips.find((skip) => time > skip.start + 1e-3 && time < skip.end) ?? null;
    const partIndex = this.#partAt(time);
    if (partIndex < 0) {
      // Between pieces, nothing plays.
      this.#pauseAll();
      this.#partIndex = this.#clipIndex = -1;
      this.part = null;
      return;
    }
    const part = this.parts[partIndex]!;
    const local = Math.min(toRecording(part, time), part.end);
    const clipIndex = this.#clipAt(part, local);
    await this.#loadClip(partIndex, clipIndex);
    this.#lead().currentTime = fileTime(part.timeline.clips[clipIndex]!, local);
    if (this.playing)
      void this.#lead()
        .play()
        .catch(() => {});
  }

  /** Scrubbing seeks following tracks to the exact frame shown rather than letting them drift. */
  set scrubbing(value: boolean) {
    this.#scrubbing = value;
  }

  // MARK: Clock

  /** The part to play at `time`. At the very end, the one ending there, so its last frame stays. */
  #partAt(time: number): number {
    const index = partIndexAt(this.parts, time);
    if (index >= 0 || time < this.duration - 1e-6) return index;
    return this.parts.findIndex((part) => part.offset + lengthOf(part) >= this.duration - 1e-6);
  }

  /** The element whose time is the playback time. */
  #lead(): HTMLMediaElement {
    const lead = this.lead;
    return lead === "screen"
      ? this.#elements.screen
      : lead === "camera"
        ? this.#elements.camera
        : this.#elements.audio;
  }

  #pauseAll(): void {
    for (const element of [
      this.#elements.screen,
      this.#elements.camera,
      this.#elements.audio,
      this.#mask,
      ...this.#videoElements(),
      ...this.#followers,
    ])
      element.pause();
  }

  /** The leading clip at `local` on the part's recording's timeline. */
  #clipAt(part: Part, local: number): number {
    return clipIndexAt(part.timeline.clips, local);
  }

  /** Where the leading element is on the part's recording's timeline, within what the part plays. */
  #local(): number {
    const part = this.part!;
    const clip = part.timeline.clips[this.#clipIndex];
    if (!clip) return part.start;
    const within = Math.min(
      Math.max(this.#lead().currentTime - (clip.fileStart ?? 0), 0),
      clip.duration,
    );
    return Math.min(Math.max(clip.offset + within, part.start), part.end);
  }

  /** Moves on to what plays at `time`, or stops at the end. */
  async #switchTo(time: number): Promise<void> {
    if (this.#switching) return;
    this.#switching = true;
    try {
      if (time < this.duration - 1e-3) await this.seek(time);
      else {
        this.pause();
        this.time = this.duration;
      }
    } finally {
      this.#switching = false;
    }
  }

  async #loadClip(partIndex: number, clipIndex: number): Promise<void> {
    if (partIndex === this.#partIndex && clipIndex === this.#clipIndex) return;
    if (partIndex !== this.#partIndex) {
      // Another recording may lead with another element, and has its own following tracks.
      this.#pauseAll();
      this.#partIndex = partIndex;
      this.part = this.parts[partIndex]!;
    }
    this.#clipIndex = clipIndex;
    const element = this.#lead();
    const { recordingId, timeline } = this.part!;
    const raw = timeline.clips[clipIndex]!.url;
    const url =
      timeline.lead === "microphone" || timeline.lead === "systemAudio"
        ? this.audioSources(recordingId, timeline.lead, 0, raw)
        : raw;
    // Pieces of one recording play on from the file already loaded.
    if (element.dataset.url === url && element.readyState >= HTMLMediaElement.HAVE_METADATA) return;
    // Following tracks tell what they have loaded by this, and the camera follows in some recordings.
    element.dataset.url = url;
    element.src = url;
    await new Promise<void>((resolve, reject) => {
      element.addEventListener("loadedmetadata", () => resolve(), { once: true });
      element.addEventListener(
        "error",
        () => reject(new Error(element.error?.message || "This recording can't be played")),
        {
          once: true,
        },
      );
    });
  }

  #onEnded = (event: Event): void => {
    if (event.target === this.#lead()) void this.#next();
  };

  /** Plays on from where the leading clip ended: its next clip, or whatever's after the part. */
  async #next(): Promise<void> {
    const part = this.part;
    if (!part || !this.playing || this.#switching) return;
    const next = part.timeline.clips[this.#clipIndex + 1];
    if (!next || next.offset >= part.end - 1e-3)
      return this.#switchTo(part.offset + lengthOf(part));
    this.#switching = true;
    try {
      await this.#loadClip(this.#partIndex, this.#clipIndex + 1);
      this.#lead().currentTime = next.fileStart ?? 0;
      if (this.playing)
        void this.#lead()
          .play()
          .catch(() => {});
    } finally {
      this.#switching = false;
    }
  }

  #frame = (now: number): void => {
    this.#frameRequest = requestAnimationFrame(this.#frame);
    // Between pieces no element keeps time, so frames do. A long wait, such as in a hidden window, isn't counted.
    const elapsed = Math.min((now - this.#lastFrame) / 1000, 0.1) * this.rate;
    this.#lastFrame = now;
    this.#applyPreview();
    if (this.#switching || this.parts.length === 0) return;
    const part = this.part;
    const local = part ? this.#local() : 0;
    const time = part ? toProject(part, local) : this.playing ? this.time + elapsed : this.time;
    // A clip that ended while something else was switching is moved on from here, as is one a cut ends early.
    if (this.playing && part && (this.#lead().ended || this.#cutOff(part)))
      return void this.#next();
    if (this.playing) {
      const skip = this.#skipAt(time);
      if (skip) return void this.#switchTo(skip.end);
      // What plays changes where a piece ends (trimmed pieces end before their recording does), where one starts
      // between pieces, and where one goes on top. Whatever's next takes over the elements, so this frame is done.
      const ended = !!part && local >= part.end - 1e-3;
      const at = ended ? part.offset + lengthOf(part) : time + ROUNDING;
      if (ended || this.#partAt(at) !== this.#partIndex) return void this.#switchTo(at);
    }
    this.time = time;
    if (!part) return this.#draw(null);
    const clip = part.timeline.clips[this.#clipIndex]!;
    // The session time of the recording playing, by its leading clip.
    const sessionTime = clip.start + local - clip.offset;
    // The camera is the stage when it leads, and a bubble over the screen while it has a clip.
    const { lead } = part.timeline;
    if (lead === "microphone" || lead === "systemAudio")
      this.#retargetLead(part.recordingId, lead, clip.url);
    const cameraShown =
      lead === "camera" ||
      (lead === "screen" && this.#follow(this.#elements.camera, part.timeline.camera, sessionTime));
    let showCamera = cameraShown;
    let maskShown = false;
    const background = this.#stage.backgrounds[part.recordingId];
    const cameraClip =
      lead === "camera" ? clip : followerAt(part.timeline.camera, sessionTime)?.clip;
    const maskUrl =
      cameraClip && background?.settings.enabled ? background.masks[cameraClip.file] : undefined;
    if (cameraShown && cameraClip && maskUrl) {
      // The mask is laid out like the camera's file, so it follows on the file's own time.
      const maskClip = {
        ...cameraClip,
        start: 0,
        duration: (cameraClip.fileStart ?? 0) + cameraClip.duration,
        url: maskUrl,
      };
      maskShown = this.#follow(this.#mask, [maskClip], this.#elements.camera.currentTime, 0.025);
      // Wait for the matching mask instead of flashing an unprocessed camera while a seek decodes.
      if (!hasFrame(this.#mask) || this.#mask.seeking || this.#elements.camera.seeking)
        showCamera = false;
    } else this.#mask.pause();
    const feeds: Record<string, StageImage | null> = {};
    const masks: Record<string, StageImage | null> = {};
    const sources = this.#extraSources(part.timeline);
    this.#videos.forEach(({ element, mask }, index) => {
      const source = sources[index];
      if (!source || !this.#follow(element, source.clips, sessionTime)) {
        element.pause();
        mask.pause();
        return;
      }
      const follower = followerAt(source.clips, sessionTime);
      const maskUrl =
        source.kind === "camera" && background?.settings.enabled && follower
          ? background.masks[follower.clip.file]
          : undefined;
      if (maskUrl && follower) {
        this.#follow(
          mask,
          [{ ...follower.clip, start: 0, url: maskUrl }],
          element.currentTime,
          0.025,
        );
        if (!hasFrame(mask) || mask.seeking || element.seeking) return;
        masks[source.id] = imageOf(mask);
      } else mask.pause();
      feeds[source.id] = imageOf(element);
    });
    this.#draw(part, clip, local, showCamera, maskShown, feeds, masks);
    // Each following audio track plays from its own source, counted among the tracks of its kind as levels are.
    const counts = new Map<string, number>([[lead, 1]]);
    this.#followers.forEach((element, i) => {
      const track = part.timeline.audio[i];
      let source: ((url: string) => string) | undefined;
      if (track) {
        const index = counts.get(track.kind) ?? 0;
        counts.set(track.kind, index + 1);
        source = (url) => this.audioSources(part.recordingId, track.kind, index, url);
      }
      this.#follow(element, track?.clips ?? [], sessionTime, DRIFT, source);
    });
  };

  #retargeting = false;

  /** Plays an audio-led recording from its other source, such as a cleaned copy, from where it is, once that changes. */
  #retargetLead(recordingId: string, kind: string, rawUrl: string): void {
    const element = this.#elements.audio;
    const url = this.audioSources(recordingId, kind, 0, rawUrl);
    if (this.#retargeting || element.dataset.url === undefined || element.dataset.url === url)
      return;
    this.#retargeting = true;
    const [time, playing] = [element.currentTime, !element.paused];
    element.dataset.url = url;
    element.src = url;
    element.addEventListener(
      "loadedmetadata",
      () => {
        element.currentTime = time;
        if (playing && this.playing) void element.play().catch(() => {});
        this.#retargeting = false;
      },
      { once: true },
    );
    element.addEventListener(
      "error",
      () => {
        this.#retargeting = false;
      },
      { once: true },
    );
  }

  /** The skipped stretch playing has reached at `time`, unless it's the one being played through. */
  #skipAt(time: number): Cut | undefined {
    const through = this.#through;
    if (through && (time < through.start - 1e-3 || time >= through.end - 1e-3))
      this.#through = null;
    return this.skips.find(
      (skip) =>
        time >= skip.start &&
        time < skip.end - 1e-3 &&
        !(this.#through && skip.start === this.#through.start),
    );
  }

  /** Whether the leading element has played past where a cut ends its clip. */
  #cutOff(part: Part): boolean {
    const clip = part.timeline.clips[this.#clipIndex];
    return (
      !!clip?.endsEarly && this.#lead().currentTime >= (clip.fileStart ?? 0) + clip.duration - 1e-3
    );
  }

  /** Puts the preview's volume and speed on every element; loading a file resets an element's speed. */
  #applyPreview(): void {
    const { screen, camera, audio } = this.#elements;
    const volume = this.muted ? 0 : this.volume;
    const levels = new Map<HTMLMediaElement, number>();
    const gains = new Map<HTMLMediaElement, number>();
    if (this.part) {
      const { recordingId, timeline } = this.part;
      levels.set(this.#lead(), this.audioLevels(recordingId, timeline.lead, 0));
      gains.set(this.#lead(), this.audioGains(recordingId, timeline.lead, 0));
      const counts = new Map<string, number>([[timeline.lead, 1]]);
      timeline.audio.forEach((track, i) => {
        const index = counts.get(track.kind) ?? 0;
        counts.set(track.kind, index + 1);
        levels.set(this.#followers[i]!, this.audioLevels(recordingId, track.kind, index));
        gains.set(this.#followers[i]!, this.audioGains(recordingId, track.kind, index));
      });
    }
    for (const element of [
      screen,
      camera,
      audio,
      this.#mask,
      ...this.#videoElements(),
      ...this.#followers,
    ]) {
      if (element.playbackRate !== this.rate)
        element.defaultPlaybackRate = element.playbackRate = this.rate;
      const level = volume * (levels.get(element) ?? 1);
      if (element.volume !== level) element.volume = level;
      this.#applyGain(element, gains.get(element) ?? 1);
    }
  }

  /** Plays `element` at `gain` times its volume. */
  #applyGain(element: HTMLMediaElement, gain: number): void {
    let node = this.#gainNodes.get(element);
    if (!node) {
      if (gain === 1) return;
      const context = (this.#audio ??= new AudioContext());
      node = context.createGain();
      context.createMediaElementSource(element).connect(node);
      node.connect(context.destination);
      this.#gainNodes.set(element, node);
    }
    if (node.gain.value !== gain) node.gain.value = gain;
    if (this.#audio?.state === "suspended") void this.#audio.resume().catch(() => {});
  }

  /** Keeps `element` on the clip of `clips` at `sessionTime`. Returns whether it has one there. */
  #follow(
    element: HTMLMediaElement,
    clips: Clip[],
    sessionTime: number,
    drift = DRIFT,
    source?: (url: string) => string,
  ): boolean {
    const at = followerAt(clips, sessionTime);
    if (!at) {
      element.pause();
      return false;
    }
    const url = source ? source(at.clip.url) : at.clip.url;
    if (element.dataset.url !== url) {
      element.dataset.url = url;
      element.src = url;
      element.currentTime = at.time;
    } else {
      // Held still, it should show the exact frame; while playing, small drift is let be, as seeking stutters.
      const exact = this.#scrubbing || !this.playing || at.early;
      if (Math.abs(element.currentTime - at.time) > (exact ? 0.01 : drift))
        element.currentTime = at.time;
    }
    const playing = this.playing && !at.early && !this.#lead().paused;
    if (playing && element.paused) void element.play().catch(() => {});
    else if (!playing && !element.paused) element.pause();
    return true;
  }

  #extraSources(timeline: Timeline) {
    return (timeline.video ?? []).filter(
      (source) => !source.lead && !(source.kind === "camera" && source.index === 0),
    );
  }

  #videoElements(): HTMLVideoElement[] {
    return this.#videos.flatMap(({ element, mask }) => [element, mask]);
  }

  // MARK: Drawing

  /** Following a window frames it at a set shape; otherwise the stage takes the first recording's own. */
  #stageAspect(): number {
    const element = this.#lead();
    if (followsWindow(this.parts)) return FOLLOW_ASPECT;
    if (element instanceof HTMLVideoElement && element.videoWidth > 0)
      return element.videoWidth / element.videoHeight;
    return 16 / 9;
  }

  /** Draws the stage at `time` on the recording's own timeline; with no part, just its backdrop. */
  #draw(
    part: Part | null,
    clip?: Clip,
    time?: number,
    cameraShown = false,
    maskShown = false,
    feeds?: Record<string, StageImage | null>,
    masks?: Record<string, StageImage | null>,
  ): void {
    const { canvas, screen, camera } = this.#elements;
    const width = Math.round(canvas.clientWidth * devicePixelRatio);
    const height = Math.round(canvas.clientHeight * devicePixelRatio);
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    // One snapshot of the current frame, so what's measured is exactly what's drawn: the video's current frame can
    // change between reads.
    const frame =
      part?.timeline.lead === "screen" && hasFrame(screen) ? new VideoFrame(screen) : null;
    try {
      this.#stage.draw(canvas.getContext("2d")!, {
        part,
        clip,
        time,
        screen: frame,
        camera: cameraShown ? imageOf(camera) : null,
        mask: maskShown ? imageOf(this.#mask) : null,
        feeds,
        masks,
      });
    } finally {
      frame?.close();
    }
  }
}

function hasFrame(video: HTMLVideoElement): boolean {
  return video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA && video.videoWidth > 0;
}

function imageOf(video: HTMLVideoElement): StageImage | null {
  return hasFrame(video)
    ? { image: video, width: video.videoWidth, height: video.videoHeight, time: video.currentTime }
    : null;
}

/** How long a media file plays, in seconds; 0 when it can't be read. */
export function mediaDuration(url: string): Promise<number> {
  return new Promise((resolve) => {
    const probe = document.createElement("video");
    probe.preload = "metadata";
    probe.onloadedmetadata = () => resolve(probe.duration);
    probe.onerror = () => resolve(0);
    probe.src = url;
  });
}

/** An error's message, without the prefix Electron adds to errors from the main process. */
function message(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);
  return text.replace(/^Error invoking remote method '[^']*': (Error: )?/, "");
}
