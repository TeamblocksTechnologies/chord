import {
  MANIFEST_FILE,
  type Manifest,
  type AudioSource,
  type MethodName,
  type MethodParams,
  type MethodResult,
  type ScreenPreview,
} from "@teamblocks.dev/chord-recorder-protocol";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { readFile, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  BrowserWindow,
  app,
  desktopCapturer,
  globalShortcut,
  ipcMain,
  net,
  session,
  shell,
  webContents,
} from "electron";
import type { BackgroundState } from "#features/background-removal/contracts/backgroundRemoval";
import { RecordingBackgrounds } from "#features/background-removal/main/recordingBackgrounds";
import { processBackground } from "#features/background-removal/main/backgroundProcessing";
import type { TranscriptionState, WordAddress } from "#features/transcription/domain/captions";
import { isProjectId } from "#features/projects/contracts/projects";
import { handleApps } from "#platform/main/apps";
import { HelperRequestError, RecorderHelper, helperBinary } from "#platform/main/helper";
import { BackgroundModelLibrary } from "#features/background-removal/main/backgroundModels";
import { NoiseModelLibrary } from "#features/audio-processing/main/noiseModels";
import {
  appleIsolationStatus,
  processNoise,
} from "#features/audio-processing/main/noiseProcessing";
import { cleanedFile } from "#features/audio-processing/main/noiseFiles";
import { RecordingNoise } from "#features/audio-processing/main/recordingNoise";
import { audioDenoised } from "#features/editing/domain/audioSettings";
import {
  resolveNoiseEngine,
  type NoiseState,
} from "#features/audio-processing/contracts/noiseReduction";
import { isInside, recordingsFolder } from "#features/recording/main/capture";
import { handleExport } from "#features/exporting/main/export";
import { setAppMenu } from "./menu.ts";
import { ModelLibrary } from "#features/transcription/main/models";
import { preferencesFrom } from "#features/settings/domain/preferences";
import { isTranscriptionModelId } from "#features/transcription/domain/transcription";
import {
  decodedAudio,
  handleMediaScheme,
  levelTrack,
  loadSession,
  registerMediaScheme,
} from "#media-engine/main/playback";
import { PreferenceStore } from "#features/settings/main/preferences";
import { ProjectLibrary } from "#features/projects/main/projects";
import { ThumbnailWindow } from "#features/projects/main/thumbnailWindow";
import { ProjectThumbnails } from "#features/projects/main/thumbnails";
import { leadClips } from "#media-engine/main/recordingClips";
import { RecordingTranscriptions } from "#features/transcription/main/recordingTranscriptions";
import { TranscriptSearch } from "#features/transcription/main/transcriptSearch";
import { handleToolbar } from "#features/recording/main/toolbar";
import {
  appleSpeech,
  mediaDuration,
  transcribe,
  transcribeTimed,
  type DownloadedModel,
} from "#features/transcription/main/transcriber";
import { wav } from "#shared/main/wav";
import { loadSurface, preloadPath } from "#platform/main/windows";
import { handleUpdates } from "#features/settings/main/updates";
import { tasks } from "#platform/main/tasks";

// Keep in sync with --title-bar-height in the renderer's app.css.
const TITLE_BAR_HEIGHT = 40;
const BACKGROUND_COLOR = "#0a0a0a"; // neutral-950
const TRAFFIC_LIGHT_SIZE = 14;
const TRANSPARENT = "#00000000";

// Blur the desktop behind the window where the OS supports it: vibrancy on
// macOS, acrylic on Windows 11. The renderer tints over it with a translucent
// background. Linux has no native equivalent, so it stays opaque.
const BLUR_OPTIONS: Electron.BrowserWindowConstructorOptions =
  process.platform === "darwin"
    ? { vibrancy: "hud", visualEffectState: "active", backgroundColor: TRANSPARENT }
    : process.platform === "win32"
      ? { backgroundMaterial: "acrylic", backgroundColor: TRANSPARENT }
      : { backgroundColor: BACKGROUND_COLOR };

let mainWindow: BrowserWindow | undefined;

/** What thumbnails wait for, so they never slow a recording or an export. Filled in as they're set up. */
const rendering = {
  recording: () => false,
  exporting: () => false,
  busy() {
    return this.recording() || this.exporting();
  },
};
let onMainClosed = () => {};

