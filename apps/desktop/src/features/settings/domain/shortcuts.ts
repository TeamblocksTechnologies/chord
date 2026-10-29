/**
 * Keyboard shortcuts the user can change in Settings. A binding is modifiers then a `KeyboardEvent.code`, joined by
 * `+`, like `Mod+Shift+KeyR`. `Mod` is command on macOS and control elsewhere; `Ctrl` is control on macOS only.
 */

/**
 * Where a shortcut works. Global ones work in every app, so they clash with every other shortcut. Recording ones work in
 * every app too, but only while recording, when the project shortcuts don't.
 */
export type ShortcutScope = "global" | "recording" | "project";

export const SHORTCUTS = [
  {
    id: "toolbar",
    scope: "global",
    label: "Show or hide the recording toolbar",
    binding: "Mod+Shift+KeyR",
  },
  {
    id: "pauseRecording",
    scope: "recording",
    label: "Pause or resume recording",
    binding: "Alt+Shift+KeyP",
  },
  { id: "addMark", scope: "recording", label: "Add a mark", binding: "Alt+Shift+KeyM" },
  { id: "playPause", scope: "project", label: "Play or pause", binding: "Space" },
  { id: "skipBack", scope: "project", label: "Skip back 5 seconds", binding: "ArrowLeft" },
  { id: "skipForward", scope: "project", label: "Skip forward 5 seconds", binding: "ArrowRight" },
  { id: "copyFrame", scope: "project", label: "Copy frame", binding: "Mod+Shift+KeyC" },
  { id: "saveFrame", scope: "project", label: "Save frame", binding: "Mod+Shift+KeyS" },
  { id: "split", scope: "project", label: "Split at playhead", binding: "Mod+KeyK" },
  { id: "snapping", scope: "project", label: "Turn snapping on or off", binding: "KeyS" },
] as const satisfies readonly {
  id: string;
  scope: ShortcutScope;
  label: string;
  binding: string;
}[];

export type ShortcutId = (typeof SHORTCUTS)[number]["id"];
/** Shortcuts the main process registers with the system rather than the windows handling. */
export const GLOBAL_SHORTCUTS = SHORTCUTS.filter((shortcut) => shortcut.scope !== "project").map(
  (shortcut) => shortcut.id,
);
/** Bindings changed from their defaults; null for a shortcut turned off. */
export type ShortcutOverrides = Partial<Record<ShortcutId, string | null>>;

/**
 * Shortcuts every app shares, keys that already mean something in Chord, and the app menu's shortcuts (see
 * `main/menu.ts`), which can't be reassigned.
 */
const RESERVED = new Set([
  "Escape",
  "Tab",
  "Shift+Tab",
  "Enter",
  "Backspace",
  "Delete",
  "Mod+KeyA",
  "Mod+KeyC",
  "Mod+KeyV",
  "Mod+KeyX",
  "Mod+KeyZ",
  "Mod+Shift+KeyZ",
  "Mod+Alt+Shift+KeyV",
  "Mod+KeyQ",
  "Mod+KeyW",
  "Mod+KeyH",
  "Mod+Alt+KeyH",
  "Mod+KeyM",
  "Mod+Comma",
  "Mod+Ctrl+KeyF",
]);

const MODIFIERS = ["Mod", "Ctrl", "Alt", "Shift"] as const;
type Modifier = (typeof MODIFIERS)[number];

/** Codes a binding can end in, with how macOS draws them, how other systems name them, and Electron's name. */
const KEYS: Record<string, { mac: string; other: string; accelerator: string }> = {};
for (const letter of "ABCDEFGHIJKLMNOPQRSTUVWXYZ")
  KEYS[`Key${letter}`] = { mac: letter, other: letter, accelerator: letter };
for (let digit = 0; digit <= 9; digit++)
  KEYS[`Digit${digit}`] = { mac: `${digit}`, other: `${digit}`, accelerator: `${digit}` };
for (let n = 1; n <= 20; n++)
  KEYS[`F${n}`] = { mac: `F${n}`, other: `F${n}`, accelerator: `F${n}` };
