// The demo library the screenshots show. Content is deliberately generic.
//
// - `scene`: which scene in scenes.mjs the screen recording shows.
// - `camera`: a presenter palette from scenes.mjs, or absent for no camera.
// - `lines`: the narration, spoken with `say` and transcribed line by line.
// - `updated`: minutes ago, for the "Last updated" order and labels.
// - `edits`: what the editor screenshot shows on the recording: pointer effect spans and a cut narration line.

/** The quick-start setup: every source on. */
export const SETUP = {
  recordsScreen: true,
  mode: "display",
  displayIds: [1],
  microphoneIds: ["mic"],
  microphoneEnabled: true,
  cameraIds: ["cam"],
  cameraEnabled: true,
  primaryCameraId: "cam",
  systemAudio: true,
};

/** What the fixture helper reports, matching `SETUP`. */
export const SOURCES = {
  displays: [
    { id: 1, name: "Built-in Retina Display", width: 3456, height: 2234, scale: 2, isMain: true },
  ],
  applications: [],
  windows: [],
  microphones: [{ id: "mic", name: "Studio Mic", isDefault: true }],
  cameras: [
    {
      id: "cam",
      name: "Webcam",
      isDefault: true,
      formats: [{ width: 1920, height: 1080, maxFps: 30 }],
    },
  ],
};

export const VOICE = { name: "Samantha", rate: 185 };

export const PROJECTS = [
  {
    name: "Product walkthrough",
    scene: "dashboard",
    camera: 0,
    systemAudio: true,
    updated: 12,
    lines: [
      "Hi everyone, this is a quick walkthrough of the new overview page.",
      "At the top, you can see the key numbers for the last thirty days.",
      "Active users are up about four percent compared to last month.",
      "The chart below shows how usage changes from week to week.",
      "On the right, top channels shows where new visitors come from.",
      "Down here, the activity list shows the latest events as they happen.",
      "You can click any row to see the details.",
      "That's the overview. Next time, we'll look at reports.",
    ],
    edits: {
      laser: [{ start: 8.5, end: 16 }],
      clicks: "all",
      cutLine: 6,
    },
  },
  {
    name: "Onboarding flow",
    scene: "onboarding",
    camera: 2,
    updated: 95,
    lines: [
      "Let's walk through setting up a new workspace.",
      "First, give your workspace a name and pick a region.",
      "Next, invite your team by email and choose a default role.",
      "Finally, set your preferences, like the theme and time zone.",
      "And that's it, the workspace is ready to go.",
    ],
  },
  {
    name: "Weekly update",
    scene: "slides",
    camera: 1,
    updated: 60 * 5,
    lines: [
      "Here's a short update on what we shipped this week.",
      "Most areas moved forward, with mobile and infrastructure leading.",
      "Next week, we'll finish the settings page and plan the next release.",
    ],
  },
  {
    name: "Design review",
    scene: "canvas",
    updated: 60 * 26,
    lines: [
      "These are the three main screens for the redesign.",
      "The home screen has a larger hero and simpler cards.",
      "Feedback so far is mostly about spacing and grouping.",
    ],
  },
  {
    name: "Bug reproduction",
    scene: "code",
    updated: 60 * 30,
    lines: [
      "This test fails when events arrive out of order.",
      "The fix keeps each day's events in the order they happened.",
      "Running the tests again, everything passes.",
    ],
  },
  {
    name: "Sprint planning",
    scene: "board",
    camera: 0,
    updated: 60 * 24 * 3,
    lines: [
      "Let's go through the board for this sprint.",
      "Settings search moved into review this morning.",
      "Keyboard shortcuts are done, so we can pick up the next task.",
    ],
  },
  {
    name: "API quickstart",
    scene: "docs",
    updated: 60 * 24 * 6,
    lines: [
      "To make your first request, create a key in your account settings.",
      "Send it in the authorization header with each request.",
      "The response is JSON, with the results in the data field.",
    ],
  },
  {
    name: "Team calendar tour",
    scene: "calendar",
    camera: 2,
    updated: 60 * 24 * 9,
    lines: [
      "This is the week view of the shared calendar.",
      "Recurring meetings, like standup, show in teal.",
      "Focus time blocks keep afternoons free for deeper work.",
    ],
  },
];
