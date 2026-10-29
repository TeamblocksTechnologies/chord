<script lang="ts">
  import { paths, type IconName } from "@teamblocks.dev/chord-ui/Icon.svelte";
  import ScreenIcon from "./ScreenIcon.svelte";
  import { isScreenIcon } from "./screenIconMotion.ts";
  import { sourceSlashMotion } from "./sourceSlashMotion.ts";

  let { name, on, compact }: { name: IconName; on: boolean; compact: boolean } = $props();

  const slash = "M2 2l20 20";
  const speakerBody = paths.speaker.slice(0, paths.speaker.indexOf("M", 1));
  const waves = paths.speaker.slice(speakerBody.length).match(/M[^M]+/g)!;
  const muteMark = paths.speakerOff.slice(speakerBody.length);
  const offNames: Partial<Record<IconName, IconName>> = {
    camera: "cameraOff",
    mic: "micOff",
  };
  let offName = $derived(offNames[name] ?? null);
  let screenName = $derived(isScreenIcon(name) ? name : null);
  let restingName = $derived(!on ? (offName ?? (name === "speaker" ? "speakerOff" : name)) : name);

  // Only react to changes, never entrance. Restart from the current scale when toggled mid-settle.
  function settle(node: SVGSVGElement, initial: boolean) {
    let previous = initial;
    let animation: Animation | undefined;
    const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
    const stop = () => {
      animation?.cancel();
      delete node.dataset.animating;
    };
    reducedMotion.addEventListener("change", stop);
    return {
      update(next: boolean) {
        if (next === previous) return;
        previous = next;
        const transform = getComputedStyle(node).transform;
        stop();
        if (reducedMotion.matches) return;
        node.dataset.animating = "";
        animation = node.animate(
          [
            { transform, offset: 0, easing: "ease-out" },
            { transform: `scale(${next ? 0.92 : 0.96})`, offset: 0.18, easing: "ease-out" },
            { transform: `scale(${next ? 1.04 : 1.02})`, offset: 0.58, easing: "ease-in-out" },
            { transform: "scale(1)", offset: 1 },
          ],
          { duration: next ? 300 : 240 },
        );
        animation.onfinish = () => delete node.dataset.animating;
      },
      destroy() {
        stop();
        reducedMotion.removeEventListener("change", stop);
      },
    };
  }
</script>

<!-- Reuse the original geometry, size, and stroke. Hidden layers only bridge the two exact end states. -->
{#if screenName}
  <ScreenIcon name={screenName} {on} {compact} />
{:else}
  <svg
    class={["source-icon", compact ? "size-4" : "size-5"]}
    class:off={!on}
    class:layered={name === "speaker" || !!offName}
    use:settle={on}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="1.5"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
  >
    <!-- A single original path at rest also preserves stroke compositing where subpaths overlap. -->
    <path class="rest-geometry" d={paths[restingName]} />
    <g class="transition-geometry">
      {#if name === "speaker"}
        <path d={speakerBody} />
        {#each waves as wave, i}
          <path class="wave" class:outer={i === 1} d={wave} />
        {/each}
        <path use:sourceSlashMotion={on} d={muteMark} pathLength="2" />
      {:else if offName}
        <path class="enabled-body" d={paths[name]} />
        <path class="disabled-body" d={paths[offName].slice(slash.length)} />
        <path use:sourceSlashMotion={on} d={slash} pathLength="1" />
      {/if}
    </g>
  </svg>
{/if}

<style>
  .source-icon {
    transform-origin: center;
  }

  .source-icon.layered:global([data-animating]) .rest-geometry,
  .source-icon:not(:global([data-animating])) .transition-geometry {
    visibility: hidden;
  }

  .enabled-body,
  .disabled-body {
    transition: opacity 140ms ease-out;
  }

  .disabled-body,
  .off .enabled-body {
    opacity: 0;
  }

  .off .disabled-body {
    opacity: 1;
  }

  .wave {
    transform-origin: 11px 12px;
    transition:
      opacity 140ms ease-out,
      transform 220ms cubic-bezier(0.16, 1.3, 0.3, 1);
  }

  .wave.outer {
    transition-delay: 25ms;
  }

  .off .wave {
    opacity: 0;
    transform: scaleX(0.6);
    transition-delay: 0ms;
  }

  @media (prefers-reduced-motion: reduce) {
    .enabled-body,
    .disabled-body,
    .wave {
      transition: none;
    }
  }
</style>
