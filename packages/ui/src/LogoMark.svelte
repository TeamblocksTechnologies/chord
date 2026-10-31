<script lang="ts">
  let {
    class: className = "h-6",
    recordOnHover = false,
  }: { class?: string; recordOnHover?: boolean } = $props();
</script>

<!-- The ring is a stroke rather than a filled disc so its centre stays transparent. Inherits text color. -->
<svg
  class={[className, recordOnHover && "record-on-hover"]}
  viewBox="29.1187 24.7134 79.847 79.847"
  fill="currentColor"
  role={recordOnHover ? undefined : "img"}
  aria-label={recordOnHover ? undefined : "Chord"}
  aria-hidden={recordOnHover ? "true" : undefined}
>
  <circle
    cx="69.0422"
    cy="64.6369"
    r="35.8449"
    fill="none"
    stroke="currentColor"
    stroke-width="8.1572"
  />
  <rect
    class="side-line left-line"
    x="48.1371"
    y="46.7684"
    width="10.8774"
    height="35.737"
    rx="5.43871"
  />
  <rect
    class="side-line right-line"
    x="79.0699"
    y="46.7684"
    width="10.8774"
    height="35.737"
    rx="5.43871"
  />
  <rect class="center-line" x="63.6034" y="39.5152" width="10.8774" height="50.2433" rx="5.43871" />
  {#if recordOnHover}
    <!-- The lines tuck behind the dot, then emerge from it on the return. -->
    <circle class="record-dot" cx="69.0422" cy="64.6369" r="14" />
  {/if}
</svg>

<style>
  .record-on-hover {
    /* A lightly damped spring: small overshoot, then a quick settle. */
    --mark-spring: linear(
      0,
      0.1095,
      0.3387,
      0.5826,
      0.786,
      0.9293,
      1.0145,
      1.0541,
      1.0632,
      1.0554,
      1.0406,
      1.0253,
      1.0127,
      1.0039,
      0.9988,
      0.9965,
      0.996,
      0.9966,
      0.9975,
      0.9985,
      1
    );
  }

  .record-on-hover .center-line,
  .record-on-hover .side-line,
  .record-on-hover .record-dot {
    transform-box: fill-box;
    transform-origin: center;
    transition: transform 440ms var(--mark-spring);
  }

  .record-on-hover .center-line,
  .record-on-hover .side-line {
    transform: translateX(0) scale(1);
  }

  .record-on-hover .left-line {
    transition-delay: 24ms;
  }

  .record-on-hover .right-line {
    transition-delay: 48ms;
  }

  .record-on-hover .record-dot {
    transform: scale(0);
  }

  :global(button:enabled:is(:hover, :focus-visible)) .record-on-hover .center-line {
    transform: translateX(0) scale(0.12);
    transition-delay: 18ms;
  }

  :global(button:enabled:is(:hover, :focus-visible)) .record-on-hover .left-line {
    transform: translateX(15.4664px) scale(0.12);
    transition-delay: 0ms;
  }

  :global(button:enabled:is(:hover, :focus-visible)) .record-on-hover .right-line {
    transform: translateX(-15.4664px) scale(0.12);
    transition-delay: 28ms;
  }

  :global(button:enabled:is(:hover, :focus-visible)) .record-on-hover .record-dot {
    transform: scale(1);
    transition-delay: 36ms;
  }

  @media (prefers-reduced-motion: reduce) {
    .record-on-hover .center-line,
    .record-on-hover .side-line,
    .record-on-hover .record-dot {
      transition: none;
    }
  }
</style>
