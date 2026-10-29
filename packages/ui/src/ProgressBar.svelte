<script lang="ts">
  import type { HTMLAttributes } from "svelte/elements";

  let {
    value = null,
    label,
    class: className,
  }: {
    /** Progress from 0 to 1, or null while the amount is unknown. */
    value?: number | null;
    label: string;
    class?: HTMLAttributes<HTMLDivElement>["class"];
  } = $props();

  const fraction = $derived(
    value === null || !Number.isFinite(value) ? null : Math.min(1, Math.max(0, value)),
  );
</script>

<div
  class={["h-1.5 min-w-0 overflow-hidden rounded-full bg-glass-800", className]}
  role="progressbar"
  aria-label={label}
  aria-valuemin={0}
  aria-valuemax={100}
  aria-valuenow={fraction === null ? undefined : fraction * 100}
>
  <div
    class="progress-fill h-full rounded-full bg-primary"
    class:indeterminate={fraction === null}
    style:width={fraction === null ? "40%" : `${fraction * 100}%`}
  ></div>
</div>

<style>
  .progress-fill {
    transition: width 160ms ease-out;
  }

  .indeterminate {
    animation: sweep 1.2s ease-in-out infinite;
  }

  @keyframes sweep {
    from {
      transform: translateX(-100%);
    }
    to {
      transform: translateX(250%);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .progress-fill {
      transition: none;
    }

    .indeterminate {
      animation: none;
      transform: translateX(75%);
    }
  }
</style>
