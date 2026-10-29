import { builtinModules } from "node:module";
import { readFile, readdir } from "node:fs/promises";
import { dirname, extname, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const desktop = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repository = resolve(desktop, "../..");
const ui = resolve(repository, "packages/ui");
const builtins = new Set(builtinModules.map((name) => name.replace(/^node:/, "")));
const inside = (file, directory) => file === directory || file.startsWith(directory + sep);

export function location(file) {
  if (inside(file, ui)) return { owner: "ui", runtime: "renderer" };
  const parts = relative(resolve(desktop, "src"), file).split(sep);
  return parts[0] === "features"
    ? { owner: `features/${parts[1]}`, runtime: parts[2] }
    : { owner: parts[0], runtime: parts[1] };
}

/** Inspect real syntax, including type imports, re-exports, dynamic imports and workers. */
export function moduleSpecifiers(source, filename) {
  const scripts = filename.endsWith(".svelte")
    ? [...source.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)]
        .map((match) => match[1])
        .join("\n")
    : source;
  const ast = ts.createSourceFile(filename, scripts, ts.ScriptTarget.Latest, true);
  const modules = [];
  const visit = (node) => {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      ts.isStringLiteralLike(node.moduleSpecifier)
    ) {
      modules.push(node.moduleSpecifier.text);
    } else if (
      ts.isImportTypeNode(node) &&
      ts.isLiteralTypeNode(node.argument) &&
      ts.isStringLiteralLike(node.argument.literal)
    ) {
      modules.push(node.argument.literal.text);
    } else if (
      ts.isCallExpression(node) &&
      (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(node.expression) && node.expression.text === "require")) &&
      ts.isStringLiteralLike(node.arguments[0])
    ) {
      modules.push(node.arguments[0].text);
    } else if (
      ts.isNewExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === "URL" &&
      node.arguments?.[0] &&
      ts.isStringLiteralLike(node.arguments[0])
    ) {
      modules.push(node.arguments[0].text);
    }
    ts.forEachChild(node, visit);
  };
  visit(ast);
  return modules;
}

function patternMatch(pattern, value) {
  const star = pattern.indexOf("*");
  if (star === -1) return undefined;
  const prefix = pattern.slice(0, star),
    suffix = pattern.slice(star + 1);
  return value.length >= prefix.length + suffix.length &&
    value.startsWith(prefix) &&
    value.endsWith(suffix)
    ? value.slice(prefix.length, value.length - suffix.length)
    : undefined;
}

/** String export targets, with Node's exact-match and most-specific-pattern precedence. */
export function resolvePublicExport(specifier, exports) {
  if (Object.hasOwn(exports, specifier)) return exports[specifier];
  const patterns = Object.keys(exports)
    .filter((key) => key.includes("*"))
    .sort((a, b) => b.indexOf("*") - a.indexOf("*") || b.length - a.length);
  for (const pattern of patterns) {
    const match = patternMatch(pattern, specifier);
    if (match !== undefined) return exports[pattern]?.replaceAll("*", match);
  }
}

