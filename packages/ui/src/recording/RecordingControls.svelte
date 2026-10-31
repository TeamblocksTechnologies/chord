<script lang="ts">
  // Four cells shared by Home, the menu bar, the floating toolbar, and the recording island. The icon end of a cell switches it
  // on and off, keeping its settings; the rest opens its popup. While recording, the last source on can't be
  // switched off.
  import type { Snippet } from "svelte";
  import { recordsAnything, type RecordingSetup } from "#ui/model/setup.ts";
  import { recordingEnvironment, type SourceNeed } from "./environment.ts";
  import Icon, { type IconName } from "#ui/Icon.svelte";
  import Menu from "#ui/Menu.svelte";
  import CameraItems from "./CameraItems.svelte";
  import MicrophoneItems from "./MicrophoneItems.svelte";
  import ScreenPanel from "./ScreenPanel.svelte";
  import SourceIcon from "./SourceIcon.svelte";
  import {
    cameraNames,
    devicesToEnable,
    microphoneNames,
    screenIcon,
    screenLabel,
    summarize,
  } from "./controls.ts";

  let {
    setup,
    layout = "home",
    side = "bottom",
    overlay = layout !== "home",
    fill = false,
    trailing,
  }: {
    setup: RecordingSetup;
    layout?: "home" | "toolbar" | "island" | "menubar";
    /** Which side the cells' menus open on, toward the room the toolbar, island, or menu bar panel keeps for them. */
    side?: "top" | "bottom" | "left" | "right";
    /** Draw the menus like the transparent window they open in. */
    overlay?: boolean;
    /** Let the home layout span its container instead of capping its width. */
    fill?: boolean;
    /**
     * Joins the grid after the cells (home layout): the last column when everything fits in one row, otherwise a full
     * row below. Size it with `@min-[53rem]:` classes, which resolve against this component's container.
     */
    trailing?: Snippet;
  } = $props();

  let cameraActive = $derived(setup.cameraEnabled && setup.cameraIds.length > 0);
  let microphoneActive = $derived(setup.microphoneEnabled && setup.microphoneIds.length > 0);

  const environment = recordingEnvironment();

  /** Why a source can't be used yet, while the system hasn't allowed what it needs. */
  const blocked = (need: SourceNeed) => environment.blockedReason(need);

  let audioReason = $derived(blocked("systemAudio"));

  let compact = $derived(layout !== "home");
  let live = $derived(layout === "island");
  /** Whether switching this field off would leave a live recording with nothing to record. */
  const isLast = (off: Partial<RecordingSetup>) => live && !recordsAnything({ ...setup, ...off });
  let frame = $derived(
    `flex w-full items-center gap-1 border text-left transition ${compact ? "h-10 rounded-lg p-1" : "h-16 rounded-xl p-2"}`,
  );
  // Cells stay neutral: on reads as a raised surface, off recedes. Only the icon tile, the switch, carries the blue.
  const frameOn = "border-glass-800 bg-glass-900";
  const frameOff = "border-glass-900 bg-transparent";
  const frameOpen = "border-glass-700 bg-glass-800/60";
  const iconOn = "bg-primary text-white enabled:hover:bg-primary-hover";
  const iconOff =
    "bg-glass-900 text-glass-500 enabled:hover:bg-glass-800 enabled:hover:text-glass-300";
  let iconBox = $derived(
    `flex shrink-0 items-center justify-center transition enabled:active:scale-95 ${compact ? "size-7 rounded-md" : "size-12 rounded-lg"}`,
  );
</script>

