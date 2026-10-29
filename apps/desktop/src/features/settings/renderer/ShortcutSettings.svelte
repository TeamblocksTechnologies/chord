<script lang="ts">
  import { onDestroy } from "svelte";
  import Icon from "@teamblocks.dev/chord-ui/Icon.svelte";
  import SettingsSection from "@teamblocks.dev/chord-ui/SettingsSection.svelte";
  import { desktop, updatePreferences } from "#platform/renderer/desktop.svelte";
  import { bindings, mac } from "./shortcuts.svelte.ts";
  import { toolbar } from "#features/recording/renderer/toolbar.svelte";
  import {
    SHORTCUTS,
    assignShortcut,
    bindingFromEvent,
    bindingKeys,
    bindingLabel,
    bindingProblem,
    shortcutDefault,
    type ShortcutId,
  } from "../domain/shortcuts.ts";

  /** Shortcuts that can't be changed, shown so every shortcut is listed. */
  type Fixed = { label: string; binding: string };
  const groups: { title: string; ids: ShortcutId[]; fixed: Fixed[] }[] = [
    {
      title: "Anywhere",
      ids: ["toolbar"],
      fixed: [{ label: "Close the recording toolbar", binding: "Escape" }],
    },
    {
      title: "While recording",
      ids: ["pauseRecording", "addMark"],
      fixed: [{ label: "Cancel the countdown", binding: "Escape" }],
    },
    {
      title: "Playback",
      ids: ["playPause", "skipBack", "skipForward", "copyFrame", "saveFrame"],
      fixed: [{ label: "Leave the expanded video", binding: "Escape" }],
    },
    {
      title: "Video timeline",
      ids: ["split"],
      fixed: [
        { label: "Remove the selected clip", binding: "Backspace" },
        { label: "Clear selection", binding: "Escape" },
      ],
    },
    {
      title: "Recording timeline",
      ids: ["snapping"],
      fixed: [
        { label: "Remove the selected span", binding: "Backspace" },
        { label: "Clear selection", binding: "Escape" },
      ],
    },
    {
      title: "Transcript",
      ids: [],
      fixed: [
        { label: "Cut selected words", binding: "Backspace" },
        { label: "Undo transcript cut", binding: "Mod+KeyZ" },
        { label: "Select the whole transcript", binding: "Mod+KeyA" },
        { label: "Edit selected words", binding: "Enter" },
        { label: "Clear selection", binding: "Escape" },
      ],
    },
  ];
  const NEEDS_MODIFIER = `Include ${mac ? "⌘, ⌃, or ⌥" : "Ctrl or Alt"} so typing in other apps still works.`;
  const labels = Object.fromEntries(
    SHORTCUTS.map((shortcut) => [shortcut.id, shortcut.label]),
  ) as Record<ShortcutId, string>;

  const current = $derived(bindings());
  const changed = $derived(Object.keys(desktop.preferences.shortcuts).length > 0);
  /** The shortcut waiting for keys, if any. */
  let listening = $state<ShortcutId | null>(null);
  /** A note under a shortcut about its last change. */
  let note = $state<{ id: ShortcutId; text: string; error: boolean } | null>(null);

  function listen(id: ShortcutId, button: HTMLButtonElement) {
    note = null;
    if (listening === id) return stop();
    // Keys go to the button, which a click doesn't always focus.
    button.focus();
    listening = id;
    void window.chord.shortcuts.suspend(true);
  }

  function stop() {
    if (!listening) return;
    listening = null;
    void window.chord.shortcuts.suspend(false);
  }
  onDestroy(stop);

  function assign(id: ShortcutId, binding: string | null) {
    const { overrides, cleared } = assignShortcut(
      $state.snapshot(desktop.preferences.shortcuts),
      id,
      binding,
      mac,
    );
    updatePreferences({ shortcuts: overrides });
    note = cleared.length
      ? {
          id,
          text: `Removed from ${cleared.map((other) => labels[other]).join(", ")}.`,
          error: false,
        }
      : null;
  }

  function onKeyDown(event: KeyboardEvent, id: ShortcutId) {
    if (listening !== id) return;
    // Keep the keys from reaching the dialog, which would close on Escape.
    event.preventDefault();
    event.stopPropagation();
    if (event.repeat) return;
    const plain = !event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey;
    if (plain && event.key === "Escape") return stop();
    if (plain && (event.key === "Backspace" || event.key === "Delete")) {
      assign(id, null);
      return stop();
    }
    const binding = bindingFromEvent(event, mac);
    if (!binding) return;
    const problem = bindingProblem(id, binding, mac);
    if (problem === "reserved")
      note = { id, text: `${bindingLabel(binding, mac)} is reserved.`, error: true };
    else if (problem === "needsModifier") note = { id, text: NEEDS_MODIFIER, error: true };
    else assign(id, binding);
    stop();
  }

  function reset(id: ShortcutId) {
    assign(id, shortcutDefault(id));
  }

  function resetAll() {
    note = null;
    updatePreferences({ shortcuts: {} });
  }

  const row =
    "flex min-h-9 flex-wrap items-center gap-2.5 border-t border-glass-800 py-1.5 first:border-t-0";
  const label = "flex-1 text-xs text-neutral-200";
  const key =
    "flex h-6 min-w-6 items-center justify-center rounded border border-glass-700 bg-glass-900 px-1.5 font-sans text-xs text-neutral-100";
