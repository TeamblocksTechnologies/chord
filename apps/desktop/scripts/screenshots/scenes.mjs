// Nondescript desktop scenes for README screenshots, in Chord's palette: neutral darks with a blue accent.
export const DISPLAY = { width: 1728, height: 1116 };
export const CAMERA = { width: 1280, height: 720 };

const C = {
  bg: "#0e0f12",
  panel: "#16181d",
  panel2: "#1c1f26",
  line: "#262a33",
  text: "#e8eaef",
  muted: "#8a909e",
  faint: "#5b6170",
  blue: "#2563eb",
  blue2: "#3b82f6",
  sky: "#38bdf8",
  violet: "#8b5cf6",
  teal: "#14b8a6",
  amber: "#f59e0b",
  rose: "#f43f5e",
  green: "#22c55e",
};

// Deterministic noise so every render is the same.
function rng(seed) {
  let s = seed >>> 0;
  return () => (s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32;
}

const base = `
* { box-sizing: border-box; margin: 0; padding: 0; }
html, body { width: 100%; height: 100%; overflow: hidden; }
body { font-family: -apple-system, "SF Pro Text", system-ui, sans-serif; color: ${C.text}; -webkit-font-smoothing: antialiased; }
.row { display: flex; align-items: center; }
.col { display: flex; flex-direction: column; }
.muted { color: ${C.muted}; }
.faint { color: ${C.faint}; }
.pill { display: inline-flex; align-items: center; gap: 8px; padding: 6px 12px; border-radius: 999px; background: ${C.panel2}; border: 1px solid ${C.line}; font-size: 14px; color: ${C.muted}; }
.btn { display: inline-flex; align-items: center; justify-content: center; height: 36px; padding: 0 16px; border-radius: 9px; font-size: 14px; font-weight: 600; background: ${C.panel2}; border: 1px solid ${C.line}; color: ${C.text}; }
.btn.primary { background: ${C.blue}; border-color: ${C.blue}; color: white; }
.card { background: ${C.panel}; border: 1px solid ${C.line}; border-radius: 14px; }
.bar { height: 10px; border-radius: 5px; background: ${C.line}; }
`;

function wallpaper() {
  return `
  <div style="position:absolute;inset:0;background:#07080b;overflow:hidden">
    <div style="position:absolute;width:1400px;height:1400px;left:-300px;top:-500px;border-radius:50%;background:radial-gradient(circle, rgba(37,99,235,.55), transparent 60%)"></div>
    <div style="position:absolute;width:1300px;height:1300px;right:-400px;bottom:-600px;border-radius:50%;background:radial-gradient(circle, rgba(139,92,246,.45), transparent 60%)"></div>
    <div style="position:absolute;width:900px;height:900px;left:700px;top:300px;border-radius:50%;background:radial-gradient(circle, rgba(20,184,166,.18), transparent 60%)"></div>
  </div>`;
}

function menuBar(app) {
  const items = ["File", "Edit", "View", "Window", "Help"];
  return `
  <div class="row" style="position:absolute;left:0;right:0;top:0;height:34px;padding:0 18px;gap:22px;background:rgba(10,11,14,.55);backdrop-filter:blur(20px);font-size:14px;color:#f1f2f5">
    <div style="width:16px;height:16px;border-radius:5px;background:linear-gradient(135deg,${C.blue2},${C.violet})"></div>
    <b style="font-weight:700">${app}</b>
    ${items.map((i) => `<span style="opacity:.9">${i}</span>`).join("")}
    <div style="flex:1"></div>
    <div style="width:22px;height:11px;border:1.5px solid #f1f2f5;border-radius:3px;position:relative"><div style="position:absolute;inset:1.5px;right:5px;background:#f1f2f5;border-radius:1px"></div></div>
    <span>Tue 10:24</span>
  </div>`;
}

function appWindow(title, content, { x = 150, y = 74, width = 1428, height = 990 } = {}) {
  return `
  <div class="col" style="position:absolute;left:${x}px;top:${y}px;width:${width}px;height:${height}px;border-radius:14px;overflow:hidden;background:${C.bg};border:1px solid rgba(255,255,255,.1);box-shadow:0 40px 120px rgba(0,0,0,.6),0 0 0 .5px rgba(0,0,0,.8)">
    <div class="row" style="height:48px;flex:none;padding:0 18px;gap:9px;border-bottom:1px solid ${C.line};background:${C.panel}">
      <i style="width:13px;height:13px;border-radius:50%;background:#ff5f57"></i>
      <i style="width:13px;height:13px;border-radius:50%;background:#febc2e"></i>
      <i style="width:13px;height:13px;border-radius:50%;background:#28c840"></i>
      <div style="flex:1;text-align:center;font-size:14px;font-weight:600;color:${C.muted};margin-right:60px">${title}</div>
    </div>
    <div style="flex:1;position:relative;overflow:hidden">${content}</div>
  </div>`;
}

function desktop(app, title, content, frame) {
  return `<style>${base}</style>${wallpaper()}${menuBar(app)}${appWindow(title, content, frame)}`;
}

function sidebar(items, active, header) {
  return `
  <div class="col" style="width:240px;flex:none;height:100%;padding:20px 14px;gap:4px;background:${C.panel};border-right:1px solid ${C.line}">
    <div class="row" style="gap:10px;padding:4px 10px 18px">
      <div style="width:26px;height:26px;border-radius:8px;background:linear-gradient(135deg,${C.blue2},${C.violet})"></div>
      <b style="font-size:15px">${header}</b>
    </div>
    ${items
      .map(
        (item, i) => `
      <div class="row" style="gap:12px;height:38px;padding:0 12px;border-radius:9px;font-size:14.5px;${i === active ? `background:rgba(37,99,235,.18);color:${C.text}` : `color:${C.muted}`}">
        <i style="width:16px;height:16px;border-radius:5px;border:2px solid ${i === active ? C.blue2 : C.faint}"></i>${item}
      </div>`,
      )
      .join("")}
  </div>`;
}

function areaChart(seed, width, height, color, points = 28) {
  const r = rng(seed);
  let v = 0.45;
  const ys = [];
  for (let i = 0; i < points; i++) {
    v = Math.min(0.92, Math.max(0.15, v + (r() - 0.42) * 0.14));
    ys.push(v);
  }
  const step = width / (points - 1);
  const path = ys
    .map((y, i) => `${i ? "L" : "M"}${(i * step).toFixed(1)},${(height - y * height).toFixed(1)}`)
    .join(" ");
  const grid = [0.25, 0.5, 0.75]
    .map(
      (g) =>
        `<line x1="0" x2="${width}" y1="${height * g}" y2="${height * g}" stroke="${C.line}" stroke-dasharray="4 6"/>`,
    )
    .join("");
  return `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" style="display:block;overflow:visible">
    <defs><linearGradient id="g${seed}" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="${color}" stop-opacity=".35"/><stop offset="1" stop-color="${color}" stop-opacity="0"/></linearGradient></defs>
    ${grid}
    <path d="${path} L${width},${height} L0,${height} Z" fill="url(#g${seed})"/>
    <path d="${path}" fill="none" stroke="${color}" stroke-width="3" stroke-linejoin="round"/>
  </svg>`;
}

// 1. An analytics dashboard.
function dashboard(v) {
  const kpis = [
    ["Active users", ["12,480", "12,912", "13,306"][v], "+4.2%"],
    ["Sessions", ["48.2k", "49.7k", "51.3k"][v], "+3.1%"],
    ["Conversion", ["3.8%", "3.9%", "4.1%"][v], "+0.3%"],
    ["Avg. duration", ["4m 12s", "4m 20s", "4m 31s"][v], "+6.0%"],
  ];
  const channels = [
    ["Direct", 0.82, C.blue2],
    ["Search", 0.64, C.violet],
    ["Referral", 0.41, C.teal],
    ["Social", 0.28, C.amber],
    ["Email", 0.19, C.sky],
  ];
  const rows = [
    ["Workspace created", "2 min ago", "Completed", C.green],
    ["Report exported", "14 min ago", "Completed", C.green],
    ["Invite sent", "32 min ago", "Pending", C.amber],
    ["Plan upgraded", "1 hr ago", "Completed", C.green],
    ["Sync started", "2 hr ago", "Running", C.blue2],
  ];
  const content = `
  <div class="row" style="height:100%;align-items:stretch">
    ${sidebar(["Overview", "Reports", "Audiences", "Events", "Settings"], 0, "Insights")}
    <div class="col" style="flex:1;padding:30px 36px;gap:24px">
      <div class="row" style="gap:12px">
        <div class="col" style="gap:4px;flex:1"><b style="font-size:26px">Overview</b><span class="muted" style="font-size:14px">All workspaces</span></div>
        <span class="pill">Last 30 days</span><span class="btn primary">Share</span>
      </div>
      <div class="row" style="gap:16px">
        ${kpis
          .map(
            ([label, value, delta]) => `
          <div class="card col" style="flex:1;padding:18px 20px;gap:10px">
            <span class="muted" style="font-size:13.5px">${label}</span>
            <div class="row" style="gap:10px"><b style="font-size:28px;letter-spacing:-.5px">${value}</b><span style="font-size:13px;color:${C.green};background:rgba(34,197,94,.12);padding:3px 8px;border-radius:6px">${delta}</span></div>
          </div>`,
          )
          .join("")}
      </div>
      <div class="row" style="gap:16px;align-items:stretch">
        <div class="card col" style="flex:2;padding:20px 22px;gap:18px">
          <div class="row"><b style="flex:1;font-size:16px">Weekly active users</b><span class="pill" style="font-size:13px">Daily</span></div>
          ${areaChart(11 + v, 690, 250, C.blue2)}
        </div>
        <div class="card col" style="flex:1;padding:20px 22px;gap:18px">
          <b style="font-size:16px">Top channels</b>
          ${channels
            .map(
              ([name, share, color], i) => `
            <div class="col" style="gap:8px">
              <div class="row" style="font-size:14px"><span style="flex:1">${name}</span><span class="muted">${Math.round(share * (100 + v * 4 - i))}%</span></div>
              <div class="bar"><div class="bar" style="width:${share * 100}%;background:${color}"></div></div>
            </div>`,
            )
            .join("")}
        </div>
      </div>
      <div class="card col" style="padding:8px 22px">
        ${rows
          .map(
            ([event, time, status, color], i) => `
          <div class="row" style="height:46px;gap:14px;font-size:14px;${i ? `border-top:1px solid ${C.line}` : ""};${i === v + 1 ? "background:rgba(37,99,235,.08);margin:0 -22px;padding:0 22px" : ""}">
            <i style="width:28px;height:28px;border-radius:8px;background:${C.panel2};border:1px solid ${C.line}"></i>
            <span style="flex:1">${event}</span><span class="muted" style="width:120px">${time}</span>
            <span style="width:110px;color:${color}">● ${status}</span>
          </div>`,
          )
          .join("")}
      </div>
    </div>
  </div>`;
  return desktop("Insights", "Insights", content);
}

// 2. An onboarding form, a step at a time.
function onboarding(v) {
  const steps = ["Workspace", "Team", "Preferences"];
  const fields = [
    [
      ["Workspace name", "Northwind Studio"],
      ["Workspace URL", "northwind.example.com"],
      ["Region", "North America"],
    ],
    [
      ["Invite by email", "alex@example.com, sam@example.com"],
      ["Default role", "Editor"],
      ["Team name", "Product"],
    ],
    [
      ["Theme", "Dark"],
      ["Weekly summary", "Mondays at 9:00"],
      ["Time zone", "UTC−05:00"],
    ],
  ][v];
  const content = `
  <div class="col" style="height:100%;align-items:center;justify-content:center;background:radial-gradient(ellipse at top, rgba(37,99,235,.18), transparent 60%)">
    <div class="row" style="gap:10px;margin-bottom:34px">
      ${steps
        .map(
          (s, i) => `
        <div class="row" style="gap:10px;font-size:14px;${i <= v ? "" : `color:${C.faint}`}">
          <span class="row" style="justify-content:center;width:28px;height:28px;border-radius:50%;font-weight:700;font-size:13px;${i < v ? `background:${C.blue};color:white` : i === v ? `border:2px solid ${C.blue2};color:${C.blue2}` : `border:2px solid ${C.line}`}">${i < v ? "✓" : i + 1}</span>${s}
        </div>${i < 2 ? `<div style="width:60px;height:2px;background:${i < v ? C.blue : C.line}"></div>` : ""}`,
        )
        .join("")}
    </div>
    <div class="card col" style="width:620px;padding:40px;gap:22px;box-shadow:0 30px 80px rgba(0,0,0,.4)">
      <div class="col" style="gap:8px"><b style="font-size:28px">${["Create your workspace", "Invite your team", "Make it yours"][v]}</b>
      <span class="muted" style="font-size:15px">${["You can change these later in settings.", "Collaborators get an email with a link to join.", "Pick the defaults that suit how you work."][v]}</span></div>
      ${fields
        .map(
          ([label, value], i) => `
        <div class="col" style="gap:8px">
          <span style="font-size:14px;font-weight:600">${label}</span>
          <div class="row" style="height:46px;padding:0 14px;border-radius:10px;background:${C.bg};border:1px solid ${i === 0 ? C.blue2 : C.line};${i === 0 ? "box-shadow:0 0 0 4px rgba(59,130,246,.18)" : ""};font-size:15px">${value}</div>
        </div>`,
        )
        .join("")}
      <div class="row" style="gap:12px;margin-top:6px"><span class="btn">Back</span><div style="flex:1"></div><span class="btn primary" style="padding:0 22px">Continue</span></div>
    </div>
  </div>`;
  return desktop("Setup", "Get started", content, { x: 240, y: 90, width: 1248, height: 960 });
}

// 3. A slide deck.
function slides(v) {
  const slide = [
    `<div class="col" style="height:100%;justify-content:center;padding:70px;gap:20px;background:linear-gradient(135deg,#0b1430,#1a1240)">
       <span style="color:${C.sky};font-size:20px;font-weight:600">Weekly update</span>
       <b style="font-size:64px;letter-spacing:-1.5px;line-height:1.05">What shipped<br>this week</b>
       <span class="muted" style="font-size:22px">Highlights, metrics and next steps</span></div>`,
    `<div class="col" style="height:100%;padding:60px 70px;gap:30px;background:#0d1020">
       <b style="font-size:40px">Progress by area</b>
       <div class="row" style="flex:1;align-items:flex-end;gap:36px;padding-bottom:10px">
         ${[0.55, 0.8, 0.42, 0.68, 0.9]
           .map(
             (h, i) =>
               `<div class="col" style="flex:1;align-items:center;gap:12px"><div style="width:100%;height:${h * 300}px;border-radius:10px 10px 4px 4px;background:${[C.blue2, C.violet, C.teal, C.sky, C.blue][i]}"></div><span class="muted" style="font-size:18px">${["Core", "Mobile", "Docs", "Infra", "Design"][i]}</span></div>`,
           )
           .join("")}
       </div></div>`,
    `<div class="col" style="height:100%;padding:60px 70px;gap:28px;background:#0d1020">
       <b style="font-size:40px">Next steps</b>
       ${[
         "Finish the new settings page",
         "Review onboarding feedback",
         "Plan the next release",
         "Share the summary with the team",
       ]
         .map(
           (t, i) =>
             `<div class="row" style="gap:18px;font-size:26px"><span class="row" style="justify-content:center;width:40px;height:40px;border-radius:12px;background:rgba(59,130,246,.2);color:${C.sky};font-size:20px;font-weight:700">${i + 1}</span>${t}</div>`,
         )
         .join("")}</div>`,
  ];
  const content = `
  <div class="row" style="height:100%;align-items:stretch">
    <div class="col" style="width:230px;flex:none;padding:20px;gap:16px;background:${C.panel};border-right:1px solid ${C.line}">
      ${[0, 1, 2, 3]
        .map(
          (
            i,
          ) => `<div class="row" style="gap:10px;align-items:flex-start"><span class="faint" style="font-size:12px;width:14px">${i + 1}</span>
          <div style="flex:1;aspect-ratio:16/9;border-radius:8px;border:2px solid ${i === v ? C.blue2 : C.line};background:${i === 0 ? "linear-gradient(135deg,#0b1430,#1a1240)" : "#0d1020"};padding:10px" class="col"><i style="width:70%;height:7px;border-radius:3px;background:rgba(255,255,255,.5)"></i><i style="width:45%;height:5px;border-radius:3px;background:rgba(255,255,255,.2);margin-top:6px"></i></div></div>`,
        )
        .join("")}
    </div>
    <div class="col" style="flex:1;padding:40px;gap:20px;align-items:center;justify-content:center;background:${C.bg}">
      <div style="width:1040px;aspect-ratio:16/9;border-radius:12px;overflow:hidden;box-shadow:0 30px 80px rgba(0,0,0,.5);border:1px solid ${C.line}">${slide[v]}</div>
      <div class="row" style="gap:10px"><span class="pill">Slide ${v + 1} of 4</span><span class="pill">Notes</span></div>
    </div>
  </div>`;
  return desktop("Slides", "Weekly update", content);
}

// 4. A design canvas.
function canvas(v) {
  const frames = [
    [120, 120, "Home"],
    [520, 120, "Detail"],
    [920, 120, "Settings"],
  ];
  const block = (x, y, w, h, color = C.line) =>
    `<div style="position:absolute;left:${x}px;top:${y}px;width:${w}px;height:${h}px;border-radius:8px;background:${color}"></div>`;
  const content = `
  <div style="position:absolute;inset:0;background-color:#111317;background-image:radial-gradient(${C.line} 1.2px, transparent 1.2px);background-size:22px 22px"></div>
  <div class="col" style="position:absolute;left:0;top:0;bottom:0;width:220px;padding:18px;gap:6px;background:${C.panel};border-right:1px solid ${C.line};font-size:14px">
    <b style="font-size:13px;margin-bottom:8px" class="muted">Layers</b>
    ${["Home", "Header", "Hero", "Cards", "Detail", "Settings"].map((l, i) => `<div style="padding:7px 10px;border-radius:7px;${i === v * 2 ? "background:rgba(37,99,235,.2)" : ""};padding-left:${i % 2 ? 26 : 10}px">${l}</div>`).join("")}
  </div>
  <div style="position:absolute;left:220px;right:0;top:0;bottom:0">
    ${frames
      .map(
        ([x, y, name], i) => `
      <span class="muted" style="position:absolute;left:${x}px;top:${y - 26}px;font-size:13px">${name}</span>
      <div style="position:absolute;left:${x}px;top:${y}px;width:340px;height:620px;border-radius:18px;background:${C.panel};${i === v ? `outline:2px solid ${C.blue2};outline-offset:4px` : `border:1px solid ${C.line}`}">
        ${block(20, 24, 120, 14)}${block(20, 60, 300, 170, i === 0 ? "linear-gradient(135deg,#1e3a8a,#5b21b6)" : C.panel2)}
        ${block(20, 250, 220, 14)}${block(20, 276, 280, 10)}${block(20, 296, 250, 10)}
        ${block(20, 330, 145, 120, C.panel2)}${block(175, 330, 145, 120, C.panel2)}
        ${block(20, 470, 300, 50, i === 2 ? C.panel2 : C.blue)}${block(20, 540, 300, 50, C.panel2)}
      </div>`,
      )
      .join("")}
    <div class="col" style="position:absolute;left:${frames[v][0] + 300}px;top:${frames[v][1] + 160}px;width:250px;padding:14px;gap:8px;border-radius:12px;background:${C.panel2};border:1px solid ${C.line};box-shadow:0 20px 50px rgba(0,0,0,.5);font-size:14px">
      <div class="row" style="gap:8px"><i style="width:22px;height:22px;border-radius:50%;background:${C.violet}"></i><b>Reviewer</b><span class="faint" style="font-size:12px">now</span></div>
      <span>${["Can the hero be a little shorter?", "Let's match the spacing to Home.", "Group these toggles by topic."][v]}</span>
    </div>
  </div>`;
  return desktop("Canvas", "App redesign", content);
}

// 5. A code editor with a terminal.
function code(v) {
  const k = (t) => `<span style="color:${C.violet}">${t}</span>`;
  const s = (t) => `<span style="color:#86efac">${t}</span>`;
  const f = (t) => `<span style="color:${C.sky}">${t}</span>`;
  const c = (t) => `<span style="color:${C.faint}">${t}</span>`;
  const lines = [
    `${k("import")} { formatDate } ${k("from")} ${s('"./format"')};`,
    ``,
    `${c("// Groups events by day for the activity list.")}`,
    `${k("export function")} ${f("groupByDay")}(events: Event[]) {`,
    `  ${k("const")} groups = ${k("new")} ${f("Map")}&lt;string, Event[]&gt;();`,
    `  ${k("for")} (${k("const")} event ${k("of")} events) {`,
    `    ${k("const")} day = ${f("formatDate")}(event.time);`,
    `    groups.${f("set")}(day, [...(groups.${f("get")}(day) ?? []), event]);`,
    `  }`,
    `  ${k("return")} [...groups].${f("map")}(([day, items]) =&gt; ({ day, items }));`,
    `}`,
    ``,
    `${k("export function")} ${f("summarize")}(groups: Group[]) {`,
    `  ${k("return")} groups.${f("map")}((g) =&gt; ${s("`${g.day}: ${g.items.length}`")});`,
    `}`,
  ];
  const term = [
    [`$ npm test`, `> running 24 tests`, `✗ groupByDay keeps events in order`],
    [
      `$ npm test`,
      `> running 24 tests`,
      `✓ groupByDay keeps events in order`,
      `✓ summarize counts each day`,
    ],
    [`$ npm test`, `> running 24 tests`, `✓ 24 passed (1.2s)`],
  ][v];
  const content = `
  <div class="row" style="height:100%;align-items:stretch;font-family:'SF Mono',ui-monospace,Menlo,monospace">
    <div class="col" style="width:250px;flex:none;padding:16px 10px;gap:2px;background:${C.panel};border-right:1px solid ${C.line};font-size:14px;font-family:-apple-system,system-ui">
      <b class="muted" style="font-size:12px;padding:0 10px 10px">Explorer</b>
      ${["src", "  activity.ts", "  format.ts", "  index.ts", "test", "  activity.test.ts", "package.json", "README.md"].map((n, i) => `<div style="padding:6px 10px;border-radius:6px;white-space:pre;${i === 1 ? "background:rgba(37,99,235,.2)" : `color:${C.muted}`}">${n}</div>`).join("")}
    </div>
    <div class="col" style="flex:1;min-width:0">
      <div class="row" style="height:42px;flex:none;border-bottom:1px solid ${C.line};font-size:13.5px;font-family:-apple-system,system-ui">
        ${["activity.ts", "format.ts", "activity.test.ts"].map((t, i) => `<div class="row" style="height:100%;padding:0 18px;${i === 0 ? `background:${C.bg};border-bottom:2px solid ${C.blue2}` : `color:${C.muted}`}">${t}</div>`).join("")}
      </div>
      <div style="flex:1;padding:18px 0;font-size:17px;line-height:30px;background:${C.bg}">
        ${lines.map((l, i) => `<div class="row" style="white-space:pre;${i === 7 - v ? "background:rgba(59,130,246,.1)" : ""}"><span class="faint" style="width:64px;text-align:right;padding-right:24px">${i + 1}</span>${l}</div>`).join("")}
      </div>
      <div class="col" style="height:250px;flex:none;border-top:1px solid ${C.line};background:${C.panel};padding:14px 22px;gap:6px;font-size:15px">
        <b class="muted" style="font-size:12px;font-family:-apple-system,system-ui;margin-bottom:6px">Terminal</b>
        ${term.map((t) => `<div style="color:${t.startsWith("✗") ? C.rose : t.startsWith("✓") ? C.green : t.startsWith("$") ? C.text : C.muted}">${t}</div>`).join("")}
      </div>
    </div>
  </div>`;
  return desktop("Editor", "activity.ts", content);
}

// 6. A planning board.
function board(v) {
  const tag = (t, color) =>
    `<span style="font-size:12px;padding:3px 8px;border-radius:6px;background:${color}22;color:${color}">${t}</span>`;
  const columns = [
    [
      "To do",
      [
        ["Update onboarding copy", "Content", C.violet],
        ["Add empty states", "Design", C.sky],
        ["Audit color contrast", "Design", C.sky],
      ],
    ],
    [
      "In progress",
      [
        ["Settings search", "Feature", C.blue2],
        ["Faster report export", "Performance", C.amber],
      ],
    ],
    [
      "Review",
      [
        ["Keyboard shortcuts", "Feature", C.blue2],
        ["Release notes draft", "Content", C.violet],
      ],
    ],
    [
      "Done",
      [
        ["Invite flow", "Feature", C.blue2],
        ["Usage dashboard", "Feature", C.blue2],
        ["Fix date grouping", "Bug", C.rose],
      ],
    ],
  ];
  if (v >= 1) columns[2][1].push(columns[1][1].shift());
  if (v >= 2) columns[3][1].unshift(columns[2][1].shift());
  const content = `
  <div class="col" style="height:100%;padding:28px 32px;gap:22px">
    <div class="row" style="gap:12px"><b style="font-size:26px;flex:1">Sprint 14</b><span class="pill">Board</span><span class="pill">Timeline</span><span class="btn primary">New task</span></div>
    <div class="row" style="flex:1;gap:18px;align-items:flex-start">
      ${columns
        .map(
          ([name, cards]) => `
        <div class="col" style="flex:1;gap:12px;padding:14px;border-radius:14px;background:${C.panel};border:1px solid ${C.line}">
          <div class="row" style="gap:8px;font-size:14.5px;font-weight:600;padding:2px 4px 6px">${name}<span class="faint">${cards.length}</span></div>
          ${cards
            .map(
              ([title, label, color]) => `
            <div class="col" style="gap:12px;padding:16px;border-radius:11px;background:${C.panel2};border:1px solid ${C.line}">
              <span style="font-size:15px;font-weight:500">${title}</span>
              <div class="row" style="gap:8px">${tag(label, color)}<div style="flex:1"></div><i style="width:24px;height:24px;border-radius:50%;background:linear-gradient(135deg,${color},${C.panel2})"></i></div>
            </div>`,
            )
            .join("")}
        </div>`,
        )
        .join("")}
    </div>
  </div>`;
  return desktop("Planner", "Sprint 14", content);
}

// 7. Developer documentation.
function docs(v) {
  const sections = [
    "Introduction",
    "Quickstart",
    "Authentication",
    "Requests",
    "Pagination",
    "Errors",
  ];
  const content = `
  <div class="row" style="height:100%;align-items:stretch">
    ${sidebar(sections, v + 1, "Docs")}
    <div class="col" style="flex:1;padding:44px 70px;gap:20px;max-width:980px">
      <span style="color:${C.sky};font-size:14px;font-weight:600">Getting started</span>
      <b style="font-size:38px;letter-spacing:-.5px">${sections[v + 1]}</b>
      <p class="muted" style="font-size:17px;line-height:1.6">${
        [
          "Make your first request in a few minutes. Create a key in your account settings, then send it with each request.",
          "Every request is authenticated with a key passed in a header. Keys can be rotated at any time without downtime.",
          "Requests and responses use JSON. Timestamps are in UTC and identifiers are stable strings.",
        ][v]
      }</p>
      <div class="card" style="padding:22px 26px;font-family:'SF Mono',ui-monospace,monospace;font-size:16px;line-height:28px;background:#0a0b0e">
        <div class="row" style="gap:8px;margin-bottom:12px;font-family:-apple-system,system-ui"><span class="pill" style="font-size:12px">Shell</span></div>
        <div><span style="color:${C.violet}">curl</span> https://api.example.com/v1/items \\</div>
        <div>&nbsp;&nbsp;-H <span style="color:#86efac">"Authorization: Bearer $API_KEY"</span></div>
      </div>
      <b style="font-size:22px;margin-top:10px">Response</b>
      <div class="card" style="padding:22px 26px;font-family:'SF Mono',ui-monospace,monospace;font-size:16px;line-height:28px;background:#0a0b0e;color:${C.muted}">
        { <span style="color:${C.sky}">"data"</span>: [ { <span style="color:${C.sky}">"id"</span>: <span style="color:#86efac">"item_01"</span>, <span style="color:${C.sky}">"name"</span>: <span style="color:#86efac">"Example"</span> } ],<br>&nbsp;&nbsp;<span style="color:${C.sky}">"has_more"</span>: <span style="color:${C.amber}">false</span> }
      </div>
    </div>
  </div>`;
  return desktop("Browser", "Developer docs", content);
}

// 8. A week calendar.
function calendar(v) {
  const days = ["Mon 20", "Tue 21", "Wed 22", "Thu 23", "Fri 24"];
  const events = [
    [0, 1, 1.5, "Planning", C.blue2],
    [0, 4, 1, "Design sync", C.violet],
    [1, 0.5, 1, "Standup", C.teal],
    [1, 2.5, 2, "Customer call", C.amber],
    [2, 1, 1, "Standup", C.teal],
    [2, 3, 1.5, "Review", C.blue2],
    [3, 0.5, 1, "Standup", C.teal],
    [3, 2, 2.5, "Focus time", C.sky],
    [4, 1, 1, "Demo", C.violet],
    [4, 3.5, 1, "Retro", C.blue2],
  ];
  const hour = 92;
  const content = `
  <div class="col" style="height:100%;padding:26px 30px;gap:18px">
    <div class="row" style="gap:12px"><b style="font-size:26px;flex:1">October</b><span class="pill">Today</span><span class="pill">Week</span><span class="btn primary">New event</span></div>
    <div class="row" style="padding-left:70px">${days.map((d, i) => `<div style="flex:1;font-size:14px;${i === v + 1 ? `color:${C.blue2};font-weight:700` : "color:" + C.muted}">${d}</div>`).join("")}</div>
    <div style="position:relative;flex:1;border-top:1px solid ${C.line}">
      ${[9, 10, 11, 12, 13, 14, 15, 16, 17]
        .map(
          (h, i) =>
            `<div class="row" style="position:absolute;left:0;right:0;top:${i * hour}px;height:1px;background:${C.line}"><span class="faint" style="position:absolute;left:0;top:6px;font-size:12px">${h}:00</span></div>`,
        )
        .join("")}
      <div style="position:absolute;left:70px;right:0;top:0;bottom:0" class="row">
        ${days
          .map(
            (
              _,
              d,
            ) => `<div style="flex:1;position:relative;height:100%;border-left:1px solid ${C.line}">
          ${events
            .filter((e) => e[0] === d)
            .map(
              ([, start, len, title, color]) =>
                `<div class="col" style="position:absolute;left:6px;right:6px;top:${start * hour + 4}px;height:${len * hour - 8}px;border-radius:10px;padding:10px 12px;gap:4px;background:${color}26;border-left:3px solid ${color};font-size:14px"><b style="font-weight:600">${title}</b><span class="muted" style="font-size:12.5px">${9 + Math.floor(start)}:${start % 1 ? "30" : "00"}</span></div>`,
            )
            .join("")}
        </div>`,
          )
          .join("")}
      </div>
      <div style="position:absolute;left:66px;right:0;top:${(1.7 + v * 0.6) * hour}px;height:2px;background:${C.rose}"></div>
    </div>
  </div>`;
  return desktop("Calendar", "Calendar", content);
}

export const SCENES = { dashboard, onboarding, slides, canvas, code, board, docs, calendar };

// A presenter on camera: a head-and-shoulders silhouette in front of a softly lit gradient, in the app's colors.
// `palette` picks the backdrop; `v` shifts the pose slightly so the camera feed moves over a take.
export const PRESENTER_PALETTES = [
  ["#1d4ed8", "#4c1d95"],
  ["#0f766e", "#1e3a8a"],
  ["#6d28d9", "#be185d"],
];

export function presenter(v, palette = 0) {
  const [from, to] = PRESENTER_PALETTES[palette];
  const dx = [0, 18, -12][v];
  const tilt = [-1.5, 1.2, 0][v];
  return `<style>${base}</style>
  <div style="position:absolute;inset:0;overflow:hidden;background:linear-gradient(135deg,${from},${to})">
    <div style="position:absolute;width:900px;height:900px;left:-260px;top:-420px;border-radius:50%;background:radial-gradient(circle,rgba(255,255,255,.28),transparent 62%)"></div>
    <div style="position:absolute;width:700px;height:700px;right:-240px;bottom:-360px;border-radius:50%;background:radial-gradient(circle,rgba(0,0,0,.35),transparent 65%)"></div>
    <div style="position:absolute;left:${640 - 260 + dx}px;top:0;width:520px;height:720px;transform:rotate(${tilt}deg);transform-origin:50% 100%">
      <div style="position:absolute;left:155px;top:140px;width:210px;height:210px;border-radius:50%;background:linear-gradient(180deg,rgba(255,255,255,.95),rgba(226,232,255,.85));box-shadow:0 20px 50px rgba(0,0,0,.25)"></div>
      <div style="position:absolute;left:40px;top:385px;width:440px;height:400px;border-radius:220px 220px 0 0 / 170px 170px 0 0;background:linear-gradient(180deg,rgba(255,255,255,.9),rgba(226,232,255,.75));box-shadow:0 -10px 50px rgba(0,0,0,.2)"></div>
    </div>
    <div style="position:absolute;inset:0;background:radial-gradient(ellipse at 50% 45%,transparent 60%,rgba(0,0,0,.3))"></div>
  </div>`;
}
