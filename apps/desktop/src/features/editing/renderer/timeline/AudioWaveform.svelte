<script lang="ts">
  import { waveformPath, type Waveform, type WaveformCache } from "#media-engine/renderer/waveform";

  let {
    cache,
    url,
    sourceStart,
    duration,
    width,
    from,
    to,
    class: className = "text-emerald-600/50",
  }: {
    cache: WaveformCache;
    url: string;
    sourceStart: number;
    duration: number;
    width: number;
    from: number;
    to: number;
    class?: string;
  } = $props();

  let waveform = $state.raw<Waveform | null>(null);
  let path = $derived(
    waveform ? waveformPath(waveform, sourceStart, duration, width, from, to) : "",
  );

  $effect(() => {
    let active = true;
    waveform = null;
    void cache.get(url).then((loaded) => {
      if (active) waveform = loaded;
    });
    return () => {
      active = false;
    };
  });
</script>

{#if waveform}
  {#if to > from}
    <svg
      class={["pointer-events-none absolute top-0 h-full", className]}
      style:left={`${from}px`}
      width={to - from}
      viewBox={`0 0 ${to - from} 24`}
      preserveAspectRatio="none"
      aria-hidden="true"
      data-waveform
    >
      <path d={`M0,12H${to - from}`} stroke="currentColor" stroke-width="0.5" opacity="0.3" />
      <path d={path} fill="currentColor" data-peaks />
    </svg>
  {/if}
{/if}
