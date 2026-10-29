import type {
  BackgroundState,
  CameraBackground,
} from "#features/background-removal/contracts/backgroundRemoval";
import { mediaUrl } from "../contracts/playback.ts";
import type { Recording } from "#project-document/domain/recording";
import type { StageImage } from "./stage.ts";

export interface CameraTreatment {
  settings: CameraBackground;
  /** Source camera file -> mask media URL. Both have the same file timestamps. */
  masks: Record<string, string>;
}

export function cameraBackgrounds(
  recordings: Recording[],
  states: Record<string, BackgroundState>,
): Record<string, CameraTreatment> {
  return Object.fromEntries(
    recordings.flatMap((recording) => {
      const result = recording.directory ? states[recording.directory]?.result : undefined;
      if (!result || !recording.directory) return [];
      const directory = recording.directory;
      return [
        [
          recording.id,
          {
            settings: { ...result.settings },
            masks: Object.fromEntries(
              Object.entries(result.masks).map(([source, mask]) => [
                source,
                mediaUrl(directory, mask),
              ]),
            ),
          },
        ],
      ];
    }),
  );
}

/** Shared by editor and export: the decoded grayscale mask becomes the foreground's soft alpha. */
export class CameraCompositor {
  #alpha = document.createElement("canvas");
  #foreground = document.createElement("canvas");
  #output = document.createElement("canvas");
  #previous?: {
    camera: CanvasImageSource;
    mask: CanvasImageSource;
    cameraTime: number;
    maskTime: number;
    key: string;
    drawnAt: number;
  };

  draw(
    camera: StageImage,
    mask: StageImage,
    settings: CameraBackground,
    maxWidth: number,
  ): StageImage {
    const width = Math.max(1, Math.round(Math.min(camera.width, maxWidth)));
    const height = Math.max(1, Math.round((width * camera.height) / camera.width));
    const videoKey = (image: CanvasImageSource) =>
      image instanceof HTMLVideoElement
        ? `${image.currentSrc}:${image.currentTime}:${image.readyState}:${image.getVideoPlaybackQuality().totalVideoFrames}`
        : "";
    const key = `${width}:${height}:${settings.replacement}:${settings.blur}:${settings.color}:${videoKey(camera.image)}:${videoKey(mask.image)}`;
    const previous = this.#previous;
    // Recheck paused video occasionally: a freshly loaded video's first GPU frame can become
    // drawable after its clock and readyState have settled. Never cache that initial mask forever.
    if (
      previous &&
      performance.now() - previous.drawnAt < 100 &&
      previous.key === key &&
      previous.camera === camera.image &&
      previous.mask === mask.image &&
      previous.cameraTime === camera.time &&
      previous.maskTime === mask.time
    )
      return { image: this.#output, width, height };
    this.#previous = {
      camera: camera.image,
      mask: mask.image,
      cameraTime: camera.time ?? -1,
      maskTime: mask.time ?? -1,
      key,
      drawnAt: performance.now(),
    };
    for (const canvas of [this.#alpha, this.#foreground, this.#output]) {
      if (canvas.width !== width) canvas.width = width;
      if (canvas.height !== height) canvas.height = height;
    }
    const alpha = this.#alpha.getContext("2d", { willReadFrequently: true })!;
    alpha.clearRect(0, 0, width, height);
    alpha.drawImage(mask.image, 0, 0, width, height);
    const pixels = alpha.getImageData(0, 0, width, height);
    for (let i = 0; i < pixels.data.length; i += 4) {
      pixels.data[i + 3] = pixels.data[i]!;
      pixels.data[i] = pixels.data[i + 1] = pixels.data[i + 2] = 255;
    }
    alpha.putImageData(pixels, 0, 0);
    const foreground = this.#foreground.getContext("2d")!;
    foreground.clearRect(0, 0, width, height);
    foreground.drawImage(camera.image, 0, 0, width, height);
    foreground.globalCompositeOperation = "destination-in";
    foreground.drawImage(this.#alpha, 0, 0);
    foreground.globalCompositeOperation = "source-over";
    const output = this.#output.getContext("2d")!;
    output.clearRect(0, 0, width, height);
    if (settings.replacement === "color") {
      output.fillStyle = settings.color;
      output.fillRect(0, 0, width, height);
    } else {
      const blur = (settings.blur * height) / 1080;
      const pad = blur * 2;
      output.filter = `blur(${blur}px)`;
      output.drawImage(camera.image, -pad, -pad, width + pad * 2, height + pad * 2);
      output.filter = "none";
    }
    output.drawImage(this.#foreground, 0, 0);
    return { image: this.#output, width, height };
  }
}
