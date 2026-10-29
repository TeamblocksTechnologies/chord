<script lang="ts">
  // One display's pointer overlay, drawn on a canvas: the laser pointer, a small dot at the cursor with a trail that
  // fades behind it, click highlights, a ripple where a click lands and a ring that holds while the button does, and
  // keyboard shortcuts, shown as key caps in a translucent pill at the bottom middle of the display.
  // The window is click-through and kept out of the recording, so this is only for the presenter; playback draws the
  // same effects from the recorded mouse and keys (see `lib/playback/effects.ts`).
  import { onMount } from "svelte";
  import { flip } from "svelte/animate";
  import { cubicOut, backOut } from "svelte/easing";
  import { fade, fly } from "svelte/transition";
  import type { ShortcutPress } from "#platform/contracts/desktop";
  import {
    LASER_COLOR,
    LASER_RADIUS,
    LASER_TRAIL,
    RELEASE,
    RIPPLE,
    SETTLE,
    SHORTCUT_LIMIT,
    SHORTCUT_TIME,
    circle,
    drawHold,
    drawRipple,
    drawTrail,
  } from "#shared/renderer/pointerStyle";

  let canvas = $state<HTMLCanvasElement>();
  let shortcuts = $state<ShortcutPress[]>([]);

  /** Keys pop in one after another, so a chord reads as it was pressed. */
  const pop = (_node: Element, { delay }: { delay: number }) => ({
    delay,
    duration: 260,
    easing: backOut,
    css: (t: number) =>
      `opacity: ${Math.min(t * 2, 1)}; transform: translateY(${(1 - t) * 6}px) scale(${0.7 + 0.3 * t})`,
  });

  type Point = { x: number; y: number; at: number };
  type Hold = { x: number; y: number; since: number; released?: number };

  onMount(() => {
    const context = canvas!.getContext("2d")!;
    const clickColor = getComputedStyle(canvas!).getPropertyValue("--color-primary").trim();
    let points: Point[] = [];
    let head: { x: number; y: number } | null = null;
    let ripples: Point[] = [];
    let hold: Hold | null = null;
    let wasDown = false;
    let frame = 0;

    const resize = () => {
      const scale = window.devicePixelRatio;
      canvas!.width = Math.round(window.innerWidth * scale);
      canvas!.height = Math.round(window.innerHeight * scale);
      context.setTransform(scale, 0, 0, scale, 0, 0);
    };
    resize();

    const clicks = (now: number) => {
      ripples = ripples.filter((ripple) => now - ripple.at < RIPPLE);
      for (const ripple of ripples)
        drawRipple(context, clickColor, ripple.x, ripple.y, (now - ripple.at) / RIPPLE);
      if (hold?.released !== undefined && now - hold.released >= RELEASE) hold = null;
      if (hold) {
        const fade = hold.released === undefined ? 1 : 1 - (now - hold.released) / RELEASE;
        // The ring settles in from the ripple's start rather than popping.
        drawHold(
          context,
          clickColor,
          hold.x,
          hold.y,
          Math.min((now - hold.since) / SETTLE, 1),
          fade,
        );
      }
    };

    const draw = (now: number) => {
      frame = 0;
      points = points.filter((point) => now - point.at < LASER_TRAIL);
      context.clearRect(0, 0, window.innerWidth, window.innerHeight);
      clicks(now);
      drawTrail(
        context,
        points.map(({ x, y, at }) => ({ x, y, life: 1 - (now - at) / LASER_TRAIL })),
        LASER_RADIUS,
      );
      if (head) {
        context.fillStyle = `rgb(${LASER_COLOR})`;
        circle(context, head.x, head.y, LASER_RADIUS);
        context.fill();
      }
      if (points.length > 0 || head || ripples.length > 0 || hold)
        frame = requestAnimationFrame(draw);
    };

    const off = window.chord.pointer.onUpdate(({ cursor, down, laser, clicks }) => {
      const now = performance.now();
      head = laser ? cursor : null;
      // A gap in the trail when the cursor leaves this display, rather than a line across it.
      if (head) points.push({ ...head, at: now });
      else points = [];

      const pressed = clicks && down && cursor !== null;
      if (pressed && !wasDown) {
        ripples.push({ ...cursor, at: now });
        hold = { ...cursor, since: now };
      } else if (pressed && hold) {
        hold = { ...hold, ...cursor, released: undefined };
      } else if (hold && hold.released === undefined) {
        hold.released = now;
      }
      wasDown = down && clicks;
      if (!frame) frame = requestAnimationFrame(draw);
    });
    const offShortcut = window.chord.pointer.onShortcut((press) => {
      shortcuts = [...shortcuts, press].slice(-SHORTCUT_LIMIT);
      setTimeout(() => {
        shortcuts = shortcuts.filter((shown) => shown.id !== press.id);
      }, SHORTCUT_TIME);
    });
    window.addEventListener("resize", resize);
    return () => {
      off();
      offShortcut();
      window.removeEventListener("resize", resize);
      cancelAnimationFrame(frame);
    };
  });
</script>

<canvas bind:this={canvas} class="pointer-events-none fixed inset-0 h-screen w-screen"></canvas>

<div class="pointer-events-none fixed inset-x-0 bottom-16 flex flex-col items-center gap-2">
  {#each shortcuts as press, i (press.id)}
    <div
      class="flex items-center gap-1.5 rounded-2xl bg-black/50 px-4 py-2.5 shadow-lg ring-1 ring-white/10 backdrop-blur-xl transition-opacity duration-300"
      style:opacity={i === shortcuts.length - 1 ? 1 : 0.55}
      in:fly={{ y: 28, duration: 320, easing: cubicOut }}
      out:fade={{ duration: 260 }}
      animate:flip={{ duration: 260, easing: cubicOut }}
    >
      {#each press.parts as part, k}
        <kbd
          class="flex min-w-9 items-center justify-center rounded-lg bg-white/15 px-2.5 py-1 font-sans text-2xl font-medium text-white shadow-[inset_0_-2px_0_rgb(255_255_255/0.12)]"
          in:pop={{ delay: k * 45 }}>{part}</kbd
        >
      {/each}
    </div>
  {/each}
</div>
