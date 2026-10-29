<script lang="ts">
  let {
    orientation,
    label,
    value,
    min,
    max,
    defaultValue,
    onresize,
    reverse = false,
  }: {
    orientation: "horizontal" | "vertical";
    label: string;
    value: number;
    min: number;
    max: number;
    defaultValue: number;
    onresize: (value: number) => void;
    /** Right-hand panes grow when their divider moves left. */
    reverse?: boolean;
  } = $props();

  let drag = $state<{ pointerId: number; from: number; value: number } | null>(null);
  const clamp = (next: number) => Math.min(Math.max(next, min), max);
  const coordinate = (event: PointerEvent) =>
    orientation === "vertical" ? event.clientX : event.clientY;

  function onKeyDown(event: KeyboardEvent) {
    const decrease = orientation === "vertical" ? "ArrowLeft" : "ArrowUp";
    const increase = orientation === "vertical" ? "ArrowRight" : "ArrowDown";
    const step = event.shiftKey ? 40 : 10;
    if (event.key === decrease) onresize(clamp(value - step * (reverse ? -1 : 1)));
    else if (event.key === increase) onresize(clamp(value + step * (reverse ? -1 : 1)));
    else if (event.key === "Home") onresize(min);
    else if (event.key === "End") onresize(max);
    else if (event.key === "Enter") onresize(clamp(defaultValue));
    else return;
    event.preventDefault();
    event.stopPropagation();
  }
</script>

<!-- A focusable separator is an interactive window splitter, with arrow keys and its size exposed to assistive technology. -->
<!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
<div
  role="separator"
  tabindex="0"
  aria-label={label}
  aria-orientation={orientation}
  aria-valuemin={Math.round(min)}
  aria-valuemax={Math.round(max)}
  aria-valuenow={Math.round(value)}
  aria-valuetext={`${Math.round(value)} pixels`}
  title={`${label}. Drag or use arrow keys to resize. Double-click to reset.`}
  class={[
    "relative z-10 shrink-0 touch-none bg-glass-900 outline-offset-[-2px]! transition-colors before:absolute hover:bg-blue-500/25 focus-visible:bg-blue-500/25",
    orientation === "vertical"
      ? "w-0.5 cursor-col-resize before:inset-y-0 before:-inset-x-0.5"
      : "h-0.5 cursor-row-resize before:inset-x-0 before:-inset-y-0.5",
    drag && "bg-blue-500/25",
  ]}
  onkeydown={onKeyDown}
  onpointerdown={(event) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.focus();
    event.currentTarget.setPointerCapture(event.pointerId);
    drag = { pointerId: event.pointerId, from: coordinate(event), value };
  }}
  onpointermove={(event) => {
    if (drag?.pointerId === event.pointerId)
      onresize(clamp(drag.value + (coordinate(event) - drag.from) * (reverse ? -1 : 1)));
  }}
  onpointerup={(event) => {
    if (drag?.pointerId !== event.pointerId) return;
    drag = null;
    event.currentTarget.releasePointerCapture(event.pointerId);
  }}
  onlostpointercapture={() => (drag = null)}
  onpointercancel={() => (drag = null)}
  ondblclick={() => onresize(clamp(defaultValue))}
></div>
