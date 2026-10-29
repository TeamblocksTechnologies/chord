import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";

type Reply =
  | { ok: true; result: unknown }
  | { ok: false; error: { code: number; message: string; data?: unknown } };

import type {
  AreaPickerInit,
  DesktopAPI,
  DesktopState,
  PointerUpdate,
  ShortcutPress,
  Surface,
} from "#platform/contracts/desktop";
import type { ProjectChange } from "#features/projects/contracts/projects";
import type { BackgroundModelState } from "#features/background-removal/contracts/backgroundRemoval";
import type {
  NoiseEngineState,
  NoiseState,
} from "#features/audio-processing/contracts/noiseReduction";
import type { BackgroundState } from "#features/background-removal/contracts/backgroundRemoval";
import type { TranscriptionState } from "#features/transcription/domain/captions";
import type { ModelState } from "#features/transcription/domain/transcription";
import type { UpdateState, UpdatesAPI } from "#features/settings/contracts/updates";
import type { AppTask } from "#platform/contracts/tasks";

const updates: UpdatesAPI = {
  getState: () => ipcRenderer.invoke("updates:state"),
  check: () => ipcRenderer.invoke("updates:check"),
  download: () => ipcRenderer.invoke("updates:download"),
  install: () => ipcRenderer.invoke("updates:install"),
  onState(listener) {
    const handler = (_event: IpcRendererEvent, state: UpdateState) => listener(state);
    ipcRenderer.on("updates:state", handler);
    return () => ipcRenderer.removeListener("updates:state", handler);
  },
};

