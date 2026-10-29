<script lang="ts">
  // One display's area picker, covering the display. Dragging on empty space adds an area; areas move by dragging
  // them and resize by their edges and corners. Everything outside the areas is dimmed. Enter or Save keeps the edits
  // on every display, Escape or the X drops them; Delete removes the selected area.
  import { onMount } from "svelte";
  import Icon from "@teamblocks.dev/chord-ui/Icon.svelte";

  type Rect = { x: number; y: number; width: number; height: number };
  type Edges = { left?: boolean; right?: boolean; top?: boolean; bottom?: boolean };
  type Drag =
    | { kind: "create"; from: { x: number; y: number } }
    | {
        kind: "move" | "resize";
        index: number;
        from: { x: number; y: number };
        original: Rect;
        edges: Edges;
      };

  /** Smaller drags are taken as clicks, and areas can't be resized below it. In points. */
  const MIN = 16;
  /** Corners show a knob; edges are invisible strips along the border. */
  const HANDLES: { edges: Edges; class: string; cursor: string }[] = [
    {
      edges: { top: true, left: true },
      class: "-top-1.5 -left-1.5 size-3 rounded-sm bg-white",
      cursor: "nwse-resize",
    },
    {
      edges: { top: true, right: true },
      class: "-top-1.5 -right-1.5 size-3 rounded-sm bg-white",
      cursor: "nesw-resize",
    },
    {
      edges: { bottom: true, left: true },
      class: "-bottom-1.5 -left-1.5 size-3 rounded-sm bg-white",
      cursor: "nesw-resize",
    },
    {
      edges: { bottom: true, right: true },
      class: "-right-1.5 -bottom-1.5 size-3 rounded-sm bg-white",
      cursor: "nwse-resize",
    },
    { edges: { top: true }, class: "-top-1 inset-x-3 h-2", cursor: "ns-resize" },
    { edges: { bottom: true }, class: "-bottom-1 inset-x-3 h-2", cursor: "ns-resize" },
    { edges: { left: true }, class: "-left-1 inset-y-3 w-2", cursor: "ew-resize" },
    { edges: { right: true }, class: "-right-1 inset-y-3 w-2", cursor: "ew-resize" },
  ];

  let areas = $state<Rect[]>([]);
  let draft = $state<Rect | null>(null);
  let selected = $state<number | null>(null);
  let controls = $state(false);
  let drag: Drag | null = null;

  const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(value, max));
  const point = (event: PointerEvent) => ({
    x: clamp(event.clientX, 0, innerWidth),
    y: clamp(event.clientY, 0, innerHeight),
  });
  const rounded = (r: Rect): Rect => ({
    x: Math.round(r.x),
    y: Math.round(r.y),
    width: Math.round(r.width),
    height: Math.round(r.height),
  });

  onMount(() => {
    void window.chord.areas.init().then((init) => {
      if (!init) return;
      areas = init.areas.map(({ x, y, width, height }) => ({ x, y, width, height }));
      controls = init.controls;
      // The window is shown once this has painted, so it opens complete.
      requestAnimationFrame(() => requestAnimationFrame(() => window.chord.areas.ready()));
    });
  });

  function changed() {
    window.chord.areas.change($state.snapshot(areas).map((area) => ({ displayId: 0, ...area })));
  }

  function begin(event: PointerEvent, next: Drag) {
    if (event.button !== 0) return;
    event.stopPropagation();
    (event.currentTarget as Element).setPointerCapture(event.pointerId);
    drag = next;
    selected = next.kind === "create" ? null : next.index;
  }

  function moved(event: PointerEvent) {
    if (!drag) return;
    const p = point(event);
    if (drag.kind === "create") {
      const { from } = drag;
      draft = {
        x: Math.min(from.x, p.x),
        y: Math.min(from.y, p.y),
        width: Math.abs(p.x - from.x),
        height: Math.abs(p.y - from.y),
      };
      return;
    }
    const { original: o, edges } = drag;
    const dx = p.x - drag.from.x;
    const dy = p.y - drag.from.y;
    if (drag.kind === "move") {
      areas[drag.index] = {
        ...o,
        x: clamp(o.x + dx, 0, innerWidth - o.width),
        y: clamp(o.y + dy, 0, innerHeight - o.height),
      };
      return;
    }
    let [x1, y1, x2, y2] = [o.x, o.y, o.x + o.width, o.y + o.height];
    if (edges.left) x1 = clamp(x1 + dx, 0, x2 - MIN);
    if (edges.right) x2 = clamp(x2 + dx, x1 + MIN, innerWidth);
    if (edges.top) y1 = clamp(y1 + dy, 0, y2 - MIN);
    if (edges.bottom) y2 = clamp(y2 + dy, y1 + MIN, innerHeight);
    areas[drag.index] = { x: x1, y: y1, width: x2 - x1, height: y2 - y1 };
  }

  function ended() {
    if (!drag) return;
    if (drag.kind === "create") {
      if (draft && draft.width >= MIN && draft.height >= MIN) {
        areas.push(rounded(draft));
        selected = areas.length - 1;
      }
      draft = null;
    } else {
      areas[drag.index] = rounded(areas[drag.index]);
    }
    drag = null;
    changed();
  }

  function remove(index: number) {
    areas.splice(index, 1);
    selected = null;
    changed();
  }

  function onKeyDown(event: KeyboardEvent) {
    if (event.key === "Escape") window.chord.areas.finish(false);
    else if (event.key === "Enter") window.chord.areas.finish(true);
    else if ((event.key === "Backspace" || event.key === "Delete") && selected !== null)
      remove(selected);
  }
