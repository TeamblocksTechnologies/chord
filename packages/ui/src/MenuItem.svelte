<script lang="ts">
  import { getContext, type Snippet } from "svelte";
  import Icon from "#ui/Icon.svelte";

  let {
    selected = false,
    multiple = false,
    detail,
    onclick,
    children,
    preview,
  }: {
    selected?: boolean;
    /** One of several that can be on at once: a checkbox rather than a check mark. */
    multiple?: boolean;
    detail?: string;
    onclick: () => void;
    children: Snippet;
    /** Shown under the item while selected, inside its hover highlight. */
    preview?: Snippet;
  } = $props();

  // Sized like a native menu row, except among a panel's controls.
  const roomy = getContext<boolean>("menu-panel") ?? false;
</script>

<!-- The whole item, preview included, is the click target. The button's own clicks (and Enter/Space) bubble up here. -->
<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
<!-- A preview marked `data-action` does its own thing when clicked, so hovering it doesn't highlight the item. -->
<div
  class={[
    roomy ? "rounded-lg" : "rounded-[5px]",
    "hover:bg-glass-800 has-[>button:focus-visible]:bg-glass-800 has-[[data-action]:hover]:bg-transparent!",
  ]}
  {onclick}
>
  <button
    role={multiple ? "menuitemcheckbox" : "menuitemradio"}
    aria-checked={selected}
    class={[
      "flex w-full items-center text-left text-neutral-200 focus-visible:outline-none",
      roomy ? "gap-2 px-2.5 py-1.5 text-sm" : "h-[22px] gap-1.5 px-2 text-[13px]",
    ]}
  >
    {#if multiple}
      <span
        class={[
          "flex shrink-0 items-center justify-center rounded border",
          roomy ? "size-4" : "size-3.5",
          selected ? "border-primary bg-primary text-white" : "border-glass-600",
        ]}
      >
        {#if selected}<Icon
            name="check"
            class={roomy ? "size-3" : "size-2.5"}
            strokeWidth={3}
          />{/if}
      </span>
    {:else}
      <span
        class={[
          "flex shrink-0 items-center justify-center text-primary",
          roomy ? "size-4" : "size-3.5",
        ]}
      >
        {#if selected}<Icon
            name="check"
            class={roomy ? "size-3.5" : "size-3"}
            strokeWidth={2.25}
          />{/if}
      </span>
    {/if}
    <span class="min-w-0 flex-1 truncate">{@render children()}</span>
    {#if detail}<span class={["shrink-0 text-glass-500", roomy ? "text-xs" : "text-[12px]"]}
        >{detail}</span
      >{/if}
  </button>
  {#if preview && selected}
    <!-- Lines up with the label, past the check column. -->
    <div class={["pb-2 empty:hidden", roomy ? "mr-2.5 ml-8.5" : "mr-2 ml-7"]}>
      {@render preview()}
    </div>
  {/if}
</div>
