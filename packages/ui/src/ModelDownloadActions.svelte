<script lang="ts">
  import { settingsButton } from "#ui/settingsStyles.ts";
  import Icon from "#ui/Icon.svelte";
  import ProgressBar from "#ui/ProgressBar.svelte";

  let {
    name,
    status,
    ondownload,
    oncancel,
    onremove,
    downloadUnavailable = false,
  }: {
    name: string;
    status?:
      | { state: "downloading"; progress: number | null }
      | { state: "downloaded" | "ready" | "notDownloaded" | "unavailable" };
    ondownload: () => void;
    oncancel?: () => void;
    onremove?: () => void;
    /** A downloadable engine can be retried even when its current availability check failed. */
    downloadUnavailable?: boolean;
  } = $props();
  const percent = new Intl.NumberFormat(undefined, { style: "percent" });
</script>

{#if status?.state === "downloading"}
  <ProgressBar class="w-28 shrink-0" value={status.progress} label={`Downloading ${name}`} />
  <span class="w-9 shrink-0 text-right text-xs text-glass-400 tabular-nums"
    >{status.progress === null ? "" : percent.format(Math.floor(status.progress * 100) / 100)}</span
  >
  {#if oncancel}<button class={settingsButton} onclick={oncancel}>Cancel</button>{/if}
{:else if status?.state === "downloaded" || status?.state === "ready"}
  <span class="flex shrink-0 items-center gap-1.5 text-xs text-glass-400"
    ><Icon name="check" class="size-3.5" />Downloaded</span
  >
  {#if onremove}<button class={settingsButton} onclick={onremove}>Remove</button>{/if}
{:else if status?.state === "notDownloaded" || (status && downloadUnavailable)}
  <button class={settingsButton} onclick={ondownload}>Download</button>
{:else if status}
  <span class="shrink-0 text-xs text-glass-500">Unavailable</span>
{/if}
