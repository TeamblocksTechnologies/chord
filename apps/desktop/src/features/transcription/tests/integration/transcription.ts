// Run after building: env -u ELECTRON_RUN_AS_NODE pnpm exec electron src/features/transcription/tests/integration/transcription.ts
import { app, BrowserWindow, protocol } from "electron";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
  cpSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
const data = mkdtempSync(join(tmpdir(), "chord-transcription-ui-"));
app.setPath("userData", data);
protocol.registerSchemesAsPrivileged([
  {
    scheme: "chord-media",
    privileges: {
      standard: true,
      secure: true,
      stream: true,
      supportFetchAPI: true,
      corsEnabled: true,
    },
  },
]);
app.on("quit", () =>
  rmSync(data, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }),
);
const fixture = join(data, "helper.cjs");
writeFileSync(
  fixture,
  `#!/usr/bin/env node
require('node:readline').createInterface({input:process.stdin}).on('line', line => {
  const request = JSON.parse(line);
  const result = request.method === 'listSources' ? {displays:[],applications:[],windows:[],microphones:[],cameras:[]}
    : ['setScreenPreview','setAudioPreview'].includes(request.method) ? {failures:[]}
    : request.method === 'getPermissions' ? {screen:'granted',microphone:'granted',camera:'granted',accessibility:'granted'} : null;
  process.stdout.write(JSON.stringify({jsonrpc:'2.0', id:request.id, result}) + '\\n');
});
`,
  { mode: 0o755 },
);
process.env.CHORD_RECORDER_HELPER = fixture;
process.env.CHORD_RECORDINGS_FOLDER = join(data, "recordings");
const modelLog = join(data, "transcriptions.log");
const speechFixture = join(data, "speech.cjs");
writeFileSync(
  speechFixture,
  `#!/usr/bin/env node
const { appendFileSync } = require('node:fs');
const args = process.argv.slice(2);
if (args[0] === 'speech-assets') console.log(JSON.stringify({status:'installed',locale:'en-CA',locales:['en-CA'],system:'en-CA'}));
else {
  appendFileSync(${JSON.stringify(modelLog)}, JSON.stringify(args) + '\\n');
  const text = args[1].endsWith('b.m4a') ? 'Later explanation.' : 'Local transcription.';
  setTimeout(() => console.log(JSON.stringify({text, words:text.split(' ').map((text,index)=>({start:index===0?0.25:0.85,end:index===0?0.75:1.5,text}))})), 100);
}
`,
  { mode: 0o755 },
);
process.env.CHORD_TRANSCRIBER_HELPER = speechFixture;
const session = join(data, "recordings", "Captions", "manual");
mkdirSync(session, { recursive: true });
const ffmpeg = (...args: string[]) => execFileSync("ffmpeg", ["-v", "error", "-y", ...args]);
ffmpeg(
  "-f",
  "lavfi",
  "-i",
  "color=blue:size=640x360:rate=30:duration=2",
  "-pix_fmt",
  "yuv420p",
  join(session, "screen.mov"),
);
for (const suffix of ["a", "b"] as const)
  ffmpeg(
    "-f",
    "lavfi",
    "-i",
    "sine=frequency=440:sample_rate=48000:duration=1.9",
    "-c:a",
    "alac",
    join(session, `mic-${suffix}.m4a`),
  );
writeFileSync(
  join(session, "session.json"),
  JSON.stringify({
    version: 1,
    id: "take",
    createdAt: "2026-10-21T12:00:00Z",
    hostTimeOrigin: 0,
    config: {},
    pauses: [{ start: 2, end: 3 }],
    marks: [],
    stoppedAt: 5,
    tracks: [
      {
        id: "screen",
        kind: "screen",
        source: "display:1",
        display: { id: 1, frame: { x: 0, y: 0, width: 640, height: 360 }, scale: 1 },
        segments: [
          { file: "screen.mov", start: 0, end: 2 },
          { file: "screen.mov", start: 3, end: 5 },
        ],
      },
      {
        id: "mic",
        kind: "microphone",
        source: "mic",
        segments: [
          { file: "mic-a.m4a", start: 0.1, end: 2 },
          { file: "mic-b.m4a", start: 3.1, end: 5 },
        ],
      },
    ],
  }),
);
const automatic = join(data, "recordings", "Automatic", "auto");
cpSync(session, automatic, { recursive: true });
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(check: () => unknown | Promise<unknown>, message = "UI state") {
  for (let i = 0; i < 600; i++) {
    if (await check()) return;
    await pause(50);
  }
  throw new Error(`Timed out waiting for ${message}`);
}
const evaluate = (win: BrowserWindow, expression: string) =>
  win.webContents.executeJavaScript(expression).catch((error) => {
    console.error("Renderer evaluation failed:", expression);
    throw error;
  });
