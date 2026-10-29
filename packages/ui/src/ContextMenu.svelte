<script lang="ts">
  import { contextMenu } from "#ui/contextMenu.svelte.ts";
  import Menu from "#ui/Menu.svelte";
  import MenuEntries from "#ui/MenuEntries.svelte";
</script>

<!-- Each right-click opens a fresh menu at the pointer, replacing the last. -->
{#key contextMenu.id}
  <Menu point={contextMenu.point} bind:open={contextMenu.open}>
    {#snippet trigger()}{/snippet}
    {#snippet children({ close })}<MenuEntries entries={contextMenu.entries} {close} />{/snippet}
  </Menu>
{/key}
