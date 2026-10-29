<script lang="ts">
  import { setContext, type Snippet } from "svelte";
  import type { Attachment } from "svelte/attachments";
  import { on } from "svelte/events";
  import { fade } from "svelte/transition";
  import { dismiss } from "#ui/dismiss.ts";
  import { floating } from "#ui/floating.ts";
  import { trackMenu } from "#ui/menus.svelte.ts";
  import { pop } from "#ui/pop.ts";

  let {
    trigger,
    children,
    align = "start",
    side = "bottom",
    overlay = false,
    panel = false,
    class: className = "",
    open = $bindable(false),
    point,
  }: {
    /** Receives a toggle function to wire to the trigger button. */
    trigger: Snippet<[{ toggle: () => void; open: boolean }]>;
    /** Receives a close function for items that should dismiss the menu. */
    children: Snippet<[{ close: () => void }]>;
    align?: "start" | "end" | "center";
    /** Which side of the trigger it opens on, when there's room. */
    side?: "top" | "bottom" | "left" | "right";
    /** Drawn with the floating surfaces' tint and a border, without backdrop blur. */
    overlay?: boolean;
    /** Holds controls rather than a list of commands, so it keeps roomier rows than a native-sized menu. */
    panel?: boolean;
    /** Extra classes for the panel, e.g. a width. */
    class?: string;
    open?: boolean;
    /** A context menu anchors to the pointer instead of its trigger. */
    point?: { x: number; y: number };
  } = $props();

  // svelte-ignore state_referenced_locally
  setContext("menu-panel", panel);

  let root: HTMLElement;

  let beside = $derived(side === "left" || side === "right");

  // Inside a toolbar, island, or menu bar panel, it clears the whole surface, in line with its own trigger.
  const reference = () => {
    if (point)
      return {
        contextElement: root,
        getBoundingClientRect: () =>
          DOMRect.fromRect({ x: point!.x, y: point!.y, width: 0, height: 0 }),
      };
    const surface = root.closest("[data-menu-anchor]");
    if (!surface) return root;
    return {
      contextElement: root,
      getBoundingClientRect() {
        const trigger = root.getBoundingClientRect();
        const { x, y, width, height } = surface.getBoundingClientRect();
        return beside
          ? DOMRect.fromRect({ x, y: trigger.y, width, height: trigger.height })
          : DOMRect.fromRect({ x: trigger.x, y, width: trigger.width, height });
      },
    };
  };

  const close = () => (open = false);
  const toggle = () => (open = !open);
  let placement = $derived(align === "center" ? side : (`${side}-${align}` as const));
  let origin = $derived(
    beside
      ? `${align === "end" ? "bottom" : align === "center" ? "center" : "top"} ${side === "left" ? "right" : "left"}`
      : `${side === "top" ? "bottom" : "top"} ${align === "end" ? "right" : align === "center" ? "center" : "left"}`,
  );

  $effect(() => {
    if (open) return trackMenu(close);
  });

  /**
   * The arrow keys, Home and End move between the enabled items while it's open. A context menu takes focus when it
   * opens, as it has no trigger to keep it, and hands it back when it closes.
   */
  const navigate: Attachment<HTMLElement> = (menu) => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (point) menu.focus({ preventScroll: true });
    const off = on(
      document,
      "keydown",
      (event) => {
        const active = document.activeElement;
        // Fields in a menu keep their keys, and so does focus elsewhere in the window.
        if (
          active instanceof HTMLInputElement ||
          active instanceof HTMLTextAreaElement ||
          active instanceof HTMLSelectElement
        )
          return;
        if (active && active !== document.body && !root.contains(active)) return;
        const items = [...menu.querySelectorAll<HTMLElement>("[role^=menuitem]:not(:disabled)")];
        const index = items.indexOf(active as HTMLElement);
        const next =
          event.key === "ArrowDown"
            ? items[(index + 1) % items.length]
            : event.key === "ArrowUp"
              ? items[index <= 0 ? items.length - 1 : index - 1]
              : event.key === "Home"
                ? items[0]
                : event.key === "End"
                  ? items.at(-1)
                  : undefined;
        if (!next) return;
        event.preventDefault();
        event.stopPropagation();
        next.focus();
      },
      { capture: true },
    );
    return () => {
      off();
      if (
        point &&
        previous?.isConnected &&
        (!document.activeElement ||
          document.activeElement === document.body ||
          menu.contains(document.activeElement))
      ) {
        previous.focus({ preventScroll: true });
      }
    };
  };
</script>

<!-- The root holds the trigger too, so clicking it toggles rather than dismissing. -->
<div bind:this={root} {@attach open && dismiss(close)}>
  {@render trigger({ toggle, open })}
  {#if open}
    <div
      class={[
        "z-30 overflow-y-auto focus-visible:outline-none",
        panel ? "min-w-56 rounded-xl p-1" : "min-w-44 rounded-lg p-[5px]",
        overlay
          ? "overlay-surface border border-glass-800"
          : "border border-glass-800 bg-popover shadow-2xl shadow-black/60 backdrop-blur-2xl backdrop-saturate-150",
        className,
      ]}
      role="menu"
      tabindex="-1"
      oncontextmenu={(event) => event.preventDefault()}
      in:pop={{ origin }}
      out:fade={{ duration: 100 }}
      {@attach floating(reference, { placement, gap: point ? 2 : undefined })}
      {@attach navigate}
    >
      {@render children({ close })}
    </div>
  {/if}
</div>