function createWindow(): BrowserWindow {
  // Utility panels can outlive the main window. Opening it must restore the app's Dock presence.
  const showInDock = () => {
    if (app.dock && !app.dock.isVisible()) void app.dock.show();
  };
  showInDock();
  const window = new BrowserWindow({
    width: 1100,
    height: 800,
    minWidth: 320,
    minHeight: 340,
    title: "Chord",
    ...BLUR_OPTIONS,
    // Hide the native title bar so the renderer draws it. macOS keeps the
    // traffic lights; Windows and Linux draw their controls as an overlay.
    titleBarStyle: "hidden",
    ...(process.platform === "darwin"
      ? {
          trafficLightPosition: {
            x: 14,
            y: (TITLE_BAR_HEIGHT - TRAFFIC_LIGHT_SIZE) / 2,
          },
        }
      : {
          titleBarOverlay: {
            color: process.platform === "win32" ? TRANSPARENT : BACKGROUND_COLOR,
            symbolColor: "#f5f5f5", // neutral-100
            height: TITLE_BAR_HEIGHT,
          },
        }),
    webPreferences: {
      preload: preloadPath,
      sandbox: true,
      contextIsolation: true,
      // Native rubber-band overscroll on macOS; ignored elsewhere.
      scrollBounce: true,
    },
  });
  mainWindow = window;
  window.on("show", showInDock);
  window.on("restore", showInDock);

  window.on("closed", () => {
    mainWindow = undefined;
    // Keep the menu bar and recording controls running without a Dock icon.
    app.dock?.hide();
    onMainClosed();
  });

  void loadSurface(window, "main");
  return window;
}

const helper = new RecorderHelper(helperBinary());

const SETTINGS_PANES: Record<string, string> = {
  screen: "Privacy_ScreenCapture",
  microphone: "Privacy_Microphone",
  camera: "Privacy_Camera",
  accessibility: "Privacy_Accessibility",
};
ipcMain.handle("permissions:open-settings", (_event, kind: string) => {
  const pane = SETTINGS_PANES[kind];
  if (pane)
    void shell.openExternal(`x-apple.systempreferences:com.apple.preference.security?${pane}`);
});

/** What the renderer may ask the helper for. Sessions are the main process's, through the recording controller. */
const RENDERER_METHODS = new Set<MethodName>([
  "listSources",
  "getPermissions",
  "requestPermission",
  "setAudioPreview",
  "setScreenPreview",
  "setWindowPreview",
]);

/**
 * Relays allowed requests to the helper and every helper notification to every window. Replies are wrapped
 * because Electron flattens errors thrown across IPC into strings.
 */
