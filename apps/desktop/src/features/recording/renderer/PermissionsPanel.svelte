<script lang="ts">
  // What recording needs the system to allow. On Home it shows until everything is allowed, with a button to prompt or
  // open the matching System Settings pane. In Settings it always shows, ticking off what's allowed and keeping a
  // button to open the pane so a permission can be changed. Rows update on their own as permissions change.
  import type { PermissionKind } from "@teamblocks.dev/chord-recorder-protocol";
  import { permissionLabels, permissions } from "./permissions.svelte.ts";
  import Icon, { type IconName } from "@teamblocks.dev/chord-ui/Icon.svelte";
  import SettingsSection from "@teamblocks.dev/chord-ui/SettingsSection.svelte";

  const rows: { kind: PermissionKind; icon: IconName }[] = [
    { kind: "camera", icon: "camera" },
    { kind: "microphone", icon: "mic" },
    { kind: "screen", icon: "monitor" },
    { kind: "accessibility", icon: "cursor" },
  ];

  let { settings = false }: { settings?: boolean } = $props();

  let needed = $derived(
    permissions.status !== null && rows.some((row) => !permissions.granted(row.kind)),
  );
  const button =
    "h-7 rounded-md border border-glass-700 bg-glass-800/70 px-2.5 text-xs font-medium text-neutral-100 transition hover:bg-glass-700/70";
</script>

{#snippet permissionRows()}
  {#each rows as row (row.kind)}
    {@const granted = permissions.granted(row.kind)}
    <div
      class="flex min-h-9 flex-wrap items-center gap-2.5 border-t border-glass-800 py-1.5 first:border-t-0"
    >
      <Icon
        name={row.icon}
        class={["shrink-0 text-glass-500", settings ? "size-3.5" : "size-4"].join(" ")}
        strokeWidth={1.5}
      />
      <span class={["flex-1 font-medium text-neutral-100", settings ? "text-xs" : "text-sm"]}
        >{permissionLabels[row.kind]}</span
      >
      {#if granted}
        <span class="flex items-center gap-1 text-xs text-glass-400"
          ><Icon name="check" class="size-3.5 text-primary" /> Allowed</span
        >
      {/if}
      {#if !granted && permissions.canPrompt(row.kind)}
        <button class={button} onclick={() => void permissions.enable(row.kind)}>Enable</button>
      {:else if !granted || settings}
        <button class={button} onclick={() => void window.chord.openPermissionSettings(row.kind)}
          >Open settings</button
        >
      {/if}
    </div>
  {/each}
{/snippet}

{#if settings}
  <SettingsSection title="Permissions">
    {@render permissionRows()}
  </SettingsSection>
{:else if needed}
  <div class="mb-6 w-full max-w-3xl rounded-lg border border-glass-800 bg-glass-900/30 px-3 py-0.5">
    <p class="pt-2 pb-1 text-sm font-medium text-neutral-100">Allow access to start recording</p>
    {@render permissionRows()}
  </div>
{/if}
