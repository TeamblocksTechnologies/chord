import type { CaptureMode } from "#project-document/domain/recording";

export const MODE_LABELS: Record<CaptureMode, string> = {
  window: "Focused window",
  display: "Full display",
  area: "Area",
};
