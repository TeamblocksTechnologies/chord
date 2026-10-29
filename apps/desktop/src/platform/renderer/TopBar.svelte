<script lang="ts">
  import type { Snippet } from "svelte";
  import { settings } from "#features/settings/renderer/settings.svelte";
  import { scrollState } from "#features/recording/renderer/scroll.svelte";
  import { updates } from "#features/settings/renderer/updates.svelte";
  import Icon from "@teamblocks.dev/chord-ui/Icon.svelte";
  import Logo from "./Logo.svelte";
  import Tooltip from "@teamblocks.dev/chord-ui/Tooltip.svelte";

  let {
    onBack,
    backLabel,
    heading,
    onLogoClick,
    title,
    actions,
  }: {
    /** Shows a back arrow next to the window controls. */
    onBack?: () => void;
    /** Text beside the back arrow; the whole button stays clickable. */
    backLabel?: string;
    /** Replaces the centered logo with the current page's name. */
    heading?: string;
    /** Makes the centered logo an action, e.g. opening the main app from the menu bar panel. */
    onLogoClick?: () => void;
    title?: Snippet;
    actions?: Snippet;
  } = $props();

  const titlebarPadding =
    "calc(100vw - env(titlebar-area-x, 0px) - env(titlebar-area-width, 100vw) + 0.75rem)";

  // What the update button shows and says for each state. Source runs have no feed, so the button stays but is disabled.
  let update = $derived.by(() => {
    const state = updates.state;
    switch (state.status) {
      case "checking":
        return {
          icon: "refresh",
          label: "Checking for updates…",
          busy: true,
          highlight: false,
        } as const;
      case "available":
        return {
          icon: "download",
          label: `Download update ${state.version}`,
          busy: false,
          highlight: true,
        } as const;
      case "downloading":
        return {
          icon: "download",
          label: `Downloading update ${state.version} (${Math.round(state.percent)}%)`,
          busy: true,
          highlight: true,
        } as const;
      case "ready":
        return {
          icon: "restart",
          label: `Restart to install update ${state.version}`,
          busy: false,
          highlight: true,
        } as const;
      case "current":
        return {
          icon: "refresh",
          label: "Chord is up to date. Check again",
          busy: false,
          highlight: false,
        } as const;
      case "error":
        return {
          icon: "refresh",
          label: `Update check failed: ${state.message}. Try again`,
          busy: false,
          highlight: false,
        } as const;
      case "idle":
        return {
          icon: "refresh",
          label: "Check for updates",
          busy: false,
          highlight: false,
        } as const;
      case "unsupported":
        return {
          icon: "refresh",
          label: "Updates are only available in installed builds",
          busy: true,
          highlight: false,
        } as const;
    }
  });

  let barWidth = $state(0);
  let leftWidth = $state(0);
  let rightWidth = $state(0);
  let centerWidth = $state(0);
  // Reserve the wider side on both sides to keep the title on the window midline.
  // Allow a pixel for the rounding in clientWidth at fractional grid boundaries.
  let centerFits = $derived(
    centerWidth > 0 && centerWidth + 2 * Math.max(leftWidth, rightWidth) <= barWidth + 1,
  );
</script>

<!--
  Doubles as the window's title bar. Window Controls Overlay (Windows/Linux) exposes the area left free of the
  native controls via titlebar-area-* env vars; macOS falls back to an inset for the traffic lights.
  Transparent over the window's blur until the content below scrolls, then darkens to separate from it.
-->
<header
  class={[
    "app-drag sticky top-0 z-20 h-(--title-bar-height) shrink-0 border-b transition-colors duration-200",
    scrollState.scrolled ? "border-white/5 bg-neutral-950/40" : "border-transparent bg-transparent",
  ]}
>
  <div
    class="grid h-full grid-cols-[minmax(min-content,1fr)_minmax(0,max-content)_minmax(min-content,1fr)] items-center"
    bind:clientWidth={barWidth}
  >
    <!-- Padding sits inside each equal-width track, so the center stays on the window midline; a side only outgrows its track when its controls need it. -->
    <div
      class="flex h-full items-center gap-2"
      style:padding-left="max(env(titlebar-area-x, 0px), var(--title-bar-inset-left))"
      bind:clientWidth={leftWidth}
    >
      {#if onBack}
        <button
          class={[
            "app-no-drag flex h-7 shrink-0 items-center justify-center gap-1.5 rounded-md text-glass-400 transition hover:bg-glass-800 hover:text-neutral-100",
            backLabel ? "ml-3 pr-2.5 pl-1.5 text-sm font-medium" : "size-7",
          ]}
          onclick={onBack}
          aria-label={backLabel ?? "Back"}
          title="Back (Esc)"
        >
          <Icon name="arrowLeft" />
          {#if backLabel}<span class="whitespace-nowrap">{backLabel}</span>{/if}
        </button>
      {/if}
      <div class="w-0 flex-1 truncate text-sm font-medium text-glass-300">
        {@render title?.()}
      </div>
    </div>
    <!-- Keep the intrinsic width measurable while hidden, so resizing or changing the title can reveal it again. -->
    <div class="pointer-events-none min-w-0 overflow-hidden">
      <div
        class="flex h-7 w-max items-center px-2"
        style:visibility={centerFits ? "visible" : "hidden"}
        bind:clientWidth={centerWidth}
      >
        {#if heading}
          <span class="h-7 shrink-0 text-sm leading-7 font-medium whitespace-nowrap text-glass-300"
            >{heading}</span
          >
        {:else if onLogoClick}
          <button
            class="app-no-drag pointer-events-auto flex h-7 shrink-0 items-center rounded-md px-1 text-neutral-100/50 transition-colors hover:text-neutral-100"
            onclick={onLogoClick}
            aria-label="Open Chord home"
            title="Open Chord home"
          >
            <Logo class="h-4 shrink-0" />
          </button>
        {:else}
          <Logo class="h-4 shrink-0 text-neutral-100 opacity-50" />
        {/if}
      </div>
    </div>
    <div
      class="flex h-full items-center justify-end gap-1"
      style:padding-right={titlebarPadding}
      bind:clientWidth={rightWidth}
    >
      <div class="app-no-drag flex items-center gap-1">{@render actions?.()}</div>
      <Tooltip text={update.label}>
        <button
          class={[
            "app-no-drag flex size-7 shrink-0 items-center justify-center rounded-md transition hover:bg-glass-800 disabled:pointer-events-none",
            update.highlight
              ? "text-primary hover:text-primary"
              : "text-glass-400 hover:text-neutral-100",
          ]}
          onclick={() => updates.act()}
          disabled={update.busy}
          aria-label={update.label}
        >
          <Icon
            name={update.icon}
            class={update.busy && updates.state.status !== "unsupported"
              ? "size-4 animate-pulse"
              : "size-4"}
          />
        </button>
      </Tooltip>
      <Tooltip text="Settings">
        <button
          class="app-no-drag flex size-7 shrink-0 items-center justify-center rounded-md text-glass-400 transition hover:bg-glass-800 hover:text-neutral-100"
          onclick={() => settings.open()}
          aria-label="Settings"
        >
          <Icon name="settings" />
        </button>
      </Tooltip>
    </div>
  </div>
</header>