function bridgeHelper(): void {
  const audioPreviews = new Map<number, AudioSource[]>();
  const windowPreviews = new Map<number, MethodParams<"setWindowPreview">>();
  /** Each window's display previews. The helper runs every window's, each id prefixed with its window's. */
  const screenPreviews = new Map<number, ScreenPreview[]>();
  let previewQueue: Promise<unknown> = Promise.resolve();
  const audioConfig = () => ({
    sources: [
      ...new Map(
        [...audioPreviews.values()].flat().map((source) => [JSON.stringify(source), source]),
      ).values(),
    ],
  });
  const windowConfig = () => [...windowPreviews.values()].at(-1) ?? { enabled: false };
  const screenConfig = () => ({
    previews: [...screenPreviews].flatMap(([sender, previews]) =>
      previews.map((p) => ({ ...p, id: `${sender}/${p.id}` })),
    ),
  });
  const previewRequest = (
    method: "setAudioPreview" | "setScreenPreview" | "setWindowPreview",
    params: unknown,
  ) => {
    previewQueue = previewQueue.catch(() => {}).then(() => helper.request(method, params as never));
    return previewQueue;
  };
  const releasePreviews = (id: number) => {
    if (audioPreviews.delete(id))
      void previewRequest("setAudioPreview", audioConfig()).catch(() => {});
    if (windowPreviews.delete(id))
      void previewRequest("setWindowPreview", windowConfig()).catch(() => {});
    if (screenPreviews.delete(id))
      void previewRequest("setScreenPreview", screenConfig()).catch(() => {});
  };
  app.on("browser-window-created", (_event, window) => {
    const id = window.webContents.id;
    window.on("hide", () => releasePreviews(id));
    window.webContents.on("destroyed", () => releasePreviews(id));
  });
  ipcMain.handle("helper:request", async (event, method: MethodName, params: unknown) => {
    if (!RENDERER_METHODS.has(method))
      return { ok: false, error: { code: -32601, message: `not allowed: ${method}` } };
    try {
      if (method === "setAudioPreview") {
        const { sources } = params as MethodParams<"setAudioPreview">;
        if (sources.length > 0) audioPreviews.set(event.sender.id, sources);
        else audioPreviews.delete(event.sender.id);
        return { ok: true, result: await previewRequest(method, audioConfig()) };
      }
      if (method === "setScreenPreview") {
        const { previews } = params as MethodParams<"setScreenPreview">;
        if (previews.length > 0) screenPreviews.set(event.sender.id, previews);
        else screenPreviews.delete(event.sender.id);
        const { failures } = (await previewRequest(
          method,
          screenConfig(),
        )) as MethodResult<"setScreenPreview">;
        const prefix = `${event.sender.id}/`;
        const own = failures
          .filter((f) => f.id.startsWith(prefix))
          .map((f) => ({ ...f, id: f.id.slice(prefix.length) }));
        return { ok: true, result: { failures: own } };
      }
      if (method === "setWindowPreview") {
        const config = params as MethodParams<"setWindowPreview">;
        windowPreviews.delete(event.sender.id);
        if (config.enabled) windowPreviews.set(event.sender.id, config);
        return { ok: true, result: await previewRequest(method, windowConfig()) };
      }
      return { ok: true, result: await helper.request(method, params as never) };
    } catch (error) {
      return {
        ok: false,
        error:
          error instanceof HelperRequestError
            ? error.error
            : { code: -32603, message: String(error) },
      };
    }
  });
  helper.onNotification(({ method, params }) => {
    for (const window of BrowserWindow.getAllWindows())
      window.webContents.send("helper:notification", method, params);
  });
  helper.onFrame(({ id, image }) => {
    const slash = id.indexOf("/");
    const target = webContents.fromId(Number(id.slice(0, slash)));
    if (target && !target.isDestroyed()) target.send("preview:frame", id.slice(slash + 1), image);
  });
}

/**
 * The project library, for the windows that show projects. A change from one window goes to the others that loaded
 * the library.
 */
