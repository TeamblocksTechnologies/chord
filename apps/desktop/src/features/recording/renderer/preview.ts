import type { DeviceSource } from "@teamblocks.dev/chord-recorder-protocol";
import { PermissionError, ensurePermission } from "#platform/renderer/helper";

/**
 * Live video for previewing windows and cameras before recording. Display frames come from the helper
 * (see `screenPreview`) so they include its app filters and alpha. Windows match the helper's by id;
 * Chromium doesn't expose camera ids, so cameras match by name.
 */

/** Opens a preview stream. Callers own the stream and stop its tracks when done. */
export type PreviewSource = () => Promise<MediaStream>;

/**
 * Chromium's constraints for a helper camera. Labels only appear once Chromium has opened a camera, so open any
 * first if they're blank. Chromium may suffix labels, e.g. "(Built-in)".
 */
async function cameraConstraints(device: DeviceSource): Promise<MediaTrackConstraints> {
  const cameras = async () =>
    (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === "videoinput");
  let devices = await cameras();
  if (devices.every((d) => !d.label)) {
    const probe = await navigator.mediaDevices.getUserMedia({ video: true });
    for (const track of probe.getTracks()) track.stop();
    devices = await cameras();
  }
  const match =
    devices.find((d) => d.label === device.name) ??
    devices.find((d) => d.label.startsWith(device.name));
  if (match) return { deviceId: { exact: match.deviceId } };
  // The system default is the best stand-in for the helper's default camera when names differ.
  if (device.isDefault) return {};
  throw new Error("Preview unavailable");
}

/**
 * The camera at the size and rate it records at (1920×1080 when unknown, as the helper's preset picks). The camera
 * runs one format for every app using it, so a preview asking for another would switch it under the recording,
 * which then gets that format's frames squeezed into its own size. Callers scale it down for display.
 */
export function cameraPreview(
  device: DeviceSource,
  size?: { width: number; height: number; fps?: number },
): PreviewSource {
  const width = size?.width ?? 1920;
  const height = size?.height ?? 1080;
  return async () => {
    if (!(await ensurePermission("camera"))) throw new PermissionError("camera");
    const constraints = await cameraConstraints(device);
    return navigator.mediaDevices.getUserMedia({
      video: {
        ...constraints,
        width: { ideal: width },
        height: { ideal: height },
        ...(size?.fps ? { frameRate: { ideal: size.fps } } : {}),
      },
    });
  };
}

/** Screen previews open one at a time: the main process answers each request with the source last selected. */
let opening: Promise<unknown> = Promise.resolve();

function screenPreview(source: { kind: "display" | "window"; id: number }): PreviewSource {
  return async () => {
    if (!(await ensurePermission("screen"))) throw new PermissionError("screen");
    const open = opening
      .catch(() => {})
      .then(async () => {
        await window.chord.selectPreviewSource(source);
        // A thumbnail: native resolution would be wasted work.
        return navigator.mediaDevices.getDisplayMedia({
          video: { width: { max: 960 }, frameRate: 15 },
          audio: false,
        });
      });
    opening = open;
    return open;
  };
}

/** Just the window, by `PreviewWindow.id`, even where others overlap it, as the recording shows it. */
export function windowPreview(windowId: number): PreviewSource {
  return screenPreview({ kind: "window", id: windowId });
}

/**
 * Runs `open` while mounted and hands back its stream. Streams that arrive after unmount are stopped immediately.
 * Use inside `$effect`; returns the cleanup.
 */
export function holdStream(
  open: PreviewSource,
  onStream: (stream: MediaStream) => void,
  onError: (error: unknown) => void,
): () => void {
  let stream: MediaStream | undefined;
  let closed = false;
  open().then(
    (opened) => {
      if (closed) for (const track of opened.getTracks()) track.stop();
      else onStream((stream = opened));
    },
    (error: unknown) => {
      if (!closed) onError(error);
    },
  );
  return () => {
    closed = true;
    for (const track of stream?.getTracks() ?? []) track.stop();
  };
}
