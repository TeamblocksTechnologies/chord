<script lang="ts">
  /** 0...1. */
  let { level }: { level: number } = $props();
</script>

<div
  class="h-1.5 overflow-hidden rounded-full bg-black/40"
  role="meter"
  aria-label="Input level"
  aria-valuemin={0}
  aria-valuemax={1}
  aria-valuenow={level}
>
  <!-- Full-width gradient revealed by clipping, so the colors stay fixed as the level changes. -->
  <div
    class="h-full bg-[linear-gradient(to_right,#34d399_0%,#34d399_50%,#facc15_75%,#ef4444_100%)] transition-[clip-path] duration-75"
    style:clip-path="inset(0 {(1 - Math.min(Math.max(level, 0), 1)) * 100}% 0 0)"
  ></div>
</div>
