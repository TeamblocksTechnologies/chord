<script lang="ts">
  import { onMount, type Snippet } from "svelte";
  import { afterExit } from "#ui/dialog.ts";
  import Icon, { type IconName } from "#ui/Icon.svelte";

  const generatedId = $props.id();
  let {
    title,
    detail,
    children,
    confirmLabel,
    icon,
    onconfirm,
    onclose,
    id = generatedId,
  }: {
    id?: string;
    title: string;
    detail?: string;
    children: Snippet;
    confirmLabel: string;
    icon?: IconName;
    onconfirm: () => void | Promise<void>;
    onclose: () => void;
  } = $props();
  let dialog: HTMLDialogElement;
  let busy = $state(false);
  let error = $state("");
  let closed = false;
  onMount(() => dialog.showModal());

  function finish(): void {
    if (closed) return;
    closed = true;
    afterExit(onclose)();
  }

  async function confirm(): Promise<void> {
    if (busy) return;
    busy = true;
    error = "";
    try {
      await onconfirm();
      // Deleting the item can unmount its caller before the action returns.
      dialog?.close();
      finish();
    } catch (failure) {
      error = failure instanceof Error ? failure.message : String(failure);
    } finally {
      busy = false;
    }
  }
</script>

<dialog
  bind:this={dialog}
  closedby={busy ? "none" : "any"}
  class="m-auto w-80 max-w-[calc(100%-2rem)] rounded-xl border border-glass-800 bg-popover p-5 text-neutral-200 shadow-2xl backdrop:bg-black/50"
  aria-labelledby={`${id}-title`}
  aria-describedby={`${id}-description`}
  aria-busy={busy}
  oncancel={(event) => {
    if (busy) event.preventDefault();
  }}
  onclose={finish}
>
  <h2 id={`${id}-title`} class="text-sm font-medium">{title}</h2>
  {#if detail}<p class="mt-1 truncate text-sm text-glass-400">{detail}</p>{/if}
  <div id={`${id}-description`} class="mt-2 text-xs text-glass-500">{@render children()}</div>
  {#if error}<p class="mt-2 text-xs text-amber-300" role="alert">{error}</p>{/if}
  <div class="mt-4 flex items-center gap-2">
    <button
      class="h-8 rounded-md px-2.5 text-xs text-glass-400 hover:bg-glass-800 disabled:opacity-50"
      disabled={busy}
      onclick={() => dialog.close()}>Cancel</button
    >
    <button
      class="flex h-8 flex-1 items-center justify-center gap-1.5 rounded-md bg-red-600/90 text-xs font-medium text-white hover:bg-red-500 disabled:opacity-50"
      disabled={busy}
      onclick={() => void confirm()}
    >
      {#if icon}<Icon name={icon} class="size-3.5" />{/if}
      {confirmLabel}
    </button>
  </div>
</dialog>
