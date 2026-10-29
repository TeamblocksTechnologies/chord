export type KeyModifier = "command" | "control" | "option" | "shift";

/** macOS virtual key codes (ANSI layout) and how they're drawn. */
const KEYS: Record<number, string> = {
  0: "A",
  1: "S",
  2: "D",
  3: "F",
  4: "H",
  5: "G",
  6: "Z",
  7: "X",
  8: "C",
  9: "V",
  11: "B",
  12: "Q",
  13: "W",
  14: "E",
  15: "R",
  16: "Y",
  17: "T",
  18: "1",
  19: "2",
  20: "3",
  21: "4",
  22: "6",
  23: "5",
  24: "=",
  25: "9",
  26: "7",
  27: "-",
  28: "8",
  29: "0",
  30: "]",
  31: "O",
  32: "U",
  33: "[",
  34: "I",
  35: "P",
  36: "↩",
  37: "L",
  38: "J",
  39: "'",
  40: "K",
  41: ";",
  42: "\\",
  43: ",",
  44: "/",
  45: "N",
  46: "M",
  47: ".",
  48: "⇥",
  49: "Space",
  50: "`",
  51: "⌫",
  53: "⎋",
  64: "F17",
  79: "F18",
  80: "F19",
  90: "F20",
  96: "F5",
  97: "F6",
  98: "F7",
  99: "F3",
  100: "F8",
  101: "F9",
  103: "F11",
  105: "F13",
  106: "F16",
  107: "F14",
  109: "F10",
  111: "F12",
  113: "F15",
  115: "↖",
  116: "⇞",
  117: "⌦",
  118: "F4",
  119: "↘",
  120: "F2",
  121: "⇟",
  122: "F1",
  123: "←",
  124: "→",
  125: "↓",
  126: "↑",
  71: "⌧",
  76: "⌤",
  114: "Help",
};

/** Modifier keys, drawn when pressed alone, and caps lock. */
const MODIFIER_KEYS: Record<number, string> = {
  54: "⌘",
  55: "⌘",
  56: "⇧",
  60: "⇧",
  58: "⌥",
  61: "⌥",
  59: "⌃",
  62: "⌃",
  63: "fn",
  57: "⇪",
};

/**
 * Keys that type nothing, shown without a modifier: return, tab, delete, escape, clear, enter, help, home, end,
 * page up and down, forward delete, the arrows, and the function keys. The recorder helper keeps the same ones.
 */
const SPECIAL_KEYS = new Set([
  36, 48, 51, 53, 71, 76, 114, 115, 116, 117, 119, 121, 123, 124, 125, 126, 122, 120, 99, 118, 96,
  97, 98, 100, 101, 109, 103, 111, 105, 107, 113, 106, 64, 79, 80, 90,
]);

/** The modifiers in the order macOS draws them. */
const SYMBOLS: [KeyModifier, string][] = [
  ["control", "⌃"],
  ["option", "⌥"],
  ["shift", "⇧"],
  ["command", "⌘"],
];

/**
 * The keys to draw for a key press, or null when it isn't one worth showing: shortcuts start with command, control
 * or option, and keys that type nothing show alone, so plain typing and shift-capitalised letters stay off the screen.
 */
export function formatShortcut(
  keyCode: number,
  modifiers: readonly KeyModifier[],
): string[] | null {
  if (!SPECIAL_KEYS.has(keyCode) && !modifiers.some((modifier) => modifier !== "shift"))
    return null;
  return formatKey(keyCode, modifiers);
}

/**
 * The keys to draw for a recorded key press, which the helper only keeps when worth showing, modifier keys pressed
 * alone and caps lock included. Null for keys with no known name.
 */
export function formatKey(keyCode: number, modifiers: readonly KeyModifier[]): string[] | null {
  const key = KEYS[keyCode] ?? MODIFIER_KEYS[keyCode];
  if (!key) return null;
  return [
    ...SYMBOLS.filter(([modifier]) => modifiers.includes(modifier)).map(([, symbol]) => symbol),
    key,
  ];
}