</script>

<svelte:window
  onkeydown={onKeyDown}
  onpointermove={moved}
  onpointerup={ended}
  onpointercancel={ended}
/>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  class="fixed inset-0 cursor-crosshair select-none"
  onpointerdown={(event) => begin(event, { kind: "create", from: point(event) })}
>
  <svg class="pointer-events-none absolute inset-0 size-full">
    <defs>
      <mask id="holes">
        <rect width="100%" height="100%" fill="white" />
        {#each draft ? [...areas, draft] : areas as area}
          <rect x={area.x} y={area.y} width={area.width} height={area.height} fill="black" />
        {/each}
      </mask>
    </defs>
    <rect width="100%" height="100%" fill="rgb(0 0 0 / 0.45)" mask="url(#holes)" />
  </svg>

  {#each areas as area, i}
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
      class={["absolute cursor-move ring-2", selected === i ? "ring-white" : "ring-white/60"]}
      style:left="{area.x}px"
      style:top="{area.y}px"
      style:width="{area.width}px"
      style:height="{area.height}px"
      onpointerdown={(event) =>
        begin(event, {
          kind: "move",
          index: i,
          from: point(event),
          original: { ...area },
          edges: {},
        })}
    >
      <div
        class="absolute top-2 left-2 flex items-center gap-1.5 rounded-md bg-black/60 py-0.5 pr-0.5 pl-2 text-xs font-medium text-white tabular-nums backdrop-blur"
      >
        <span>{i + 1}</span>
        <span class="text-white/60">{Math.round(area.width)} × {Math.round(area.height)}</span>
        <button
          class="flex size-5 items-center justify-center rounded text-white/70 hover:bg-white/15 hover:text-white"
          aria-label="Remove area"
          onpointerdown={(event) => event.stopPropagation()}
          onclick={() => remove(i)}
        >
          <Icon name="x" class="size-3.5" />
        </button>
      </div>
      {#each HANDLES as handle (handle.class)}
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <div
          class={["absolute", handle.class]}
          style:cursor={handle.cursor}
          onpointerdown={(event) =>
            begin(event, {
              kind: "resize",
              index: i,
              from: point(event),
              original: { ...area },
              edges: handle.edges,
            })}
        ></div>
      {/each}
    </div>
  {/each}

  {#if draft}
    <div
      class="pointer-events-none absolute ring-2 ring-white"
      style:left="{draft.x}px"
      style:top="{draft.y}px"
      style:width="{draft.width}px"
      style:height="{draft.height}px"
    >
      <span
        class="absolute top-2 left-2 rounded-md bg-black/60 px-2 py-0.5 text-xs font-medium text-white tabular-nums backdrop-blur"
      >
        {Math.round(draft.width)} × {Math.round(draft.height)}
      </span>
    </div>
  {/if}

  {#if controls}
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
      class="absolute bottom-16 left-1/2 flex -translate-x-1/2 items-center gap-1.5 rounded-xl bg-neutral-950/90 p-1.5 shadow-lg ring-1 ring-white/10 backdrop-blur-xl"
      onpointerdown={(event) => event.stopPropagation()}
    >
      <button
        class="flex size-8 items-center justify-center rounded-lg text-glass-300 transition hover:bg-glass-800 hover:text-neutral-100"
        aria-label="Cancel"
        title="Cancel (Esc)"
        onclick={() => window.chord.areas.finish(false)}
      >
        <Icon name="x" class="size-4" />
      </button>
      <button
        class="h-8 rounded-lg bg-white px-3.5 text-sm font-medium text-neutral-950 transition hover:bg-neutral-200"
        onclick={() => window.chord.areas.finish(true)}
      >
        Save
      </button>
    </div>
  {/if}
</div>