function handleProjects(
  preferences: PreferenceStore,
  models: ModelLibrary,
  backgroundModels: BackgroundModelLibrary,
  noiseModels: NoiseModelLibrary,
): ProjectThumbnails {
  const library = new ProjectLibrary(join(app.getPath("userData"), "projects"));
  const subscribers = new Set<Electron.WebContents>();
  const share = (change: { put: unknown[]; removed: string[] }, from?: Electron.WebContents) => {
    if (change.put.length === 0 && change.removed.length === 0) return;
    for (const contents of subscribers)
      if (contents !== from) contents.send("projects:change", change);
  };
  ipcMain.handle("projects:load", (event, legacy: unknown) => {
    if (!subscribers.has(event.sender)) {
      subscribers.add(event.sender);
      event.sender.once("destroyed", () => subscribers.delete(event.sender));
    }
    share({ put: library.import(legacy), removed: [] }, event.sender);
    return library.projects;
  });
  async function loadRecording(directory: string) {
    if (
      !library.projects.some((project) =>
        project.recordings.some((recording) => recording.directory === directory),
      )
    )
      throw new Error("Not a project recording");
    const root = await realpath(recordingsFolder());
    const actual = await realpath(directory);
    if (!isInside(root, actual)) throw new Error("Not a recording");
    const manifest = JSON.parse(await readFile(join(actual, MANIFEST_FILE), "utf8")) as Manifest;
    for (const track of manifest.tracks)
      for (const segment of track.segments) {
        if (!isInside(actual, await realpath(join(actual, segment.file))))
          throw new Error("Invalid recording media path");
      }
    return manifest;
  }
  const transcriptions = new RecordingTranscriptions<DownloadedModel>({
    load: loadRecording,
    async model() {
      const id = preferences.value.transcriptionModel;
      if (!id) throw new Error("Choose and download a local model in Settings → Transcription");
      const state = (await models.refresh()).find((model) => model.id === id);
      if (state?.status.state !== "downloaded")
        throw new Error("Download the selected local model in Settings → Transcription");
      const model: DownloadedModel =
        id === "apple-speech"
          ? { id, locale: preferences.value.appleSpeechLocale }
          : { id, folder: models.folder(id)! };
      return { id, model };
    },
    transcribe: transcribeTimed,
    duration: mediaDuration,
    // A microphone with noise reduction on, and a cleaned copy ready, is transcribed from the copy.
    source(directory, file, microphone) {
      const recording = library.projects
        .flatMap((project) => project.recordings)
        .find((candidate) => candidate.directory === directory);
      return (
        (audioDenoised(recording?.audio, "microphone", microphone)
          ? cleanedFile(directory, file)
          : undefined) ?? join(directory, file)
      );
    },
    change(state) {
      search.invalidate(state.directory);
      for (const contents of subscribers) contents.send("transcription:change", state);
    },
  });
  const search = new TranscriptSearch({
    projects: () => library.projects,
    transcript: async (directory) => (await transcriptions.get(directory)).transcript,
    clips: async (directory) =>
      leadClips(await loadRecording(directory), (file) => mediaDuration(join(directory, file))),
  });
  const backgrounds = new RecordingBackgrounds({
    load: loadRecording,
    model() {
      const id = preferences.value.backgroundModel;
      if (!id) throw new Error("Choose and download a local model in Settings → Backgrounds");
      const weights = backgroundModels.file(id);
      if (!weights) throw new Error("Download the selected local model in Settings → Backgrounds");
      return { id, weights };
    },
    defaults: () => ({
      enabled: true,
      replacement: preferences.value.backgroundReplacement,
      blur: preferences.value.backgroundBlur,
      color: preferences.value.backgroundColor,
    }),
    process: processBackground,
    change(state) {
      for (const contents of subscribers) contents.send("background:change", state);
    },
  });
  ipcMain.handle("background:get", (_event, directory: unknown) => {
    if (typeof directory !== "string") throw new Error("Not a recording");
    return backgrounds.get(directory);
  });
  ipcMain.handle("background:start", (_event, directory: unknown) => {
    if (typeof directory !== "string") throw new Error("Not a recording");
    return backgrounds.start(directory);
  });
  ipcMain.handle("background:cancel", async (_event, directory: unknown) => {
    if (typeof directory !== "string") throw new Error("Not a recording");
    await backgrounds.get(directory);
    backgrounds.cancel(directory);
  });
  ipcMain.handle("background:update", (_event, directory: unknown, patch: unknown) => {
    if (typeof directory !== "string") throw new Error("Not a recording");
    return backgrounds.update(directory, patch);
  });
  const noise = new RecordingNoise({
    load: loadRecording,
    decoded: decodedAudio,
    async engine() {
      const id = resolveNoiseEngine(preferences.value.noiseEngine, await noiseModels.list());
      if (!id) throw new Error("Choose a noise reduction engine in Settings → Audio");
      return { id, folder: id === "deepfilternet3" ? noiseModels.folder() : null };
    },
    process: processNoise,
    change(state: NoiseState) {
      for (const contents of subscribers) contents.send("noise:change", state);
    },
  });
  ipcMain.handle("noise:get", (_event, directory: unknown) => {
    if (typeof directory !== "string") throw new Error("Not a recording");
    return noise.get(directory);
  });
  ipcMain.handle("noise:start", (_event, directory: unknown, kind: unknown, index: unknown) => {
    if (typeof directory !== "string") throw new Error("Not a recording");
    return noise.start(directory, kind, index);
  });
  ipcMain.handle(
    "noise:cancel",
    async (_event, directory: unknown, kind: unknown, index: unknown) => {
      if (typeof directory !== "string") throw new Error("Not a recording");
      await noise.get(directory);
      noise.cancel(directory, kind, index);
    },
  );
  ipcMain.handle("transcription:get", (_event, directory: unknown) => {
    if (typeof directory !== "string") throw new Error("Not a recording");
    return transcriptions.get(directory);
  });
  ipcMain.handle("transcription:search", (_event, query: unknown) => {
    if (typeof query !== "string") throw new Error("Invalid transcript search");
    return search.search(query);
  });
  ipcMain.handle(
    "transcription:start",
    (_event, directory: unknown, timingOnly: unknown = false) => {
      if (typeof directory !== "string" || typeof timingOnly !== "boolean")
        throw new Error("Invalid transcription request");
      return transcriptions.start(directory, timingOnly);
    },
  );
  ipcMain.handle("transcription:cancel", async (_event, directory: unknown) => {
    if (typeof directory !== "string") throw new Error("Not a recording");
    await transcriptions.get(directory);
    transcriptions.cancel(directory);
  });
  ipcMain.handle(
    "transcription:correct",
    (_event, directory: unknown, id: unknown, text: unknown) => {
      if (
        typeof directory !== "string" ||
        typeof id !== "string" ||
        typeof text !== "string" ||
        text.length > 500
      )
        throw new Error("Invalid caption correction");
      return transcriptions.correct(directory, id, text);
    },
  );
  ipcMain.handle(
    "transcription:replace",
    (_event, directory: unknown, from: unknown, to: unknown, text: unknown) => {
      const address = (value: unknown): value is WordAddress =>
        !!value &&
        typeof value === "object" &&
        typeof (value as WordAddress).cue === "string" &&
        Number.isInteger((value as WordAddress).word);
      if (
        typeof directory !== "string" ||
        !address(from) ||
        !address(to) ||
        typeof text !== "string" ||
        text.length > 500
      )
        throw new Error("Invalid transcript correction");
      return transcriptions.replace(directory, from, to, text);
    },
  );
  const thumbnailWindow = new ThumbnailWindow();
  const thumbnails = new ProjectThumbnails({
    projects: () => library.projects,
    root: recordingsFolder(),
    busy: () => rendering.busy(),
    render: (project) => thumbnailWindow.render(project),
    changed(projectId) {
      for (const contents of subscribers) contents.send("thumbnails:change", projectId);
    },
  });
  ipcMain.handle("thumbnails:get", (_event, projectId: unknown) =>
    isProjectId(projectId) ? thumbnails.get(projectId) : null,
  );
  thumbnails.start();
  ipcMain.handle("projects:put", (event, projects: unknown) => {
    const known = new Set(
      library.projects.flatMap((project) =>
        project.recordings.map((recording) => recording.directory),
      ),
    );
    const change = library.put(projects);
    const present = new Set(
      library.projects.flatMap((project) =>
        project.recordings.map((recording) => recording.directory),
      ),
    );
    for (const directory of known)
      if (directory && !present.has(directory)) {
        transcriptions.cancel(directory);
        backgrounds.cancel(directory);
        noise.cancelAll(directory);
      }
    share(change, event.sender);
    thumbnails.nudge();
    if (preferences.value.autoTranscribe)
      for (const project of change.put)
        for (const recording of project.recordings) {
          if (recording.directory && recording.hasMicrophone && !known.has(recording.directory)) {
            void transcriptions.start(recording.directory).catch((error: unknown) => {
              const state: TranscriptionState = {
                directory: recording.directory!,
                phase: "failed",
                error: error instanceof Error ? error.message : String(error),
              };
              for (const contents of subscribers) contents.send("transcription:change", state);
            });
          }
        }
    if (preferences.value.autoRemoveBackground)
      for (const project of change.put)
        for (const recording of project.recordings) {
          if (recording.directory && recording.hasCamera && !known.has(recording.directory)) {
            void backgrounds.start(recording.directory).catch((error: unknown) => {
              const state: BackgroundState = {
                directory: recording.directory!,
                phase: "failed",
                error: error instanceof Error ? error.message : String(error),
              };
              for (const contents of subscribers) contents.send("background:change", state);
            });
          }
        }
  });
  ipcMain.handle("projects:remove", (event, ids: unknown) => {
    const previous = library.projects;
    const change = library.remove(ids);
    for (const project of previous)
      if (change.removed.includes(project.id)) {
        for (const recording of project.recordings)
          if (recording.directory) {
            transcriptions.cancel(recording.directory);
            backgrounds.cancel(recording.directory);
            noise.cancelAll(recording.directory);
          }
      }
    share(change, event.sender);
  });
  app.on("will-quit", () => {
    transcriptions.dispose();
    backgrounds.dispose();
    noise.dispose();
    thumbnails.dispose();
    thumbnailWindow.close();
    library.flush();
  });
  return thumbnails;
}

