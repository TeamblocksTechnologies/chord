<script lang="ts" module>
  // 24×24 icons in the style of Lucide; the record symbol is filled.
  export const paths = {
    arrowLeft: "M19 12H5M12 19l-7-7 7-7",
    arrowRight: "M5 12h14M12 5l7 7-7 7",
    monitor:
      "M3 4h18a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1zM8 21h8M12 17v4",
    monitorOff:
      "M2 2l20 20M7 4h14a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1h-1M14 17H3a1 1 0 0 1-1-1V7M8 21h8M12 17v4",
    area: "M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2M8 9h8v6H8z",
    areaOff: "M2 2l20 20M17 3h2a2 2 0 0 1 2 2v2M7 21H5a2 2 0 0 1-2-2v-2M13 9h3v2M11 15H8v-3",
    window:
      "M4 4h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2zM2 9h20M6 6.5h.01M9 6.5h.01",
    windowOff: "M2 2l20 20M7 4h13a2 2 0 0 1 2 2v11M16 20H4a2 2 0 0 1-2-2V7M2 9h3M13 9h9M9 6.5h.01",
    pin: "M12 17v5M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z",
    mic: "M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3zM19 10v2a7 7 0 0 1-14 0v-2M12 19v3",
    micOff:
      "M2 2l20 20M18.89 13.23A7 7 0 0 0 19 12v-2M5 10v2a7 7 0 0 0 12 5M15 9.34V5a3 3 0 0 0-5.68-1.33M9 9v3a3 3 0 0 0 5.12 2.12M12 19v3",
    camera:
      "M16 13l5.22 3.48a.5.5 0 0 0 .78-.42V7.94a.5.5 0 0 0-.76-.43L16 10.5M4 6h10a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2z",
    cameraOff:
      "M2 2l20 20M10.66 6H14a2 2 0 0 1 2 2v2.5l5.25-3.5a.5.5 0 0 1 .75.43v8.14M16 16a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h2",
    speaker: "M11 5L6 9H2v6h4l5 4zM15.54 8.46a5 5 0 0 1 0 7.07M19.07 4.93a10 10 0 0 1 0 14.14",
    speakerOff: "M11 5L6 9H2v6h4l5 4zM22 9l-6 6M16 9l6 6",
    speakerLow: "M11 5L6 9H2v6h4l5 4zM15.54 8.46a5 5 0 0 1 0 7.07",
    chevronDown: "M6 9l6 6 6-6",
    chevronRight: "M9 18l6-6-6-6",
    chevronLeft: "M15 18l-6-6 6-6",
    chevronUp: "M18 15l-6-6-6 6",
    check: "M20 6L9 17l-5-5",
    plus: "M12 5v14M5 12h14",
    minus: "M5 12h14",
    x: "M18 6L6 18M6 6l12 12",
    search: "M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM21 21l-4.35-4.35",
    record: "M12 19a7 7 0 1 0 0-14 7 7 0 0 0 0 14z",
    pause: "M6 4h4v16H6zM14 4h4v16h-4z",
    play: "M6 3l14 9-14 9z",
    expand:
      "M8 3H5a2 2 0 0 0-2 2v3M21 8V5a2 2 0 0 0-2-2h-3M3 16v3a2 2 0 0 0 2 2h3M16 21h3a2 2 0 0 0 2-2v-3",
    collapse:
      "M8 3v3a2 2 0 0 1-2 2H3M21 8h-3a2 2 0 0 1-2-2V3M3 16h3a2 2 0 0 1 2 2v3M16 21v-3a2 2 0 0 1 2-2h3",
    bookmark: "M7 3h10a1 1 0 0 1 1 1v12.5l-6 4.5-6-4.5V4a1 1 0 0 1 1-1z",
    trash:
      "M3 6h18M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6M10 11v6M14 11v6M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2",
    notes:
      "M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6M16 13H8M16 17H8M10 9H8",
    panelLeft: "M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2zM9 3v18",
    panelRight: "M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2zM15 3v18",
    captions:
      "M5 5h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2zM7 15h4M15 15h2M7 11h2M13 11h4",
    corner: "M5 19v-8a6 6 0 0 1 6-6h8",
    corners:
      "M4 9V7a3 3 0 0 1 3-3h2M15 4h2a3 3 0 0 1 3 3v2M20 15v2a3 3 0 0 1-3 3h-2M9 20H7a3 3 0 0 1-3-3v-2",
    sliders: "M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6",
    photo:
      "M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3zM15 13a3 3 0 1 1-6 0 3 3 0 0 1 6 0z",
    image:
      "M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2zM9.5 8.5a1 1 0 1 1-2 0 1 1 0 0 1 2 0zM21 15l-3.09-3.09a2 2 0 0 0-2.82 0L6 21",
    folder: "M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z",
    laser: "M4 20l7-7M13.5 6.5l4 4M9 11l4 4M15 3v3M21 9h-3M19.5 4.5L18 6M7 5L5.5 3.5M5 9H3",
    click:
      "M9 9l5 12 1.774-5.226L21 14zM16.071 16.071l4.243 4.243M7.188 2.239l.777 2.897M5.136 7.965l-2.898-.777M13.95 4.05l-2.122 2.122M5.171 11.828l-2.12 2.122",
    keyboard:
      "M4 5h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2zM6 9h.01M10 9h.01M14 9h.01M18 9h.01M7 15h10",
    cursor: "M3 3l7.07 16.97 2.51-7.39 7.39-2.51z",
    eyeOff:
      "M9.88 9.88a3 3 0 1 0 4.24 4.24M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68M6.61 6.61A13.53 13.53 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61M2 2l20 20",
    filter: "M22 3H2l8 9.46V19l4 2v-8.54z",
    apps: "M3 3h7v7H3zM14 3h7v7h-7zM14 14h7v7h-7zM3 14h7v7H3z",
    list: "M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01",
    timer: "M10 2h4M12 14l3-3M12 22a8 8 0 1 0 0-16 8 8 0 0 0 0 16z",
    film: "M3 3h18v18H3zM7 3v18M17 3v18M3 12h18M3 7.5h4M3 16.5h4M17 7.5h4M17 16.5h4",
    scissors:
      "M6 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM6 21a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM8.12 8.12L12 12M20 4L8.12 15.88M14.8 14.8L20 20",
    pencil: "M17 3a2.85 2.85 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5zM15 5l4 4",
    undo: "M3 7v6h6M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13",
    magnet:
      "M6 15l-4-4 6.75-6.77a7.79 7.79 0 0 1 11 11L13 22l-4-4 6.39-6.36a2.12 2.12 0 0 0-3-3L6 15M5 8l4 4M12 15l4 4",
    more: "M12 13a1 1 0 1 0 0-2 1 1 0 0 0 0 2zM19 13a1 1 0 1 0 0-2 1 1 0 0 0 0 2zM5 13a1 1 0 1 0 0-2 1 1 0 0 0 0 2z",
    user: "M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z",
    refresh:
      "M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8M3 3v5h5M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16M16 16h5v5",
    download: "M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3",
    restart: "M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5",
    settings:
      "M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z",
  } as const;

  export type IconName = keyof typeof paths;
</script>

<script lang="ts">
  let {
    name,
    class: className = "size-4",
    strokeWidth = 1.75,
  }: { name: IconName; class?: string; strokeWidth?: number } = $props();
</script>

<svg
  class={className}
  viewBox="0 0 24 24"
  fill={name === "record" ? "currentColor" : "none"}
  stroke={name === "record" ? "none" : "currentColor"}
  stroke-width={strokeWidth}
  stroke-linecap="round"
  stroke-linejoin="round"
  aria-hidden="true"
>
  <path d={paths[name]} />
</svg>
