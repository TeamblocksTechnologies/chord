import type { ClipBackground } from "#features/editing/domain/clipLayout";

/**
 * A clip's wallpaper, behind every feed. Time is seconds on the video's sequence, never wall-clock time or an
 * accumulated animation phase, so seeks, stills and exports reproduce exactly the same frame.
 */
export function drawClipBackground(
  context: CanvasRenderingContext2D,
  background: ClipBackground,
  time: number,
): void {
  const { width, height } = context.canvas;
  if (!width || !height) return;
  context.save();
  try {
    context.fillStyle = background.type === "solid" ? background.color : "#000000";
    context.fillRect(0, 0, width, height);
    if (background.type === "solid") return;

    // A gently drifting field of rounded blocks. Only black and white paint; translucent lines keep it quiet
    // behind a screen recording. Work in stage-relative units so every output size has the same composition.
    const unit = Math.min(width, height);
    const pitch = 0.16;
    const phase = (Number.isFinite(time) ? time : 0) * 0.32;
    context.translate(width / 2, height / 2);
    context.scale(unit, unit);
    // Slow movement across the whole field makes the animation readable without distracting from the clip.
    context.translate(Math.sin(phase) * 0.025, Math.sin(phase * 0.73) * 0.018);
    context.rotate(-Math.PI / 12);
    const reach = Math.hypot(width, height) / unit / 2 + pitch * 2;
    const count = Math.ceil(reach / pitch);
    context.strokeStyle = "#ffffff";
    context.fillStyle = "#ffffff";
    // Keep the outlines readable even when the editor scales the canvas down.
    context.lineWidth = 0.0016;
    for (let row = -count; row <= count; row++) {
      for (let column = -count; column <= count; column++) {
        const x = column * pitch;
        const y = row * pitch;
        const wave = Math.sin(x * 2.4 + y * 1.8 - phase);
        const drift = Math.cos(y * 2 - x * 0.8 + phase * 0.7);
        const size = pitch * (0.72 + wave * 0.035);
        context.beginPath();
        context.roundRect(
          x + drift * 0.012 - size / 2,
          y + wave * 0.016 - size / 2,
          size,
          size,
          size * 0.19,
        );
        context.globalAlpha = 0.18 + (wave + 1) * 0.1;
        context.stroke();
        context.globalAlpha = 0.025 + (drift + 1) * 0.02;
        context.fill();
      }
    }
  } finally {
    context.restore();
  }
}
