import assert from "node:assert/strict";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { checkImport, moduleSpecifiers, resolvePublicExport } from "./check-boundaries.mjs";

const source = (path: string) => fileURLToPath(new URL("../src/" + path, import.meta.url));
const manifest = {
  imports: {
    "#recording/main": "./src/features/recording/main/recording.ts",
    "#recording/contracts": "./src/features/recording/contracts/island.ts",
  },
  exports: { "./Slider.svelte": "./src/Slider.svelte" },
};

test("cross-feature internals are private, while declared contracts can be consumed", () => {
  const importer = source("features/editing/renderer/Editor.svelte");
  assert.deepEqual(checkImport(importer, "#recording/contracts", manifest).errors, []);
  assert.match(
    checkImport(importer, "../../recording/contracts/island.ts", manifest).errors.join(),
    /public subpath/,
  );
  assert.match(checkImport(importer, "#unknown/contracts", manifest).errors.join(), /undeclared/);
});

test("public aliases cannot bypass runtime isolation", () => {
  const importer = source("features/editing/renderer/Editor.svelte");
  assert.match(
    checkImport(importer, "#recording/main", manifest).errors.join(),
    /cannot import main/,
  );
  assert.match(checkImport(importer, "node:fs", manifest).errors.join(), /Node\/Electron/);
  assert.match(
    checkImport(source("features/editing/domain/cuts.ts"), "svelte", manifest).errors.join(),
    /independent/,
  );
});

test("UI internals are private and generic shared code cannot depend on features", () => {
  const importer = source("features/editing/renderer/Editor.svelte");
  assert.deepEqual(
    checkImport(importer, "@teamblocks.dev/chord-ui/Slider.svelte", manifest).errors,
    [],
  );
  assert.match(
    checkImport(importer, "@teamblocks.dev/chord-ui/src/Slider.svelte", manifest).errors.join(),
    /private/,
  );
  assert.match(
    checkImport(source("shared/domain/utils.ts"), "#recording/contracts", manifest).errors.join(),
    /generic shared/,
  );
});

test("UI wildcard exports preserve component and rune-helper resolution regardless of declaration order", () => {
  const exports = {
    "./*": "./src/*.ts",
    "./*.svelte": "./src/*.svelte",
    "./contextMenu.svelte": "./src/contextMenu.svelte.ts",
  };
  assert.equal(resolvePublicExport("./Slider.svelte", exports), "./src/Slider.svelte");
  assert.equal(resolvePublicExport("./pointerDrag", exports), "./src/pointerDrag.ts");
  assert.equal(resolvePublicExport("./contextMenu.svelte", exports), "./src/contextMenu.svelte.ts");
  const importer = source("features/editing/renderer/Editor.svelte");
  assert.deepEqual(
    checkImport(importer, "@teamblocks.dev/chord-ui/Slider.svelte", { ...manifest, exports })
      .errors,
    [],
  );
  assert.match(
    checkImport(
      source("features/editing/domain/cuts.ts"),
      "@teamblocks.dev/chord-ui/Slider.svelte",
      { ...manifest, exports },
    ).errors.join(),
    /independent/,
  );
  // The UI package's model is framework-free, so domain code may share it, and it is held to domain rules.
  assert.deepEqual(
    checkImport(source("features/editing/domain/cuts.ts"), "@teamblocks.dev/chord-ui/model/setup", {
      ...manifest,
      exports,
    }).errors,
    [],
  );
  const model = fileURLToPath(new URL("../../../packages/ui/src/model/setup.ts", import.meta.url));
  assert.match(checkImport(model, "svelte", { ...manifest, exports }).errors.join(), /independent/);
});

test("syntax inspection covers static, dynamic, type-only and worker imports without matching comments", () => {
  const imports = moduleSpecifiers(
    `<script lang="ts">
    // import bad from "comment";
    import type { A } from "types";
    export { B } from "exports";
    type C = import("type-expression").C;
    const lazy = import("dynamic");
    const worker = new Worker(new URL("./worker.ts", import.meta.url));
  </script><div>import text from "template"</div>`,
    "Editor.svelte",
  );
  assert.deepEqual(imports, ["types", "exports", "type-expression", "dynamic", "./worker.ts"]);
});