const desktop: DesktopAPI = {
  tasks: {
    list: () => ipcRenderer.invoke("tasks:list"),
    cancel: (id) => ipcRenderer.invoke("tasks:cancel", id),
    onChange(listener) {
      const handler = (_event: IpcRendererEvent, tasks: AppTask[]) => listener(tasks);
      ipcRenderer.on("tasks:change", handler);
      return () => ipcRenderer.removeListener("tasks:change", handler);
    },
  },
  getState: () => ipcRenderer.invoke("desktop:state"),
  initializeDefaults: (setup) => ipcRenderer.invoke("desktop:initialize", setup),
  updateDefaults: (patch) => ipcRenderer.invoke("desktop:defaults", patch),
  updatePreferences: (patch) => ipcRenderer.invoke("preferences:update", patch),
  onState(listener) {
    const handler = (_event: IpcRendererEvent, state: DesktopState) => listener(state);
    ipcRenderer.on("desktop:state", handler);
    return () => ipcRenderer.removeListener("desktop:state", handler);
  },
  pickAreas: (areas) => ipcRenderer.invoke("areas:pick", areas),
  recording: {
    start: (setup, projectId, notes, folder) =>
      ipcRenderer.invoke("recording:start", setup, projectId, notes, folder),
    quickStart: () => ipcRenderer.invoke("recording:quick-start"),
    pause: () => ipcRenderer.invoke("recording:pause"),
    resume: () => ipcRenderer.invoke("recording:resume"),
    addMark: () => ipcRenderer.invoke("recording:mark"),
    setPage: (page) => ipcRenderer.invoke("recording:page", page),
    setLaser: (on) => ipcRenderer.invoke("recording:laser", on),
    setClicks: (on) => ipcRenderer.invoke("recording:clicks", on),
    setKeys: (on) => ipcRenderer.invoke("recording:keys", on),
    cancel: () => ipcRenderer.invoke("recording:cancel"),
    stop: () => ipcRenderer.invoke("recording:stop"),
    update: (patch) => ipcRenderer.invoke("recording:update", patch),
    claimFinished: () => ipcRenderer.invoke("recording:claim"),
    trash: (directories) => ipcRenderer.invoke("recording:trash", directories),
    reveal: (directory) => ipcRenderer.invoke("recording:reveal", directory),
    load: (directory) => ipcRenderer.invoke("recording:load", directory),
    levelAudio: (directory, kind, index, clean = false) =>
      ipcRenderer.invoke("recording:levelAudio", directory, kind, index, clean),
    folder: () => ipcRenderer.invoke("recordings:folder"),
    openFolder: () => ipcRenderer.invoke("recordings:open"),
  },
  export: {
    create: (folder, name, extension) =>
      ipcRenderer.invoke("export:create", folder, name, extension),
    open: (path) => ipcRenderer.invoke("export:open", path),
    write: (id, position, data) => ipcRenderer.invoke("export:write", id, position, data),
    close: (id, keep) => ipcRenderer.invoke("export:close", id, keep),
    saveFrame: (folder, name, time, data) =>
      ipcRenderer.invoke("export:save-frame", folder, name, time, data),
    copyFrame: (data) => ipcRenderer.invoke("export:copy-frame", data),
    captions: (path, cues) => ipcRenderer.invoke("export:captions", path, cues),
    list: (folder) => ipcRenderer.invoke("export:list", folder),
    play: (path) => ipcRenderer.invoke("export:play", path),
    reveal: (path) => ipcRenderer.invoke("export:reveal", path),
    trash: (path) => ipcRenderer.invoke("export:trash", path),
  },
  toolbar: {
    show: () => ipcRenderer.invoke("toolbar:show"),
    hide: () => ipcRenderer.invoke("toolbar:hide"),
  },
  shortcuts: {
    suspend: (on) => ipcRenderer.invoke("shortcuts:suspend", on),
  },
  projects: {
    load: (legacy) => ipcRenderer.invoke("projects:load", legacy),
    put: (projects) => ipcRenderer.invoke("projects:put", projects),
    remove: (ids) => ipcRenderer.invoke("projects:remove", ids),
    onChange(listener) {
      const handler = (_event: IpcRendererEvent, change: ProjectChange) => listener(change);
      ipcRenderer.on("projects:change", handler);
      return () => ipcRenderer.removeListener("projects:change", handler);
    },
  },
  transcription: {
    get: (directory) => ipcRenderer.invoke("transcription:get", directory),
    search: (query) => ipcRenderer.invoke("transcription:search", query),
    start: (directory, timingOnly = false) =>
      ipcRenderer.invoke("transcription:start", directory, timingOnly),
    cancel: (directory) => ipcRenderer.invoke("transcription:cancel", directory),
    correct: (directory, id, text) =>
      ipcRenderer.invoke("transcription:correct", directory, id, text),
    replace: (directory, from, to, text) =>
      ipcRenderer.invoke("transcription:replace", directory, from, to, text),
    onChange(listener) {
      const handler = (_event: Electron.IpcRendererEvent, state: TranscriptionState) =>
        listener(state);
      ipcRenderer.on("transcription:change", handler);
      return () => ipcRenderer.removeListener("transcription:change", handler);
    },
  },
  models: {
    list: () => ipcRenderer.invoke("models:list"),
    download: (id) => ipcRenderer.invoke("models:download", id),
    cancel: (id) => ipcRenderer.invoke("models:cancel", id),
    remove: (id) => ipcRenderer.invoke("models:remove", id),
    async transcribe(id, samples, sampleRate) {
      const reply: { text: string } | { error: string } = await ipcRenderer.invoke(
        "models:transcribe",
        id,
        samples,
        sampleRate,
      );
      if ("error" in reply) throw new Error(reply.error);
      return reply.text;
    },
    onChange(listener) {
      const handler = (_event: IpcRendererEvent, models: ModelState[]) => listener(models);
      ipcRenderer.on("models:change", handler);
      return () => ipcRenderer.removeListener("models:change", handler);
    },
  },
  background: {
    get: (directory) => ipcRenderer.invoke("background:get", directory),
    start: (directory) => ipcRenderer.invoke("background:start", directory),
    cancel: (directory) => ipcRenderer.invoke("background:cancel", directory),
    update: (directory, patch) => ipcRenderer.invoke("background:update", directory, patch),
    onChange(listener) {
      const handler = (_event: Electron.IpcRendererEvent, state: BackgroundState) =>
        listener(state);
      ipcRenderer.on("background:change", handler);
      return () => ipcRenderer.removeListener("background:change", handler);
    },
  },
  noise: {
    get: (directory) => ipcRenderer.invoke("noise:get", directory),
    start: (directory, kind, index) => ipcRenderer.invoke("noise:start", directory, kind, index),
    cancel: (directory, kind, index) => ipcRenderer.invoke("noise:cancel", directory, kind, index),
    onChange(listener) {
      const handler = (_event: IpcRendererEvent, state: NoiseState) => listener(state);
      ipcRenderer.on("noise:change", handler);
      return () => ipcRenderer.removeListener("noise:change", handler);
    },
  },
  thumbnails: {
    get: (projectId) => ipcRenderer.invoke("thumbnails:get", projectId),
    onChange(listener) {
      const handler = (_event: IpcRendererEvent, projectId: string) => listener(projectId);
      ipcRenderer.on("thumbnails:change", handler);
      return () => ipcRenderer.removeListener("thumbnails:change", handler);
    },
  },
  backgroundModels: {
    list: () => ipcRenderer.invoke("background-models:list"),
    download: (id) => ipcRenderer.invoke("background-models:download", id),
    cancel: (id) => ipcRenderer.invoke("background-models:cancel", id),
    remove: (id) => ipcRenderer.invoke("background-models:remove", id),
    onChange(listener) {
      const handler = (_event: IpcRendererEvent, models: BackgroundModelState[]) =>
        listener(models);
      ipcRenderer.on("background-models:change", handler);
      return () => ipcRenderer.removeListener("background-models:change", handler);
    },
  },
  noiseEngines: {
    list: () => ipcRenderer.invoke("noise-engines:list"),
    download: (id) => ipcRenderer.invoke("noise-engines:download", id),
    cancel: (id) => ipcRenderer.invoke("noise-engines:cancel", id),
    remove: (id) => ipcRenderer.invoke("noise-engines:remove", id),
    onChange(listener) {
      const handler = (_event: IpcRendererEvent, engines: NoiseEngineState[]) => listener(engines);
      ipcRenderer.on("noise-engines:change", handler);
      return () => ipcRenderer.removeListener("noise-engines:change", handler);
    },
  },
  openMain: (route) => ipcRenderer.invoke("main:open", route),
  onNavigate(listener) {
    const handler = () => listener();
    ipcRenderer.on("main:navigate", handler);
    return () => ipcRenderer.removeListener("main:navigate", handler);
  },
  takeRoute: () => ipcRenderer.invoke("main:take-route"),
  hideMenubar: () => ipcRenderer.invoke("menubar:hide"),
  overlay: {
    setDropdownOpen: (open) => ipcRenderer.send("overlay:dropdown", open),
    onDismiss(listener) {
      const handler = () => listener();
      ipcRenderer.on("overlay:dismiss", handler);
      return () => ipcRenderer.removeListener("overlay:dismiss", handler);
    },
    dragStart: (edge) => ipcRenderer.invoke("overlay:drag-start", edge),
    dragMove: (dx, dy) => ipcRenderer.send("overlay:drag-move", dx, dy),
    dragEnd: () => ipcRenderer.invoke("overlay:drag-end"),
  },
};