async function dragWords(win: BrowserWindow, first: number, last: number, backwards = false) {
  const points = await evaluate(
    win,
    `(() => {
    const words=[...document.querySelectorAll('[data-transcript-word]')];
    const a=words[${first}].getBoundingClientRect(), b=words[${last}].getBoundingClientRect();
    return {from:{x:Math.round(${backwards ? "b.right-2" : "a.left+2"}),y:Math.round(${backwards ? "b.top+b.height/2" : "a.top+a.height/2"})},
      to:{x:Math.round(${backwards ? "a.left+2" : "b.right-2"}),y:Math.round(${backwards ? "a.top+a.height/2" : "b.top+b.height/2"})}};
  })()`,
  );
  win.focus();
  win.webContents.focus();
  await pause(100);
  win.webContents.sendInputEvent({
    type: "mouseDown",
    ...points.from,
    button: "left",
    clickCount: 1,
  });
  for (let i = 1; i <= 8; i++) {
    win.webContents.sendInputEvent({
      type: "mouseMove",
      x: Math.round(points.from.x + ((points.to.x - points.from.x) * i) / 8),
      y: Math.round(points.from.y + ((points.to.y - points.from.y) * i) / 8),
      button: "left",
      modifiers: ["leftbuttondown"],
    });
    await pause(15);
  }
  win.webContents.sendInputEvent({ type: "mouseUp", ...points.to, button: "left", clickCount: 1 });
  await pause(100);
}
function key(
  win: BrowserWindow,
  keyCode: string,
  modifiers: NonNullable<Electron.KeyboardInputEvent["modifiers"]> = [],
) {
  win.webContents.sendInputEvent({ type: "keyDown", keyCode, modifiers });
  win.webContents.sendInputEvent({ type: "keyUp", keyCode, modifiers });
}
const calls = () =>
  existsSync(modelLog) ? readFileSync(modelLog, "utf8").trim().split("\n").length : 0;
