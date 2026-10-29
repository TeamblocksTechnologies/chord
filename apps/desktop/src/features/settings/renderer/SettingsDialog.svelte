<script lang="ts">
  import { afterExit } from "@teamblocks.dev/chord-ui/dialog";
  import { onMount } from "svelte";
  import AlwaysHiddenApps from "#features/recording/renderer/AlwaysHiddenApps.svelte";
  import Icon, { type IconName } from "@teamblocks.dev/chord-ui/Icon.svelte";
  import PermissionsPanel from "#features/recording/renderer/PermissionsPanel.svelte";
  import Segmented from "@teamblocks.dev/chord-ui/Segmented.svelte";
  import SettingsSection from "@teamblocks.dev/chord-ui/SettingsSection.svelte";
  import Toggle from "@teamblocks.dev/chord-ui/Toggle.svelte";
  import { allApps } from "#features/recording/renderer/apps.svelte";
  import { desktop, updatePreferences } from "#platform/renderer/desktop.svelte";
  import { settings, type SettingsTab } from "./settings.svelte.ts";
  import { shortcutLabel } from "./shortcuts.svelte.ts";
  import { toolbar } from "#features/recording/renderer/toolbar.svelte";
  import type { Preferences } from "../domain/preferences.ts";
  import BackgroundRemovalSettings from "#features/background-removal/renderer/BackgroundRemovalSettings.svelte";
  import NoiseReductionSettings from "#features/audio-processing/renderer/NoiseReductionSettings.svelte";
  import ShortcutSettings from "./ShortcutSettings.svelte";
  import TranscriptionSettings from "#features/transcription/renderer/TranscriptionSettings.svelte";

  const tabs = [
    { id: "general", label: "General", icon: "sliders", description: "Quick access to Chord." },
    {
      id: "shortcuts",
      label: "Shortcuts",
      icon: "keyboard",
      description: "View and change keyboard shortcuts.",
    },
    {
      id: "recording",
      label: "Recording",
      icon: "record",
      description: "Recording defaults, storage, and camera previews.",
    },
    {
      id: "transcription",
      label: "Transcription",
      icon: "notes",
      description: "Choose a speech model, set its language, and try it out.",
    },
    {
      id: "audio",
      label: "Audio",
      icon: "speaker",
      description: "Choose how noise is reduced in recorded microphones and system audio.",
    },
    {
      id: "background",
      label: "Backgrounds",
      icon: "user",
      description:
        "Set up background removal and choose a default background for camera recordings.",
    },
    {
      id: "privacy",
      label: "Privacy",
      icon: "eyeOff",
      description: "Control which apps are captured and what Chord can access.",
    },
  ] as const satisfies readonly {
    id: SettingsTab;
    label: string;
    icon: IconName;
    description: string;
  }[];
  // Kept in the store so an entrypoint can switch tabs while the dialog is already open.
  let activeTab = $derived(settings.tab ?? "general");
  const currentTab = $derived(tabs.find((tab) => tab.id === activeTab)!);

  let dialog: HTMLDialogElement;
  onMount(() => {
    dialog.showModal();
    // Start on the tab asked for, so arrow keys move between tabs straight away.
    document.getElementById(`settings-tab-${activeTab}`)?.focus();
  });

  // Narrow windows show the tabs in a row above the settings instead of beside them.
  const wide = window.matchMedia("(min-width: 40rem)");
  let vertical = $state(wide.matches);
  $effect(() => {
    const update = () => (vertical = wide.matches);
    wide.addEventListener("change", update);
    return () => wide.removeEventListener("change", update);
  });

  // The row of tabs scrolls, so keep the open one showing.
  $effect(() => {
    document
      .getElementById(`settings-tab-${activeTab}`)
      ?.scrollIntoView({ block: "nearest", inline: "nearest" });
  });

  function onTabKeydown(event: KeyboardEvent) {
    const index = tabs.findIndex((tab) => tab.id === activeTab);
    let next: number;
    switch (event.key) {
      case vertical ? "ArrowDown" : "ArrowRight":
        next = (index + 1) % tabs.length;
        break;
      case vertical ? "ArrowUp" : "ArrowLeft":
        next = (index - 1 + tabs.length) % tabs.length;
        break;
      case "Home":
        next = 0;
        break;
      case "End":
        next = tabs.length - 1;
        break;
      default:
        return;
    }
    event.preventDefault();
    settings.tab = tabs[next].id;
    document.getElementById(`settings-tab-${settings.tab}`)?.focus();
  }

  const countdowns: { value: Preferences["countdown"]; label: string }[] = [
    { value: 0, label: "Off" },
    { value: 3, label: "3s" },
    { value: 5, label: "5s" },
  ];

  let folder = $state("");
  void window.chord.desktop.recording.folder().then((path) => (folder = path));

  const row =
    "flex min-h-9 flex-wrap items-center gap-2.5 border-t border-glass-800 py-1.5 first:border-t-0";
  const label = "flex-1 text-xs font-medium text-neutral-100";
  const button =
    "h-7 shrink-0 rounded-md border border-glass-700 bg-glass-800/70 px-2.5 text-xs font-medium text-neutral-100 transition enabled:hover:bg-glass-700/70 disabled:opacity-50";
