<script lang="ts">
  // Home: the recording controls with Record and New project, then the projects. The menu bar panel shows it
  // narrower, with the cells' menus opening beside it.
  import type { Snippet } from "svelte";
  import type { RecordingSetup } from "#ui/model/setup.ts";
  import RecordingControls from "#ui/recording/RecordingControls.svelte";
  import RecordRow from "#ui/recording/RecordRow.svelte";

  let {
    setup,
    panel = false,
    side,
    onRecord,
    onNewProject,
    notice,
    projects,
  }: {
    setup: RecordingSetup;
    /** The menu bar panel's narrower layout. */
    panel?: boolean;
    /** Which side the cells' menus open on. */
    side?: "top" | "bottom" | "left" | "right";
    onRecord: () => void;
    onNewProject: () => void;
    /** Above the controls, e.g. permissions still to allow. */
    notice?: Snippet;
    /** Under the Projects heading. */
    projects: Snippet;
  } = $props();
</script>

<section class={["flex flex-col items-center", panel ? "px-4 pt-2 pb-5" : "px-8 pt-10 pb-14"]}>
  {@render notice?.()}
  <RecordingControls
    {setup}
    layout={panel ? "menubar" : "home"}
    {side}
    overlay={panel}
    fill={panel}
  />
  <RecordRow {setup} {onRecord} {onNewProject} compact={panel} class={panel ? "mt-3" : "mt-8"} />
</section>

<section class={panel ? "px-4 pb-6" : "px-8 pb-12"}>
  <h2 class={["font-semibold text-neutral-100", panel ? "text-base" : "text-lg"]}>Projects</h2>
  {@render projects()}
</section>
