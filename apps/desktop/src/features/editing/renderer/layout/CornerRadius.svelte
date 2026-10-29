<script lang="ts">
  // Rounds every corner with one field, or each corner on its own, as percentages of the fully round shape. Drag a
  // field's icon to scrub its value.
  import { cornerRadii, type CornerRadii, type FeedFraming } from "../../domain/clipLayout.ts";
  import { pointerDrag } from "@teamblocks.dev/chord-ui/pointerDrag";
  import Icon from "@teamblocks.dev/chord-ui/Icon.svelte";

  let {
    value,
    label,
    onchange,
  }: {
    value: FeedFraming["radius"];
    label: string;
    onchange: (value: FeedFraming["radius"]) => void;
  } = $props();
  const independent = $derived(Array.isArray(value));
  const radii = $derived(cornerRadii(value));
  /** Clockwise from the top left, as stored, but laid out in reading order. */
  const corners = [
    { index: 0, label: "Top left", rotate: "" },
    { index: 1, label: "Top right", rotate: "rotate-90" },
    { index: 3, label: "Bottom left", rotate: "-rotate-90" },
    { index: 2, label: "Bottom right", rotate: "rotate-180" },
  ];
  /** The index the shared field edits, standing for every corner. */
  const ALL = -1;
  const percent = (radius: number) => Math.round(radius * 100);
  const clamp = (radius: number) => Math.min(Math.max(Math.round(radius), 0), 100) / 100;

  /** Splitting copies the shared value to each corner; joining keeps the roundest. */
  function toggle(): void {
    onchange(independent ? Math.max(...radii) : ([...radii] as CornerRadii));
  }
  function set(index: number, radius: number): void {
    if (!Number.isFinite(radius)) return;
    if (index === ALL) return onchange(clamp(radius));
    const next = [...radii] as CornerRadii;
    next[index] = clamp(radius);
    onchange(next);
  }
  function step(event: KeyboardEvent, index: number): void {
    if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
    event.preventDefault();
    set(
      index,
      percent(radii[Math.max(index, 0)]) +
        (event.key === "ArrowUp" ? 1 : -1) * (event.shiftKey ? 10 : 1),
    );
  }
  /** Two pixels of drag per percent, so the full range fits a short drag. */
  function scrub(index: number) {
    return pointerDrag((event) => {
      event.preventDefault();
      const start = percent(radii[Math.max(index, 0)]);
      return { move: (_event, delta) => set(index, start + delta.x / 2) };
    });
  }
</script>

<!-- Dragging the icon scrubs the value; the field takes typing and arrow keys. -->
{#snippet field(
  index: number,
  icon: "corner" | "corners",
  rotate: string,
  title: string,
  aria: string,
  place = "",
)}
  {@const current = index === ALL ? radii[0] : radii[index]}
  <label
    class="{place} flex h-7 min-w-0 items-center gap-1 rounded-md bg-glass-900 pr-1.5 text-xs focus-within:ring-1 focus-within:ring-primary"
  >
    <!-- svelte-ignore a11y_no_static_element_interactions (the field beside it takes typing and arrow keys) -->
    <span
      class="grid h-full w-6 shrink-0 cursor-ew-resize touch-none place-items-center text-glass-500 hover:text-glass-300"
      {title}
      {@attach scrub(index)}
    >
      <Icon name={icon} class={["size-3", rotate].join(" ")} strokeWidth={2} />
    </span>
    <input
      type="text"
      inputmode="numeric"
      aria-label={aria}
      class="w-0 min-w-0 flex-1 bg-transparent tabular-nums text-neutral-100 outline-none"
      value={percent(current)}
      oninput={(event) => set(index, parseFloat(event.currentTarget.value))}
      onblur={(event) => (event.currentTarget.value = String(percent(current)))}
      onkeydown={(event) => step(event, index)}
    />
    <span class="text-glass-500">%</span>
  </label>
{/snippet}

<span class="flex items-start gap-2">
  <!-- Two columns either way, so the shared field is the size of each corner's and sits beside the toggle. -->
  <span class="grid min-w-0 flex-1 grid-cols-2 gap-1">
    {#if independent}
      {#each corners as corner (corner.index)}
        {@render field(
          corner.index,
          "corner",
          corner.rotate,
          corner.label,
          `${label} ${corner.label.toLowerCase()}`,
        )}
      {/each}
    {:else}
      {@render field(ALL, "corners", "", "All corners", label, "col-start-2")}
    {/if}
  </span>
  <button
    class={[
      "grid size-7 shrink-0 place-items-center rounded-md transition",
      independent
        ? "bg-glass-800 text-neutral-100"
        : "text-glass-400 hover:bg-glass-800 hover:text-neutral-100",
    ]}
    aria-pressed={independent}
    aria-label={`${label} individually`}
    title="Individual corners"
    onclick={toggle}
  >
    <Icon name="corners" class="size-3.5" />
  </button>
</span>