Object.assign(KEYS, {
  Space: { mac: "Space", other: "Space", accelerator: "Space" },
  Enter: { mac: "↩", other: "Enter", accelerator: "Return" },
  Tab: { mac: "⇥", other: "Tab", accelerator: "Tab" },
  Backspace: { mac: "⌫", other: "Backspace", accelerator: "Backspace" },
  Delete: { mac: "⌦", other: "Delete", accelerator: "Delete" },
  Escape: { mac: "Esc", other: "Esc", accelerator: "Escape" },
  ArrowLeft: { mac: "←", other: "←", accelerator: "Left" },
  ArrowRight: { mac: "→", other: "→", accelerator: "Right" },
  ArrowUp: { mac: "↑", other: "↑", accelerator: "Up" },
  ArrowDown: { mac: "↓", other: "↓", accelerator: "Down" },
  Home: { mac: "↖", other: "Home", accelerator: "Home" },
  End: { mac: "↘", other: "End", accelerator: "End" },
  PageUp: { mac: "⇞", other: "Page Up", accelerator: "PageUp" },
  PageDown: { mac: "⇟", other: "Page Down", accelerator: "PageDown" },
  Minus: { mac: "-", other: "-", accelerator: "-" },
  Equal: { mac: "=", other: "=", accelerator: "=" },
  BracketLeft: { mac: "[", other: "[", accelerator: "[" },
  BracketRight: { mac: "]", other: "]", accelerator: "]" },
  Backslash: { mac: "\\", other: "\\", accelerator: "\\" },
  Semicolon: { mac: ";", other: ";", accelerator: ";" },
  Quote: { mac: "'", other: "'", accelerator: "'" },
  Comma: { mac: ",", other: ",", accelerator: "," },
  Period: { mac: ".", other: ".", accelerator: "." },
  Slash: { mac: "/", other: "/", accelerator: "/" },
  Backquote: { mac: "`", other: "`", accelerator: "`" },
});

interface Parsed {
  modifiers: Set<Modifier>;
  code: string;
}

function parse(binding: string): Parsed | null {
  const parts = binding.split("+");
  const code = parts.pop()!;
  if (!Object.hasOwn(KEYS, code)) return null;
  // Modifiers come once each, in the canonical order, so equal bindings are equal strings.
  let last = -1;
  for (const part of parts) {
    const index = MODIFIERS.indexOf(part as Modifier);
    if (index <= last) return null;
    last = index;
  }
  return { modifiers: new Set(parts as Modifier[]), code };
}

export function isBinding(value: unknown): value is string {
  return typeof value === "string" && parse(value) !== null;
}

export function isShortcutId(value: unknown): value is ShortcutId {
  return SHORTCUTS.some((shortcut) => shortcut.id === value);
}

export function isShortcutOverrides(value: unknown): value is ShortcutOverrides {
  return (
    !!value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.entries(value).every(
      ([id, binding]) => isShortcutId(id) && (binding === null || isBinding(binding)),
    )
  );
}

/** Overrides without shortcuts this version doesn't have, so a newer version's choices don't invalidate the rest. */
export function knownOverrides(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  return Object.fromEntries(Object.entries(value).filter(([id]) => isShortcutId(id)));
}

export function shortcutDefault(id: ShortcutId): string {
  return SHORTCUTS.find((shortcut) => shortcut.id === id)!.binding;
}

/** Every shortcut's binding, or null when it's turned off. */
export function resolveShortcuts(overrides: ShortcutOverrides): Record<ShortcutId, string | null> {
  return Object.fromEntries(
    SHORTCUTS.map(({ id, binding }) => [
      id,
      Object.hasOwn(overrides, id) ? overrides[id]! : binding,
    ]),
  ) as Record<ShortcutId, string | null>;
}

/** The binding for a key press, or null for a lone modifier or a key that can't be bound. */
export function bindingFromEvent(
  event: Pick<KeyboardEvent, "code" | "metaKey" | "ctrlKey" | "altKey" | "shiftKey">,
  mac: boolean,
): string | null {
  if (!Object.hasOwn(KEYS, event.code)) return null;
  // Off macOS the Windows key isn't a modifier apps can use.
  if (!mac && event.metaKey) return null;
  const modifiers: string[] = [];
  if (mac ? event.metaKey : event.ctrlKey) modifiers.push("Mod");
  if (mac && event.ctrlKey) modifiers.push("Ctrl");
  if (event.altKey) modifiers.push("Alt");
  if (event.shiftKey) modifiers.push("Shift");
  return [...modifiers, event.code].join("+");
}

/** Whether a key press is the binding. */
export function matchesBinding(
  event: Pick<KeyboardEvent, "code" | "metaKey" | "ctrlKey" | "altKey" | "shiftKey">,
  binding: string | null,
  mac: boolean,
): boolean {
  return binding !== null && bindingFromEvent(event, mac) === normalize(binding, mac);
}

