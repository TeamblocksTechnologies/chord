<script lang="ts" generics="T extends string">
  import { fade } from "svelte/transition";
  import { dismiss } from "#ui/dismiss.ts";
  import { floating } from "#ui/floating.ts";
  import { trackMenu } from "#ui/menus.svelte.ts";
  import { pop } from "#ui/pop.ts";
  import Icon from "#ui/Icon.svelte";

  let {
    value = $bindable(),
    options,
    label,
    compact = false,
    overlay = false,
    disabled = false,
    class: className = "",
  }: {
    value: T;
    options: { value: T; label: string }[];
    label: string;
    compact?: boolean;
    overlay?: boolean;
    disabled?: boolean;
    /** Extra classes for the trigger. */
    class?: string;
  } = $props();

  const id = $props.id();
  let trigger: HTMLButtonElement;
  let list = $state<HTMLDivElement>();
  let open = $state(false);
  let active = $state(0);
  let selected = $derived(options.find((option) => option.value === value));
  let search = "";
  let lastTyped = 0;

  function close() {
    open = false;
    search = "";
  }

  function show(index = options.findIndex((option) => option.value === value)) {
    active = Math.max(0, index);
    search = "";
    open = true;
  }

  function choose(index: number) {
    if (options[index]) value = options[index].value;
    close();
    trigger.focus({ preventScroll: true });
  }

  function onKeyDown(event: KeyboardEvent) {
    if (event.key === "Tab") {
      close();
      return;
    }
    if (event.altKey || event.ctrlKey || event.metaKey || options.length === 0) return;

    switch (event.key) {
      case "ArrowDown":
      case "ArrowUp":
        event.preventDefault();
        if (!open) show();
        else
          active =
            (active + (event.key === "ArrowDown" ? 1 : -1) + options.length) % options.length;
        return;
      case "Home":
      case "End":
        event.preventDefault();
        show(event.key === "Home" ? 0 : options.length - 1);
        return;
      case "Enter":
      case " ":
        event.preventDefault();
        if (open) choose(active);
        else show();
        return;
    }

    if (event.key.length === 1) {
      event.preventDefault();
      if (!open) show();
      const now = Date.now();
      search = (now - lastTyped < 500 ? search : "") + event.key.toLowerCase();
      lastTyped = now;
      const match = options.findIndex((option) => option.label.toLowerCase().startsWith(search));
      if (match !== -1) active = match;
    }
  }

  $effect(() => {
    if (open) return trackMenu(close);
  });

  $effect(() => {
    if (open) list?.children[active]?.scrollIntoView({ block: "nearest" });
  });
</script>

<div class="min-w-0 flex-1" {@attach open && dismiss(close)}>
  <button
    bind:this={trigger}
    type="button"
    role="combobox"
    aria-label={label}
    aria-haspopup="listbox"
    aria-expanded={open}
    aria-controls={open ? `${id}-list` : undefined}
    aria-activedescendant={open ? `${id}-${active}` : undefined}
    {disabled}
    class={[
      "flex w-full items-center justify-between gap-2 rounded-lg border border-glass-800 px-3 text-left text-glass-300 transition-colors enabled:hover:bg-glass-900 enabled:hover:text-neutral-100 disabled:opacity-50",
      compact ? "h-7 text-xs" : "h-9 text-sm",
      open && "bg-glass-900 text-neutral-100",
      className,
    ]}
    onclick={() => (open ? close() : show())}
    onkeydown={onKeyDown}
    onblur={close}
  >
    <span class="truncate">{selected?.label ?? label}</span>
    <Icon
      name="chevronDown"
      class={["size-3.5 shrink-0 text-glass-500 transition-transform", open && "rotate-180"]
        .filter(Boolean)
        .join(" ")}
    />
  </button>
  {#if open}
    <div
      bind:this={list}
      id={`${id}-list`}
      role="listbox"
      aria-label={label}
      class={[
        "z-30 overflow-y-auto overscroll-contain border border-glass-800 p-1 shadow-2xl shadow-black/60",
        overlay
          ? "overlay-surface"
          : "rounded-xl bg-popover backdrop-blur-2xl backdrop-saturate-150",
      ]}
      in:pop={{ origin: "top left" }}
      out:fade={{ duration: 100 }}
      {@attach floating(() => trigger, { placement: "bottom-start", matchWidth: true })}
    >
      {#each options as option, index (option.value)}
        <button
          id={`${id}-${index}`}
          type="button"
          role="option"
          aria-selected={value === option.value}
          tabindex="-1"
          class={[
            "flex w-full items-center gap-2 rounded-lg px-2 text-left text-glass-300",
            compact ? "py-1.5 text-xs" : "py-2 text-sm",
            active === index && "bg-glass-800 text-neutral-100",
          ]}
          onpointermove={() => (active = index)}
          onpointerdown={(event) => event.preventDefault()}
          onclick={() => choose(index)}
        >
          <span class="min-w-0 flex-1 truncate">{option.label}</span>
          <span class="flex size-4 shrink-0 items-center justify-center text-primary">
            {#if value === option.value}<Icon
                name="check"
                class="size-3.5"
                strokeWidth={2.25}
              />{/if}
          </span>
        </button>
      {/each}
    </div>
  {/if}
</div>
