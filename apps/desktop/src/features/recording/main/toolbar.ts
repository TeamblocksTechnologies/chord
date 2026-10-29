import { readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { app, BrowserWindow, dialog, globalShortcut, ipcMain, screen } from "electron";
import {
  TOOLBAR_HEIGHT,
  TOOLBAR_WIDTH,
  isRoute,
  type DesktopState,
  type FinishedRecording,
  type Rect,
  type Route,
  type Surface,
} from "#platform/contracts/desktop";
import { dropdownSide, overlayFrame } from "#platform/contracts/overlay";
import {
  activeCameraIds,
  capturesScreen,
  initialSetup,
  isRecordingSetup,
  upgradeQuality,
  upgradeScreenAppearance,
  type RecordingSetup,
} from "#project-document/domain/recording";
import type { SessionInfo } from "@teamblocks.dev/chord-recorder-protocol";
import type { RecorderHelper } from "#platform/main/helper";
import { AreaPicker } from "./areas.ts";
import { Island } from "./island.ts";
import { Menubar } from "./menubar.ts";
import { NotesWindow } from "./notes.ts";
import { hasNotes, isNotePages } from "../domain/notes.ts";
import { withoutPreferences } from "#features/settings/domain/preferences";
import { PointerOverlay } from "./pointer.ts";
import type { KeyModifier } from "../domain/keys.ts";
import {
  GLOBAL_SHORTCUTS,
  bindingProblem,
  resolveShortcuts,
  toAccelerator,
  type ShortcutId,
} from "#features/settings/domain/shortcuts";
import { OverlayWindow } from "#platform/main/overlay";
import {
  HelperCapture,
  openRecordingsFolder,
  recordingsFolder,
  revealRecording,
  trashRecordings,
} from "./capture.ts";
import type { PreferenceStore } from "#features/settings/main/preferences";
import { RecordingController } from "./recording.ts";
import { loadSurface, preloadPath } from "#platform/main/windows";

/** About a frame, so clicks reach the toolbar as soon as the cursor does. */
const POLL_INTERVAL = 16;
const TITLES: Record<Surface, string> = {
  main: "Chord",
  toolbar: "Chord recording toolbar",
  island: "Chord recording controls",
  pointer: "Chord pointer overlay",
  areas: "Chord area picker",
  notes: "Chord recording notes",
  menubar: "Chord",
  thumbnails: "Chord thumbnails",
};
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(value, max));

/** `base` with the patch's known top-level fields, so windows editing different fields don't lose each other's updates. */
function merged(base: RecordingSetup, patch: unknown): RecordingSetup {
  if (!patch || typeof patch !== "object") throw new Error("Invalid recording setup");
  const next = { ...base };
  for (const key of Object.keys(base) as (keyof RecordingSetup)[]) {
    if (Object.hasOwn(patch, key))
      Object.assign(next, { [key]: (patch as Partial<RecordingSetup>)[key] });
  }
  if (!isRecordingSetup(next)) throw new Error("Invalid recording setup");
  return next;
}

/**
 * The toolbar and recording island, each a transparent overlay window with room for its dropdowns (see
 * `shared/overlay.ts`). Starting a recording hides the main window while the island takes over.
 */