/** The background removal models, downloaded into `models/background-removal` in the user-data directory. */
function handleBackgroundModels(): BackgroundModelLibrary {
  const library = new BackgroundModelLibrary(
    join(app.getPath("userData"), "models", "background-removal"),
    (url, init) => net.fetch(url, init),
    (models) => {
      for (const window of BrowserWindow.getAllWindows())
        window.webContents.send("background-models:change", models);
    },
  );
  ipcMain.handle("background-models:list", () => library.models);
  ipcMain.handle("background-models:download", (_event, id: unknown) => library.download(id));
  ipcMain.handle("background-models:cancel", (_event, id: unknown) => library.cancel(id));
  ipcMain.handle("background-models:remove", (_event, id: unknown) => library.remove(id));
  app.on("will-quit", () => library.stop());
  return library;
}

/** The noise reduction engines: DeepFilterNet3 downloads into `models/noise-reduction` in the user-data directory. */
function handleNoiseModels(): NoiseModelLibrary {
  const library = new NoiseModelLibrary(
    join(app.getPath("userData"), "models", "noise-reduction"),
    (url, init) => net.fetch(url, init),
    (engines) => {
      for (const window of BrowserWindow.getAllWindows())
        window.webContents.send("noise-engines:change", engines);
    },
    () => appleIsolationStatus(),
  );
  ipcMain.handle("noise-engines:list", () => library.list());
  ipcMain.handle("noise-engines:download", (_event, id: unknown) => library.download(id));
  ipcMain.handle("noise-engines:cancel", (_event, id: unknown) => library.cancel(id));
  ipcMain.handle("noise-engines:remove", (_event, id: unknown) => library.remove(id));
  app.on("will-quit", () => library.stop());
  return library;
}

