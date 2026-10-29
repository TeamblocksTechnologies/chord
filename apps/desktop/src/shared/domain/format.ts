/** `1:05`, or `1:02:05` past an hour. */
export function formatDuration(seconds: number): string {
  const total = Math.floor(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${s}` : `${m}:${s}`;
}

const relative = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });

/** "just now", "5 minutes ago", "yesterday", then a date past a week. */
export function formatRelative(iso: string, now = Date.now()): string {
  const seconds = (new Date(iso).getTime() - now) / 1000;
  const abs = Math.abs(seconds);
  if (abs < 60) return "just now";
  if (abs < 3600) return relative.format(Math.round(seconds / 60), "minute");
  if (abs < 86_400) return relative.format(Math.round(seconds / 3600), "hour");
  if (abs < 7 * 86_400) return relative.format(Math.round(seconds / 86_400), "day");
  return formatDate(iso);
}

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/** `1:05.3`: minutes, seconds and tenths, for times that are typed. */
export function formatTimecode(seconds: number): string {
  const tenths = Math.max(0, Math.round(seconds * 10));
  return `${Math.floor(tenths / 600)}:${((tenths % 600) / 10).toFixed(1).padStart(4, "0")}`;
}

/** Reads a typed time, such as `1:05.3`, `65.3` or `1:02:05`, in seconds; null if it isn't one. */
export function parseTimecode(text: string): number | null {
  const parts = text.trim().split(":");
  if (parts.length > 3 || !parts.every((part) => /^(\d+(\.\d*)?|\.\d+)$/.test(part))) return null;
  return parts.reduce((total, part) => total * 60 + Number(part), 0);
}

const kilobytes = new Intl.NumberFormat(undefined, {
  style: "unit",
  unit: "kilobyte",
  maximumFractionDigits: 0,
});
const megabytes = new Intl.NumberFormat(undefined, {
  style: "unit",
  unit: "megabyte",
  maximumFractionDigits: 0,
});
const gigabytes = new Intl.NumberFormat(undefined, {
  style: "unit",
  unit: "gigabyte",
  maximumFractionDigits: 1,
});

/** `483 MB`, `640 kB` under a megabyte, or `1.2 GB` from a gigabyte. */
export function formatBytes(bytes: number): string {
  if (bytes < 1e6) return kilobytes.format(Math.max(1, bytes / 1e3));
  return bytes < 1e9 ? megabytes.format(bytes / 1e6) : gigabytes.format(bytes / 1e9);
}
