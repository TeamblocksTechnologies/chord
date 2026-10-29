<script lang="ts">
  import { openContextMenu, type MenuEntry } from "@teamblocks.dev/chord-ui/contextMenu.svelte";
  import { formatDuration, formatRelative } from "#shared/domain/format";
  import { totalDuration } from "#project-document/renderer/projects.svelte";
  import { thumbnails } from "./thumbnails.svelte.ts";
  import type { Project } from "#project-document/domain/recording";
  import { hasNotes } from "#features/recording/domain/notes";
  import Icon from "@teamblocks.dev/chord-ui/Icon.svelte";
  import Menu from "@teamblocks.dev/chord-ui/Menu.svelte";
  import MenuEntries from "@teamblocks.dev/chord-ui/MenuEntries.svelte";
  import ThumbnailCaptions from "./ThumbnailCaptions.svelte";

  let {
    project,
    view = "grid",
    compact = false,
    onclick,
    actions,
  }: {
    project: Project;
    view?: "grid" | "list";
    compact?: boolean;
    onclick: (time?: number) => void;
    /** The project's actions, from its menu button on hover and a right-click. */
    actions?: () => MenuEntry[];
  } = $props();

  /** How close to the thumbnail's bottom the pointer must be to scrub, in CSS pixels. */
  const SCRUB_ZONE = 24;
  /** How far up captions move while scrubbing, clear of the time under them, in CSS pixels. */
  const TIME_CLEARANCE = 34;

  // Shown until the project's thumbnails have rendered.
  let hue = $derived([...project.id].reduce((sum, c) => sum + c.charCodeAt(0), 0) % 360);
  let takes = $derived(project.recordings.length);
  let set = $derived(takes > 0 ? (thumbnails.sets[project.id] ?? null) : null);
  let scrubs = $derived(view === "grid" && !!set);
  /** Where the pointer is along the video while scrubbing, from 0 to 1. */
  let scrub = $state<number | null>(null);
  /** Whether the other frames have been asked for, once the card is first hovered. */
  let warm = $state(false);
  /** Where in the video the thumbnail shows: the cover's time, or wherever the pointer is. */
  let at = $derived(set ? (scrub === null ? set.frames[0]!.time : scrub * set.duration) : 0);
  /** The frame nearest `at`. */
  let shown = $derived(
    set
      ? set.frames.reduce(
          (best, frame, index) =>
            Math.abs(frame.time - at) < Math.abs(set!.frames[best]!.time - at) ? index : best,
          0,
        )
      : 0,
  );

  $effect(() => {
    if (takes > 0) thumbnails.load(project.id);
  });

  function onpointermove(event: PointerEvent) {
    if (!scrubs) return;
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    scrub =
      event.clientY >= rect.bottom - SCRUB_ZONE
        ? Math.min(Math.max((event.clientX - rect.left) / rect.width, 0), 1)
        : null;
  }

  function oncontextmenu(event: MouseEvent) {
    if (!actions || (event.target as HTMLElement).closest("[role=menu]")) return;
    openContextMenu(event, actions());
  }
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="group relative flex min-w-0 flex-col" {oncontextmenu}>
  <button
    class={[
      "flex min-w-0 text-left",
      view === "list"
        ? "items-center gap-3 py-3 transition-[background-color] group-hover:bg-glass-800/40"
        : "flex-col gap-2.5",
    ]}
    onclick={() => onclick(scrub === null ? undefined : at)}
  >
    <div
      class={[
        "relative aspect-video overflow-hidden transition group-hover:brightness-110",
        view === "list" ? ["shrink-0 rounded-lg", compact ? "w-16" : "w-24"] : "w-full rounded-xl",
        takes === 0 && "bg-neutral-950 group-hover:bg-neutral-900/50",
      ]}
      style:background={set || takes === 0
        ? undefined
        : `radial-gradient(120% 120% at 0% 0%, hsl(${hue} 45% 22%), hsl(${(hue + 40) % 360} 30% 10%))`}
      role="presentation"
      onpointerenter={() => (warm = true)}
      {onpointermove}
      onpointerleave={() => (scrub = null)}
    >
      {#if takes === 0}
        <div
          class="absolute inset-0 flex flex-col items-center justify-center gap-1.5 text-glass-500 transition group-hover:text-glass-400"
        >
          {#if hasNotes(project.notes)}<Icon name="notes" class="size-5" />{/if}
          {#if view === "grid"}<span class="text-xs font-medium">Ready to record</span>{/if}
        </div>
      {:else}
        {#if set}
          <div class="absolute inset-0 flex items-center justify-center bg-neutral-950">
            <div
              class={["relative", set.aspect >= 16 / 9 ? "w-full" : "h-full"]}
              style:aspect-ratio={set.aspect}
            >
              {#each set.frames as frame, index (frame.url)}
                {#if index === 0 || (warm && scrubs)}
                  <img
                    src={frame.url}
                    alt=""
                    draggable="false"
                    class={["absolute inset-0 size-full", index !== shown && "invisible"]}
                  />
                {/if}
              {/each}
              {#if view === "grid"}<ThumbnailCaptions
                  captions={set.captions}
                  style={set.captionStyle}
                  {at}
                  clearance={scrub === null ? 0 : TIME_CLEARANCE}
                />{/if}
            </div>
          </div>
        {/if}
        <div
          class={[
            "absolute inset-0 flex items-center justify-center opacity-0 transition group-hover:opacity-100",
            scrub !== null && "invisible",
          ]}
        >
          <div
            class="flex size-10 items-center justify-center rounded-lg bg-neutral-950/70 backdrop-blur"
          >
            <Icon name="play" class="ml-0.5 size-4 text-neutral-100" />
          </div>
        </div>
        {#if view === "grid"}
          {#if scrubs && scrub !== null}
            <span
              class="absolute bottom-2 -translate-x-1/2 rounded-md bg-neutral-950/75 px-1.5 py-0.5 text-xs font-medium text-neutral-100 tabular-nums backdrop-blur"
              style:left="clamp(1.75rem, {scrub * 100}%, calc(100% - 1.75rem))"
            >
              {formatDuration(at)}
            </span>
          {:else}
            <span
              class="absolute right-2 bottom-2 rounded-md bg-neutral-950/75 px-1.5 py-0.5 text-xs font-medium text-neutral-200 tabular-nums backdrop-blur"
            >
              {formatDuration(set?.duration ?? totalDuration(project))}
            </span>
          {/if}
          {#if scrubs}
            <div
              class={[
                "absolute inset-x-0 bottom-0 bg-neutral-100/25 opacity-0 transition-[opacity,height] group-hover:opacity-100",
                scrub === null ? "h-0.5" : "h-1",
              ]}
            >
              <div class="h-full bg-primary" style:width="{(at / set!.duration) * 100}%"></div>
            </div>
          {/if}
          {#if takes > 1 && scrub === null}
            <span
              class="absolute top-2 left-2 rounded-md bg-neutral-950/75 px-1.5 py-0.5 text-xs font-medium text-glass-300 backdrop-blur"
            >
              {takes} recordings
            </span>
          {/if}
        {/if}
      {/if}
      <div
        class="pointer-events-none absolute inset-0 rounded-[inherit] ring-1 ring-glass-900 ring-inset"
      ></div>
    </div>
    <div class={["min-w-0 px-0.5", view === "list" && "flex-1", actions && "pr-8"]}>
      <div class="truncate text-sm font-medium text-neutral-100">{project.name}</div>
      {#if view === "list"}
        <div class="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-glass-500">
          <span
            >{takes === 0
              ? "Ready to record"
              : `${takes} ${takes === 1 ? "recording" : "recordings"}`}</span
          >
          {#if takes > 0}<span class="tabular-nums">{formatDuration(totalDuration(project))}</span
            >{/if}
          <span>{formatRelative(project.updatedAt)}</span>
        </div>
      {:else}
        <div class="mt-0.5 text-xs text-glass-500">{formatRelative(project.updatedAt)}</div>
      {/if}
    </div>
    {#if view === "list"}<Icon
        name="chevronRight"
        class="mr-2 size-4 shrink-0 text-glass-600 group-hover:text-glass-300"
      />{/if}
  </button>
  {#if actions}
    <div
      class={[
        "absolute right-0 flex items-center",
        view === "list" ? "inset-y-0 right-7" : "bottom-1",
      ]}
    >
      <Menu align="end">
        {#snippet trigger({ toggle, open })}
          <button
            class={[
              "flex size-7 items-center justify-center rounded-md text-glass-400 transition hover:bg-glass-800 hover:text-neutral-100 focus-visible:opacity-100",
              !open && "opacity-0 group-focus-within:opacity-100 group-hover:opacity-100",
            ]}
            onclick={toggle}
            aria-label={`${project.name || "Untitled project"} actions`}
            aria-haspopup="menu"
            aria-expanded={open}
            title="Project actions"><Icon name="more" class="size-3.5" /></button
          >
        {/snippet}
        {#snippet children({ close })}<MenuEntries entries={actions()} {close} />{/snippet}
      </Menu>
    </div>
  {/if}
</div>
