<script lang="ts">
  import { onMount } from "svelte";
  import type { ExportedVideo } from "#platform/contracts/desktop";
  import { openContextMenu, type MenuEntry } from "@teamblocks.dev/chord-ui/contextMenu.svelte";
  import { formatDateTime } from "#shared/domain/format";
  import ConfirmDialog from "@teamblocks.dev/chord-ui/ConfirmDialog.svelte";
  import Icon from "@teamblocks.dev/chord-ui/Icon.svelte";
  import Menu from "@teamblocks.dev/chord-ui/Menu.svelte";
  import MenuEntries from "@teamblocks.dev/chord-ui/MenuEntries.svelte";

  /** The project's folder, whose Exports folder is listed. */
  let { folder }: { folder: string } = $props();

  let videos = $state<ExportedVideo[]>([]);
  // A new request can open while the previous confirmation is still fading out.
  let deleting = $state<{ video: ExportedVideo } | null>(null);

  /** Reads the Exports folder again, e.g. after an export or a change in Finder. */
  export async function refresh() {
    videos = await window.chord.desktop.export.list(folder);
  }

  onMount(() => {
    void refresh();
    const onfocus = () => void refresh();
    window.addEventListener("focus", onfocus);
    return () => window.removeEventListener("focus", onfocus);
  });

  /** Whether the export is a saved frame rather than a video. */
  const isFrame = (video: ExportedVideo) => video.name.toLowerCase().endsWith(".png");
  /** Whether the export has transcript files alongside it: GIFs and frames have no sound to transcribe. */
  const hasTranscript = (video: ExportedVideo) =>
    !isFrame(video) && !video.name.toLowerCase().endsWith(".gif");

  async function trash(video: ExportedVideo) {
    await window.chord.desktop.export.trash(video.path);
    await refresh();
  }

  function closeDelete(request: { video: ExportedVideo }): () => void {
    return () => {
      if (deleting === request) deleting = null;
    };
  }

  /** The export's actions, the same from its menu button and a right-click. */
  function actions(video: ExportedVideo): MenuEntry[] {
    return [
      {
        label: "Show in folder",
        icon: "folder",
        onselect: () => void window.chord.desktop.export.reveal(video.path),
      },
      "separator",
      {
        label: "Delete export",
        icon: "trash",
        destructive: true,
        onselect: () => {
          if (videos.some((item) => item.path === video.path)) deleting = { video };
        },
      },
    ];
  }

  function contextMenu(event: MouseEvent, video: ExportedVideo): void {
    if ((event.target as HTMLElement).closest("[role=menu]")) return;
    openContextMenu(event, actions(video));
  }
</script>

{#if videos.length > 0}
  <section class="border-t border-glass-800 p-2" aria-label="Exports">
    <h3 class="flex h-7 items-center px-2.5 text-[11px] font-medium text-glass-500">Exports</h3>
    <ol class="flex flex-col gap-0.5" data-exports>
      {#each videos as video (video.path)}
        <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
        <li
          class="group/export relative flex h-9 items-center rounded-md text-glass-300 transition hover:bg-glass-800/60 hover:text-neutral-100"
          data-export={video.path}
          oncontextmenu={(event) => contextMenu(event, video)}
        >
          <button
            class="flex h-full min-w-0 flex-1 cursor-pointer items-center gap-2.5 pr-9 pl-2.5 text-left text-xs"
            onclick={() => void window.chord.desktop.export.play(video.path)}
            aria-label={`${isFrame(video) ? "Open" : "Play"} ${video.name}`}
            title={video.name}
          >
            <Icon name={isFrame(video) ? "image" : "film"} class="size-3 shrink-0 text-glass-500" />
            <span class="min-w-0 flex-1 truncate">{formatDateTime(video.createdAt)}</span>
          </button>
          <div class="absolute inset-y-0 right-1 flex items-center">
            <Menu align="end">
              {#snippet trigger({ toggle, open })}
                <button
                  class={[
                    "flex size-7 items-center justify-center rounded-md text-glass-400 transition hover:bg-glass-700 hover:text-neutral-100 focus-visible:opacity-100",
                    !open &&
                      "opacity-0 group-focus-within/export:opacity-100 group-hover/export:opacity-100",
                  ]}
                  onclick={toggle}
                  aria-label={`${video.name} actions`}
                  aria-haspopup="menu"
                  aria-expanded={open}
                  title="Export actions"><Icon name="more" class="size-3.5" /></button
                >
              {/snippet}
              {#snippet children({ close })}<MenuEntries
                  entries={actions(video)}
                  {close}
                />{/snippet}
            </Menu>
          </div>
        </li>
      {/each}
    </ol>
  </section>
{/if}

{#if deleting}
  {#key deleting}
    {@const video = deleting.video}
    <ConfirmDialog
      id="export-delete"
      title={isFrame(video) ? "Delete this frame?" : "Delete this export?"}
      detail={video.name}
      confirmLabel="Delete export"
      onclose={closeDelete(deleting)}
      onconfirm={() => trash(video)}
    >
      {isFrame(video)
        ? "This frame will be moved to the Trash."
        : hasTranscript(video)
          ? "This export and its transcript files will be moved to the Trash."
          : "This export will be moved to the Trash."}
    </ConfirmDialog>
  {/key}
{/if}