/** Off macOS, control is the command key, so a binding with `Ctrl` means `Mod`. */
function normalize(binding: string, mac: boolean): string {
  const parsed = parse(binding);
  if (!parsed || mac || !parsed.modifiers.has("Ctrl")) return binding;
  parsed.modifiers.delete("Ctrl");
  parsed.modifiers.add("Mod");
  return [...MODIFIERS.filter((modifier) => parsed.modifiers.has(modifier)), parsed.code].join("+");
}

/** The keys to show for a binding: one string per key off macOS, symbols in macOS's order on it. */
export function bindingKeys(binding: string, mac: boolean): string[] {
  const parsed = parse(normalize(binding, mac));
  if (!parsed) return [];
  const key = KEYS[parsed.code];
  if (mac) {
    const symbols: [Modifier, string][] = [
      ["Ctrl", "⌃"],
      ["Alt", "⌥"],
      ["Shift", "⇧"],
      ["Mod", "⌘"],
    ];
    return [
      ...symbols.filter(([modifier]) => parsed.modifiers.has(modifier)).map(([, symbol]) => symbol),
      key.mac,
    ];
  }
  const names: [Modifier, string][] = [
    ["Mod", "Ctrl"],
    ["Alt", "Alt"],
    ["Shift", "Shift"],
  ];
  return [
    ...names.filter(([modifier]) => parsed.modifiers.has(modifier)).map(([, name]) => name),
    key.other,
  ];
}

/** A binding as text, like `⇧⌘R` on macOS or `Ctrl+Shift+R` elsewhere. */
export function bindingLabel(binding: string | null, mac: boolean): string {
  if (!binding) return "";
  return bindingKeys(binding, mac).join(mac ? "" : "+");
}

/** The binding as an Electron accelerator, for global shortcuts. */
export function toAccelerator(binding: string): string | null {
  const parsed = parse(binding);
  if (!parsed) return null;
  const names: Record<Modifier, string> = {
    Ctrl: "Control",
    Alt: "Alt",
    Shift: "Shift",
    Mod: "CommandOrControl",
  };
  return [
    ...MODIFIERS.filter((modifier) => parsed.modifiers.has(modifier)).map(
      (modifier) => names[modifier],
    ),
    KEYS[parsed.code].accelerator,
  ].join("+");
}

/** Whether two shortcuts can be pressed in the same place, so can't share a binding. */
function overlaps(a: ShortcutScope, b: ShortcutScope): boolean {
  return a === b || a === "global" || b === "global";
}

export type BindingProblem = "reserved" | "needsModifier";

/** Why a binding can't be given to a shortcut, or null if it can. */
export function bindingProblem(
  id: ShortcutId,
  binding: string,
  mac: boolean,
): BindingProblem | null {
  const normalized = normalize(binding, mac);
  if (RESERVED.has(normalized)) return "reserved";
  const scope = SHORTCUTS.find((shortcut) => shortcut.id === id)!.scope;
  const parsed = parse(normalized)!;
  // Without a modifier a shortcut working in every app would take the key from typing in them.
  if (
    scope !== "project" &&
    !/^F\d+$/.test(parsed.code) &&
    ![...parsed.modifiers].some((modifier) => modifier !== "Shift")
  )
    return "needsModifier";
  return null;
}

/**
 * The overrides after giving `id` the binding (null to turn it off), with any shortcut that clashes with it turned
 * off, and the ids of those turned off.
 */
export function assignShortcut(
  overrides: ShortcutOverrides,
  id: ShortcutId,
  binding: string | null,
  mac: boolean,
): { overrides: ShortcutOverrides; cleared: ShortcutId[] } {
  const next: ShortcutOverrides = { ...overrides };
  const cleared: ShortcutId[] = [];
  const scope = SHORTCUTS.find((shortcut) => shortcut.id === id)!.scope;
  if (binding !== null) {
    const resolved = resolveShortcuts(overrides);
    for (const other of SHORTCUTS) {
      const current = resolved[other.id];
      if (
        other.id === id ||
        !current ||
        !overlaps(scope, other.scope) ||
        normalize(current, mac) !== normalize(binding, mac)
      )
        continue;
      setOverride(next, other.id, null);
      cleared.push(other.id);
    }
  }
  setOverride(next, id, binding);
  return { overrides: next, cleared };
}

/** Records the binding, leaving out overrides that match the default. */
function setOverride(overrides: ShortcutOverrides, id: ShortcutId, binding: string | null): void {
  if (binding === shortcutDefault(id)) delete overrides[id];
  else overrides[id] = binding;
}
