<script lang="ts">
  import { onMount, untrack } from "svelte";
  import { fade } from "svelte/transition";
  import { clamp, parseHex, toHex, toHsva, toRgba, type Hsva } from "#ui/color.ts";
  import { dismiss } from "#ui/dismiss.ts";
  import { floating } from "#ui/floating.ts";
  import { trackMenu } from "#ui/menus.svelte.ts";
  import { pop } from "#ui/pop.ts";
  import Icon from "#ui/Icon.svelte";

  let {
    value = $bindable("#000000"),
    label = "Color",
    id,
    alpha = false,
    disabled = false,
    showValue = true,
    onchange,
  }: {
    /** CSS hex (#rgb, #rgba, #rrggbb or #rrggbbaa). Emits normalized CSS hex. */
    value?: string;
    label?: string;
    id?: string;
    /** Enable the separate opacity track and percentage field. Emits eight-digit hex when transparent. */
    alpha?: boolean;
    disabled?: boolean;
    showValue?: boolean;
    /** Called continuously while dragging, and when a text edit is committed. */
    onchange?: (value: string) => void;
  } = $props();

  const uid = $props.id();
  let trigger: HTMLButtonElement;
  let panel: HTMLDivElement | undefined = $state();
  let plane: HTMLDivElement | undefined = $state();
  let open = $state(false);
  let color = $state<Hsva>({ h: 0, s: 0, v: 0, a: 1 });
  let format = $state("hex");
  let draft = $state("");
  let invalid = $state(false);
  let lastEmitted: string | undefined;
  let sampling = $state(false);
  let sampleError = $state("");
  let sampleController: AbortController | undefined;
  type EyeDropper = { open(options: { signal: AbortSignal }): Promise<{ sRGBHex: string }> };
  let EyeDropper: (new () => EyeDropper) | undefined = $state();
  const rgb = $derived(toRgba(color));
  const hex = $derived(toHex(rgb, alpha));
  const solid = $derived(toHex(rgb, false));
  const hue = $derived(toHex(toRgba({ h: color.h, s: 1, v: 1, a: 1 })));
  const field =
    "h-8 min-w-0 rounded-md border border-glass-800 bg-glass-900 text-xs tabular-nums text-neutral-100";

  onMount(() => {
    EyeDropper = (window as Window & { EyeDropper?: new () => EyeDropper }).EyeDropper;
    return () => sampleController?.abort();
  });

  // Don't round-trip our own drag through RGB: that would lose the chosen hue at black or gray.
  $effect(() => {
    const incoming = value,
      allowAlpha = alpha;
    untrack(() => {
      const parsed = parseHex(incoming);
      if (!parsed) return;
      const normalized = toHex(parsed, allowAlpha);
      if (normalized === lastEmitted && (allowAlpha || color.a === 1)) return;
      lastEmitted = undefined;
      const next = toHsva(parsed);
      color = { ...next, h: next.s ? next.h : color.h, a: allowAlpha ? next.a : 1 };
    });
  });

  $effect(() => {
    draft = solid.slice(1);
    invalid = false;
  });
  $effect(() => {
    if (open) return trackMenu(close);
  });
  $effect(() => {
    if (disabled) close();
  });
  $effect(() => {
    if (open) plane?.focus({ preventScroll: true });
  });

  function close() {
    if (sampling) return;
    if (panel?.contains(document.activeElement)) trigger.focus({ preventScroll: true });
    open = false;
  }

  function show() {
    draft = solid.slice(1);
    invalid = false;
    sampleError = "";
    open = true;
  }

  function update(patch: Partial<Hsva>) {
    color = { ...color, ...patch, ...(!alpha && { a: 1 }) };
    const next = toHex(toRgba(color), alpha);
    lastEmitted = next;
    if (next !== value) {
      value = next;
      onchange?.(next);
    }
  }

  function commitHex() {
    const parsed = parseHex(draft);
    if (!parsed || (!alpha && parsed.a !== 1)) {
      invalid = true;
      return;
    }
    const next = toHsva(parsed);
    // Six-digit hex edits leave the separately chosen opacity alone.
    const includesAlpha = [4, 8].includes(draft.trim().replace(/^#/, "").length);
    update({ ...next, h: next.s ? next.h : color.h, a: includesAlpha ? next.a : color.a });
    draft = solid.slice(1);
    invalid = false;
  }

  function move(event: PointerEvent) {
    if (!plane) return;
    const rect = plane.getBoundingClientRect();
    update({
      s: clamp((event.clientX - rect.left) / rect.width),
      v: 1 - clamp((event.clientY - rect.top) / rect.height),
    });
  }

  function planeKey(event: KeyboardEvent) {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    const step = event.shiftKey ? 0.1 : 0.01;
    switch (event.key) {
      case "ArrowLeft":
        update({ s: clamp(color.s - step) });
        break;
      case "ArrowRight":
        update({ s: clamp(color.s + step) });
        break;
      case "ArrowUp":
        update({ v: clamp(color.v + step) });
        break;
      case "ArrowDown":
        update({ v: clamp(color.v - step) });
        break;
      case "Home":
        update({ s: 0 });
        break;
      case "End":
        update({ s: 1 });
        break;
      default:
        return;
    }
    event.preventDefault();
    event.stopPropagation();
  }

  async function sample() {
    if (!EyeDropper || sampling) return;
    sampling = true;
    sampleError = "";
    sampleController = new AbortController();
    try {
      const result = await new EyeDropper().open({ signal: sampleController.signal });
      const parsed = parseHex(result.sRGBHex);
      if (parsed) update({ ...toHsva(parsed), a: color.a });
    } catch (error) {
      if (!(error instanceof DOMException && error.name === "AbortError"))
        sampleError = "Couldn't sample this color. Try again.";
    } finally {
      sampling = false;
      sampleController = undefined;
      plane?.focus({ preventScroll: true });
    }
  }
</script>

<div
  class="inline-flex min-w-0"
  {@attach open && dismiss(close)}
  onfocusout={(event) => {
    if (event.relatedTarget instanceof Node && !event.currentTarget.contains(event.relatedTarget))
      close();
  }}
>
  <button
    bind:this={trigger}
    {id}
    type="button"
    {disabled}
    value={hex}
    class="flex h-7 min-w-0 items-center gap-2 rounded-md border border-glass-800 px-1.5 text-xs text-glass-400 transition-colors enabled:hover:bg-glass-900 enabled:hover:text-neutral-100 disabled:opacity-50"
    aria-label={label}
    aria-haspopup="dialog"
    aria-expanded={open}
    aria-controls={open ? `${uid}-picker` : undefined}
    onclick={() => {
      if (open) close();
      else show();
    }}
  >
    <span
      class="checker size-4 shrink-0 overflow-hidden rounded-sm border border-glass-700"
      aria-hidden="true"
    >
      <span class="block size-full" style:background={hex}></span>
    </span>
    {#if showValue}<span class="truncate font-mono text-left" style:width={alpha ? "9ch" : "7ch"}
        >{hex}</span
      >{/if}
  </button>

  {#if open}
    <div
      bind:this={panel}
      id={`${uid}-picker`}
      role="dialog"
      aria-label={`${label} picker`}
      tabindex="-1"
      class="z-40 flex w-68 flex-col gap-3 overflow-y-auto overscroll-contain rounded-xl border border-glass-800 bg-popover p-3 text-neutral-100 shadow-2xl shadow-black/60 backdrop-blur-2xl backdrop-saturate-150"
      in:pop={{ origin: "top left" }}
      out:fade={{ duration: 100 }}
      {@attach floating(() => trigger, { placement: "bottom-end" })}
    >
      <div
        bind:this={plane}
        class="color-plane"
        style:background-color={hue}
        role="slider"
        tabindex="0"
        aria-label="Color saturation and brightness"
        aria-valuemin="0"
        aria-valuemax="100"
        aria-valuenow={Math.round(color.s * 100)}
        aria-valuetext={`${Math.round(color.s * 100)}% saturation, ${Math.round(color.v * 100)}% brightness`}
        aria-describedby={`${uid}-help`}
        onkeydown={planeKey}
        onpointerdown={(event) => {
          if (event.button !== 0) return;
          event.preventDefault();
          event.currentTarget.focus({ preventScroll: true });
          event.currentTarget.setPointerCapture(event.pointerId);
          move(event);
        }}
        onpointermove={(event) => {
          if (event.currentTarget.hasPointerCapture(event.pointerId)) move(event);
        }}
        onpointerup={(event) => {
          if (event.currentTarget.hasPointerCapture(event.pointerId))
            event.currentTarget.releasePointerCapture(event.pointerId);
        }}
      >
        <span
          class="color-cursor"
          style:left={`${color.s * 100}%`}
          style:top={`${(1 - color.v) * 100}%`}
          style:background={solid}
        ></span>
      </div>
      <span id={`${uid}-help`} class="sr-only"
        >Left and right adjust saturation. Up and down adjust brightness. Hold Shift for larger
        steps.</span
      >

      <div class="flex items-center gap-3">
        {#if EyeDropper}
          <button
            type="button"
            class="flex size-7 shrink-0 items-center justify-center rounded-md text-glass-400 hover:bg-glass-800 hover:text-neutral-100 disabled:opacity-50"
            aria-label="Pick color from screen"
            disabled={sampling}
            onclick={() => void sample()}
          >
            <svg
              class="size-4"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="1.75"
              stroke-linecap="round"
              stroke-linejoin="round"
              aria-hidden="true"
            >
              <path d="m16 3 5 5M3 21l1-5L16.5 3.5a2.12 2.12 0 0 1 3 3L7 19zM12 8l4 4M3 21l3-1" />
            </svg>
          </button>
        {/if}
        <div class="flex min-w-0 flex-1 flex-col gap-2.5">
          <input
            class="color-rail hue-rail"
            type="range"
            min="0"
            max="360"
            step="0.1"
            value={color.h}
            style:--thumb-color={hue}
            aria-label="Hue"
            aria-valuetext={`${Math.round(color.h)} degrees`}
            oninput={(event) => update({ h: event.currentTarget.valueAsNumber })}
          />
          {#if alpha}
            <input
              class="color-rail checker alpha-rail"
              type="range"
              min="0"
              max="100"
              step="1"
              value={Math.round(color.a * 100)}
              style:--solid={solid}
              style:--thumb-color={hex}
              aria-label="Opacity"
              aria-valuetext={`${Math.round(color.a * 100)}%`}
              oninput={(event) => update({ a: event.currentTarget.valueAsNumber / 100 })}
            />
          {/if}
        </div>
      </div>

      <div class="flex items-center gap-1.5">
        <div class="relative w-14 shrink-0">
          <select
            class={`${field} w-full appearance-none pl-2 pr-5`}
            aria-label="Color format"
            bind:value={format}
          >
            <option value="hex">Hex</option><option value="rgb">RGB</option>
          </select>
          <span
            class="pointer-events-none absolute inset-y-0 right-2 flex items-center text-glass-400"
            ><Icon name="chevronDown" class="size-3" /></span
          >
        </div>
        {#if format === "hex"}
          <input
            class={`${field} flex-1 px-2`}
            aria-label="Hex color"
            spellcheck="false"
            maxlength={alpha ? 9 : 7}
            aria-invalid={invalid || undefined}
            aria-describedby={invalid ? `${uid}-error` : undefined}
            bind:value={draft}
            oninput={() => (invalid = false)}
            onchange={commitHex}
            onkeydown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                commitHex();
              }
            }}
          />
        {:else}
          <div class="grid min-w-0 flex-1 grid-cols-3 gap-1">
            {#each ["r", "g", "b"] as channel}
              {@const key = channel as "r" | "g" | "b"}
              <input
                class={`${field} w-full px-1 text-center`}
                type="number"
                min="0"
                max="255"
                step="1"
                aria-label={{ r: "Red", g: "Green", b: "Blue" }[key]}
                value={rgb[key]}
                oninput={(event) => {
                  const next = event.currentTarget.valueAsNumber;
                  if (Number.isFinite(next)) {
                    const updated = toHsva({ ...rgb, [key]: Math.round(clamp(next, 0, 255)) });
                    update({ ...updated, h: updated.s ? updated.h : color.h });
                  }
                }}
                onblur={(event) => (event.currentTarget.value = String(rgb[key]))}
              />
            {/each}
          </div>
        {/if}
        {#if alpha}
          <div class="relative w-14 shrink-0">
            <input
              class={`${field} w-full pl-2 pr-5`}
              type="number"
              min="0"
              max="100"
              step="1"
              aria-label="Opacity percentage"
              value={Math.round(color.a * 100)}
              oninput={(event) => {
                const next = event.currentTarget.valueAsNumber;
                if (Number.isFinite(next)) update({ a: clamp(next / 100) });
              }}
              onblur={(event) => (event.currentTarget.value = String(Math.round(color.a * 100)))}
            />
            <span
              class="pointer-events-none absolute inset-y-0 right-2 flex items-center text-xs text-glass-500"
              >%</span
            >
          </div>
        {/if}
      </div>
      {#if invalid}<p id={`${uid}-error`} class="text-xs text-amber-300" role="alert">
          Enter a valid hex color, such as ff5733.
        </p>{/if}
      {#if sampleError}<p class="text-xs text-amber-300" role="alert">{sampleError}</p>{/if}
    </div>
  {/if}
</div>

<style>
  .checker {
    background-color: #343434;
    background-image: conic-gradient(#4b4b4b 25%, transparent 0 50%, #4b4b4b 0 75%, transparent 0);
    background-size: 10px 10px;
  }

  .color-plane {
    position: relative;
    flex-shrink: 0;
    width: 100%;
    aspect-ratio: 1;
    border-radius: 6px;
    background-image:
      linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, transparent);
    box-shadow: inset 0 0 0 1px rgb(255 255 255 / 8%);
    touch-action: none;
    cursor: crosshair;
  }

  .color-cursor {
    position: absolute;
    width: 14px;
    height: 14px;
    border: 3px solid white;
    border-radius: 50%;
    box-shadow:
      0 1px 4px rgb(0 0 0 / 60%),
      inset 0 0 0 1px rgb(0 0 0 / 15%);
    transform: translate(-50%, -50%);
    pointer-events: none;
  }

  .color-rail {
    appearance: none;
    width: 100%;
    height: 12px;
    border-radius: 999px;
    box-shadow: inset 0 0 0 1px rgb(255 255 255 / 10%);
  }

  .hue-rail {
    background: linear-gradient(to right, #f00, #ff0, #0f0, #0ff, #00f, #f0f, #f00);
  }

  .alpha-rail {
    background-image:
      linear-gradient(to right, transparent, var(--solid)),
      conic-gradient(#4b4b4b 25%, transparent 0 50%, #4b4b4b 0 75%, transparent 0);
    background-size:
      100% 100%,
      10px 10px;
  }

  .color-rail::-webkit-slider-thumb {
    appearance: none;
    width: 16px;
    height: 16px;
    border: 3px solid white;
    border-radius: 50%;
    background: var(--thumb-color);
    box-shadow: 0 1px 4px rgb(0 0 0 / 50%);
  }

  input[type="number"]::-webkit-inner-spin-button,
  input[type="number"]::-webkit-outer-spin-button {
    appearance: none;
    margin: 0;
  }
</style>
