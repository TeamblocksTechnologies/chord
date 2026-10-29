<script lang="ts">
  import { fade } from "svelte/transition";
  import {
    DEFAULT_CLIP_BACKGROUND,
    DEFAULT_FEED_FRAMING,
    LAYOUT_PRESETS,
    defaultClipLayout,
    layoutCells,
    layoutSources,
    pictureCount,
    type ClipLayout,
    type FeedFraming,
    type LayoutCorner,
    type LayoutPreset,
    type LayoutRect,
  } from "../../domain/clipLayout.ts";
  import type { Piece } from "#project-document/domain/recording";
  import type { Part } from "#media-engine/renderer/timeline";
  import { dismiss } from "@teamblocks.dev/chord-ui/dismiss";
  import { floating } from "@teamblocks.dev/chord-ui/floating";
  import { trackMenu } from "@teamblocks.dev/chord-ui/menus.svelte";
  import { pop } from "@teamblocks.dev/chord-ui/pop";
  import { ClipLayoutEditor } from "./clipLayoutEditor.ts";
  import type { Project } from "#project-document/domain/recording";
  import CornerRadius from "./CornerRadius.svelte";
  import ColorPicker from "@teamblocks.dev/chord-ui/ColorPicker.svelte";
  import Icon from "@teamblocks.dev/chord-ui/Icon.svelte";
  import Segmented from "@teamblocks.dev/chord-ui/Segmented.svelte";
  import Select from "@teamblocks.dev/chord-ui/Select.svelte";
  import SliderField from "@teamblocks.dev/chord-ui/SliderField.svelte";

  let { project, piece, part }: { project: Project; piece: Piece; part?: Part } = $props();
  const editor = new ClipLayoutEditor(() => project);
  const sources = $derived(part?.timeline.video ?? []);
  const layout = $derived(piece.layout ?? defaultClipLayout(sources, piece.cameraLayout));
  const clipBackground = $derived(layout.background ?? DEFAULT_CLIP_BACKGROUND);
  const backgroundOptions = [
    { value: "solid", label: "Single colour" },
    { value: "teamblocks", label: "Floating blocks" },
  ];
  function background(value: string): void {
    update({
      background: value === "teamblocks" ? { type: "teamblocks" } : { ...DEFAULT_CLIP_BACKGROUND },
      // Give the wallpaper room to show on a full-frame clip; keep spacing the user already chose.
      ...(value === "teamblocks" && layout.padding === 0 && { padding: 0.06 }),
    });
  }
  const presets = $derived(LAYOUT_PRESETS.filter((preset) => preset.count <= sources.length));
  const selected = $derived(layoutSources(layout, sources));
  const sourceName = (id: string) => {
    const source = sources.find((source) => source.id === id);
    if (!source) return "";
    const kind = source.kind === "screen" ? "Screen" : "Camera";
    // Numbered only when the recording has more than one of the kind.
    return sources.some((other) => other.kind === source.kind && other !== source)
      ? `${kind} ${source.index + 1}`
      : kind;
  };
  const sourceOptions = $derived(
    sources.map((source) => ({ value: source.id, label: sourceName(source.id) })),
  );
  const pictures = $derived(pictureCount(layout.preset, selected.length));
  const split = $derived(selected.length > 1 && !["pip", "double-pip"].includes(layout.preset));
  const secondary = $derived(
    selected.length === 3 && (layout.preset === "three-split" || layout.preset === "split-stack"),
  );
  const corners: { value: LayoutCorner; label: string }[] = [
    { value: "top-left", label: "Top left" },
    { value: "top-right", label: "Top right" },
    { value: "bottom-left", label: "Bottom left" },
    { value: "bottom-right", label: "Bottom right" },
  ];
  /** Fill covers the cell; fit shows the whole feed; square crops it, so full corners make a circle. */
  const frames = [
    { value: "fill", label: "Fill" },
    { value: "fit", label: "Fit" },
    { value: "square", label: "Square" },
  ];
  const frameOf = (feed: FeedFraming) =>
    feed.fit === "cover" ? "fill" : feed.aspect === 1 ? "square" : "fit";
  const framed = (value: string): Partial<FeedFraming> => ({
    fit: value === "fill" ? "cover" : "contain",
    aspect: value === "square" ? 1 : undefined,
  });
  /** The feed whose settings popover is open. */
  let framing = $state<string | null>(null);
  const triggers: Record<string, HTMLButtonElement> = {};
  $effect(() => {
    if (framing) return trackMenu(() => (framing = null));
  });

  interface Shape {
    cells: LayoutRect[];
    pictures: number;
  }
  type Look = Partial<Omit<ClipLayout, "pip">> & { pip?: Partial<ClipLayout["pip"]> };
  interface Choice {
    label: string;
    patch: Look;
    chosen: boolean;
    look: Look;
  }
  /** A layout as drawn before any of its options are set, so the thumbnails don't change as options below them do. */
  const plain = (value: LayoutPreset): Look => ({
    direction: "horizontal",
    stack: "end",
    split: value === "three-split" ? 1 / 3 : 0.5,
    secondarySplit: 0.5,
    pip: { width: 0.3, aspect: 4 / 3, position: "bottom-right", apart: false },
  });
  const merge = <T extends Look>(base: T, patch: Look): T => ({
    ...base,
    ...patch,
    pip: { ...base.pip, ...patch.pip },
  });
  /** The variations of the chosen layout, each drawn with the choices above it but none below. */
  const arrangement = $derived.by(() => {
    const { preset: mode, direction, stack, pip } = layout;
    const horizontal = direction === "horizontal";
    const rows: { label: string; choices: Choice[] }[] = [];
    let drawn = plain(mode);
    const add = (label: string, choices: Omit<Choice, "look">[]) => {
      rows.push({
        label,
        choices: choices.map((choice) => ({ ...choice, look: merge(drawn, choice.patch) })),
      });
      drawn = merge(drawn, choices.find((choice) => choice.chosen)?.patch ?? {});
    };
    if (mode !== "single" && mode !== "pip")
      add(mode === "double-pip" ? "Arrange" : "Direction", [
        {
          label: mode === "double-pip" ? "Row" : "Columns",
          patch: { direction: "horizontal" },
          chosen: horizontal,
        },
        {
          label: mode === "double-pip" ? "Column" : "Rows",
          patch: { direction: "vertical" },
          chosen: !horizontal,
        },
      ]);
    if (mode === "split-stack")
      add("Split side", [
        {
          label: horizontal ? "Left" : "Top",
          patch: { stack: "start" },
          chosen: stack === "start",
        },
        {
          label: horizontal ? "Right" : "Bottom",
          patch: { stack: "end" },
          chosen: stack === "end",
        },
      ]);
    if (pictures)
      add(
        "Corner",
        corners.map((corner) => ({
          label: corner.label,
          patch: { pip: { position: corner.value } },
          chosen: pip.position === corner.value,
        })),
      );
    if (mode === "double-pip")
      add(
        "Placement",
        [false, true].map((apart) => ({
          label: apart ? "Apart" : "Together",
          patch: { pip: { apart } },
          chosen: pip.apart === apart,
        })),
      );
    return rows;
  });

  function update(patch: Partial<ClipLayout>): void {
    editor.update(piece.id, sources, patch);
  }
  function preset(value: LayoutPreset): void {
    const next = { ...layout, preset: value };
    update({
      preset: value,
      sources: layoutSources(next, sources),
      ...(value === "three-split"
        ? { split: 1 / 3, secondarySplit: 0.5 }
        : layout.preset === "three-split" && { split: 0.5 }),
    });
  }
  /** A layout drawn small, as currently set unless the patch changes it. */
  function shape(
    value: LayoutPreset,
    patch: Look = {},
    picture?: { width: number; inset: number },
  ): Shape {
    const base = merge(
      value === layout.preset
        ? layout
        : {
            ...layout,
            preset: value,
            split: value === "three-split" ? 1 / 3 : 0.5,
            secondarySplit: 0.5,
          },
      patch,
    );
    const count = LAYOUT_PRESETS.find((option) => option.value === value)!.count;
    const cells = layoutCells(
      {
        ...base,
        padding: 0,
        gap: 0.08,
        pip: { ...base.pip, ...(picture ?? { width: Math.max(base.pip.width, 0.3), inset: 0.1 }) },
      },
      64,
      36,
      count,
    );
    return {
      cells,
      pictures: value === "double-pip" ? 2 : value === "pip" || value === "split-pip" ? 1 : 0,
    };
  }
  function assign(index: number, id: string): void {
    const next = [...selected];
    const other = next.indexOf(id);
    if (other !== -1) next[other] = next[index];
    next[index] = id;
    update({ sources: next });
  }
  function frame(id: string, patch: Partial<FeedFraming>): void {
    editor.updateFeed(piece.id, sources, id, patch);
  }