export function checkImport(file, specifier, { imports, exports: uiExports, uiImports = {} }) {
  specifier = specifier.replace(/\?(?:worker|asset)$/, "");
  const from = location(file);
  const errors = [];
  const pure = ["domain", "contracts"].includes(from.runtime);
  const builtin = specifier.startsWith("node:") || builtins.has(specifier);
  if (
    (from.runtime === "renderer" || pure) &&
    (builtin || specifier === "electron" || specifier.startsWith("electron/"))
  ) {
    errors.push("Node/Electron imports belong in main or preload");
  }
  if (
    pure &&
    (specifier === "svelte" ||
      specifier.startsWith("svelte/") ||
      specifier.startsWith("@teamblocks.dev/chord-ui/"))
  ) {
    errors.push("domain and contracts must be independent of the UI framework");
  }
  let target;
  if (specifier.startsWith("#")) {
    const entry =
      from.owner === "ui"
        ? (uiImports[specifier] ??
          (specifier.startsWith("#ui/")
            ? uiImports["#ui/*"]?.replace("*", specifier.slice(4))
            : undefined))
        : imports[specifier];
    if (!entry) errors.push("undeclared package.json imports entry");
    else target = resolve(from.owner === "ui" ? ui : desktop, entry);
  } else if (specifier.startsWith("@teamblocks.dev/chord-ui/")) {
    const entry = resolvePublicExport(
      "./" + specifier.slice("@teamblocks.dev/chord-ui/".length),
      uiExports,
    );
    if (!entry) errors.push("private or unknown UI package export");
    else target = resolve(ui, entry);
  } else if (specifier.startsWith(".")) {
    target = resolve(dirname(file), specifier);
    if (from.owner !== location(target).owner)
      errors.push("cross-owner imports must use a declared public subpath");
  }
  if (target) {
    const to = location(target);
    if (from.owner === "ui" && to.owner !== "ui")
      errors.push("the UI package cannot depend on the desktop application");
    if (from.owner === "shared" && !["shared", "ui"].includes(to.owner))
      errors.push("generic shared code cannot depend on business features");
    if (from.owner !== "app" && to.owner === "app")
      errors.push("only the app shell may import app composition code");
    if (
      ["renderer", "domain", "contracts"].includes(from.runtime) &&
      ["main", "preload"].includes(to.runtime)
    )
      errors.push("renderer/domain/contracts cannot import main or preload code");
    if (
      ["main", "preload", "domain", "contracts"].includes(from.runtime) &&
      to.runtime === "renderer"
    )
      errors.push("main/preload/domain/contracts cannot import renderer code");
    if (
      (from.runtime === "preload" && to.runtime === "main") ||
      (from.runtime === "main" && to.runtime === "preload")
    )
      errors.push("main and preload must communicate through contracts, not import each other");
    if (
      !file.includes(".test.") &&
      (target.includes(".test.") || target.split(sep).includes("tests"))
    )
      errors.push("production code cannot import tests");
  }
  return { target, errors };
}

async function files(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries
      .filter((entry) => !["node_modules", ".svelte-check"].includes(entry.name))
      .map((entry) => {
        const path = resolve(directory, entry.name);
        return entry.isDirectory() ? files(path) : [path];
      }),
  );
  return nested.flat();
}

export async function checkBoundaries() {
  const [appPackage, uiPackage, allFiles] = await Promise.all([
    readFile(resolve(desktop, "package.json"), "utf8").then(JSON.parse),
    readFile(resolve(ui, "package.json"), "utf8").then(JSON.parse),
    Promise.all([files(resolve(desktop, "src")), files(resolve(ui, "src"))]).then((results) =>
      results.flat(),
    ),
  ]);
  const manifest = {
    imports: appPackage.imports,
    exports: uiPackage.exports,
    uiImports: uiPackage.imports,
  };
  const known = new Set(allFiles);
  const violations = [];
  // Unit tests can directly exercise their owner; feature integrations may compose its public dependencies.
  for (const file of allFiles.filter(
    (file) =>
      [".ts", ".svelte"].includes(extname(file)) &&
      !file.endsWith(".test.ts") &&
      !file.split(sep).includes("tests"),
  )) {
    const source = await readFile(file, "utf8");
    if (location(file).owner === "ui" && /\bwindow\.chord\b/.test(source))
      violations.push(`${relative(repository, file)}: UI cannot access the desktop bridge`);
    for (const specifier of moduleSpecifiers(source, file)) {
      const { target, errors } = checkImport(file, specifier, manifest);
      if (target && !known.has(target)) errors.push("public import target does not exist");
      for (const error of errors)
        violations.push(`${relative(repository, file)}: ${specifier}: ${error}`);
    }
  }
  // Validate API declarations even when no current consumer uses them.
  for (const [specifier, path] of Object.entries(appPackage.imports)) {
    if (specifier.includes("*") || path.includes("*"))
      violations.push(`${specifier}: public desktop subpaths must be explicit`);
    if (!known.has(resolve(desktop, path)))
      violations.push(`${specifier}: import target does not exist`);
  }
  for (const [specifier, path] of Object.entries(uiPackage.exports)) {
    const target = resolve(ui, path);
    if (specifier.includes("*")) {
      if (![...known].some((file) => patternMatch(target, file) !== undefined))
        violations.push(`${specifier}: UI export pattern must match existing source files`);
    } else if (!known.has(target)) violations.push(`${specifier}: UI export target does not exist`);
  }
  return violations;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const violations = await checkBoundaries();
  if (violations.length) {
    console.error(violations.join("\n"));
    process.exitCode = 1;
  } else console.log("Feature, runtime and UI package boundaries passed.");
}
