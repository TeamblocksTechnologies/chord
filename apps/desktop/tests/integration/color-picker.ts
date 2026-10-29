// Run: env -u ELECTRON_RUN_AS_NODE pnpm exec electron tests/integration/color-picker.ts
import { app, BrowserWindow } from "electron";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const fixture = mkdtempSync(join(import.meta.dirname, ".color-picker-"));
app.setPath("userData", join(fixture, "user-data"));
app.on("quit", () =>
  rmSync(fixture, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }),
);

app.whenReady().then(async () => {
  try {
    const [{ build }, { svelte }, { default: tailwindcss }] = await Promise.all([
      import("vite"),
      import("@sveltejs/vite-plugin-svelte"),
      import("@tailwindcss/vite"),
    ]);
    writeFileSync(
      join(fixture, "index.html"),
      '<div id="app"></div><script type="module" src="./main.js"></script>',
    );
    writeFileSync(
      join(fixture, "main.js"),
      `import { mount } from 'svelte';
      import Harness from './Harness.svelte';
      import { CameraCompositor } from ${JSON.stringify(resolve(import.meta.dirname, "../../src/media-engine/renderer/background.ts"))};
      import './test.css';
      mount(Harness, { target: document.getElementById('app') });
      window.testCameraOpacity = () => {
        const camera = document.createElement('canvas'), mask = document.createElement('canvas');
        camera.width = mask.width = 2; camera.height = mask.height = 1;
        const source = camera.getContext('2d'), matte = mask.getContext('2d');
        source.fillStyle = '#ff0000'; source.fillRect(0, 0, 2, 1);
        matte.fillStyle = '#fff'; matte.fillRect(0, 0, 1, 1);
        matte.fillStyle = '#000'; matte.fillRect(1, 0, 1, 1);
        const compositor = new CameraCompositor();
        return ['#00ff00', '#00ff0080', '#00ff0000'].map(color => {
          const output = compositor.draw({ image: camera, width: 2, height: 1 }, { image: mask, width: 2, height: 1 },
            { enabled: true, replacement: 'color', blur: 0, color }, 2).image;
          const pixels = [...output.getContext('2d').getImageData(0, 0, 2, 1).data];
          const stage = document.createElement('canvas'); stage.width = 2; stage.height = 1;
          const context = stage.getContext('2d'); context.fillStyle = '#0000ff'; context.fillRect(0, 0, 2, 1); context.drawImage(output, 0, 0);
          return { pixels, composite: [...context.getImageData(0, 0, 2, 1).data] };
        });
      };`,
    );
    writeFileSync(
      join(fixture, "test.css"),
      `@import ${JSON.stringify(resolve(import.meta.dirname, "../../src/app/renderer/app.css"))};
      @source ${JSON.stringify(resolve(import.meta.dirname, "../../src"))};
      @source './Harness.svelte';`,
    );
    writeFileSync(
      join(fixture, "Harness.svelte"),
      `<script>
      import ColorPicker from '@teamblocks.dev/chord-ui/ColorPicker.svelte';
      let color = $state('#1b1b1b');
      let opaque = $state('#000000');
      let disabled = $state(false);
      let restore = '';
    </script>
    <main class="flex h-screen flex-col items-start gap-4 bg-neutral-900 p-8 text-neutral-100">
      <ColorPicker label="Fill" alpha bind:value={color} />
      <output id="value">{color}</output>
      <ColorPicker label="Background" bind:value={opaque} {disabled} />
      <output id="opaque">{opaque}</output>
      <button id="external" onclick={() => { restore = color; color = '#ff000080'; }}>External update</button>
      <button id="restore" onclick={() => color = restore}>Restore value</button>
      <button id="disable" onclick={() => disabled = !disabled}>Toggle disabled</button>
      <button id="outside">Outside</button>
    </main>`,
    );
    await build({
      root: fixture,
      configFile: false,
      base: "./",
      plugins: [svelte(), tailwindcss()],
      logLevel: "error",
      build: { outDir: join(fixture, "dist") },
    });
    const win = new BrowserWindow({ width: 620, height: 660, show: false });
    const run = (code: string) => win.webContents.executeJavaScript(code);
    const frame = () =>
      run("new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))");
    const click = async (selector: string) => {
      await run(`document.querySelector(${JSON.stringify(selector)}).click()`);
      await frame();
    };
    const read = (selector: string) =>
      run(`document.querySelector(${JSON.stringify(selector)})?.value`);
    const edit = async (label: string, value: string | number, event = "input") => {
      await run(
        `(() => { const input = document.querySelector('[aria-label="${label}"]'); input.value = ${JSON.stringify(String(value))}; input.dispatchEvent(new Event('input', { bubbles: true })); ${event === "change" ? "input.dispatchEvent(new Event('change', { bubbles: true }));" : ""} })()`,
      );
      await frame();
    };
    const key = async (selector: string, key: string, shift = false) => {
      await run(
        `document.querySelector(${JSON.stringify(selector)}).dispatchEvent(new KeyboardEvent('keydown', { key: ${JSON.stringify(key)}, shiftKey: ${shift}, bubbles: true, cancelable: true }))`,
      );
      await frame();
    };
    const plane = '[aria-label="Color saturation and brightness"]';
    const escape = async () => {
      await key(plane, "Escape");
      await run(
        `new Promise(resolve => { const check = () => document.querySelector('[role="dialog"]') ? requestAnimationFrame(check) : resolve(); check(); })`,
      );
    };
    await win.loadFile(join(fixture, "dist/index.html"));
    await frame();
    assert.deepEqual(
      await run("window.testCameraOpacity()"),
      [
        { pixels: [255, 0, 0, 255, 0, 255, 0, 255], composite: [255, 0, 0, 255, 0, 255, 0, 255] },
        { pixels: [255, 0, 0, 255, 0, 255, 0, 128], composite: [255, 0, 0, 255, 0, 128, 127, 255] },
        { pixels: [255, 0, 0, 255, 0, 0, 0, 0], composite: [255, 0, 0, 255, 0, 0, 255, 255] },
      ],
      "Background opacity reveals the video underneath while keeping the subject opaque",
    );
    assert.equal(await read('[aria-label="Fill"]'), "#1b1b1b");
    await click('[aria-label="Fill"]');
    assert.equal(
      await run(`document.activeElement.matches('${plane}')`),
      true,
      "Opening focuses the color plane",
    );
    assert.equal(
      await run(`parseFloat(getComputedStyle(document.querySelector('${plane}')).width)`),
      246,
      "The fixture includes app styles",
    );
    assert.equal(
      await run(`(() => {
      const hue = document.querySelector('[aria-label="Hue"]').getBoundingClientRect();
      const opacity = document.querySelector('[aria-label="Opacity"]').getBoundingClientRect();
      const hex = document.querySelector('[aria-label="Hex color"]').getBoundingClientRect();
      return hue.bottom < opacity.top && opacity.bottom < hex.top;
    })()`),
      true,
      "Opacity has its own track between hue and the color values",
    );

    await edit("Hex color", "abcd", "change");
    assert.equal(await read('[aria-label="Fill"]'), "#aabbccdd");
    await edit("Hex color", "oops", "change");
    assert.equal(
      await read('[aria-label="Fill"]'),
      "#aabbccdd",
      "Invalid drafts never overwrite a color",
    );
    assert.equal(
      await run(`document.querySelector('[aria-label="Hex color"]').getAttribute('aria-invalid')`),
      "true",
    );
    await edit("Hex color", "ff0000", "change");
    assert.equal(
      await read('[aria-label="Fill"]'),
      "#ff0000dd",
      "Six-digit edits preserve opacity",
    );
    await edit("Opacity percentage", 50);
    assert.equal(await read('[aria-label="Fill"]'), "#ff000080");
    await edit("Color format", "rgb", "change");
    assert.equal(await read('[aria-label="Red"]'), "255");
    assert.equal(
      await run(`(() => {
      const context = document.createElement('canvas').getContext('2d');
      return ['Red', 'Green', 'Blue', 'Opacity percentage', 'Color format'].every(label => {
        const input = document.querySelector('[aria-label="' + label + '"]');
        const style = getComputedStyle(input);
        context.font = style.fontWeight + ' ' + style.fontSize + ' ' + style.fontFamily;
        const text = label === 'Color format' ? 'RGB' : label === 'Opacity percentage' ? '100' : '255';
        const available = input.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
        return available >= context.measureText(text).width + 2;
      });
    })()`),
      true,
      "RGB channels, opacity, and format text fit without clipping at maximum values",
    );
    await edit("Green", 128);
    assert.equal(await read('[aria-label="Fill"]'), "#ff800080");
    await edit("Opacity", 100);
    assert.equal(await read('[aria-label="Fill"]'), "#ff8000");
    await edit("Color format", "hex", "change");
    await edit("Hex color", "000000", "change");
    await edit("Hue", 240);
    await key(plane, "End");
    for (let i = 0; i < 10; i++) await key(plane, "ArrowUp", true);
    assert.equal(
      await read('[aria-label="Fill"]'),
      "#0000ff",
      "Hue and saturation survive edits at black",
    );

    // Real pointer capture keeps a drag active outside the plane, clamping at the edge.
    const rect = await run(
      `(() => { const r = document.querySelector('${plane}').getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; })()`,
    );
    const start = {
      x: Math.round(rect.x + rect.width / 2),
      y: Math.round(rect.y + rect.height / 2),
    };
    const end = {
      x: Math.round(rect.x + rect.width + 15),
      y: Math.round(rect.y + rect.height + 15),
    };
    win.webContents.sendInputEvent({ type: "mouseDown", ...start, button: "left", clickCount: 1 });
    await frame();
    win.webContents.sendInputEvent({
      type: "mouseMove",
      ...end,
      button: "left",
      modifiers: ["leftbuttondown"],
    });
    await frame();
    win.webContents.sendInputEvent({ type: "mouseUp", ...end, button: "left", clickCount: 1 });
    await frame();
    assert.equal(await read('[aria-label="Fill"]'), "#000000");
    await escape();
    assert.equal(await run('document.activeElement.getAttribute("aria-label")'), "Fill");
    assert.equal(
      await run('document.querySelector("[aria-label=Fill]").getAttribute("aria-expanded")'),
      "false",
    );

    await click("#external");
    await click('[aria-label="Fill"]');
    assert.equal(await read('[aria-label="Hex color"]'), "ff0000");
    assert.equal(
      await read('[aria-label="Opacity percentage"]'),
      "50",
      "External colors resynchronize the picker",
    );
    await escape();
    await click("#restore");
    await click('[aria-label="Fill"]');
    assert.equal(
      await read('[aria-label="Hex color"]'),
      "000000",
      "Restoring a previously emitted color also resynchronizes",
    );
    await escape();
    await click('[aria-label="Background"]');
    assert.equal(
      await run('!!document.querySelector("[aria-label=Opacity]")'),
      false,
      "Opaque-only settings hide alpha",
    );
    await edit("Hex color", "#abc", "change");
    assert.equal(await read('[aria-label="Background"]'), "#aabbcc");
    await edit("Hex color", "1234", "change");
    assert.equal(
      await read('[aria-label="Background"]'),
      "#aabbcc",
      "Opaque settings reject transparent colors",
    );
    await run(
      'document.querySelector("#outside").dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }))',
    );
    await run(
      `new Promise(resolve => { const check = () => document.querySelector('[role="dialog"]') ? requestAnimationFrame(check) : resolve(); check(); })`,
    );
    assert.equal(
      await run('document.querySelector("[aria-label=Background]").getAttribute("aria-expanded")'),
      "false",
    );
    await click("#disable");
    await click('[aria-label="Background"]');
    assert.equal(
      await run('document.querySelector("[aria-label=Background]").getAttribute("aria-expanded")'),
      "false",
    );

    if (process.env.CHORD_TEST_SCREENSHOTS) {
      await click('[aria-label="Fill"]');
      await edit("Hex color", "ffffff", "change");
      await edit("Opacity percentage", 99);
      await edit("Color format", "rgb", "change");
      await run(
        "new Promise(resolve => { let frames = 12; const next = () => --frames ? requestAnimationFrame(next) : resolve(); requestAnimationFrame(next); })",
      );
      mkdirSync(process.env.CHORD_TEST_SCREENSHOTS, { recursive: true });
      writeFileSync(
        join(process.env.CHORD_TEST_SCREENSHOTS, "color-picker.png"),
        (await win.webContents.capturePage()).toPNG(),
      );
    }
    console.log(
      "PASS: color picker controls, separate opacity track, transparent camera compositing, keyboard, focus, and opaque settings",
    );
    app.exit(0);
  } catch (error) {
    console.error(error);
    app.exit(1);
  }
});
