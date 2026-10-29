import { mount } from "svelte";
import "./app.css";

const surface = window.chord.surface;
document.documentElement.dataset.platform = window.chord.platform;
document.documentElement.dataset.surface = surface;

// The hidden thumbnail window only draws; it has nothing to show.
if (surface === "thumbnails")
  void import("#features/projects/renderer/renderThumbnails").then(({ startThumbnailRenderer }) =>
    startThumbnailRenderer(),
  );

// Utility windows never initialize a project library or an independent recorder; the menu bar panel shows projects.
const root =
  surface === "thumbnails"
    ? null
    : surface === "main"
      ? import("./App.svelte")
      : surface === "pointer"
        ? import("#features/recording/renderer/PointerOverlay.svelte")
        : surface === "areas"
          ? import("#features/recording/renderer/AreaPicker.svelte")
          : surface === "notes"
            ? import("#features/recording/renderer/RecordingNotes.svelte")
            : surface === "menubar"
              ? import("#features/recording/renderer/MenubarPanel.svelte")
              : import("#features/recording/renderer/FloatingSurface.svelte");
void root?.then(({ default: component }) =>
  mount(component, { target: document.getElementById("app")! }),
);