</script>

{#snippet keys(binding: string)}
  <span class="flex items-center gap-1">
    {#each bindingKeys(binding, mac) as part, index (index)}
      <kbd class={key}>{part}</kbd>
    {/each}
  </span>
{/snippet}

{#each groups as group (group.title)}
  <SettingsSection title={group.title}>
    {#each group.ids as id (id)}
      {@const binding = current[id]}
      <div class={row} data-shortcut={id}>
        <span class={label}>{labels[id]}</span>
        {#if binding !== shortcutDefault(id)}
          <button
            class="flex size-7 shrink-0 items-center justify-center rounded-md text-glass-400 transition hover:bg-glass-800 hover:text-neutral-100"
            onclick={() => reset(id)}
            aria-label={`Reset ${labels[id]}`}
            title={`Reset to ${bindingLabel(shortcutDefault(id), mac)}`}
          >
            <Icon name="undo" class="size-3.5" />
          </button>
        {/if}
        <button
          class={[
            "flex h-7 min-w-24 shrink-0 items-center justify-center rounded-md border px-2 text-xs transition",
            listening === id
              ? "border-primary bg-glass-800 text-neutral-100"
              : "border-glass-700 bg-glass-800/40 text-glass-400 hover:bg-glass-700/70",
          ]}
          aria-label={`Change ${labels[id]}`}
          aria-pressed={listening === id}
          onclick={(event) => listen(id, event.currentTarget)}
          onkeydown={(event) => onKeyDown(event, id)}
          onblur={stop}
        >
          {#if listening === id}
            Press keys
          {:else if binding}
            {@render keys(binding)}
          {:else}
            None
          {/if}
        </button>
        {#if note?.id === id}
          <p class={["basis-full text-xs", note.error ? "text-amber-300" : "text-glass-500"]}>
            {note.text}
          </p>
        {:else if binding && bindingProblem(id, binding, mac) === "needsModifier"}
          <!-- Saved before shortcuts working in other apps needed a modifier, so it's left unregistered. -->
          <p class="basis-full text-xs text-amber-300">{NEEDS_MODIFIER}</p>
        {:else if id === "toolbar" && binding && !toolbar.registered}
          <p class="basis-full text-xs text-amber-300">Another app may be using this shortcut.</p>
        {/if}
      </div>
    {/each}
    {#each group.fixed as fixed (fixed.label)}
      <div class={row}>
        <span class={label}>{fixed.label}</span>
        <span class="flex min-w-24 shrink-0 justify-center">{@render keys(fixed.binding)}</span>
      </div>
    {/each}
  </SettingsSection>
{/each}

<button
  class="mt-3 h-7 rounded-md border border-glass-700 bg-glass-800/70 px-3 text-xs font-medium text-neutral-100 transition enabled:hover:bg-glass-700/70 disabled:opacity-50"
  disabled={!changed}
  onclick={resetAll}
>
  Reset all shortcuts
</button>