{#snippet text(title: string, state: string, on: boolean, chevron: boolean)}
  <span class="flex min-w-0 flex-1 flex-col items-start justify-center gap-0.5 text-left">
    {#if !compact}<span class="text-xs text-glass-500">{title}</span>{/if}
    <span class={["flex w-full items-center gap-1.5 font-medium", compact ? "text-xs" : "text-sm"]}>
      <span class={["flex-1 truncate", on ? "text-neutral-50" : "text-glass-500"]}>{state}</span>
      {#if chevron}<Icon name="chevronDown" class="size-3.5 shrink-0 text-glass-500" />{/if}
    </span>
  </span>
{/snippet}

<!-- The icon end is the switch; the rest opens the popup. -->
{#snippet cell(
  kind: "screen" | "camera" | "microphone",
  title: string,
  icon: IconName,
  on: boolean,
  state: string,
  power: () => void,
  toggle: () => void,
  open: boolean,
  last: boolean,
  need: SourceNeed,
)}
  {@const reason = blocked(need)}
  <div
    class={[frame, open ? frameOpen : on ? frameOn : frameOff, reason && "opacity-40"]}
    title={reason ?? undefined}
  >
    <button
      data-source-toggle={kind}
      class={[iconBox, "disabled:cursor-default", on ? iconOn : iconOff]}
      onclick={power}
      disabled={last || !!reason}
      aria-pressed={on}
      aria-label={`${title} ${on ? "on" : "off"}`}
      title={reason
        ? undefined
        : last
          ? "Something must stay on while recording"
          : on
            ? `Turn ${title.toLowerCase()} off`
            : `Turn ${title.toLowerCase()} on`}
    >
      <SourceIcon name={icon} {on} {compact} />
    </button>
    <button
      data-popup-trigger
      disabled={!!reason}
      class={[
        "flex h-full min-w-0 flex-1 items-center transition enabled:hover:bg-glass-900 disabled:cursor-default",
        compact ? "rounded-md px-1.5" : "rounded-lg px-2.5",
      ]}
      aria-label={`${title} options: ${state}`}
      onclick={toggle}
    >
      {@render text(title, state, on, true)}
    </button>
  </div>
{/snippet}

<div
  class={[
    "@container flex w-full flex-col items-center",
    layout === "home" && !fill && "max-w-3xl",
  ]}
>
  <div
    class={[
      "grid w-full gap-2",
      layout === "toolbar"
        ? "grid-cols-4"
        : layout === "island"
          ? "grid-cols-2 gap-1.5"
          : layout === "menubar"
            ? "grid-cols-1 gap-1.5"
            : trailing
              ? "grid-cols-1 @sm:grid-cols-2 @min-[53rem]:grid-cols-[repeat(4,minmax(0,1fr))_10rem]"
              : "grid-cols-1 @sm:grid-cols-2 @2xl:grid-cols-4",
    ]}
  >
    <Menu class="w-[26rem]" {side} {overlay} panel>
      {#snippet trigger({ toggle, open })}
        {@render cell(
          "screen",
          "Screen",
          screenIcon(setup),
          setup.recordsScreen,
          screenLabel(setup),
          () => (setup.recordsScreen = !setup.recordsScreen),
          toggle,
          open,
          setup.recordsScreen && isLast({ recordsScreen: false }),
          "screen",
        )}
      {/snippet}
      {#snippet children()}<ScreenPanel {setup} />{/snippet}
    </Menu>

    <Menu class="w-72" {side} {overlay} panel>
      {#snippet trigger({ toggle, open })}
        {@render cell(
          "camera",
          "Camera",
          "camera",
          cameraActive,
          summarize(cameraNames(setup), "Off"),
          () => {
            if (cameraActive) return (setup.cameraEnabled = false);
            setup.cameraIds = devicesToEnable(setup.cameraIds, environment.sources.cameras);
            setup.cameraEnabled = true;
          },
          toggle,
          open,
          cameraActive && isLast({ cameraEnabled: false }),
          "camera",
        )}
      {/snippet}
      {#snippet children()}<CameraItems {setup} />{/snippet}
    </Menu>

    <Menu class="w-72" {side} {overlay} panel>
      {#snippet trigger({ toggle, open })}
        {@render cell(
          "microphone",
          "Microphone",
          "mic",
          microphoneActive,
          summarize(microphoneNames(setup), "Off"),
          () => {
            if (microphoneActive) return (setup.microphoneEnabled = false);
            setup.microphoneIds = devicesToEnable(
              setup.microphoneIds,
              environment.sources.microphones,
            );
            setup.microphoneEnabled = true;
          },
          toggle,
          open,
          microphoneActive && isLast({ microphoneEnabled: false }),
          "microphone",
        )}
      {/snippet}
      {#snippet children()}<MicrophoneItems {setup} />{/snippet}
    </Menu>

    <!-- Nothing to choose, so no popup: the whole cell switches it. -->
    <button
      class={[
        frame,
        setup.systemAudio ? frameOn : frameOff,
        "group enabled:hover:border-glass-800 enabled:hover:bg-glass-800/60 disabled:cursor-default",
        audioReason && "opacity-40",
      ]}
      disabled={!!audioReason || (setup.systemAudio && isLast({ systemAudio: false }))}
      title={audioReason ??
        (setup.systemAudio && isLast({ systemAudio: false })
          ? "Something must stay on while recording"
          : undefined)}
      aria-pressed={setup.systemAudio}
      aria-label={`System audio ${setup.systemAudio ? "on" : "off"}`}
      onclick={() => (setup.systemAudio = !setup.systemAudio)}
    >
      <span
        class={[
          iconBox,
          setup.systemAudio
            ? "bg-primary text-white group-enabled:group-hover:bg-primary-hover"
            : "bg-glass-900 text-glass-500 group-enabled:group-hover:bg-glass-800 group-enabled:group-hover:text-glass-300",
        ]}
      >
        <SourceIcon name="speaker" on={setup.systemAudio} {compact} />
      </span>
      <span class={["flex min-w-0 flex-1 items-center", compact ? "px-1.5" : "px-2.5"]}>
        <!-- Compact cells drop the title, and "On"/"Off" alone doesn't say what it is. -->
        {@render text(
          "System audio",
          compact ? "System audio" : setup.systemAudio ? "On" : "Off",
          setup.systemAudio,
          false,
        )}
      </span>
    </button>
    {#if trailing}
      <div class="col-span-full flex @min-[53rem]:col-span-1">{@render trailing()}</div>
    {/if}
  </div>
</div>
