// The screenshots kept in the repository, captured in this order by `pnpm screenshots`. Each `id` has a matching
// capture step in capture.mjs; `output` is relative to the repository root.
export const SHOTS = [
  {
    id: "home",
    output: "docs/images/home.png",
    description: "The main window's home screen: every source on and the demo projects in the grid",
    window: { width: 1280, height: 880 },
  },
  {
    id: "menubar",
    output: "docs/images/menubar.png",
    description: "The panel under the menu bar icon, with projects in the list view",
  },
  {
    id: "toolbar",
    output: "docs/images/toolbar.png",
    description: "The floating toolbar, with every source on",
  },
  {
    id: "editor",
    output: "docs/images/editor.png",
    description:
      "A recording open in the editor: transcript with a cut, effect tracks and waveforms",
    window: { width: 1280, height: 880 },
    project: "Product walkthrough",
    track: "microphone",
    // Seconds into the recording, inside the laser pointer span and mid-caption.
    time: 11.2,
  },
];

// Composed from another shot rather than captured: the GitHub social preview, on black with the logo over the top of
// `source`'s window. Regenerated whenever `source` is, and by `pnpm screenshots social` on its own.
export const SOCIAL = {
  id: "social",
  output: "docs/images/social.png",
  source: "home",
  description: "The GitHub social preview card (1280x640), made from the home screen",
};