const surface = (process.argv.find((arg) => arg.startsWith("--chord-surface="))?.split("=")[1] ??
  "main") as Surface;
contextBridge.exposeInMainWorld("chord", {
  platform: process.platform,
  surface,
  desktop,
  updates,
  toolbar: desktop.toolbar,
  shortcuts: desktop.shortcuts,
  /** The pointer overlay windows only. */
  pointer: {
    onUpdate(listener: (update: PointerUpdate) => void): () => void {
      const handler = (_event: IpcRendererEvent, update: PointerUpdate) => listener(update);
      ipcRenderer.on("pointer:update", handler);
      return () => ipcRenderer.removeListener("pointer:update", handler);
    },
    onShortcut(listener: (press: ShortcutPress) => void): () => void {
      const handler = (_event: IpcRendererEvent, press: ShortcutPress) => listener(press);
      ipcRenderer.on("pointer:shortcut", handler);
      return () => ipcRenderer.removeListener("pointer:shortcut", handler);
    },
  },
  /** The area picker windows only. */
  areas: {
    /** What this window starts with; asked for once the page is listening. */
    init: (): Promise<AreaPickerInit | null> => ipcRenderer.invoke("areas:init"),
    /** The page has painted, so the window can be shown. */
    ready: () => ipcRenderer.send("areas:ready"),
    /** This display's areas, after each edit. */
    change: (areas: unknown[]) => ipcRenderer.send("areas:change", areas),
    /** Closes every picker window, keeping the edits if `done`. */
    finish: (done: boolean) => ipcRenderer.send("areas:finish", done),
  },
  /** The thumbnail window only: projects to draw thumbnails of, and what's drawn. */
  thumbnailRenderer: {
    onRender(listener: (id: number, project: unknown) => void): () => void {
      const handler = (_event: IpcRendererEvent, id: number, project: unknown) =>
        listener(id, project);
      ipcRenderer.on("thumbnails:render", handler);
      return () => ipcRenderer.removeListener("thumbnails:render", handler);
    },
    /** The window is listening for renders. */
    ready: () => ipcRenderer.send("thumbnails:ready"),
    result: (id: number, reply: unknown): Promise<void> =>
      ipcRenderer.invoke("thumbnails:result", id, reply),
  },
  /** Frames of the display previews this window asked the helper for, by `ScreenPreview.id`. */
  onPreviewFrame(listener: (id: string, image: Uint8Array) => void): () => void {
    const handler = (_event: IpcRendererEvent, id: string, image: Uint8Array) =>
      listener(id, image);
    ipcRenderer.on("preview:frame", handler);
    return () => ipcRenderer.removeListener("preview:frame", handler);
  },
  selectPreviewSource: (source: { kind: "display" | "window"; id: number }): Promise<void> =>
    ipcRenderer.invoke("preview:select-source", source),
  openPermissionSettings: (kind: string): Promise<void> =>
    ipcRenderer.invoke("permissions:open-settings", kind),
  installedApps: (): Promise<unknown> => ipcRenderer.invoke("apps:installed"),
  runningApps: (): Promise<unknown> => ipcRenderer.invoke("apps:running"),
  appIcons: (apps: { bundleId: string; pid?: number }[]): Promise<Record<string, string>> =>
    ipcRenderer.invoke("apps:icons", apps),
  helper: {
    async request(method: string, params?: unknown): Promise<unknown> {
      const reply: Reply = await ipcRenderer.invoke("helper:request", method, params);
      if (reply.ok) return reply.result;
      throw Object.assign(new Error(reply.error.message), reply.error);
    },
    onNotification(listener: (method: string, params: unknown) => void): () => void {
      const handler = (_event: IpcRendererEvent, method: string, params: unknown) =>
        listener(method, params);
      ipcRenderer.on("helper:notification", handler);
      return () => ipcRenderer.removeListener("helper:notification", handler);
    },
  },
});
