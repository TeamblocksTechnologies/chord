import type {
  NotificationName,
  NotificationParams,
  PermissionKind,
  Permissions,
} from "@teamblocks.dev/chord-recorder-protocol";

/** The recorder helper, via the main process. Errors carry the RPC `code` and `data.reason`. */
export const helper = window.chord.helper;

/** Calls `listener` for each `name` notification; returns the unsubscribe function. */
export function onHelper<N extends NotificationName>(
  name: N,
  listener: (params: NotificationParams<N>) => void,
): () => void {
  return helper.onNotification((method, params) => {
    if (method === name) listener(params as NotificationParams<N>);
  });
}

// macOS reports screen recording as denied until granted, so only prompt for it once per launch.
const promptedScreen = { value: false };

/**
 * Asks for `kind` if the user hasn't decided yet, and reports whether it's granted. For screen recording the
 * first call shows the system prompt and later calls just check.
 */
export async function ensurePermission(kind: PermissionKind): Promise<boolean> {
  let permissions: Permissions = await helper.request("getPermissions");
  const undecided =
    kind === "screen" ? !promptedScreen.value : permissions[kind] === "notDetermined";
  if (permissions[kind] !== "granted" && undecided) {
    if (kind === "screen") promptedScreen.value = true;
    permissions = await helper.request("requestPermission", { permission: kind });
  }
  return permissions[kind] === "granted";
}

/** A preview couldn't start for lack of `kind`; the message says where to allow it. */
export class PermissionError extends Error {
  readonly kind: PermissionKind;

  constructor(kind: PermissionKind) {
    super(PERMISSION_HINTS[kind]);
    this.kind = kind;
  }
}

export const PERMISSION_HINTS: Record<PermissionKind, string> = {
  screen: "Allow screen recording in System Settings",
  microphone: "Allow microphone access in System Settings",
  camera: "Allow camera access in System Settings",
  accessibility: "Allow accessibility access in System Settings",
};
