<script lang="ts">
  // One app in an app grid: its icon (or initials), a badge in the corner, and its name.
  import type { HTMLButtonAttributes } from "svelte/elements";
  import { appIcons, iconsSettled, type AppEntry } from "./apps.svelte.ts";
  import Icon from "@teamblocks.dev/chord-ui/Icon.svelte";

  let {
    app,
    selected,
    faded = false,
    compact = false,
    badge,
    ...rest
  }: HTMLButtonAttributes & {
    app: AppEntry;
    /** Raised, with a primary badge. */
    selected: boolean;
    /** The icon greyed out and shrunk. */
    faded?: boolean;
    /** Smaller icons and spacing for settings grids. */
    compact?: boolean;
    /** The corner badge's icon; none hides it. */
    badge: "check" | "eyeOff" | null;
  } = $props();

  let icon = $derived(appIcons[app.bundleId]);

  function monogram(name: string): string {
    return name
      .split(/\s+/)
      .map((word) => word[0])
      .join("")
      .slice(0, 2)
      .toUpperCase();
  }
</script>

<button
  {...rest}
  class={[
    "relative flex min-w-0 flex-col items-center border px-1 transition duration-150",
    compact ? "gap-1 rounded-lg py-1.5" : "gap-1.5 rounded-xl pt-2.5 pb-2",
    selected
      ? "border-glass-700 bg-glass-800/80 hover:border-glass-500"
      : "border-transparent hover:border-glass-800 hover:bg-glass-800/30",
  ]}
  title={app.name}
>
  <span class={["relative", compact ? "size-7" : "size-9"]}>
    <span
      class={[
        "flex size-full items-center justify-center transition duration-200",
        faded ? "scale-90 opacity-35 grayscale" : "scale-100",
      ]}
    >
      {#if icon}
        <img src={icon} alt="" class="size-full" draggable="false" />
      {:else if !iconsSettled[app.bundleId]}
        <span
          class={["skeleton rounded-lg", compact ? "size-6" : "size-8"]}
          role="status"
          aria-label="Loading icon"
        ></span>
      {:else}
        <span
          class={[
            "flex items-center justify-center rounded-lg bg-glass-700 text-[11px] font-semibold text-neutral-200",
            compact ? "size-6" : "size-8",
          ]}
        >
          {monogram(app.name)}
        </span>
      {/if}
    </span>
    {#if badge}
      <span
        class={[
          "absolute -right-1 -bottom-1 flex size-4 items-center justify-center rounded-full ring-2 ring-black/30 transition duration-200",
          selected ? "bg-primary text-white" : "bg-glass-800 text-glass-400 backdrop-blur-sm",
        ]}
      >
        <Icon name={badge} class="size-2.5" strokeWidth={badge === "check" ? 3.5 : 2.5} />
      </span>
    {/if}
  </span>
  <span
    class={[
      "line-clamp-2 w-full text-center text-[11px] leading-tight break-words transition",
      selected || !faded ? "text-neutral-100" : "text-glass-500",
    ]}
  >
    {app.name}
  </span>
</button>
