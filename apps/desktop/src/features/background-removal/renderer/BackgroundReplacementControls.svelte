<script lang="ts">
  import type { Snippet } from "svelte";
  import { BACKGROUND_BLUR_RANGE, type CameraBackground } from "../contracts/backgroundRemoval.ts";
  import ColorPicker from "@teamblocks.dev/chord-ui/ColorPicker.svelte";
  import Segmented from "@teamblocks.dev/chord-ui/Segmented.svelte";
  import SliderField from "@teamblocks.dev/chord-ui/SliderField.svelte";

  type Appearance = Pick<CameraBackground, "replacement" | "blur" | "color">;
  const generatedId = $props.id();
  let {
    value,
    onchange,
    row = defaultRow,
    fill = false,
    showReplacementLabel = true,
    id = generatedId,
  }: {
    id?: string;
    value: Appearance;
    onchange: (patch: Partial<Appearance>) => void;
    /** The caller supplies its row layout; the controls have no persistence or processing knowledge. */
    row?: Snippet<[label: string, controls: Snippet]>;
    fill?: boolean;
    showReplacementLabel?: boolean;
  } = $props();
  const replacements = [
    { value: "blur", label: "Blur" },
    { value: "color", label: "Color" },
  ] as const;
</script>

{#snippet defaultRow(label: string, controls: Snippet)}
  <div class="flex items-center justify-between gap-3 text-xs text-glass-400">
    <span>{label}</span>{@render controls()}
  </div>
{/snippet}

{#snippet replacement()}
  <Segmented
    {fill}
    label="Background replacement"
    options={[...replacements]}
    bind:value={() => value.replacement, (replacement) => onchange({ replacement })}
  />
{/snippet}
{#snippet blur()}
  <SliderField
    id={`${id}-blur`}
    ariaLabel="Blur amount"
    value={value.blur}
    min={BACKGROUND_BLUR_RANGE.min}
    max={BACKGROUND_BLUR_RANGE.max}
    controlsClass="min-w-0 flex-1 max-w-60"
    readoutClass="w-6 text-xs text-glass-400"
    onchange={(blur) => onchange({ blur })}
  />
{/snippet}
{#snippet color()}
  <ColorPicker
    id={`${id}-color`}
    label="Background color"
    alpha
    value={value.color}
    onchange={(color) => onchange({ color })}
  />
{/snippet}

{#if showReplacementLabel}{@render row(
    "Background",
    replacement,
  )}{:else}{@render replacement()}{/if}
{#if value.replacement === "blur"}{@render row("Blur", blur)}{:else}{@render row(
    "Color",
    color,
  )}{/if}
