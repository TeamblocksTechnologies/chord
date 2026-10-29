import { svelte } from "@sveltejs/vite-plugin-svelte";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "electron-vite";
import { resolve } from "node:path";

export default defineConfig({
  main: {
    build: {
      rollupOptions: {
        input: {
          index: "src/app/main/index.ts",
          backgroundWorker: "src/features/background-removal/main/backgroundWorker.ts",
          noiseWorker: "src/features/audio-processing/main/noiseWorker.ts",
        },
      },
    },
  },
  preload: {
    build: {
      // Sandboxed preloads can't be ES modules.
      rollupOptions: {
        input: "src/app/preload/index.ts",
        output: { format: "cjs", entryFileNames: "[name].cjs" },
      },
    },
  },
  renderer: {
    root: "src/app/renderer",
    build: { rollupOptions: { input: resolve("src/app/renderer/index.html") } },
    plugins: [svelte(), tailwindcss()],
  },
});