</script>

<dialog
  bind:this={dialog}
  closedby="any"
  class="m-auto h-[40rem] w-[56rem] max-w-[calc(100%-2rem)] overflow-hidden rounded-xl border border-glass-800 bg-popover p-0 open:flex open:flex-col sm:open:flex-row text-neutral-200 shadow-2xl backdrop-blur-2xl backdrop-saturate-150 backdrop:bg-black/50"
  aria-labelledby="settings-title"
  onclose={afterExit(() => settings.close())}
>
  <aside
    class="shrink-0 border-b border-glass-800 pt-3 pb-2 sm:w-44 sm:overflow-y-auto sm:border-r sm:border-b-0 sm:px-2 sm:py-3"
  >
    <h2 id="settings-title" class="px-4 pb-2 text-[13px] font-medium text-neutral-100 sm:px-2">
      Settings
    </h2>
    <div
      role="tablist"
      aria-label="Settings"
      aria-orientation={vertical ? "vertical" : "horizontal"}
      class="flex scroll-px-4 gap-0.5 overflow-x-auto px-4 [scrollbar-width:none] sm:flex-col sm:overflow-visible sm:px-0"
    >
      {#each tabs as tab (tab.id)}
        <button
          id={`settings-tab-${tab.id}`}
          role="tab"
          aria-selected={activeTab === tab.id}
          aria-controls={`settings-panel-${tab.id}`}
          tabindex={activeTab === tab.id ? 0 : -1}
          class={[
            "flex min-h-7 shrink-0 items-center gap-2 rounded-md px-2 text-left text-xs font-medium whitespace-nowrap transition-colors sm:w-full",
            activeTab === tab.id
              ? "bg-glass-800 text-neutral-100"
              : "text-glass-400 hover:bg-glass-900 hover:text-neutral-100",
          ]}
          onclick={() => (settings.tab = tab.id)}
          onkeydown={onTabKeydown}
        >
          <Icon name={tab.icon} class="hidden size-3.5 shrink-0 sm:block" />
          {tab.label}
        </button>
      {/each}
    </div>
  </aside>

  {#key activeTab}
    <div
      id={`settings-panel-${activeTab}`}
      role="tabpanel"
      aria-labelledby={`settings-tab-${activeTab}`}
      tabindex="0"
      class="min-w-0 flex-1 overflow-y-auto overscroll-contain"
    >
      <section class="w-full px-4 pt-5 pb-6 sm:px-6">
        <h1 class="pr-8 text-base font-medium text-neutral-100">{currentTab.label}</h1>
        <p class="mt-1 text-xs text-glass-500">{currentTab.description}</p>

        {#if activeTab === "general"}
          <SettingsSection title="Quick recording toolbar">
            <div class="flex flex-wrap items-center justify-between gap-3 py-2.5">
              <div>
                <p class="text-xs text-glass-500">Open from any app while Chord is running.</p>
                {#if shortcutLabel("toolbar") && !toolbar.registered}
                  <p class="mt-2 text-xs text-amber-300">
                    Shortcut unavailable. Another app may be using it. You can open the toolbar
                    here.
                  </p>
                {/if}
              </div>
              <button
                class="shrink-0 rounded-md border border-glass-700 bg-glass-900 px-2.5 py-1 text-xs hover:bg-glass-800"
                onclick={() => (settings.tab = "shortcuts")}
                aria-label="Change shortcut"
              >
                {#if shortcutLabel("toolbar")}<kbd class="font-sans">{shortcutLabel("toolbar")}</kbd
                  >{:else}No shortcut{/if}
              </button>
            </div>
          </SettingsSection>
          <button
            class="mt-3 h-7 rounded-md border border-glass-700 px-2.5 text-xs text-glass-300 hover:bg-glass-800"
            onclick={() => window.chord.toolbar.show()}>Open recording toolbar</button
          >
        {:else if activeTab === "shortcuts"}
          <ShortcutSettings />
        {:else if activeTab === "recording"}
          <SettingsSection title="Recording defaults">
            <div class={row}>
              <span class={label}>Countdown</span>
              <Segmented
                label="Countdown"
                options={countdowns}
                bind:value={
                  () => desktop.preferences.countdown,
                  (countdown) => updatePreferences({ countdown })
                }
              />
            </div>
            <div class={row}>
              <div class="flex min-w-0 basis-full flex-wrap items-baseline gap-3 opacity-50">
                <span class="shrink-0 text-xs font-medium text-neutral-100">Recordings folder</span>
                <span class="truncate text-xs text-glass-400" title={folder}>{folder}</span>
              </div>
              <button class={button} disabled>Change…</button>
              <button
                class={button}
                onclick={() => void window.chord.desktop.recording.openFolder()}
                >Show in Finder</button
              >
            </div>
          </SettingsSection>

          <SettingsSection title="Camera">
            <div class={row}>
              <span class={label}>Mirror camera preview</span>
              <Toggle
                label="Mirror camera preview"
                bind:checked={
                  () => desktop.preferences.cameraMirrored,
                  (cameraMirrored) => updatePreferences({ cameraMirrored })
                }
              />
            </div>
            <div class={row}>
              <span class={label}>Show camera while recording</span>
              <Toggle
                label="Show camera while recording"
                bind:checked={
                  () => desktop.preferences.islandPreview,
                  (islandPreview) => updatePreferences({ islandPreview })
                }
              />
            </div>
          </SettingsSection>
        {:else if activeTab === "transcription"}
          <TranscriptionSettings />
        {:else if activeTab === "audio"}
          <NoiseReductionSettings />
        {:else if activeTab === "background"}
          <BackgroundRemovalSettings />
        {:else if activeTab === "privacy"}
          <SettingsSection
            title="Hidden apps"
            detail={`${desktop.preferences.hiddenApps.length}/${allApps(desktop.preferences.hiddenApps).length}`}
          >
            <div class="py-2.5">
              <AlwaysHiddenApps
                hidden={desktop.preferences.hiddenApps}
                onchange={(hiddenApps) => updatePreferences({ hiddenApps })}
              />
            </div>
          </SettingsSection>

          <PermissionsPanel settings />
        {/if}
      </section>
    </div>
  {/key}

  <button
    class="absolute top-3 right-3 flex size-7 items-center justify-center rounded-md text-glass-400 transition hover:bg-glass-800 hover:text-neutral-100"
    onclick={() => dialog.close()}
    aria-label="Close settings"
    title="Close (Esc)"
  >
    <Icon name="x" />
  </button>
</dialog>
