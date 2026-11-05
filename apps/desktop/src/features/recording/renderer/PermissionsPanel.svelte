<script lang="ts">
  // What recording asks the system to allow, in Settings: ticks off what's allowed and keeps a button to prompt or
  // open the matching System Settings pane, so a permission can be changed. Rows update on their own as permissions
  // change. Each source asks for its own permission where it's picked, so none of these is needed up front.
  import type { PermissionKind } from "@teamblocks.dev/chord-recorder-protocol";
  import { permissionLabels, permissions } from "./permissions.svelte.ts";
  import Icon, { type IconName } from "@teamblocks.dev/chord-ui/Icon.svelte";
  import SettingsSection from "@teamblocks.dev/chord-ui/SettingsSection.svelte";

  const rows: { kind: PermissionKind; icon: IconName }[] = [
    { kind: "camera", icon: "camera" },
    { kind: "microphone", icon: "mic" },
    { kind: "screen", icon: "monitor" },
    // Following a window works without it, but only includes the window's dialogs and popups with it.
    { kind: "accessibility", icon: "cursor" },
  ];

  const button =
    "h-7 rounded-md border border-glass-700 bg-glass-800/70 px-2.5 text-xs font-medium text-neutral-100 transition hover:bg-glass-700/70";
</script>

<SettingsSection title="Permissions">
  {#each rows as row (row.kind)}
    {@const granted = permissions.granted(row.kind)}
    <div
      class="flex min-h-9 flex-wrap items-center gap-2.5 border-t border-glass-800 py-1.5 first:border-t-0"
    >
      <Icon name={row.icon} class="size-3.5 shrink-0 text-glass-500" strokeWidth={1.5} />
      <span class="flex-1 text-xs font-medium text-neutral-100">{permissionLabels[row.kind]}</span>
      {#if granted}
        <span class="flex items-center gap-1 text-xs text-glass-400"
          ><Icon name="check" class="size-3.5 text-primary" /> Allowed</span
        >
      {/if}
      {#if !granted && permissions.canPrompt(row.kind)}
        <button class={button} onclick={() => void permissions.enable(row.kind)}>Enable</button>
      {:else}
        <button class={button} onclick={() => void permissions.openSettings(row.kind)}
          >Open settings</button
        >
      {/if}
    </div>
  {/each}
</SettingsSection>
