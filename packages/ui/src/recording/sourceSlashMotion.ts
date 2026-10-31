// Every source uses the same quick draw/retract, independent of its body morph or scale settle.
export function sourceSlashMotion(node: SVGPathElement, initial: boolean) {
  let previous = initial;
  let animations: Animation[] = [];
  const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
  const stop = () => {
    animations.forEach((animation) => animation.cancel());
    animations = [];
  };
  const setRest = (on: boolean) => {
    node.style.strokeDashoffset = on ? "1" : "0";
    node.style.opacity = on ? "0" : "1";
  };

  node.style.strokeDasharray = "1";
  setRest(initial);
  reducedMotion.addEventListener("change", stop);

  return {
    update(on: boolean) {
      if (on === previous) return;
      previous = on;
      const { strokeDashoffset, opacity } = getComputedStyle(node);
      stop();
      setRest(on);
      if (reducedMotion.matches) return;
      animations = [
        node.animate([{ strokeDashoffset }, { strokeDashoffset: node.style.strokeDashoffset }], {
          duration: 180,
          easing: "cubic-bezier(0.2, 0.8, 0.2, 1)",
        }),
        node.animate([{ opacity }, { opacity: node.style.opacity }], {
          duration: 100,
          easing: "ease-out",
        }),
      ];
    },
    destroy() {
      stop();
      reducedMotion.removeEventListener("change", stop);
    },
  };
}