export function handleToolbar(
  helper: RecorderHelper,
  preferences: PreferenceStore,
  getMainWindow: () => BrowserWindow,
  hasMainWindow: () => boolean,
): { lifecycle: () => void; recording: () => boolean } {
  let toolbarOverlay: OverlayWindow | undefined;
  let toolbarLoading: Promise<void> | undefined;
  let toolbarTimer: ReturnType<typeof setInterval> | undefined;
  let shuttingDown = false;
  let version = 0;
  let defaultsRevision = 0;
  let defaults: RecordingSetup | null = null;
  const toolbar: DesktopState["toolbar"] = { visible: false, registered: false, side: "above" };
  /** The global shortcuts registered now, with their accelerators. */
  const registeredShortcuts = new Map<ShortcutId, string>();
  /** Whether Settings is recording a new shortcut. */
  let suspendedShortcuts = false;
  const finished: FinishedRecording[] = [];
  const defaultsPath = join(app.getPath("userData"), "quick-recording.json");
  try {
    const stored: unknown = JSON.parse(readFileSync(defaultsPath, "utf8"));
    const upgraded =
      stored && typeof stored === "object"
        ? {
            ...initialSetup(),
            ...withoutPreferences(upgradeScreenAppearance(upgradeQuality(stored))),
          }
        : stored;
    if (isRecordingSetup(upgraded)) defaults = upgraded;
  } catch {
    /* First launch imports the renderer's existing quick-start defaults. */
  }

  let defaultsReady: () => void;
  const initialized = new Promise<void>((resolve) => {
    defaultsReady = resolve;
  });
  if (defaults) defaultsReady!();
  const recording = new RecordingController(
    notify,
    new HelperCapture(helper, () => preferences.value),
    (message, take) => {
      // What was recorded before the session ended is kept.
      if (take) {
        finished.push(take);
        notify();
      }
      revealMain();
      const window = getMainWindow();
      void dialog.showMessageBox(window, {
        type: "warning",
        message: take ? "The recording stopped" : "Couldn't start recording",
        detail: take ? `${message} What was recorded until then is saved.` : message,
      });
    },
  );
  helper.onNotification(({ method, params }) => {
    if (method === "sessionState" && (params as SessionInfo).stopReason === "diskFull") {
      recording.interrupted("The disk is full.");
    }
    // A restarted helper has lost the session.
    if (method === "ready") recording.interrupted("The recorder quit unexpectedly.");
  });
  const island = new Island({
    path: join(app.getPath("userData"), "recording-island.json"),
    create: () => {
      const window = utilityWindow("island");
      return { window, loading: loadSurface(window, "island") };
    },
    changed: notify,
  });
  const pointer = new PointerOverlay({
    create: () => utilityWindow("pointer"),
    load: (window) => loadSurface(window, "pointer"),
    watchMouse: (on) => {
      helper.request("setMouseWatch", { enabled: on }).catch(() => {});
    },
    watchKeys: (on) => {
      helper.request("setKeyWatch", { enabled: on }).catch(() => {});
    },
  });
  const notes = new NotesWindow({
    path: join(app.getPath("userData"), "recording-notes.json"),
    create: () => utilityWindow("notes"),
    load: (window) => loadSurface(window, "notes"),
  });
  const areas = new AreaPicker({
    create: () => utilityWindow("areas"),
    load: (window) => loadSurface(window, "areas"),
  });
  // A macOS menu bar extra; other platforms have the toolbar.
  const menubar =
    process.platform === "darwin"
      ? new Menubar({
          create: () => {
            const window = utilityWindow("menubar");
            return { window, loading: loadSurface(window, "menubar") };
          },
          recording: () => recording.state.phase !== "idle",
          showMain: () => revealMain(),
          changed: notify,
        })
      : undefined;
  /** A screen the menu bar asked the main window for, until the main window takes it. */
  let pendingRoute: Route | null = null;
  helper.onNotification(({ method, params }) => {
    if (method === "mouseButton") pointer.setDown((params as { down: boolean }).down);
    if (method === "keyPress") {
      const { keyCode, modifiers } = params as { keyCode: number; modifiers: KeyModifier[] };
      pointer.showShortcut(keyCode, modifiers);
    }
  });
  const state = (): DesktopState => ({
    version,
    defaultsRevision,
    defaults,
    preferences: preferences.value,
    recording: recording.state,
    liveRevision: recording.revision,
    finished: finished.length,
    toolbar,
    island: island.state,
    menubar: menubar?.state ?? { visible: false, side: "left" },
  });
  const toolbarWindow = () => toolbarOverlay?.window;

  function notify(): void {
    version++;
    // The recording shortcuts come and go with the recording.
    registerShortcuts();
    const target = recording.state.target;
    // The pointer tools annotate the screen, so they're inert while none is recorded.
    const annotates = !!target && capturesScreen(target.setup);
    pointer.sync(
      annotates && recording.state.laser,
      annotates && recording.state.clicks,
      annotates && recording.state.keys,
    );
    island.sync(
      recording.state.phase !== "idle",
      !!target && activeCameraIds(target.setup).length > 0,
      preferences.value.islandPreview,
      annotates,
    );
    notes.sync(recording.state.phase !== "idle" && !!target && hasNotes(target.notes));
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.webContents.isDestroyed()) window.webContents.send("desktop:state", state());
    }
  }

  function saveDefaults(setup: RecordingSetup): void {
    // Atomic replacement prevents a partial settings file if the app exits during a write.
    writeFileSync(`${defaultsPath}.tmp`, JSON.stringify(setup));
    renameSync(`${defaultsPath}.tmp`, defaultsPath);
    defaults = setup;
    defaultsRevision++;
    defaultsReady!();
    notify();
  }

  function revealMain(): void {
    const window = getMainWindow();
    if (window.isMinimized()) window.restore();
    window.show();
    app.focus({ steal: true });
    window.focus();
  }

  function checkLifecycle(): void {
    if (
      process.platform !== "darwin" &&
      !hasMainWindow() &&
      !toolbar.visible &&
      recording.state.phase === "idle"
    )
      app.quit();
  }

  /** Closes dropdowns in the overlay windows, e.g. when the app is deactivated without their window blurring. */
  function dismissDropdowns(): void {
    for (const window of [toolbarWindow(), island.window]) {
      if (window && !window.isDestroyed()) window.webContents.send("overlay:dismiss");
    }
  }

  function hide(): void {
    toolbar.visible = false;
    clearInterval(toolbarTimer);
    toolbarTimer = undefined;
    toolbarOverlay?.reset();
    toolbarWindow()?.hide();
    notify();
    checkLifecycle();
  }

  function utilityWindow(surface: Surface): BrowserWindow {
    const window = new BrowserWindow({
      title: TITLES[surface],
      width: 400,
      height: 200,
      show: false,
      frame: false,
      resizable: false,
      maximizable: false,
      minimizable: false,
      fullscreenable: false,
      // The page draws the surface, its dropdowns, and empty room for them, so the window has no shadow or material.
      transparent: true,
      backgroundColor: "#00000000",
      hasShadow: false,
      // Without this, macOS keeps the top of the window below the menu bar, so empty dropdown room above the bar
      // would stop it being dragged to the top of the screen.
      enableLargerThanScreen: true,
      skipTaskbar: true,
      alwaysOnTop: true,
      acceptFirstMouse: true,
      // A panel is the only kind of window macOS lets join another app's full-screen space.
      ...(process.platform === "darwin" ? { type: "panel" as const } : {}),
      webPreferences: {
        preload: preloadPath,
        sandbox: true,
        contextIsolation: true,
        backgroundThrottling: false,
        scrollBounce: surface === "menubar",
        additionalArguments: [`--chord-surface=${surface}`],
      },
    });
    // The screen-saver level, with the window joined to every space, keeps it above full-screen apps.
    window.setAlwaysOnTop(true, "screen-saver");
    // These are native panels, so they can join full-screen spaces without transforming the whole app
    // into a UI element (which would hide its Dock icon even while the main window is open).
    if (process.platform === "darwin") {
      window.setVisibleOnAllWorkspaces(true, {
        visibleOnFullScreen: true,
        skipTransformProcessType: true,
      });
    }
    window.webContents.on("did-finish-load", () =>
      window.webContents.send("desktop:state", state()),
    );
    return window;
  }

  /** The toolbar's bar on screen: the top or bottom of its window, depending on which side its dropdowns open. */
  function toolbarRect(): Rect | null {
    const frame = toolbarWindow()?.getBounds();
    if (!frame) return null;
    const width = Math.min(frame.width, TOOLBAR_WIDTH);
    return {
      x: frame.x,
      y: toolbar.side === "above" ? frame.y + frame.height - TOOLBAR_HEIGHT : frame.y,
      width,
      height: TOOLBAR_HEIGHT,
    };
  }

  /** Puts the toolbar's bar at `rect`, kept within its work area, with room for dropdowns on the roomier side. */
  function placeToolbar(rect: Rect): void {
    const window = toolbarWindow();
    if (!window) return;
    const { workArea } = screen.getDisplayMatching(rect);
    const width = Math.min(TOOLBAR_WIDTH, workArea.width);
    const bar = {
      x: clamp(rect.x, workArea.x, workArea.x + workArea.width - width),
      y: clamp(rect.y, workArea.y, workArea.y + workArea.height - TOOLBAR_HEIGHT),
      width,
      height: TOOLBAR_HEIGHT,
    };
    const side = dropdownSide(bar, workArea);
    window.setBounds(overlayFrame(bar, side, "left", workArea));
    if (side !== toolbar.side) {
      toolbar.side = side;
      notify();
    }
  }

  async function show(): Promise<void> {
    if (recording.state.phase !== "idle") {
      hide();
      revealMain();
      return;
    }
    if (!defaults) {
      getMainWindow();
      await initialized;
    }
    if (!toolbarOverlay) {
      const window = utilityWindow("toolbar");
      toolbarOverlay = new OverlayWindow(window);
      const { workArea } = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
      const width = Math.min(TOOLBAR_WIDTH, workArea.width);
      placeToolbar({
        x: Math.round(workArea.x + (workArea.width - width) / 2),
        y: workArea.y + workArea.height - TOOLBAR_HEIGHT - 24,
        width,
        height: TOOLBAR_HEIGHT,
      });
      window.on("closed", () => {
        toolbarOverlay = undefined;
        toolbarLoading = undefined;
        clearInterval(toolbarTimer);
        toolbarTimer = undefined;
        toolbar.visible = false;
        if (!shuttingDown) {
          notify();
          checkLifecycle();
        }
      });
      toolbarLoading = loadSurface(window, "toolbar");
    }
    toolbar.visible = true;
    notify();
    await toolbarLoading;
    const overlay = toolbarOverlay;
    if (toolbar.visible && overlay && !overlay.window.isDestroyed()) {
      // A non-activating panel takes key focus without activating the app, which would switch away from a full-screen space.
      overlay.window.show();
      overlay.window.focus();
      toolbarTimer ??= setInterval(
        () => overlay.updateClicks(screen.getCursorScreenPoint(), toolbarRect()),
        POLL_INTERVAL,
      );
    }
  }

  ipcMain.handle("desktop:state", () => state());
  ipcMain.handle("desktop:initialize", (_event, setup: RecordingSetup) => {
    if (!defaults) {
      if (!isRecordingSetup(setup)) throw new Error("Invalid recording setup");
      saveDefaults(withoutPreferences(setup));
    }
    return state();
  });
  ipcMain.handle("desktop:defaults", (_event, patch: Partial<RecordingSetup>) => {
    if (!defaults) throw new Error("Recording setup is not initialized");
    saveDefaults(merged(defaults, patch));
    return state();
  });
  ipcMain.handle("preferences:update", (_event, patch: unknown) => {
    const previous = preferences.value;
    preferences.update(patch);
    // Cursor visibility and hidden apps take effect mid-recording too.
    const target = recording.state.target;
    if (
      target &&
      (preferences.value.showsCursor !== previous.showsCursor ||
        JSON.stringify(preferences.value.hiddenApps) !== JSON.stringify(previous.hiddenApps))
    ) {
      void recording
        .update(target.setup)
        .catch((error: unknown) =>
          console.error("Could not update the recording preferences", error),
        );
    }
    notify();
    return state();
  });
  ipcMain.handle("areas:pick", (event, current: unknown) => {
    dismissDropdowns();
    const picking = areas.pick(Array.isArray(current) ? current : []);
    return menubar && event.sender === menubar.window?.webContents
      ? menubar.hold(picking)
      : picking;
  });
  ipcMain.handle("main:open", (_event, route: unknown) => {
    if (!isRoute(route)) return;
    menubar?.hide();
    pendingRoute = route;
    const window = getMainWindow();
    // A main window still loading takes the route once its projects are in.
    if (!window.webContents.isLoading()) window.webContents.send("main:navigate");
    revealMain();
  });
  ipcMain.handle("main:take-route", (event) => {
    if (!hasMainWindow() || event.sender !== getMainWindow().webContents) return null;
    const route = pendingRoute;
    pendingRoute = null;
    return route;
  });
  ipcMain.handle("menubar:hide", () => menubar?.hide());
  ipcMain.handle("toolbar:show", show);
  ipcMain.handle("toolbar:hide", hide);
  // Dropdowns and drags in the toolbar and island pages.
  const overlayOf = (event: Electron.IpcMainEvent | Electron.IpcMainInvokeEvent) =>
    event.sender === toolbarWindow()?.webContents
      ? "toolbar"
      : event.sender === island.window?.webContents
        ? "island"
        : event.sender === notes.window?.webContents
          ? "notes"
          : menubar && event.sender === menubar.window?.webContents
            ? "menubar"
            : null;
  ipcMain.on("overlay:dropdown", (event, open: boolean) => {
    const owner = overlayOf(event);
    if (owner === "toolbar" && toolbarOverlay) toolbarOverlay.dropdownOpen = open === true;
    if (owner === "island") island.setDropdownOpen(open === true);
    if (owner === "menubar") menubar?.setDropdownOpen(open === true);
  });
  ipcMain.handle("overlay:drag-start", (event, edge?: unknown) => {
    const owner = overlayOf(event);
    if (owner === "toolbar") toolbarOverlay?.dragStart();
    if (owner === "island") island.dragStart();
    if (owner === "notes") notes.dragStart(edge);
  });
  ipcMain.on("overlay:drag-move", (event, dx: number, dy: number) => {
    const owner = overlayOf(event);
    if (owner === "toolbar") toolbarOverlay?.dragMove(dx, dy);
    if (owner === "island") island.dragMove(dx, dy);
    if (owner === "notes") notes.dragMove(dx, dy);
  });
  ipcMain.handle("overlay:drag-end", (event) => {
    const owner = overlayOf(event);
    if (owner === "island") island.dragEnd();
    if (owner === "notes") notes.dragEnd();
    if (owner !== "toolbar" || !toolbarOverlay?.dragEnd()) return;
    // Dropped in the other half of the screen, its dropdowns open on the other side.
    const rect = toolbarRect();
    if (rect) placeToolbar(rect);
  });

  // Every entry point hands control to the island, including during the countdown.
  const start = (setup: RecordingSetup, projectId?: string, notes?: unknown, folder?: unknown) => {
    const options = {
      projectId,
      notes: isNotePages(notes) ? notes : [],
      folder: typeof folder === "string" ? folder : undefined,
      countdown: preferences.value.countdown,
    };
    if (recording.start(setup, options)) {
      if (hasMainWindow()) getMainWindow().hide();
      hide();
      menubar?.hide();
    }
  };
  ipcMain.handle(
    "recording:start",
    (_event, setup: RecordingSetup, projectId?: string, notes?: unknown, folder?: unknown) =>
      start(setup, projectId, notes, folder),
  );
  ipcMain.handle("recording:quick-start", () => {
    if (defaults) start(defaults);
  });
  ipcMain.handle("recording:pause", () => recording.pause());
  ipcMain.handle("recording:resume", () => recording.resume());
  ipcMain.handle("recording:mark", () => recording.addMark());
  ipcMain.handle("recording:page", (_event, page: unknown) => {
    if (typeof page === "number") recording.setPage(page);
  });
  ipcMain.handle("recording:laser", (_event, on: unknown) => recording.setLaser(on === true));
  ipcMain.handle("recording:clicks", (_event, on: unknown) => recording.setClicks(on === true));
  ipcMain.handle("recording:keys", (_event, on: unknown) => recording.setKeys(on === true));
  ipcMain.handle("recording:cancel", () => {
    if (recording.state.phase === "idle") return;
    recording.cancel();
    revealMain();
  });
  ipcMain.handle("recording:stop", async () => {
    const active = recording.state.phase !== "idle";
    const stopping = recording.stop();
    if (active) revealMain();
    const take = await stopping;
    if (!take) return;
    // Queued rather than returned, so a take finished from the island is saved by the main window, even a new one.
    finished.push(take);
    notify();
  });
  ipcMain.handle("recording:update", async (_event, patch: Partial<RecordingSetup>) => {
    const target = recording.state.target;
    if (!target) throw new Error("Not recording");
    await recording.update(merged(target.setup, patch));
    return state();
  });
  ipcMain.handle("recording:trash", (_event, directories: unknown) =>
    trashRecordings(recordingsFolder(), Array.isArray(directories) ? directories : []),
  );
  ipcMain.handle("recordings:folder", () => {
    const folder = recordingsFolder();
    const home = homedir();
    return folder === home || folder.startsWith(`${home}/`)
      ? `~${folder.slice(home.length)}`
      : folder;
  });
  ipcMain.handle("recordings:open", () => openRecordingsFolder());
  ipcMain.handle("recording:reveal", (_event, directory: unknown) =>
    revealRecording(recordingsFolder(), directory),
  );
  ipcMain.handle("recording:claim", (event) => {
    if (!hasMainWindow() || event.sender !== getMainWindow().webContents) return [];
    const takes = finished.splice(0);
    if (takes.length > 0) notify();
    return takes;
  });

  /** Registers the shortcuts that work in every app: the toolbar's always, and the recording ones while recording. */
  function registerShortcuts(): void {
    const bindings = resolveShortcuts(preferences.value.shortcuts);
    const capturing = recording.state.phase === "recording" || recording.state.phase === "paused";
    const wanted = new Map<ShortcutId, string>();
    for (const id of GLOBAL_SHORTCUTS) {
      const binding = bindings[id];
      // A recording shortcut saved before they needed a modifier would take the key from typing everywhere.
      if (
        !binding ||
        (id !== "toolbar" && !capturing) ||
        bindingProblem(id, binding, process.platform === "darwin")
      )
        continue;
      const accelerator = toAccelerator(binding);
      if (accelerator) wanted.set(id, accelerator);
    }
    for (const [id, accelerator] of registeredShortcuts) {
      if (!suspendedShortcuts && wanted.get(id) === accelerator) continue;
      globalShortcut.unregister(accelerator);
      registeredShortcuts.delete(id);
    }
    // Suspending leaves `toolbar.registered` alone so Settings doesn't flash a warning.
    if (suspendedShortcuts) return;
    for (const [id, accelerator] of wanted) {
      if (registeredShortcuts.has(id)) continue;
      if (globalShortcut.register(accelerator, () => onShortcut(id)))
        registeredShortcuts.set(id, accelerator);
      else console.warn(`Could not register ${accelerator} for ${id}.`);
    }
    // No shortcut at all isn't a failure to warn about.
    toolbar.registered = !wanted.has("toolbar") || registeredShortcuts.has("toolbar");
  }

  function onShortcut(id: ShortcutId): void {
    if (id === "pauseRecording") {
      if (recording.state.phase === "recording") recording.pause();
      else recording.resume();
    } else if (id === "addMark") recording.addMark();
    else if (recording.state.phase !== "idle") {
      hide();
      revealMain();
    } else if (toolbar.visible) hide();
    else void show();
  }

  registerShortcuts();
  preferences.onChange(registerShortcuts);
  // Pressing a current shortcut while recording a new one would otherwise run it instead.
  ipcMain.handle("shortcuts:suspend", (_event, on: unknown) => {
    suspendedShortcuts = on === true;
    registerShortcuts();
    if (!suspendedShortcuts) notify();
  });
  const adjustToDisplays = () => {
    dismissDropdowns();
    island.place();
    notes.place();
    menubar?.hide();
    const rect = toolbarRect();
    if (rect) placeToolbar(rect);
  };
  screen.on("display-removed", adjustToDisplays);
  screen.on("display-metrics-changed", adjustToDisplays);
  // macOS can keep a key window in this app even when another app becomes active.
  // Dismiss explicitly on app deactivation instead of relying only on individual window blur events.
  app.on("did-resign-active", () => {
    if (!shuttingDown) dismissDropdowns();
  });
  app.on("browser-window-focus", (_event, window) => {
    if (!shuttingDown && window !== toolbarWindow() && window !== island.window) dismissDropdowns();
  });
  app.on("before-quit", () => {
    shuttingDown = true;
    recording.dispose();
    island.dispose();
    notes.dispose();
    pointer.dispose();
    areas.dispose();
    menubar?.dispose();
  });
  return { lifecycle: checkLifecycle, recording: () => recording.state.phase !== "idle" };
}
