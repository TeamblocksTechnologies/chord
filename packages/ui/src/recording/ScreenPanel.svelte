<script lang="ts">
  // Everything about the screen, inside one popup. Apps, pinned windows, and quality drill in rather than sitting beside the rest.
  // While the screen is off its settings stay, dimmed; picking a mode or display switches it back on.
  import { excludedApps, type RecordingSetup } from "#ui/model/setup.ts";
  import AppAccess from "./AppAccess.svelte";
  import AreaItems from "./AreaItems.svelte";
  import BackgroundRow from "./BackgroundRow.svelte";
  import DrillBack from "./DrillBack.svelte";
  import DrillRow from "./DrillRow.svelte";
  import ModeSwitch from "./ModeSwitch.svelte";
  import PinnedWindows from "./PinnedWindows.svelte";
  import Toggle from "#ui/Toggle.svelte";
  import QualityRow from "./QualityRow.svelte";
  import ScreenItems from "./ScreenItems.svelte";
  import ScreenQuality from "./ScreenQuality.svelte";
  import { appSummary, pinnedSummary, qualityLabel } from "./controls.ts";
  import { recordingEnvironment } from "./environment.ts";

  let { setup }: { setup: RecordingSetup } = $props();

  const environment = recordingEnvironment();
  const FocusedWindowPreview = environment.previews.focusedWindow;

  // The popup renders only while open, so this resets to the main view each time.
  let view = $state<"main" | "apps" | "pinned" | "quality">("main");
  let alwaysHidden = $derived(environment.preferences.hiddenApps);
  let apps = $derived(appSummary(setup, alwaysHidden));
  let hiddenApps = $derived(excludedApps(setup.hiddenApps, alwaysHidden));
</script>

{#if view !== "main"}
  <DrillBack label="Screen" onback={() => (view = "main")} />
  {#if view === "apps"}
    <AppAccess
      hidden={setup.hiddenApps}
      exclude={alwaysHidden}
      onchange={(hidden) => (setup.hiddenApps = hidden)}
    />
  {:else if view === "pinned"}
    <PinnedWindows {setup} {hiddenApps} />
  {:else}
    <ScreenQuality {setup} />
  {/if}
{:else}
  <div class={["transition-opacity", !setup.recordsScreen && "opacity-50"]}>
    <ModeSwitch {setup} class="mx-1" />
    <div class="mt-2">
      {#if setup.mode === "display"}
        <ScreenItems {setup} />
      {:else if setup.mode === "area"}
        <AreaItems {setup} />
      {:else if setup.recordsScreen}
        <div class="px-2.5 pb-2">
          <FocusedWindowPreview
            allowedApps={setup.allowedApps}
            {hiddenApps}
            pinnedWindowIds={setup.pinnedWindowIds}
          />
        </div>
      {/if}
    </div>
    <div class="-mx-1 my-1 h-px bg-glass-800"></div>
    {#if setup.mode === "window"}
      <DrillRow
        icon="pin"
        label="Pinned windows"
        detail={pinnedSummary(setup)}
        onclick={() => (view = "pinned")}
      />
    {/if}
    <DrillRow
      icon={apps.blocked === 0 ? "apps" : apps.allowed === 0 ? "eyeOff" : "filter"}
      label="Apps"
      detail={apps.label}
      onclick={() => (view = "apps")}
    />
    <DrillRow
      icon="sliders"
      label="Quality"
      detail={qualityLabel(setup, setup.screenQuality !== null)}
      onclick={() => (view = "quality")}
    />
    {#if setup.mode !== "window"}<BackgroundRow {setup} />{/if}
    <QualityRow label="Hide mouse cursor">
      <Toggle
        label="Hide mouse cursor"
        bind:checked={
          () => !environment.preferences.showsCursor,
          (hide) => environment.updatePreferences({ showsCursor: !hide })
        }
      />
    </QualityRow>
  </div>
{/if}