</script>

<!-- Every row shares one label column, so controls line up down the panel. -->
{#snippet row(label: string)}
  <span class="truncate text-xs text-glass-400">{label}</span>
{/snippet}

{#snippet slider(
  label: string,
  value: number,
  min: number,
  max: number,
  change: (value: number) => void,
  aria = label,
)}
  <SliderField
    {label}
    ariaLabel={aria}
    {value}
    min={min / 100}
    max={max / 100}
    step={0.01}
    scale={100}
    suffix="%"
    onchange={change}
    class="contents"
    labelClass="truncate text-xs text-glass-400"
    readoutClass="w-8 text-xs text-glass-400"
  />
{/snippet}

<!-- Highlight marks one cell, such as the one a feed fills; otherwise the shape is drawn as a choice. -->
{#snippet glyph(shape: Shape, chosen: boolean, highlight = -1)}
  <svg viewBox="0 0 64 36" class="block w-full" aria-hidden="true">
    {#each shape.cells as cell, index (index)}
      {@const picture = index >= shape.cells.length - shape.pictures}
      <rect
        x={cell.x}
        y={cell.y}
        width={cell.width}
        height={cell.height}
        rx="2.5"
        stroke-width={picture ? 2 : 0}
        paint-order="stroke"
        class={[
          picture && "stroke-neutral-900",
          highlight === -1
            ? chosen
              ? picture
                ? "fill-neutral-100"
                : "fill-glass-500"
              : picture
                ? "fill-glass-400"
                : "fill-glass-700"
            : index === highlight
              ? "fill-primary"
              : picture
                ? "fill-glass-500"
                : "fill-glass-700",
        ]}
      />
    {/each}
  </svg>
{/snippet}

{#snippet heading(title: string)}
  <h4 class="text-xs font-medium text-glass-300">{title}</h4>
{/snippet}

{#if sources.length}
  <section class="flex flex-col gap-3 border-b border-glass-800 p-3" aria-label="Layout">
    <h3 class="text-xs font-medium text-neutral-100">Layout</h3>
    {#if presets.length > 1}
      <div class="grid grid-cols-4 gap-1.5" role="radiogroup" aria-label="Clip layout">
        {#each presets as option (option.value)}
          {@const chosen = layout.preset === option.value}
          <button
            role="radio"
            aria-checked={chosen}
            aria-label={option.label}
            title={option.label}
            class={[
              "rounded-md border p-1 transition",
              chosen
                ? "border-primary bg-glass-800"
                : "border-glass-800 hover:border-glass-600 hover:bg-glass-900",
            ]}
            onclick={() => preset(option.value)}
          >
            {@render glyph(shape(option.value, plain(option.value)), chosen)}
          </button>
        {/each}
      </div>
    {/if}
    <div class="grid grid-cols-[5.5rem_minmax(0,1fr)] items-center gap-x-3 gap-y-2.5">
      {#each arrangement as { label, choices } (label)}
        {@render row(label)}
        <!-- Four columns whatever the count, so every option is drawn at one size. -->
        <div class="grid grid-cols-4 gap-1" role="radiogroup" aria-label={label}>
          {#each choices as choice (choice.label)}
            <button
              role="radio"
              aria-checked={choice.chosen}
              aria-label={choice.label}
              title={choice.label}
              class={[
                "rounded border p-0.5 transition",
                choice.chosen
                  ? "border-primary bg-glass-800"
                  : "border-glass-800 hover:border-glass-600",
              ]}
              onclick={() => update(merge(layout, choice.patch))}
            >
              <!-- Smaller pictures leave room to see where each one goes. -->
              {@render glyph(
                shape(layout.preset, choice.look, { width: 0.2, inset: 0.06 }),
                choice.chosen,
              )}
            </button>
          {/each}
        </div>
      {/each}
      {#if split}
        {@render slider("Split", layout.split, 10, 90, (split) => update({ split }))}
      {/if}
      {#if secondary}
        {@render slider("Second split", layout.secondarySplit, 10, 90, (secondarySplit) =>
          update({ secondarySplit }),
        )}
      {/if}
    </div>
    <!-- Spacing comes last, as finishing on whatever the choices above make. -->
    {@render heading("Spacing")}
    <div class="grid grid-cols-[5.5rem_minmax(0,1fr)] items-center gap-x-3 gap-y-2.5">
      {@render slider("Padding", layout.padding, 0, 20, (padding) => update({ padding }))}
      {#if split}
        {@render slider("Gap", layout.gap, 0, 15, (gap) => update({ gap }))}
      {/if}
    </div>
  </section>

  <section class="flex flex-col gap-3 border-b border-glass-800 p-3" aria-label="Background">
    {@render heading("Background")}
    <div class="grid grid-cols-[5.5rem_minmax(0,1fr)] items-center gap-x-3 gap-y-2.5">
      {@render row("Style")}
      <Select
        compact
        label="Clip background"
        options={backgroundOptions}
        bind:value={() => clipBackground.type, background}
      />
      {#if clipBackground.type === "solid"}
        {@render row("Colour")}
        <ColorPicker
          label="Background colour"
          alpha={false}
          value={clipBackground.color}
          onchange={(color) => update({ background: { type: "solid", color } })}
        />
      {/if}
    </div>
  </section>

  {#if pictures}
    <!-- Pictures share one size and margin, so they're set here rather than per feed. -->
    <section
      class="flex flex-col gap-3 border-b border-glass-800 p-3"
      aria-label={pictures > 1 ? "Pictures" : "Picture"}
    >
      {@render heading(pictures > 1 ? "Pictures" : "Picture")}
      <div class="grid grid-cols-[5.5rem_minmax(0,1fr)] items-center gap-x-3 gap-y-2.5">
        {@render slider(
          "Size",
          layout.pip.width,
          10,
          60,
          (width) => update({ pip: { ...layout.pip, width } }),
          "Picture size",
        )}
        {@render slider(
          "Margin",
          layout.pip.inset,
          0,
          20,
          (inset) => update({ pip: { ...layout.pip, inset } }),
          "Picture margin",
        )}
      </div>
    </section>
  {/if}

  <section class="flex flex-col gap-2 border-b border-glass-800 p-3" aria-label="Feeds">
    {@render heading(selected.length > 1 ? "Feeds" : "Feed")}
    {#each selected as id, index (id)}
      {@const feed = layout.feeds[id] ?? DEFAULT_FEED_FRAMING}
      {@const open = framing === id}
      <div class="flex items-center gap-2">
        <div class="w-10 shrink-0">
          {@render glyph(shape(layout.preset), false, selected.length > 1 ? index : -1)}
        </div>
        <div class="min-w-0 flex-1">
          {#if sources.length > 1}
            <Select
              compact
              label={`Feed ${index + 1} source`}
              options={sourceOptions}
              bind:value={() => id, (value) => assign(index, value)}
            />
          {:else}
            <span class="text-xs text-neutral-100">{sourceName(id)}</span>
          {/if}
        </div>
        <div class="shrink-0" {@attach open && dismiss(() => (framing = null))}>
          <button
            bind:this={triggers[id]}
            class={[
              "grid size-7 place-items-center rounded-md transition",
              open
                ? "bg-glass-800 text-neutral-100"
                : "text-glass-400 hover:bg-glass-800 hover:text-neutral-100",
            ]}
            aria-haspopup="dialog"
            aria-expanded={open}
            aria-label={`${sourceName(id)} settings`}
            title="Settings"
            onclick={() => (framing = open ? null : id)}
          >
            <Icon name="sliders" class="size-3.5" />
          </button>
          {#if open}
            <!-- Beside the inspector, so the stage it changes stays in view. -->
            <div
              role="dialog"
              aria-label={`${sourceName(id)} settings`}
              class="z-30 flex w-72 flex-col gap-3 overflow-y-auto overscroll-contain rounded-xl border border-glass-800 bg-popover p-3 shadow-2xl shadow-black/60 backdrop-blur-2xl backdrop-saturate-150"
              in:pop={{ origin: "top right" }}
              out:fade={{ duration: 100 }}
              {@attach floating(() => triggers[id], { placement: "left-start", gap: 12 })}
            >
              <div class="flex items-center gap-2">
                <div class="w-8 shrink-0">
                  {@render glyph(shape(layout.preset), false, selected.length > 1 ? index : -1)}
                </div>
                <h4 class="text-xs font-medium text-neutral-100">{sourceName(id)}</h4>
              </div>
              <div class="grid grid-cols-[4.5rem_minmax(0,1fr)] items-center gap-x-3 gap-y-2.5">
                <!-- A picture always fills its slot, which the picture shape sets. -->
                {#if index < selected.length - pictures}
                  {@render row("Frame")}
                  <Segmented
                    fill
                    label={`${sourceName(id)} frame`}
                    options={frames}
                    bind:value={() => frameOf(feed), (value) => frame(id, framed(value))}
                  />
                {/if}
                {@render slider(
                  "Zoom",
                  feed.scale,
                  100,
                  300,
                  (scale) => frame(id, { scale }),
                  `${sourceName(id)} zoom`,
                )}
                {@render slider(
                  "Horizontal",
                  feed.x,
                  0,
                  100,
                  (x) => frame(id, { x }),
                  `${sourceName(id)} horizontal position`,
                )}
                {@render slider(
                  "Vertical",
                  feed.y,
                  0,
                  100,
                  (y) => frame(id, { y }),
                  `${sourceName(id)} vertical position`,
                )}
                {@render row("Corners")}
                <CornerRadius
                  value={feed.radius}
                  label={`${sourceName(id)} corners`}
                  onchange={(radius) => frame(id, { radius })}
                />
              </div>
            </div>
          {/if}
        </div>
      </div>
    {/each}
  </section>
{/if}
