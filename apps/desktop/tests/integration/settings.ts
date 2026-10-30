// Run after building: env -u ELECTRON_RUN_AS_NODE pnpm exec electron tests/integration/settings.ts
import { app, BrowserWindow } from "electron";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, mkdirSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import { click, evaluate, eventually, screenshot, until } from "../support/integration.ts";
const data = mkdtempSync(join(tmpdir(), "chord-settings-test-"));
app.setPath("userData", data);
app.on("quit", () =>
  rmSync(data, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }),
);
const helperLog = join(data, "helper.log");
const sessionDirectory = join(data, "recordings", "session");
mkdirSync(sessionDirectory, { recursive: true });
const fixture = join(data, "helper.cjs");
writeFileSync(
  fixture,
  `#!/usr/bin/env node
const { appendFileSync } = require('node:fs');
require('node:readline').createInterface({input:process.stdin}).on('line', line => {
  const request = JSON.parse(line);
  appendFileSync(${JSON.stringify(helperLog)}, line + '\\n');
  const result = request.method === 'listSources' ? {displays:[],applications:[],windows:[],microphones:[],cameras:[]}
    : ['setScreenPreview','setAudioPreview'].includes(request.method) ? {failures:[]}
    : request.method === 'getPermissions' ? {screen:'granted',microphone:'granted',camera:'granted',accessibility:'granted'}
    : ['startSession','stopSession'].includes(request.method) ? {id:'session',directory:${JSON.stringify(sessionDirectory)},state:'recording'}
    : null;
  process.stdout.write(JSON.stringify({jsonrpc:'2.0', id:request.id, result}) + '\\n');
});
`,
  { mode: 0o755 },
);
process.env.CHORD_RECORDER_HELPER = fixture;
process.env.CHORD_RECORDINGS_FOLDER = join(data, "recordings");
const speechFixture = join(data, "speech.cjs");
writeFileSync(
  speechFixture,
  `#!/usr/bin/env node
console.log(JSON.stringify({status:'installed',locale:'en-CA',locales:['en-CA','fr-CA'],system:'en-CA'}));
`,
  { mode: 0o755 },
);
process.env.CHORD_TRANSCRIBER_HELPER = speechFixture;
const rendererErrors: string[] = [];
app.on("browser-window-created", (_event, win: BrowserWindow) =>
  win.webContents.on("console-message", (event) => {
    if (/^Uncaught/.test(event.message)) {
      console.error("Renderer error:", event.message, event.sourceId, event.lineNumber);
      rendererErrors.push(event.message);
    }
  }),
);
app.whenReady().then(async () => {
  try {
    await import(pathToFileURL(resolve(import.meta.dirname, "../../out/main/index.js")).href);
    let main!: BrowserWindow;
    await until(
      () =>
        (main = BrowserWindow.getAllWindows().find((win: BrowserWindow) =>
          win.webContents.getURL().includes("surface=main"),
        )!),
    );
    await until(() => evaluate(main, '!!document.querySelector("[aria-label=Settings]")'));
    await until(
      () => evaluate(main, "window.chord.desktop.getState().then(s => !!s.defaults)"),
      "recording defaults",
    );
    const cursor = (await evaluate(main, "window.chord.desktop.getState()")).preferences
      .showsCursor;
    const systemUI = (await evaluate(main, "window.chord.desktop.getState()")).defaults
      .showsSystemUI;
    for (const mode of ["window", "display", "area"] as const) {
      await evaluate(main, `window.chord.desktop.updateDefaults({mode:${JSON.stringify(mode)}})`);
      await click(
        main,
        `document.querySelector('[data-source-toggle="screen"] + [data-popup-trigger]')`,
      );
      await click(main, `document.querySelector('[aria-label="Hide mouse cursor"]')`);
      await until(
        async () =>
          (await evaluate(main, "window.chord.desktop.getState()")).preferences.showsCursor ===
          !cursor,
        "cursor preference saved",
      );
      assert.equal(
        (await evaluate(main, "window.chord.desktop.getState()")).defaults.showsSystemUI,
        systemUI,
        "Cursor visibility keeps Mac UI unchanged",
      );
      await click(main, `document.querySelector('[aria-label="Hide mouse cursor"]')`);
      await until(
        async () =>
          (await evaluate(main, "window.chord.desktop.getState()")).preferences.showsCursor ===
          cursor,
        "cursor preference restored",
      );
      main.webContents.sendInputEvent({ type: "keyDown", keyCode: "Escape" });
      main.webContents.sendInputEvent({ type: "keyUp", keyCode: "Escape" });
      await until(
        () => evaluate(main, '!document.querySelector("[role=menu]")'),
        "screen popover closed",
      );
    }
    await evaluate(main, `window.chord.desktop.updateDefaults({mode:'window'})`);
    await evaluate(main, 'document.querySelector("[aria-label=Settings]").click()');
    await until(
      () => evaluate(main, '!!document.querySelector("#settings-panel-general")'),
      "General settings",
    );
    assert.deepEqual(
      await evaluate(
        main,
        'Array.from(document.querySelectorAll("[role=tab]")).map(tab => tab.textContent.trim())',
      ),
      ["General", "Shortcuts", "Recording", "Transcription", "Audio", "Backgrounds", "Privacy"],
    );
    const selectSettings = async (id: string) => {
      await click(main, `document.querySelector('#settings-tab-${id}')`);
      await until(
        () => evaluate(main, `!!document.querySelector('#settings-panel-${id}')`),
        `${id} settings`,
      );
      assert.equal(
        await evaluate(main, 'document.querySelectorAll("[role=tabpanel]").length'),
        1,
        "Only the current settings panel is mounted",
      );
    };
    await selectSettings("shortcuts");
    const shortcuts = async () =>
      (await evaluate(main, "window.chord.desktop.getState()")).preferences.shortcuts;
    const pressKey = (
      keyCode: string,
      modifiers: NonNullable<Electron.KeyboardInputEvent["modifiers"]> = [],
    ) => {
      main.webContents.sendInputEvent({ type: "keyDown", keyCode, modifiers });
      main.webContents.sendInputEvent({ type: "keyUp", keyCode, modifiers });
    };
    // Giving split the snapping key takes it from snapping, which is pressed in the same place.
    await evaluate(
      main,
      "document.querySelector('[aria-label=\"Change Split at playhead\"]').click()",
    );
    await until(
      () =>
        evaluate(
          main,
          'document.querySelector(\'[aria-label="Change Split at playhead"]\').textContent.includes("Press keys")',
        ),
      "listening for split keys",
    );
    pressKey("S");
    await until(async () => {
      const value = await shortcuts();
      return value.split === "KeyS" && value.snapping === null && Object.keys(value).length === 2;
    }, "split shortcut saved");
    assert.ok(
      await evaluate(
        main,
        'document.querySelector(\'[data-shortcut="split"]\').textContent.includes("Removed from Turn snapping on or off")',
      ),
    );
    // Global shortcuts need a modifier, and Escape cancels without changing anything.
    await evaluate(
      main,
      "document.querySelector('[aria-label=\"Change Show or hide the recording toolbar\"]').click()",
    );
    pressKey("T");
    await until(
      () =>
        evaluate(
          main,
          'document.querySelector(\'[data-shortcut="toolbar"]\').textContent.includes("so typing in other apps still works")',
        ),
      "global shortcut needs a modifier",
    );
    await evaluate(
      main,
      "document.querySelector('[aria-label=\"Change Show or hide the recording toolbar\"]').click()",
    );
    pressKey("Escape");
    await until(
      () =>
        evaluate(
          main,
          '!!document.querySelector("dialog[open]") && !document.querySelector(\'[aria-label="Change Show or hide the recording toolbar"]\').textContent.includes("Press keys")',
        ),
      "Escape cancels without closing settings",
    );
    await evaluate(
      main,
      "document.querySelector('[aria-label=\"Change Show or hide the recording toolbar\"]').click()",
    );
    pressKey("T", ["control", "alt"]);
    await until(
      async () => (await shortcuts()).toolbar === "Ctrl+Alt+KeyT",
      "toolbar shortcut saved",
    );
    assert.equal(
      (await evaluate(main, "window.chord.desktop.getState()")).toolbar.registered,
      true,
      "the new global shortcut is registered",
    );
    await evaluate(
      main,
      'Array.from(document.querySelectorAll("button")).find(button => button.textContent.trim() === "Reset all shortcuts").click()',
    );
    await until(async () => Object.keys(await shortcuts()).length === 0, "shortcuts reset");
    await selectSettings("recording");
    assert.equal(
      await evaluate(main, `!!document.querySelector('[aria-label="Hide mouse cursor"]')`),
      false,
      "Cursor control belongs to the screen popover",
    );
    const mirrored = (await evaluate(main, "window.chord.desktop.getState()")).preferences
      .cameraMirrored;
    await evaluate(
      main,
      "document.querySelector('[aria-label=\"Mirror camera preview\"]').click()",
    );
    await until(
      async () =>
        (await evaluate(main, "window.chord.desktop.getState()")).preferences.cameraMirrored !==
        mirrored,
      "camera preference saved",
    );
    await selectSettings("transcription");
    assert.equal(
      await evaluate(
        main,
        "!!document.querySelector('[aria-label=\"Transcription model\"]') && !document.querySelector('[aria-label=\"Countdown\"]')",
      ),
      true,
    );
    await until(
      () =>
        evaluate(
          main,
          'Array.from(document.querySelectorAll("[role=radio]")).some(button => button.textContent.includes("Apple Speech") && !button.disabled)',
        ),
      "Apple Speech fixture",
    );
    await evaluate(
      main,
      'Array.from(document.querySelectorAll("[role=radio]")).find(button => button.textContent.includes("Apple Speech")).click()',
    );
    await until(
      async () =>
        (await evaluate(main, "window.chord.desktop.getState()")).preferences.transcriptionModel ===
        "apple-speech",
      "transcription model saved",
    );
    await until(
      () =>
        evaluate(
          main,
          'Array.from(document.querySelectorAll("button")).some(button => button.textContent.trim() === "Test")',
        ),
      "transcription test control",
    );
    // A generated audio track exercises the test lifecycle without microphone permission or hardware.
    await evaluate(
      main,
      `(() => {
      window.settingsTestAudio = new AudioContext();
      window.settingsTestStream = window.settingsTestAudio.createMediaStreamDestination().stream;
      navigator.mediaDevices.getUserMedia = async () => window.settingsTestStream;
      Array.from(document.querySelectorAll('button')).find(button => button.textContent.trim() === 'Test').click();
    })()`,
    );
    await until(
      () =>
        evaluate(
          main,
          'Array.from(document.querySelectorAll("button")).some(button => button.textContent.trim() === "Stop")',
        ),
      "test recording started",
    );
    await selectSettings("privacy");
    await until(
      () =>
        evaluate(
          main,
          'window.settingsTestStream.getTracks().every(track => track.readyState === "ended")',
        ),
      "leaving Transcription releases the microphone",
    );
    await evaluate(main, "window.settingsTestAudio.close()");
    await selectSettings("audio");
    await until(
      () =>
        evaluate(
          main,
          "document.querySelectorAll('[aria-label=\"Noise reduction engine\"] [role=radio]').length === 2",
        ),
      "both noise reduction engines",
    );
    const engineRows = await evaluate(
      main,
      'Array.from(document.querySelectorAll(\'[aria-label="Noise reduction engine"] [role=radio]\')).map(row => ({ name: row.textContent, disabled: row.disabled, checked: row.getAttribute("aria-checked") }))',
    );
    assert.ok(
      engineRows[0].name.includes("Apple Sound Isolation") &&
        engineRows[1].name.includes("DeepFilterNet3"),
    );
    assert.ok(
      engineRows[1].disabled && engineRows[1].checked === "false",
      "DeepFilterNet3 cannot be chosen until it is downloaded",
    );
    assert.equal(
      await evaluate(
        main,
        'Array.from(document.querySelectorAll("button")).some(button => button.textContent.trim() === "Download")',
      ),
      true,
      "and offers its download",
    );
    await selectSettings("background");
    assert.equal(
      await evaluate(
        main,
        '!!document.querySelector(\'[aria-label="Background removal model"]\') && !!document.querySelector("#background-blur")',
      ),
      true,
    );
    await evaluate(
      main,
      'document.querySelector(\'[aria-label="Background replacement"] [role=radio]:last-child, [aria-label="Background replacement"] button:last-child\').click()',
    );
    await until(
      () =>
        evaluate(
          main,
          '!!document.querySelector("#background-color") && !document.querySelector("#background-blur")',
        ),
      "color replacement shown",
    );
    assert.equal(
      (await evaluate(main, "window.chord.desktop.getState()")).preferences.backgroundReplacement,
      "color",
    );
    await evaluate(main, 'document.querySelector("#background-color").click()');
    await until(
      () =>
        evaluate(
          main,
          `(() => {
      const plane = document.querySelector('[aria-label="Color saturation and brightness"]');
      if (!plane) return false;
      const r = plane.getBoundingClientRect();
      return [0.1, 0.9].every(at => plane.contains(document.elementFromPoint(r.x + r.width * at, r.y + r.height * at)));
    })()`,
        ),
      "color picker visible inside settings dialog",
    );
    await evaluate(
      main,
      `(() => { const input = document.querySelector('[aria-label="Hex color"]'); input.value = '123abc'; input.dispatchEvent(new Event('input', { bubbles: true })); input.dispatchEvent(new Event('change', { bubbles: true })); })()`,
    );
    await until(
      async () =>
        (await evaluate(main, "window.chord.desktop.getState()")).preferences.backgroundColor ===
        "#123abc",
      "custom color saved",
    );
    await evaluate(
      main,
      `(() => { const input = document.querySelector('[aria-label="Opacity"]'); input.value = '50'; input.dispatchEvent(new Event('input', { bubbles: true })); })()`,
    );
    await until(
      async () =>
        (await evaluate(main, "window.chord.desktop.getState()")).preferences.backgroundColor ===
        "#123abc80",
      "background removal opacity saved",
    );
    // Exercise the per-recording IPC handler as well as the default preference: the inspector uses background:update.
    const transparentTake = join(data, "recordings", "transparent-camera");
    mkdirSync(join(transparentTake, "backgrounds", "fixture"), { recursive: true });
    writeFileSync(
      join(transparentTake, "session.json"),
      JSON.stringify({
        version: 1,
        id: "transparent-camera",
        createdAt: new Date().toISOString(),
        hostTimeOrigin: 0,
        config: {},
        pauses: [],
        marks: [],
        tracks: [
          {
            id: "camera",
            kind: "camera",
            source: "camera",
            segments: [{ file: "camera.mp4", start: 0, end: 1 }],
          },
        ],
      }),
    );
    writeFileSync(join(transparentTake, "backgrounds", "fixture", "0.mp4"), "mask");
    writeFileSync(join(transparentTake, "camera.mp4"), "camera");
    writeFileSync(
      join(transparentTake, "background.json"),
      JSON.stringify({
        version: 1,
        model: "modnet",
        masks: { "camera.mp4": "backgrounds/fixture/0.mp4" },
        settings: { enabled: true, replacement: "color", blur: 40, color: "#060606" },
      }),
    );
    const opacitySetup = (await evaluate(main, "window.chord.desktop.getState()")).defaults;
    const opacityTime = new Date().toISOString();
    const opacityProject = {
      id: "opacity",
      name: "Opacity",
      createdAt: opacityTime,
      updatedAt: opacityTime,
      notes: [],
      setup: opacitySetup,
      recordings: [
        {
          id: "take",
          createdAt: opacityTime,
          directory: transparentTake,
          duration: 1,
          mode: null,
          hasCamera: true,
          hasMicrophone: false,
          hasSystemAudio: false,
          markCount: 0,
          pageChanges: [],
          annotations: { laser: [], clicks: [], keys: [] },
        },
      ],
    };
    await evaluate(main, `window.chord.desktop.projects.put([${JSON.stringify(opacityProject)}])`);
    for (const color of ["#060606ad", "#06060600", "#06060680", "#060606"] as const) {
      const updated = await evaluate(
        main,
        `window.chord.desktop.background.update(${JSON.stringify(transparentTake)}, { color: ${JSON.stringify(color)} })`,
      );
      assert.equal(
        updated.result.settings.color,
        color,
        "The recording inspector IPC accepts transparent colors",
      );
      assert.equal(
        JSON.parse(readFileSync(join(transparentTake, "background.json"), "utf8")).settings.color,
        color,
        "The recording opacity is saved",
      );
    }
    await evaluate(
      main,
      'document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))',
    );
    await eventually(
      async () =>
        assert.equal(
          await evaluate(
            main,
            '!!document.querySelector("dialog[open]") && document.activeElement.id === "background-color"',
          ),
          true,
          "Escape closes only the picker and restores focus",
        ),
      "the picker to close",
    );
    await selectSettings("privacy");
    assert.equal(
      await evaluate(
        main,
        'document.querySelector("[role=tabpanel]").innerText.includes("Permissions")',
      ),
      true,
    );
    await evaluate(
      main,
      'document.querySelector("#settings-tab-privacy").dispatchEvent(new KeyboardEvent("keydown", {key:"ArrowDown", bubbles:true}))',
    );
    await until(
      () =>
        evaluate(
          main,
          'document.activeElement?.id === "settings-tab-general" && !!document.querySelector("#settings-panel-general")',
        ),
      "keyboard navigation wraps to General",
    );
    for (const [key, expected] of [
      ["End", "privacy"],
      ["ArrowUp", "background"],
      ["Home", "general"],
    ] as const) {
      await evaluate(
        main,
        `document.activeElement.dispatchEvent(new KeyboardEvent('keydown', {key:${JSON.stringify(key)}, bubbles:true}))`,
      );
      await until(
        () =>
          evaluate(
            main,
            `document.activeElement?.id === 'settings-tab-${expected}' && document.activeElement.getAttribute('aria-selected') === 'true'`,
          ),
        `${key} selects ${expected}`,
      );
    }
    const settingsBounds = main.getBounds();
    for (const width of [1100, 480, 320] as const) {
      main.setContentSize(width, 800);
      for (const id of [
        "general",
        "shortcuts",
        "recording",
        "transcription",
        "background",
        "privacy",
      ] as const) {
        await selectSettings(id);
        if (id === "transcription")
          await until(
            () =>
              evaluate(main, "!!document.querySelector('[aria-label=\"Apple Speech language\"]')"),
            "speech language selector",
          );
        await evaluate(main, "document.activeElement?.blur()");
        await evaluate(
          main,
          "new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))",
        );
        const layout = await evaluate(
          main,
          `(() => {
          const sidebar = document.querySelector('[role=tablist]').getBoundingClientRect();
          const panel = document.querySelector('[role=tabpanel]');
          const area = panel.getBoundingClientRect();
          return {sidebarRight:sidebar.right, sidebarBottom:sidebar.bottom, panelLeft:area.left, panelTop:area.top, width:panel.clientWidth, content:panel.scrollWidth};
        })()`,
        );
        // Narrow windows move the tabs into a row above the content.
        if (width >= 640)
          assert.ok(
            layout.sidebarRight <= layout.panelLeft,
            "Settings tabs stay to the left of the content",
          );
        else
          assert.ok(layout.sidebarBottom <= layout.panelTop, "Settings tabs sit above the content");
        assert.ok(
          layout.content <= layout.width + 1,
          `${id} settings fit at ${width}px: ${JSON.stringify(layout)}`,
        );
        await screenshot(main, `settings-${id}-${width}`);
      }
    }
    main.setBounds(settingsBounds);
    await selectSettings("recording");
    assert.equal(
      await evaluate(
        main,
        'document.querySelector(\'[aria-label="Mirror camera preview"]\').getAttribute("aria-checked")',
      ),
      String(!mirrored),
      "Preferences survive switching tabs",
    );
    await evaluate(main, `window.chord.desktop.updatePreferences({cameraMirrored:${mirrored}})`);
    // The global preference reaches capture and live updates without changing Mac UI visibility.
    const sessionRequest = (method: string) =>
      readFileSync(helperLog, "utf8")
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line))
        .filter((r) => r.method === method)
        .at(-1)?.params;
    await evaluate(main, `window.chord.desktop.updatePreferences({countdown:0,showsCursor:false})`);
    await evaluate(
      main,
      `window.chord.desktop.getState().then(s => window.chord.desktop.recording.start({...s.defaults,mode:'display',showsSystemUI:false}))`,
    );
    await until(() => sessionRequest("startSession"), "capture started");
    assert.equal(sessionRequest("startSession").screen.showsCursor, false);
    for (const showsCursor of [true, false] as const) {
      await evaluate(main, `window.chord.desktop.updatePreferences({showsCursor:${showsCursor}})`);
      await until(
        () => sessionRequest("updateSession")?.screen.showsCursor === showsCursor,
        "live cursor preference",
      );
      assert.equal(
        sessionRequest("updateSession").screen.mode.showsSystemUI,
        false,
        "Cursor visibility keeps Mac UI hidden",
      );
      assert.equal(
        JSON.parse(readFileSync(join(data, "preferences.json"), "utf8")).showsCursor,
        showsCursor,
      );
    }
    await evaluate(main, "window.chord.desktop.recording.cancel()");
    await until(() => !existsSync(sessionDirectory), "discarded fixture recording");
    assert.deepEqual(rendererErrors, [], "Pages must not throw uncaught errors");
    console.log(
      "PASS: settings sections, current panel, keyboard navigation, preference persistence, live cursor capture updates, transcription cleanup, and layout at 1100, 480, and 320px",
    );
    app.quit();
  } catch (error) {
    console.error(error);
    app.exit(1);
  }
});