async function screenshot(win: BrowserWindow, label: string) {
  if (!process.env.CHORD_TEST_SCREENSHOTS) return;
  mkdirSync(process.env.CHORD_TEST_SCREENSHOTS, { recursive: true });
  await pause(200);
  writeFileSync(
    join(process.env.CHORD_TEST_SCREENSHOTS, `${label}.png`),
    (await win.webContents.capturePage()).toPNG(),
  );
}
app.whenReady().then(async () => {
  let main!: BrowserWindow;
  try {
    await import(
      pathToFileURL(resolve(import.meta.dirname, "../../../../../out/main/index.js")).href
    );
    await until(
      () =>
        (main = BrowserWindow.getAllWindows().find((win: BrowserWindow) =>
          win.webContents.getURL().includes("surface=main"),
        )!),
    );
    const rendererErrors: string[] = [];
    main.webContents.on("console-message", (event) => {
      if (/^Uncaught/.test(event.message)) {
        rendererErrors.push(event.message);
        console.error(event.message);
      }
    });
    await until(() => evaluate(main, '!!document.querySelector("[aria-label=Settings]")'));
    const desktop = "window.chord.desktop";
    await evaluate(main, `${desktop}.projects.load()`);
    const setup = await evaluate(main, `${desktop}.getState().then(s=>s.defaults)`);
    const now = new Date().toISOString();
    const project = (id: string, directory: string) => ({
      id,
      name: id === "auto" ? "Automatic" : "Captions",
      createdAt: now,
      updatedAt: now,
      notes: [],
      setup,
      recordings: [
        {
          id: "take",
          createdAt: now,
          duration: 4,
          mode: "display",
          hasMicrophone: true,
          hasCamera: false,
          hasSystemAudio: false,
          markCount: 0,
          pageChanges: [],
          directory,
          annotations: { laser: [], clicks: [], keys: [] },
        },
      ],
    });
    await evaluate(
      main,
      `${desktop}.updatePreferences({transcriptionModel:'apple-speech',autoTranscribe:true})`,
    );
    await evaluate(
      main,
      `${desktop}.projects.put([${JSON.stringify(project("auto", automatic))}])`,
    );
    await until(
      () =>
        evaluate(
          main,
          `${desktop}.transcription.get(${JSON.stringify(automatic)}).then(s=>s.phase==='done')`,
        ),
      "automatic transcription without opening the project",
    );
    assert.equal(
      calls(),
      2,
      "Automatically transcribes every microphone segment immediately after project creation",
    );
    await evaluate(main, `${desktop}.updatePreferences({autoTranscribe:false})`);
    await evaluate(
      main,
      `${desktop}.projects.put([${JSON.stringify(project("manual", session))}])`,
    );
    await pause(300);
    assert.equal(calls(), 2, "Auto-transcription off does not run the local model");
    main.webContents.reload();
    await until(() =>
      evaluate(
        main,
        `[...document.querySelectorAll('[data-projects] > div > button:first-child')].some(b=>b.textContent.includes('Captions'))`,
      ),
    );
    await evaluate(
      main,
      `[...document.querySelectorAll('[data-projects] > div > button:first-child')].find(b=>b.textContent.includes('Captions')).click()`,
    );
    await until(() =>
      evaluate(main, `!!document.querySelector('[aria-label="Edit recording 1"]')`),
    );
    await evaluate(main, `document.querySelector('[aria-label="Edit recording 1"]').click()`);
    const transcriptButton = (text: string) =>
      `[...document.querySelectorAll('[aria-label="Transcript"] button')].find(b=>b.textContent.trim()===${JSON.stringify(text)})`;
    await until(() =>
      evaluate(
        main,
        `!!${transcriptButton("Transcribe")} && !${transcriptButton("Transcribe")}.disabled`,
      ),
    );
    await evaluate(main, `${transcriptButton("Transcribe")}.click()`);
    await until(
      () =>
        evaluate(
          main,
          `document.querySelectorAll('[data-transcript-text]').length===1 && document.querySelectorAll('[data-transcript-word]').length===4`,
        ),
      "manual transcript in editor",
    );
    assert.equal(calls(), 4);
    assert.equal(
      await evaluate(
        main,
        `document.querySelectorAll('[aria-label="Transcript"] textarea').length`,
      ),
      0,
      "One continuous reading view without per-caption fields",
    );
    await dragWords(main, 0, 1);
    await until(
      () =>
        evaluate(
          main,
          `document.querySelector('[aria-label="Transcript selection"]')?.textContent.includes('2 words selected')`,
        ),
      "select words to correct",
    );
    await evaluate(main, `${transcriptButton("Edit")}.click()`);
    await until(
      () =>
        evaluate(
          main,
          `document.querySelector('[data-word-editor]')?.value==='Local transcription.'`,
        ),
      "inline editor holds the selected words",
    );
    const before = await evaluate(main, `${desktop}.transcription.get(${JSON.stringify(session)})`);
    await evaluate(
      main,
      `(()=>{const field=document.querySelector('[data-word-editor]');field.focus();field.setSelectionRange(field.value.length,field.value.length);})()`,
    );
    key(main, "Backspace");
    await until(
      () =>
        evaluate(
          main,
          `document.querySelector('[data-word-editor]').value==='Local transcription'`,
        ),
      "Backspace in the correction field edits text normally",
    );
    assert.equal(
      await evaluate(
        main,
        `Number(document.querySelector('[aria-label="Playback position"]').max)`,
      ),
      4,
      "Correction fields do not cut video",
    );
    await evaluate(
      main,
      `(()=>{const field=document.querySelector('[data-word-editor]');field.value='Corrected API explanation.';field.dispatchEvent(new Event('input',{bubbles:true}));})()`,
    );
    key(main, "Return");
    await until(
      () =>
        evaluate(
          main,
          `${desktop}.transcription.get(${JSON.stringify(session)}).then(s=>s.transcript.cues[0].text==='Corrected API explanation.')`,
        ),
      "correction saved",
    );
    const after = await evaluate(main, `${desktop}.transcription.get(${JSON.stringify(session)})`);
    assert.deepEqual(
      after.transcript.cues.map((c: { start: number; end: number }) => [c.start, c.end]),
      before.transcript.cues.map((c: { start: number; end: number }) => [c.start, c.end]),
    );
    assert.deepEqual(
      [after.transcript.cues[0].words[0].start, after.transcript.cues[0].words.at(-1).end],
      [before.transcript.cues[0].words[0].start, before.transcript.cues[0].words.at(-1).end],
      "Corrected words keep their timing",
    );
    assert.match(
      readFileSync(join(session, "transcript.srt"), "utf8"),
      /00:00:02,350 --> 00:00:03,600\nLater explanation\./,
      "Pause removed in recording subtitle files",
    );
    await until(
      () => evaluate(main, `document.querySelectorAll('[data-transcript-word]').length===5`),
      "corrected words shown",
    );
    await evaluate(
      main,
      `[...document.querySelectorAll('[data-transcript-word]')].find(b=>b.textContent==='API').click()`,
    );
    await until(
      () =>
        evaluate(
          main,
          `document.querySelector('[data-transcript-word][aria-current="time"]')?.textContent==='API'`,
        ),
      "adjacent word seek",
    );
    await pause(100); // Let the media clock replace the requested seek time on subsequent frames.
    assert.equal(
      await evaluate(
        main,
        `document.querySelector('[data-transcript-word][aria-current="time"]').textContent`,
      ),
      "API",
      "Clicked adjacent word remains highlighted after media timestamp rounding",
    );
    await evaluate(
      main,
      `[...document.querySelectorAll('[data-transcript-word]')].find(b=>b.textContent==='Later').click()`,
    );
    await until(
      () => evaluate(main, `document.querySelector('[aria-label="Playback position"]').value>2.3`),
      "forward word seek",
    );
    assert.equal(
      await evaluate(
        main,
        `document.querySelector('[data-transcript-word][aria-current="time"]').textContent`,
      ),
      "Later",
    );
    await evaluate(main, `document.querySelector('[aria-label="Play"]').click()`);
    await until(
      () =>
        evaluate(
          main,
          `document.querySelector('[data-transcript-word][aria-current="time"]')?.textContent==='explanation.'`,
        ),
      "word marker advances during playback",
    );
    await evaluate(main, `document.querySelector('[aria-label="Pause"]').click()`);
    await evaluate(
      main,
      `[...document.querySelectorAll('[data-transcript-word]')].find(b=>b.textContent==='Corrected').click()`,
    );
    await until(
      () => evaluate(main, `document.querySelector('[aria-label="Playback position"]').value<0.5`),
      "backward word seek",
    );
    assert.equal(
      await evaluate(
        main,
        `document.querySelector('[data-transcript-word][aria-current="time"]').textContent`,
      ),
      "Corrected",
    );
    await pause(300);
    const pixels = () =>
      evaluate(
        main,
        `(()=>{const c=document.querySelector('[data-player] canvas');const p=c.getContext('2d').getImageData(0,0,c.width,c.height).data;let white=0;for(let i=0;i<p.length;i+=4)if(p[i]>200&&p[i+1]>200&&p[i+2]>200)white++;return white;})()`,
      );
    await until(async () => (await pixels()) > 20, "captions drawn in paused preview");
    await screenshot(main, "transcript-editor");
    await evaluate(
      main,
      `window.testRemaining = async () => 4 - ((await ${desktop}.projects.load()).find(p => p.id === 'manual').recordings.find(r => r.id === 'take').cuts ?? []).reduce((total, cut) => total + cut.end - cut.start, 0); true`,
    );
    const originalText = readFileSync(join(session, "transcript.json"), "utf8");
    const seekBeforeDrag = await evaluate(
      main,
      `document.querySelector('[aria-label="Playback position"]').valueAsNumber`,
    );
    await dragWords(main, 1, 2);
    await until(
      () =>
        evaluate(
          main,
          `document.querySelector('[aria-label="Transcript selection"]')?.textContent.includes('2 words selected')`,
        ),
      "native drag selects adjacent words",
    );
    assert.equal(
      await evaluate(
        main,
        `document.querySelector('[aria-label="Playback position"]').valueAsNumber`,
      ),
      seekBeforeDrag,
      "Selecting text does not seek",
    );
    await screenshot(main, "transcript-range-selected");
    key(main, "Backspace");
    await until(
      () =>
        evaluate(
          main,
          `(async()=>(document.querySelectorAll('[data-transcript-word][aria-disabled="true"]').length===2 && Math.abs((await window.testRemaining())-3.1666667)<0.001))()`,
        ),
      "Backspace cuts selected words",
    );
    assert.equal(
      readFileSync(join(session, "transcript.json"), "utf8"),
      originalText,
      "Video cuts preserve the original transcript",
    );
    await screenshot(main, "transcript-range-cut");
    await evaluate(main, `${transcriptButton("Undo")}.click()`);
    await until(
      () =>
        evaluate(
          main,
          `(async()=>(document.querySelectorAll('[data-transcript-word][aria-disabled="true"]').length===0 && (await window.testRemaining())===4))()`,
        ),
      "Undo restores the cut",
    );
    await dragWords(main, 1, 2, true);
    await until(
      () =>
        evaluate(
          main,
          `document.querySelector('[aria-label="Transcript selection"]')?.textContent.includes('2 words selected')`,
        ),
      "backward drag selects the same words",
    );
    key(main, "Delete");
    await until(
      () =>
        evaluate(
          main,
          `document.querySelectorAll('[data-transcript-word][aria-disabled="true"]').length===2`,
        ),
      "Delete cuts a backward selection",
    );
    key(main, "z", [process.platform === "darwin" ? "meta" : "control"]);
    await until(
      () =>
        evaluate(
          main,
          `document.querySelectorAll('[data-transcript-word][aria-disabled="true"]').length===0`,
        ),
      "keyboard undo restores transcript cut",
    );
    await dragWords(main, 1, 4);
    await until(
      () =>
        evaluate(
          main,
          `document.querySelector('[aria-label="Transcript selection"]')?.textContent.includes('4 words and 1 silence selected')`,
        ),
      "drag selection spans wrapped lines, caption boundaries and the silence between",
    );
    key(main, "Backspace");
    await until(
      () =>
        evaluate(
          main,
          `(async()=>(document.querySelectorAll('[data-transcript-word][aria-disabled="true"]').length===4 && Math.abs((await window.testRemaining())-1.1666667)<0.001))()`,
        ),
      "cross-pause deletion removes only recorded time",
    );
    key(main, "z", [process.platform === "darwin" ? "meta" : "control"]);
    await until(
      () => evaluate(main, `(async()=>((await window.testRemaining())===4))()`),
      "cross-pause cut can be undone",
    );
    const clickPoint = await evaluate(
      main,
      `(()=>{const b=[...document.querySelectorAll('[data-transcript-word]')].find(b=>b.textContent==='API').getBoundingClientRect();return {x:Math.round(b.left+b.width/2),y:Math.round(b.top+b.height/2)};})()`,
    );
    main.webContents.sendInputEvent({
      type: "mouseDown",
      ...clickPoint,
      button: "left",
      clickCount: 1,
    });
    main.webContents.sendInputEvent({
      type: "mouseUp",
      ...clickPoint,
      button: "left",
      clickCount: 1,
    });
    await until(
      () =>
        evaluate(
          main,
          `document.querySelector('[data-transcript-word][aria-current="time"]')?.textContent==='API'`,
        ),
      "single native clicks still seek after range selection",
    );
    await until(
      () =>
        evaluate(
          main,
          `document.querySelector('[aria-label="Transcript selection"]')?.textContent.includes('1 word selected')`,
        ),
      "a clicked word is selected too",
    );
    await evaluate(main, `document.querySelector('[data-transcript-text]').focus()`);
    key(main, "a", [process.platform === "darwin" ? "meta" : "control"]);
    await until(
      () =>
        evaluate(
          main,
          `document.querySelector('[aria-label="Transcript selection"]')?.textContent.includes('5 words and 1 silence selected')`,
        ),
      "Select all is scoped to the transcript",
    );
    key(main, "Backspace");
    await until(
      () =>
        evaluate(
          main,
          `(async()=>(document.querySelectorAll('[data-transcript-word][aria-disabled="true"]').length===5 && (await window.testRemaining())<2))()`,
        ),
      "whole transcript selection can be cut",
    );
    key(main, "z", [process.platform === "darwin" ? "meta" : "control"]);
    await until(
      () =>
        evaluate(
          main,
          `(async()=>(document.querySelectorAll('[data-transcript-word][aria-disabled="true"]').length===0 && (await window.testRemaining())===4))()`,
        ),
      "whole transcript cut is undoable",
    );
    // The pause between passages is silence: shown in line, seekable, removable by length or by hand, and undoable.
    const silence = `document.querySelector('[data-transcript-silence]')`;
    // A recording on its own keeps its length; what's cut is saved on the recording.
    const duration = `(await window.testRemaining())`;
    const silenceButton = (text: string) =>
      `[...document.querySelectorAll('div[aria-label="Remove silences"] button')].find(b=>b.textContent.trim()===${JSON.stringify(text)})`;
    // Silence removal is an action, its options shown on demand.
    const openSilences = () =>
      evaluate(
        main,
        `[...document.querySelectorAll('[aria-label="Transcript"] button')].find(b=>b.textContent.trim()==='Remove silences').click()`,
      );
    await openSilences();
    await until(
      () => evaluate(main, `!!${silenceButton("No long silences")}`),
      "the silence removal options",
    );
    assert.equal(
      await evaluate(main, `document.querySelectorAll('[data-transcript-silence]').length`),
      1,
      "Only the long gap is shown as silence",
    );
    assert.equal(
      await evaluate(main, `${silence}.textContent`),
      "0.8s",
      "Silence counts recorded time, not the recording pause",
    );
    assert.equal(
      await evaluate(main, `${silenceButton("No long silences")}.disabled`),
      true,
      "Nothing is longer than the default length",
    );
    await evaluate(main, `${silenceButton("0.5s")}.click()`);
    await until(
      () => evaluate(main, `!!${silenceButton("Remove 1 silence")}`),
      "shorter length finds the silence",
    );
    await evaluate(main, `${silenceButton("Remove 1 silence")}.click()`);
    await until(
      () =>
        evaluate(
          main,
          `(async()=>(Math.abs(${duration}-3.55)<0.001 && ${silence}.textContent==='0.8s'))()`,
        ),
      "silence shortened to padding either side, still showing its whole length",
    );
    await screenshot(main, "transcript-silence-removed");
    assert.equal(
      await evaluate(
        main,
        `document.querySelectorAll('[data-transcript-word][aria-disabled="true"]').length`,
      ),
      0,
      "Removing silence keeps every word",
    );
    assert.equal(
      await evaluate(main, `!!${silenceButton("No long silences")}`),
      false,
      "Removing closes the options",
    );
    await openSilences();
    await until(
      () => evaluate(main, `!!${silenceButton("No long silences")}`),
      "A shortened silence is not removed again",
    );
    key(main, "Escape");
    key(main, "z", [process.platform === "darwin" ? "meta" : "control"]);
    await until(
      () => evaluate(main, `(async()=>(${duration}===4 && ${silence}.textContent==='0.8s'))()`),
      "silence removal is undoable",
    );
    await evaluate(main, `${silence}.click()`);
    await until(
      () => evaluate(main, `${silence}.getAttribute('aria-current')==='time'`),
      "clicking a silence seeks into it",
    );
    await evaluate(
      main,
      `(()=>{document.querySelector('[data-transcript-text]').focus();window.getSelection().selectAllChildren(${silence});})()`,
    );
    await until(
      () =>
        evaluate(
          main,
          `document.querySelector('[aria-label="Transcript selection"]')?.textContent.includes('1 silence selected')`,
        ),
      "a silence can be selected on its own",
    );
    await screenshot(main, "transcript-silence-selected");
    key(main, "Backspace");
    await until(
      () => evaluate(main, `(async()=>(Math.abs(${duration}-3.55)<0.001))()`),
      "deleting a selected silence removes it by hand",
    );
    key(main, "z", [process.platform === "darwin" ? "meta" : "control"]);
    await until(() => evaluate(main, `(async()=>(${duration}===4))()`), "hand removal is undoable");
    // The captions menu's first item shows and hides them.
    const toggleCaptions = async () => {
      await evaluate(main, `document.querySelector('[aria-label="Captions"]').click()`);
      const item = `[...document.querySelectorAll('[role=menu] [role^=menuitem]')].find(b => b.textContent.trim() === 'Captions')`;
      await until(() => evaluate(main, `!!${item}`), "the captions menu");
      await evaluate(main, `${item}.click()`);
      // Choosing an item can leave the menu open; its button closes it.
      if (await evaluate(main, `!!document.querySelector('[role=menu]')`))
        await evaluate(main, `document.querySelector('[aria-label="Captions"]').click()`);
      await until(
        () => evaluate(main, `!document.querySelector('[role=menu]')`),
        "the captions menu to close",
      );
    };
    await toggleCaptions();
    await until(async () => (await pixels()) === 0, "preview captions toggle");
    await toggleCaptions();
    // Bulk actions queue only missing transcripts and preserve corrections in existing ones.
    const batch = join(data, "recordings", "Captions", "batch");
    cpSync(session, batch, { recursive: true });
    for (const file of [
      "transcript.json",
      "transcript.txt",
      "transcript.srt",
      "transcript.vtt",
    ] as const)
      rmSync(join(batch, file), { force: true });
    const batchProject = project("manual", session);
    batchProject.recordings.push({ ...batchProject.recordings[0], id: "batch", directory: batch });
    await evaluate(main, `${desktop}.projects.put([${JSON.stringify(batchProject)}])`);
    main.webContents.reload();
    await until(() =>
      evaluate(
        main,
        `[...document.querySelectorAll('[data-projects] > div > button:first-child')].some(b=>b.textContent.includes('Captions'))`,
      ),
    );
    await evaluate(
      main,
      `[...document.querySelectorAll('[data-projects] > div > button:first-child')].find(b=>b.textContent.includes('Captions')).click()`,
    );
    await until(() =>
      evaluate(main, `!!document.querySelector('[aria-label="Edit recording 1"]')`),
    );
    await evaluate(main, `document.querySelector('[aria-label="Edit recording 1"]').click()`);
    await until(() =>
      evaluate(main, `!!document.querySelector('[aria-label="Edit recording 2"]')`),
    );
    await evaluate(main, `document.querySelector('[aria-label="Recording actions"]').click()`);
    const transcribeAll = `[...document.querySelectorAll('[role=menuitem]')].find(b=>b.innerText.includes('Transcribe 1 recording'))`;
    await until(
      () =>
        evaluate(
          main,
          `!!${transcribeAll} && !${transcribeAll}.disabled && ${transcribeAll}.innerText.includes('1 recording')`,
        ),
      "only one recording eligible for bulk transcription",
    );
    await evaluate(main, `${transcribeAll}.click()`);
    await until(
      () =>
        evaluate(
          main,
          `${desktop}.transcription.get(${JSON.stringify(batch)}).then(s=>s.phase==='done')`,
        ),
      "batch transcription finished",
    );
    assert.equal(calls(), 6, "Only the new recording runs recognition");
    assert.equal(
      (await evaluate(main, `${desktop}.transcription.get(${JSON.stringify(session)})`)).transcript
        .cues[0].text,
      "Corrected API explanation.",
    );
    await evaluate(main, `document.querySelector('[aria-label="Edit recording 2"]').click()`);
    await until(() =>
      evaluate(
        main,
        `document.querySelector('[data-inspector] [data-panel-title]')?.textContent==='Microphone' && document.querySelectorAll('[data-transcript-text]').length===1 && document.querySelectorAll('[data-transcript-word]').length===4`,
      ),
    );
    assert.equal(
      await evaluate(
        main,
        `[...document.querySelectorAll('[data-transcript-word]')].map(w=>w.textContent).join(' ')`,
      ),
      "Local transcription. Later explanation.",
      "Changing selection shows that recording’s transcript",
    );
    // A legacy transcript can refresh timing without replacing custom corrections or deleted passages.
    const timing = join(data, "recordings", "Timing", "legacy");
    cpSync(session, timing, { recursive: true });
    const legacy = JSON.parse(readFileSync(join(timing, "transcript.json"), "utf8"));
    for (const cue of legacy.cues) delete cue.words;
    writeFileSync(join(timing, "transcript.json"), JSON.stringify(legacy));
    const timingProject = {
      ...project("timing", timing),
      name: "Timing",
      pieces: [{ id: "timing-piece", recordingId: "take", start: 1.2, end: 4, offset: 0 }],
    };
    await evaluate(main, `${desktop}.projects.put([${JSON.stringify(timingProject)}])`);
    main.webContents.reload();
    await until(() =>
      evaluate(
        main,
        `[...document.querySelectorAll('[data-projects] > div > button:first-child')].some(b=>b.textContent.includes('Timing'))`,
      ),
    );
    await evaluate(
      main,
      `[...document.querySelectorAll('[data-projects] > div > button:first-child')].find(b=>b.textContent.includes('Timing')).click()`,
    );
    await until(() =>
      evaluate(main, `!!document.querySelector('[aria-label="Edit recording 1"]')`),
    );
    await evaluate(main, `document.querySelector('[aria-label="Edit recording 1"]').click()`);
    await until(() => evaluate(main, `!!document.querySelector('[data-layer-label=microphone]')`));
    await evaluate(main, `document.querySelector('[data-layer-label=microphone]').click()`);
    await until(
      () =>
        evaluate(
          main,
          `!!${transcriptButton("Update timing")} && !${transcriptButton("Update timing")}.disabled`,
        ),
      "legacy timing refresh available",
    );
    await screenshot(main, "estimated-word-timing");
    await evaluate(main, `${transcriptButton("Update timing")}.click()`);
    await until(
      () =>
        evaluate(
          main,
          `${desktop}.transcription.get(${JSON.stringify(timing)}).then(s=>s.phase==='done' && s.transcript.cues[1].words?.length===2)`,
        ),
      "word timing refreshed",
    );
    const retimed = await evaluate(main, `${desktop}.transcription.get(${JSON.stringify(timing)})`);
    assert.deepEqual(
      retimed.transcript.cues.map((c: { id: string; text: string }) => [c.id, c.text]),
      legacy.cues.map((c: { id: string; text: string }) => [c.id, c.text]),
      "Refresh keeps text corrections",
    );
    assert.equal(
      retimed.transcript.cues[0].words,
      undefined,
      "Unmatched custom text keeps its existing anchors",
    );
    assert.equal(calls(), 8, "Timing refresh runs one recognition pass per segment");
    const span = ({
      id,
      recordingId,
      start,
      end,
    }: {
      id: string;
      recordingId: string;
      start: number;
      end: number | null;
    }) => ({ id, recordingId, start, end });
    assert.deepEqual(
      (
        await evaluate(
          main,
          `${desktop}.projects.load().then(p=>p.find(p=>p.id==='timing').pieces)`,
        )
      ).map(span),
      timingProject.pieces.map(span),
      "Timing refresh keeps the edit",
    );
    await screenshot(main, "refreshed-word-timing");
    await dragWords(main, 3, 4);
    await until(
      () =>
        evaluate(
          main,
          `document.querySelector('[aria-label="Transcript selection"]')?.textContent.includes('2 words selected')`,
        ),
      "select timed words for a persistent cut",
    );
    await evaluate(main, `${transcriptButton("Cut")}.click()`);
    await until(
      () =>
        evaluate(
          main,
          `document.querySelectorAll('[data-transcript-word][aria-disabled="true"]').length===2`,
        ),
      "cut selection button cuts the words",
    );
    await until(
      () =>
        evaluate(
          main,
          `${desktop}.projects.load().then(ps=>ps.find(p=>p.id==='timing').recordings[0].cuts?.length===1)`,
        ),
      "transcript cut persisted",
    );
    main.webContents.reload();
    await until(() =>
      evaluate(
        main,
        `[...document.querySelectorAll('[data-projects] > div > button:first-child')].some(b=>b.textContent.includes('Timing'))`,
      ),
    );
    await evaluate(
      main,
      `[...document.querySelectorAll('[data-projects] > div > button:first-child')].find(b=>b.textContent.includes('Timing')).click()`,
    );
    await until(() =>
      evaluate(main, `!!document.querySelector('[aria-label="Edit recording 1"]')`),
    );
    await evaluate(main, `document.querySelector('[aria-label="Edit recording 1"]').click()`);
    await until(() => evaluate(main, `!!document.querySelector('[data-layer-label=microphone]')`));
    await evaluate(main, `document.querySelector('[data-layer-label=microphone]').click()`);
    await until(
      () =>
        evaluate(
          main,
          `document.querySelectorAll('[data-transcript-word][aria-disabled="true"]').length===2 && !document.querySelector('[aria-label="Playback position"]').disabled`,
        ),
      "cuts remain visible after reopening",
    );
    // The video plays the recording from 1.2s and skips what's cut.
    await evaluate(main, `document.querySelector('[data-video]').click()`);
    await until(
      () =>
        evaluate(
          main,
          `!!document.querySelector('[data-clip]') && !document.querySelector('[aria-label="Playback position"]').disabled`,
        ),
      "the video",
    );
    await evaluate(
      main,
      `(()=>{const slider=document.querySelector('[aria-label="Playback position"]');slider.value='1.2';slider.dispatchEvent(new Event('input',{bubbles:true}));slider.dispatchEvent(new Event('change',{bubbles:true}));})()`,
    );
    await until(
      () =>
        evaluate(
          main,
          `Math.abs(document.querySelector('[data-player] video').currentTime-1.65)<0.02`,
        ),
      "playback jumps past the deleted source times",
    );
    assert.deepEqual(rendererErrors, []);
    console.log(
      "PASS: native forward/backward and wrapped transcript selection, Delete/Backspace cuts, pointer word seeking, undo, saved cuts and skipped video time, caption filtering and export, text correction isolation, transcription and timing refresh",
    );
    app.exit(0);
  } catch (error) {
    console.error(error);
    if (main)
      console.error(
        await evaluate(
          main,
          `({time:document.querySelector('[aria-label="Playback position"]')?.value, text:document.querySelector('[data-transcript-text]')?.outerHTML, body:document.body.innerText.slice(-1600)})`,
        ).catch(() => null),
      );
    app.exit(1);
  }
});
