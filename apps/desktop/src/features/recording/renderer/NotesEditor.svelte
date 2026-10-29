<script lang="ts">
  // A project's recording notes, page by page: a title and a body each, in the order they're shown while recording.
  import { tick } from "svelte";
  import type { NotePage } from "../domain/notes.ts";
  import Icon from "@teamblocks.dev/chord-ui/Icon.svelte";

  let { pages, onchange }: { pages: NotePage[]; onchange: () => void } = $props();

  let deletingId = $state<string | null>(null);
  let list = $state<HTMLElement>();

  async function addPage() {
    const page = { id: crypto.randomUUID(), title: "", body: "" };
    pages.push(page);
    onchange();
    await tick();
    list?.querySelector<HTMLInputElement>(`[data-page="${page.id}"] input`)?.focus();
  }

  /** The page being dragged, and the slot (0 to pages.length, the gap before that page) it would land in. */
  let dragging = $state<string | null>(null);
  let slot = $state<number | null>(null);
  let lineTop = $state(0);

  /** Dropping a page where it already is, just before or just after itself, changes nothing. */
  function movesPage(target: number) {
    const from = pages.findIndex((page) => page.id === dragging);
    return from >= 0 && target !== from && target !== from + 1;
  }

  /** The slot nearest the pointer: above a page's midpoint is before it, below is after it, and the gaps fall between. */
  function slotAt(clientY: number) {
    const items = [...(list?.querySelectorAll<HTMLElement>(":scope > li") ?? [])];
    const index = items.findIndex((item) => {
      const rect = item.getBoundingClientRect();
      return clientY < rect.top + rect.height / 2;
    });
    return index < 0 ? items.length : index;
  }

  /** Where the line for a slot sits in the list: the middle of the gap, or just past the first and last pages. */
  function lineFor(target: number) {
    const items = [...(list?.querySelectorAll<HTMLElement>(":scope > li") ?? [])];
    const top = list!.getBoundingClientRect().top;
    const before = items[target - 1]?.getBoundingClientRect();
    const after = items[target]?.getBoundingClientRect();
    if (before && after) return (before.bottom + after.top) / 2 - top;
    if (after) return after.top - top - 6;
    return before.bottom - top + 6;
  }

  function dragOver(event: DragEvent) {
    if (!dragging) return;
    const target = slotAt(event.clientY);
    if (!movesPage(target)) {
      slot = null;
      return;
    }
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
    slot = target;
    lineTop = lineFor(target);
  }

  function drop(event: DragEvent) {
    event.preventDefault();
    const target = slot;
    const from = pages.findIndex((page) => page.id === dragging);
    endDrag();
    if (target === null || from < 0) return;
    const [page] = pages.splice(from, 1);
    pages.splice(target > from ? target - 1 : target, 0, page);
    onchange();
  }

  function endDrag() {
    dragging = null;
    slot = null;
  }

  function startDrag(event: DragEvent, id: string) {
    const item = (event.currentTarget as HTMLElement).closest("li");
    if (!event.dataTransfer || !item) return;
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setDragImage(item, 16, 20);
    dragging = id;
  }

  function remove(id: string) {
    const index = pages.findIndex((page) => page.id === id);
    if (index >= 0) pages.splice(index, 1);
    deletingId = null;
    onchange();
  }

  /** Pages with nothing on them go without asking. */
  function requestRemove(page: NotePage) {
    if (page.title.trim() || page.body.trim()) deletingId = page.id;
    else remove(page.id);
  }
</script>

<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<ol class="relative flex flex-col gap-3" bind:this={list} ondragover={dragOver} ondrop={drop}>
  {#each pages as page, index (page.id)}
    <li
      data-page={page.id}
      data-focus-group
      class={[
        "group rounded-xl border border-glass-800 bg-glass-900/40 transition",
        dragging === page.id && "opacity-40",
      ]}
    >
      <div class="flex items-center gap-3 py-2 pr-2 pl-4">
        <span
          class="flex w-4 shrink-0 cursor-grab items-center justify-center text-xs font-medium text-glass-500 tabular-nums"
          role="button"
          tabindex="-1"
          aria-label={`Drag page ${index + 1} to reorder`}
          draggable="true"
          ondragstart={(event) => startDrag(event, page.id)}
          ondragend={endDrag}>{index + 1}</span
        >
        <input
          class="min-w-0 flex-1 bg-transparent text-sm font-medium text-neutral-100 placeholder:text-glass-600"
          placeholder="Title"
          aria-label={`Page ${index + 1} title`}
          bind:value={page.title}
          oninput={onchange}
          onkeydown={(event) => {
            if (event.key !== "Enter") return;
            event.preventDefault();
            event.currentTarget.closest("li")?.querySelector("textarea")?.focus();
          }}
        />
        {#if deletingId === page.id}
          <div class="flex items-center gap-1">
            <button
              class="h-7 rounded-md px-2.5 text-xs text-glass-400 hover:bg-glass-800"
              onclick={() => (deletingId = null)}
            >
              Cancel
            </button>
            <button
              class="h-7 rounded-md bg-red-600/90 px-2.5 text-xs font-medium text-white hover:bg-red-500"
              onclick={() => remove(page.id)}
            >
              Delete
            </button>
          </div>
        {:else}
          <div
            class="flex items-center opacity-0 transition group-focus-within:opacity-100 group-hover:opacity-100"
          >
            <button
              class="flex size-7 items-center justify-center rounded-md text-glass-500 transition hover:bg-glass-800 hover:text-neutral-100"
              aria-label={`Delete page ${index + 1}`}
              title={`Delete page ${index + 1}`}
              onclick={() => requestRemove(page)}
            >
              <Icon name="trash" class="size-3.5" />
            </button>
          </div>
        {/if}
      </div>
      <textarea
        class="block min-h-20 w-full resize-none bg-transparent px-4 pt-0 pb-3 pl-11 text-sm leading-relaxed text-neutral-200 [field-sizing:content] placeholder:text-glass-600"
        placeholder="Talking points or script"
        aria-label={`Page ${index + 1} notes`}
        bind:value={page.body}
        oninput={onchange}></textarea>
    </li>
  {/each}
  {#if slot !== null}
    <div
      class="pointer-events-none absolute inset-x-0 h-0.5 -translate-y-1/2 rounded-full bg-neutral-100"
      style:top="{lineTop}px"
    ></div>
  {/if}
</ol>

<button
  class={[
    "flex h-10 w-full items-center justify-center gap-1.5 rounded-xl border border-dashed border-glass-800 text-sm text-glass-400 transition hover:border-glass-700 hover:text-neutral-100",
    pages.length > 0 && "mt-3",
  ]}
  onclick={addPage}
>
  <Icon name="plus" class="size-4" />
  Add page
</button>