/**
 * The transcription models, downloaded into `models` in the user-data directory, with Apple Speech in the language
 * the preferences choose. Every window hears of changes.
 */
function handleModels(preferences: PreferenceStore): ModelLibrary {
  const library = new ModelLibrary(
    join(app.getPath("userData"), "models"),
    { speech: appleSpeech(), locale: () => preferences.value.appleSpeechLocale },
    (url, init) => net.fetch(url, init),
    (models) => {
      for (const window of BrowserWindow.getAllWindows())
        window.webContents.send("models:change", models);
    },
  );
  preferences.onChange((value, previous) => {
    if (value.appleSpeechLocale !== previous.appleSpeechLocale) void library.refresh();
  });
  ipcMain.handle("models:list", () => library.refresh());
  ipcMain.handle("models:download", (_event, id: unknown) => library.download(id));
  ipcMain.handle("models:cancel", (_event, id: unknown) => library.cancel(id));
  ipcMain.handle("models:remove", (_event, id: unknown) => library.remove(id));
  // Replies with the text or why there's none, since a thrown error reaches the renderer wrapped in IPC's words.
  ipcMain.handle(
    "models:transcribe",
    async (_event, id: unknown, samples: unknown, sampleRate: unknown) => {
      if (
        !isTranscriptionModelId(id) ||
        !(samples instanceof Float32Array) ||
        !Number.isInteger(sampleRate) ||
        (sampleRate as number) <= 0
      ) {
        return { error: "Couldn't transcribe that audio" };
      }
      let model: DownloadedModel;
      if (id === "apple-speech") model = { id, locale: preferences.value.appleSpeechLocale };
      else {
        const folder = library.folder(id);
        if (!folder) return { error: "This model isn't downloaded" };
        model = { id, folder };
      }
      const directory = mkdtempSync(join(tmpdir(), "chord-transcribe-"));
      try {
        const file = join(directory, "audio.wav");
        writeFileSync(file, wav(samples, sampleRate as number));
        return { text: await transcribe(file, model) };
      } catch (error) {
        return { error: error instanceof Error ? error.message : String(error) };
      } finally {
        rmSync(directory, { recursive: true, force: true });
      }
    },
  );
  app.on("will-quit", () => library.stop());
  return library;
}

/** What the renderer's next `getDisplayMedia` call shows: a helper `DisplaySource.id` or `PreviewWindow.id`. */
const previewSources = new Map<number, { kind: "display" | "window"; id: number }>();

