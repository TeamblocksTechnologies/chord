<script lang="ts">
  import type { Snippet } from "svelte";
  import { settings } from "#features/settings/renderer/settings.svelte";
  import { scrollState } from "#features/recording/renderer/scroll.svelte";
  import { updates } from "#features/settings/renderer/updates.svelte";
  import Icon from "@teamblocks.dev/chord-ui/Icon.svelte";
  import Logo from "@teamblocks.dev/chord-ui/Logo.svelte";
  import TitleBar from "@teamblocks.dev/chord-ui/TitleBar.svelte";
  import TitleBarButton from "@teamblocks.dev/chord-ui/TitleBarButton.svelte";

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
</script>

<TitleBar scrolled={scrollState.scrolled}>
  {#snippet start()}
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
  {/snippet}
  {#snippet center()}
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
  {/snippet}
  {#snippet end()}
    <div class="app-no-drag flex items-center gap-1">{@render actions?.()}</div>
    <TitleBarButton
      label={update.label}
      icon={update.icon}
      onclick={() => updates.act()}
      disabled={update.busy}
      highlight={update.highlight}
      pulse={update.busy && updates.state.status !== "unsupported"}
    />
    <TitleBarButton label="Settings" icon="settings" onclick={() => settings.open()} />
  {/snippet}
</TitleBar>
