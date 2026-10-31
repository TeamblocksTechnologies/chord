import { sourceSlashMotion } from "./sourceSlashMotion.ts";

export type ScreenIconName = "monitor" | "window" | "area";
export type ScreenIconState = { name: ScreenIconName; on: boolean };
type ScreenShape = ScreenIconName | "monitorOff" | "windowOff" | "areaOff";

export const isScreenIcon = (name: string): name is ScreenIconName =>
  name === "monitor" || name === "window" || name === "area";

export const screenShape = ({ name, on }: ScreenIconState): ScreenShape =>
  on ? name : `${name}Off`;

// Corresponding strokes: five frame pieces, two header/selection edges, selection bottom or stand,
// upright, and two window dots. Empty strokes fold into the centre as they disappear.
const strokes: Record<ScreenShape, readonly string[]> = {
  monitor: [
    "M2 10.5V5a1 1 0 0 1 1-1h4",
    "M7 4h5",
    "M12 4h9a1 1 0 0 1 1 1v5.5",
    "M22 10.5V16a1 1 0 0 1-1 1h-9",
    "M12 17H3a1 1 0 0 1-1-1v-5.5",
    "",
    "",
    "M16 21H8",
    "M12 17v4",
    "",
    "",
  ],
  monitorOff: [
    "M2 10.5V7",
    "M7 4h5",
    "M12 4h9a1 1 0 0 1 1 1v5.5",
    "M22 10.5V16a1 1 0 0 1-1 1h-1",
    "M14 17H3a1 1 0 0 1-1-1v-5.5",
    "",
    "",
    "M16 21H8",
    "M12 17v4",
    "",
    "",
  ],
  window: [
    "M2 12V6a2 2 0 0 1 2-2h3",
    "M7 4h5",
    "M12 4h8a2 2 0 0 1 2 2v6",
    "M22 12v6a2 2 0 0 1-2 2h-8",
    "M12 20H4a2 2 0 0 1-2-2v-6",
    "M2 9h9",
    "M11 9h11",
    "",
    "",
    "M6 6.5h.01",
    "M9 6.5h.01",
  ],
  windowOff: [
    "M2 12V7",
    "M7 4h5",
    "M12 4h8a2 2 0 0 1 2 2v6",
    "M22 12v5",
    "M16 20H4a2 2 0 0 1-2-2v-6",
    "M2 9h3",
    "M13 9h9",
    "",
    "",
    "",
    "M9 6.5h.01",
  ],
  area: [
    "M3 7V5a2 2 0 0 1 2-2",
    "M5 3h2",
    "M17 3h2a2 2 0 0 1 2 2v2",
    "M21 17v2a2 2 0 0 1-2 2h-2",
    "M7 21H5a2 2 0 0 1-2-2v-2",
    "M8 12V9h4",
    "M12 9h4v3",
    "M16 12v3H8v-3",
    "",
    "",
    "",
  ],
  areaOff: [
    "",
    "",
    "M17 3h2a2 2 0 0 1 2 2v2",
    "",
    "M7 21H5a2 2 0 0 1-2-2v-2",
    "",
    "M13 9h3v2",
    "M11 15H8v-3",
    "",
    "",
    "",
  ],
};

const SVG_NS = "http://www.w3.org/2000/svg";
const POINTS = 32;
type Stroke = { points: number[]; opacity: number };
type Geometry = { strokes: Stroke[] };

export function screenIconMotion(node: SVGSVGElement) {
  const rest = node.querySelector("path")!;
  const cache = new Map<ScreenShape, Stroke[]>();
  let current: Geometry | undefined;
  let frame = 0;
  let layer: SVGGElement | undefined;
  let elements: SVGPathElement[] = [];
  let slashMotion: ReturnType<typeof sourceSlashMotion> | undefined;
  let scale: Animation | undefined;

  function geometry(state: ScreenIconState): Geometry {
    const shape = screenShape(state);
    if (!cache.has(shape)) {
      const probe = document.createElementNS(SVG_NS, "path");
      cache.set(
        shape,
        strokes[shape].map((d) => {
          probe.setAttribute("d", d || "M12 12h0");
          const length = probe.getTotalLength();
          return {
            opacity: d ? 1 : 0,
            points: Array.from({ length: POINTS }, (_, i) => {
              const p = probe.getPointAtLength((length * i) / (POINTS - 1));
              return [p.x, p.y];
            }).flat(),
          };
        }),
      );
    }
    return { strokes: cache.get(shape)! };
  }

  function paint(value: Geometry) {
    value.strokes.forEach((stroke, i) => {
      elements[i].setAttribute(
        "d",
        stroke.points
          .map((p, j) => `${j === 0 ? "M" : j % 2 === 0 ? "L" : ","}${p.toFixed(3)}`)
          .join(""),
      );
      elements[i].setAttribute("opacity", String(Math.max(0, Math.min(1, stroke.opacity))));
    });
  }

  function stop() {
    cancelAnimationFrame(frame);
    scale?.cancel();
    slashMotion?.destroy();
    slashMotion = undefined;
    layer?.remove();
    layer = undefined;
    current = undefined;
    rest.removeAttribute("visibility");
  }

  return {
    stop,
    transition(from: ScreenIconState, to: ScreenIconState) {
      const start = current ?? geometry(from);
      const end = geometry(to);
      const transform = getComputedStyle(node).transform;
      cancelAnimationFrame(frame);
      scale?.cancel();
      if (!layer) {
        layer = document.createElementNS(SVG_NS, "g");
        elements = end.strokes.map(() => {
          const path = document.createElementNS(SVG_NS, "path");
          layer!.append(path);
          return path;
        });
        const slash = document.createElementNS(SVG_NS, "path");
        slash.setAttribute("d", "M2 2l20 20");
        slash.setAttribute("pathLength", "1");
        slashMotion = sourceSlashMotion(slash, from.on);
        layer.append(slash);
        node.append(layer);
      }
      rest.setAttribute("visibility", "hidden");
      current = start;
      paint(start);
      slashMotion!.update(to.on);
      const duration = to.on || from.name !== to.name ? 300 : 240;
      scale = node.animate(
        [
          { transform, offset: 0, easing: "ease-out" },
          { transform: `scale(${to.on ? 0.94 : 0.97})`, offset: 0.18, easing: "ease-out" },
          { transform: "scale(1.025)", offset: 0.58, easing: "ease-in-out" },
          { transform: "scale(1)", offset: 1 },
        ],
        { duration },
      );
      const began = performance.now();
      function tick(now: number) {
        const t = Math.min(1, (now - began) / duration);
        // Fast response with a small, damped overshoot. Interrupted morphs start at the last painted frame.
        const eased = 1 + 1.65 * (t - 1) ** 3 + 0.65 * (t - 1) ** 2;
        const mix = (a: number, b: number) => a + (b - a) * eased;
        current = {
          strokes: start.strokes.map((stroke, i) => ({
            points: stroke.points.map((point, j) => mix(point, end.strokes[i].points[j])),
            opacity: mix(stroke.opacity, end.strokes[i].opacity),
          })),
        };
        paint(current);
        if (t < 1) frame = requestAnimationFrame(tick);
        else stop();
      }
      frame = requestAnimationFrame(tick);
    },
  };
}