/**
 * Display and window previews call `getDisplayMedia`. Answer with what the renderer picked instead of the system
 * picker. Electron uses the same CGDirectDisplayID and CGWindowID as the helper, so ids match exactly.
 */
function handleDisplayMedia(): void {
  ipcMain.handle(
    "preview:select-source",
    (event, source: { kind: "display" | "window"; id: number }) => {
      previewSources.set(event.sender.id, source);
    },
  );
  app.on("web-contents-created", (_event, contents) =>
    contents.on("destroyed", () => previewSources.delete(contents.id)),
  );
  session.defaultSession.setDisplayMediaRequestHandler(
    async (request, callback) => {
      const owner = request.frame && webContents.fromFrame(request.frame);
      const wanted = owner && previewSources.get(owner.id);
      const types = wanted?.kind === "window" ? ["window" as const] : ["screen" as const];
      const sources = await desktopCapturer.getSources({
        types,
        thumbnailSize: { width: 0, height: 0 },
      });
      const source = sources.find((s) =>
        wanted?.kind === "window"
          ? s.id.startsWith(`window:${wanted.id}:`)
          : s.display_id === String(wanted?.id),
      );
      // An empty answer rejects the request, so the preview shows as unavailable.
      callback(source ? { video: source } : {});
    },
    { useSystemPicker: false },
  );
}

/** Recordings played back in the renderer: their session folders, and their media through `MEDIA_SCHEME`. */
function handlePlayback(thumbnails: ProjectThumbnails): void {
  handleMediaScheme((projectId, file) => thumbnails.path(projectId, file));
  ipcMain.handle("recording:load", (_event, directory: unknown) =>
    loadSession(recordingsFolder(), directory),
  );
  ipcMain.handle(
    "recording:levelAudio",
    (_event, directory: unknown, kind: unknown, index: unknown, clean: unknown) =>
      levelTrack(recordingsFolder(), directory, kind, index, clean),
  );
}

registerMediaScheme();

// Rubber-band inner scroll containers on their own, not just the document root.
app.commandLine.appendSwitch("enable-features", "OverscrollEffectOnNonRootScrollers");

/** Preferences, seeded on first launch from what the quick-start setup held before preferences were their own. */
function loadPreferences(): PreferenceStore {
  const userData = app.getPath("userData");
  return new PreferenceStore(join(userData, "preferences.json"), () => {
    let defaults: unknown;
    try {
      defaults = JSON.parse(readFileSync(join(userData, "quick-recording.json"), "utf8"));
    } catch {
      /* None yet. */
    }
    return preferencesFrom(defaults);
  });
}

app.whenReady().then(() => {
  ipcMain.handle("tasks:list", () => tasks.list());
  ipcMain.handle("tasks:cancel", (_event, id: unknown) => {
    if (typeof id === "string") tasks.cancel(id);
  });
  tasks.subscribe((list) => {
    for (const window of BrowserWindow.getAllWindows())
      window.webContents.send("tasks:change", list);
  });
  setAppMenu();
  const preferences = loadPreferences();
  bridgeHelper();
  const models = handleModels(preferences);
  const backgroundModels = handleBackgroundModels();
  const noiseModels = handleNoiseModels();
  const thumbnails = handleProjects(preferences, models, backgroundModels, noiseModels);
  handleDisplayMedia();
  handlePlayback(thumbnails);
  rendering.exporting = handleExport();
  handleApps();
  handleUpdates();
  // Start now so the first source list doesn't wait on launch.
  helper.request("ping").catch(() => {});
  createWindow();
  const toolbar = handleToolbar(
    helper,
    preferences,
    () => mainWindow ?? createWindow(),
    () => !!mainWindow,
  );
  onMainClosed = toolbar.lifecycle;
  rendering.recording = toolbar.recording;
  app.on("activate", () => {
    // With the main window closed the app lives in the menu bar and toolbar. Hiding the toolbar hands activation
    // back to the app, which must not bring the main window up; the menu bar's "open" does that on request.
    if (!mainWindow && app.dock && !app.dock.isVisible()) return;
    const window = mainWindow ?? createWindow();
    if (window.isMinimized()) window.restore();
    window.show();
  });
});

app.on("will-quit", () => {
  globalShortcut.unregisterAll();
  helper.stop();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
