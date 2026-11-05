import type { PermissionKind, Permissions } from "@teamblocks.dev/chord-recorder-protocol";
import type { FeatureNeed, SourceNeed } from "@teamblocks.dev/chord-ui/recording/environment";
import { helper, onHelper } from "#platform/renderer/helper";

/**
 * What each source needs, and what features need to work in full. Accessibility tells following a window which new
 * windows are its dialogs, sheets, and panels; without it, only noticeably smaller ones count.
 */
export const requirements = {
  screen: ["screen"],
  camera: ["camera"],
  microphone: ["microphone"],
  systemAudio: ["screen"],
  windowRoles: ["accessibility"],
} as const satisfies Record<SourceNeed | FeatureNeed, readonly PermissionKind[]>;

export type Requirement = keyof typeof requirements;

const kinds: PermissionKind[] = ["screen", "camera", "microphone", "accessibility"];

export const permissionLabels: Record<PermissionKind, string> = {
  camera: "Camera",
  microphone: "Microphone",
  screen: "Screen recording",
  accessibility: "Accessibility",
};

const POLL_MS = 2000;
/** How long after asking for a permission each read checks with a fresh helper, while the user is in System Settings. */
const WATCH_MS = 3 * 60_000;

/**
 * The system's permission states as the helper reports them, re-read on focus and every couple of seconds, since
 * they change in System Settings without telling us. `null` until the first read.
 *
 * The running helper can keep seeing a permission allowed since it started as denied, so while one is missing, a
 * return to the window and the reads after asking for one check with a fresh helper instead, which also swaps the
 * running one for it. That's what lets the user skip quitting and reopening the app as macOS asks.
 */
class PermissionStore {
  status = $state<Permissions | null>(null);
  #promptedScreen = false;
  #promptedAccessibility = false;
  #watchUntil = 0;
  /** Allowed as a fresh helper saw it, though the running one didn't yet. Cleared when the helper restarts. */
  #allowed = new Set<PermissionKind>();

  constructor() {
    void this.refresh();
    setInterval(() => document.visibilityState === "visible" && void this.refresh(), POLL_MS);
    window.addEventListener("focus", () => void this.refresh(true));
    onHelper("ready", () => {
      this.#allowed.clear();
      void this.refresh();
    });
  }

  async refresh(returned = false): Promise<void> {
    const missing = !this.status || kinds.some((kind) => !this.granted(kind));
    try {
      if (missing && (returned || Date.now() < this.#watchUntil)) {
        const fresh = await window.chord.checkPermissions();
        for (const kind of kinds)
          if (fresh[kind] !== "granted") this.#allowed.delete(kind);
          else if (this.status?.[kind] !== "granted") this.#allowed.add(kind);
        this.status = fresh;
      } else {
        const running = await helper.request("getPermissions");
        for (const kind of this.#allowed) running[kind] = "granted";
        this.status = running;
      }
    } catch {
      // The helper isn't reachable; keep the last known state.
    }
  }

  granted(kind: PermissionKind): boolean {
    return this.status?.[kind] === "granted";
  }

  /** The permissions `need` still lacks. */
  missing(need: Requirement): PermissionKind[] {
    return requirements[need].filter((kind) => !this.granted(kind));
  }

  /** Why `need` is unavailable, and what clicking it does, or null when it's usable. */
  blockedReason(need: Requirement): string | null {
    if (!this.status) return null;
    const missing = this.missing(need);
    if (missing.length === 0) return null;
    const names = missing.map((kind) => permissionLabels[kind].toLowerCase()).join(" and ");
    return `Needs ${names} access, click to allow`;
  }

  /** Asks for the first permission `need` is missing. */
  async allow(need: Requirement): Promise<void> {
    const [kind] = this.missing(need);
    if (kind) await this.enable(kind);
  }

  /** Whether `enable` would show a system prompt rather than open System Settings. */
  canPrompt(kind: PermissionKind): boolean {
    if (kind === "screen") return !this.#promptedScreen;
    if (kind === "accessibility") return !this.#promptedAccessibility;
    return this.status?.[kind] === "notDetermined";
  }

  /**
   * Shows the system prompt when there is one to show, which for camera and microphone is until the user decides.
   * Otherwise opens the System Settings pane. Screen recording only prompts once per launch, since macOS reports it
   * as denied until granted; accessibility's prompt is shown only if it isn't granted, and points to Settings itself.
   */
  async enable(kind: PermissionKind): Promise<void> {
    if (!this.canPrompt(kind)) return this.openSettings(kind);
    this.#watchUntil = Date.now() + WATCH_MS;
    if (kind === "screen") this.#promptedScreen = true;
    if (kind === "accessibility") this.#promptedAccessibility = true;
    this.status = await helper.request("requestPermission", { permission: kind });
  }

  /** Opens the System Settings pane for `kind`, watching for it to be allowed there. */
  async openSettings(kind: PermissionKind): Promise<void> {
    this.#watchUntil = Date.now() + WATCH_MS;
    await window.chord.openPermissionSettings(kind);
  }
}

export const permissions = new PermissionStore();
