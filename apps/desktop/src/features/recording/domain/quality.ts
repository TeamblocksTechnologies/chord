import type {
  CameraConfig,
  CameraSource,
  VideoQuality,
} from "@teamblocks.dev/chord-recorder-protocol";
import {
  resolveCamera,
  type QualityPreset,
  type CameraQuality,
  type ScreenQuality,
} from "@teamblocks.dev/chord-ui/model/quality";

// Presets and their resolution are shared with the recording controls in the UI package; this adds what the
// recorder helper takes.
export * from "@teamblocks.dev/chord-ui/model/quality";

export function screenVideoQuality(quality: ScreenQuality): VideoQuality {
  return { fps: quality.fps, scale: quality.scale, hdr: quality.hdr };
}

export function cameraConfig(
  camera: CameraSource,
  preset: QualityPreset,
  custom: CameraQuality | undefined,
): CameraConfig {
  const quality = resolveCamera(camera, preset, custom);
  if (!quality) return { deviceId: camera.id };
  return {
    deviceId: camera.id,
    format: { width: quality.width, height: quality.height },
    fps: quality.fps,
  };
}
