/**
 * Styles for the drawing itself. Kept as a string so the exact same look
 * is embedded into exported SVG / PNG files.
 */
export const CANVAS_CSS = `
.canvas { --ink:#e6f0ff; --ink-dim:#a9c4ea; --line:rgba(214,232,255,.5); --accent:#ffd166; --danger:#ff6b6b; --net:#7ad7ff; --infra:#ffc27a;
  font-family: ui-monospace,"SF Mono","JetBrains Mono","Cascadia Code",Menlo,Consolas,monospace; background:#0c3b6e; user-select:none; }
.canvas text { fill: var(--ink); }
.dimension line { stroke: var(--ink-dim); stroke-width: .8; }
.dimension text { font-size: 12px; fill: var(--ink-dim); letter-spacing: .08em; }
.room > rect:first-child { fill: rgba(140,190,255,.035); stroke: rgba(214,232,255,.45); stroke-width: 1; stroke-dasharray: 8 4; }
.room.selected > rect:first-child { stroke: var(--accent); stroke-dasharray: none; stroke-width: 1.6; }
.room.broken > rect:first-child { stroke: rgba(255,120,120,.75); fill: rgba(255,90,90,.05); }
.room-tag { fill: #0c3b6e; stroke: rgba(214,232,255,.45); stroke-width: .8; }
.room-label { cursor: pointer; }
.room-label text { font-size: 11px; letter-spacing: .12em; fill: var(--ink); font-weight: 600; }
.room-loc { font-size: 10.5px; fill: var(--ink-dim) !important; letter-spacing: .04em; }
.edge { fill: none; stroke: var(--line); transition: opacity .25s, stroke .25s; }
.edge.reexport { stroke-dasharray: 10 3; }
.edge.dynamic { stroke-dasharray: 6 4; }
.edge.http { stroke: var(--net); stroke-dasharray: 3 5; }
.edge.infra { stroke: var(--infra); stroke-dasharray: 1.5 4; }
.edge.hot { stroke: var(--accent); opacity: 1; }
.edge.red { stroke: var(--danger); opacity: .95; }
.edge.dim { opacity: .12; }
.arrowhead { stroke: var(--line); }
.arrowhead.hot { stroke: var(--accent); } .arrowhead.red { stroke: var(--danger); }
.arrowhead.net { stroke: var(--net); } .arrowhead.infra { stroke: var(--infra); }
.unit { cursor: pointer; transition: opacity .25s; }
.unit.dim { opacity: .3; }
.unit .body { fill: #0e4479; stroke: var(--ink); stroke-width: 1; transition: fill .35s var(--delay,0ms), stroke .35s var(--delay,0ms); }
.unit .line { fill: none; stroke: var(--ink); stroke-width: 1; }
.unit .inner { fill: none; stroke: rgba(214,232,255,.6); stroke-width: .7; }
.unit .hatch { fill: url(#hatch); pointer-events: none; }
.unit .columns rect { fill: var(--ink); transition: fill .35s var(--delay,0ms); }
.unit .door { fill: none; stroke: var(--ink-dim); stroke-width: .9; }
.unit .crack { fill: none; stroke: var(--danger); stroke-width: 1.6; stroke-linejoin: round; }
.unit .title { font-size: 12.5px; font-weight: 600; pointer-events: none; }
.unit .sub { font-size: 10.5px; fill: var(--ink-dim) !important; pointer-events: none; }
.far .unit .sub, .far .room-loc { display: none; }
.unit.role-pillar .body, .unit.role-foundation .body { stroke-width: 1.8; }
.unit.role-beam .body { stroke-width: 1.4; }
.unit.role-orphan { opacity: .62; }
.unit.role-orphan .body { stroke-dasharray: 3 3; fill: rgba(14,68,121,.5); }
.unit.infra .body { fill: #123f6c; stroke: var(--infra); stroke-width: 1.6; }
.unit.infra .line { stroke: var(--infra); }
.unit.service .body { stroke: var(--net); stroke-width: 1.6; stroke-dasharray: 6 3; }
.unit:hover .body { stroke: #fff; stroke-width: 2; }
.unit.match .body { stroke: var(--accent); stroke-width: 2.4; }
.unit.selected .body { stroke: var(--accent); stroke-width: 2.6; }
.unit.selected .columns rect { fill: var(--accent); }
.unit.demolished { opacity: .45; }
.unit.demolished .body { stroke-dasharray: 5 4; fill: rgba(12,59,110,.4); }
.unit.demolished .x-mark line { stroke: var(--danger); stroke-width: 1.6; }
.unit.broken .body { fill: #5a1f33; stroke: var(--danger); }
.unit.broken .hatch { fill: url(#hatch-red); }
.unit.broken .columns rect { fill: var(--danger); }
.unit.broken .title { fill: #ffe1e1; }
@media (prefers-reduced-motion: no-preference) {
  .unit.broken .shake { animation: quake .5s var(--delay,0ms) both; transform-box: fill-box; transform-origin: center; }
  @keyframes quake { 0%{transform:translate(0,0)} 20%{transform:translate(-2px,1px) rotate(-.6deg)} 40%{transform:translate(2px,-1px) rotate(.6deg)} 60%{transform:translate(-1px,2px)} 80%{transform:translate(1px,0) rotate(.3deg)} 100%{transform:translate(0,3px) rotate(.8deg)} }
}
.mode-demolish .unit, .mode-demolish .tower { cursor: crosshair; }
/* ── layers (2D) ── */
.unit.layer-dim, .tower.layer-dim { opacity: .22; }
.edge.layer-dim { opacity: .08; }
.unit.fire-source .body { stroke: #7ad7ff; stroke-width: 2.2; }
.unit.fire-sink .body { fill: #5b3a12; stroke: #ffb347; stroke-width: 2.2; }
.unit.fire-high .body { fill: #5a1f33; stroke: var(--danger); stroke-width: 2.6; }
.unit.fire-secret .body { stroke: #ffd166; stroke-width: 2.2; stroke-dasharray: 6 3; }
.unit.route .body { stroke: #ff9f43; stroke-width: 3; }
.edge.route { stroke: #ff9f43; stroke-width: 3 !important; opacity: 1; stroke-dasharray: none; }
.unit.heat-1 .body { fill: #1b5a8f; } .unit.heat-2 .body { fill: #6b5a2a; } .unit.heat-3 .body { fill: #8a4b1f; } .unit.heat-4 .body { fill: #9c2f2f; }
.unit.solo .body { stroke: #ffd166; stroke-width: 2.4; stroke-dasharray: 2 3; }
.unit.reno-added .body { fill: #1d5e3c; stroke: #7ee2a8; stroke-width: 2.4; }
.unit.reno-changed .body { fill: #6b5412; stroke: #ffd166; stroke-width: 2.4; }
.unit.reno-affected .body { stroke: #ff8f8f; stroke-width: 2; stroke-dasharray: 4 2; }
.unit.unbuilt, .tower.unbuilt { opacity: .05; pointer-events: none; }
.unit { transition: opacity .45s; }
/* ── 3D isometric ── */
.iso .ground { stroke: rgba(214,232,255,.25); stroke-width: 1; }
.iso .plot-top { fill: rgba(140,190,255,.05); stroke: rgba(214,232,255,.5); stroke-width: .9; stroke-dasharray: 7 4; }
.iso .plot-side { fill: #0a3260; stroke: rgba(214,232,255,.35); stroke-width: .6; }
.iso .plot-side.r { fill: #082a52; }
.iso .plot.selected .plot-top { stroke: var(--accent); stroke-dasharray: none; stroke-width: 1.6; }
.iso .plot-label { cursor: pointer; }
.iso .plot-label text { font-size: 11px; letter-spacing: .12em; font-weight: 700; fill: var(--ink-dim); }
.iso .gedge { fill: none; stroke: rgba(214,232,255,.16); stroke-width: .8; }
.iso .gedge.http { stroke: rgba(122,215,255,.3); stroke-dasharray: 3 4; }
.iso .gedge.infra { stroke: rgba(255,194,122,.3); stroke-dasharray: 1.5 3; }
.focusing .gedge, .demolishing .gedge { opacity: .35; }
.tower { cursor: pointer; transition: opacity .4s; }
.tower.dim { opacity: .25; }
.tower .shadow { fill: rgba(2,14,30,.35); }
.tower .solid { transform-box: fill-box; transform-origin: 50% 100%; transition: transform .7s cubic-bezier(.55,0,.8,.3) var(--delay,0ms), opacity .5s; }
.tower .face { stroke: rgba(225,238,255,.85); stroke-width: .8; stroke-linejoin: round; transition: fill .4s var(--delay,0ms), stroke .4s var(--delay,0ms); }
.tower .face.top { fill: #2f74b8; }
.tower .face.left { fill: #175592; }
.tower .face.right { fill: #0f4073; }
.tower .hatch-face { fill: url(#hatch); pointer-events: none; }
.tower .inner-roof { fill: none; stroke: rgba(225,238,255,.55); stroke-width: .7; }
.tower .iso-columns line { stroke: #fff; stroke-width: 2.6; stroke-linecap: square; }
.tower .iso-door { fill: #0b2e57; stroke: var(--ink-dim); stroke-width: .7; }
.tower .crack { fill: none; stroke: var(--danger); stroke-width: 1.8; }
.tower .cyl-ring { fill: none; stroke: rgba(255,194,122,.6); stroke-width: .8; }
.tower.infra .face { stroke: var(--infra); }
.tower.infra .face.top { fill: #3b5f86; } .tower.infra .face.left { fill: #24476d; }
.tower.service .face { stroke: var(--net); stroke-dasharray: 5 3; }
.tower .roof-label { pointer-events: none; }
.tower .roof-label text { fill: #f2f7ff; font-weight: 700; }
.tower .roof-label .roof-sub { fill: #cfe0ff !important; font-weight: 400; }
.far .tower .roof-sub, .far .plot-label { display: none; }
.tower.role-orphan .face { stroke-dasharray: 3 3; fill-opacity: .45; }
.tower.role-orphan { opacity: .7; }
.tower:hover .face { stroke: #fff; stroke-width: 1.6; }
.tower.selected .face, .tower.match .face { stroke: var(--accent); stroke-width: 2; }
.tower.selected .iso-columns line { stroke: var(--accent); }
.tower.broken .face.top { fill: #c2414f; } .tower.broken .face.left { fill: #8f2737; } .tower.broken .face.right { fill: #6e1c2a; }
.tower.broken .face { stroke: #ffc9c9; }
.tower.broken .hatch-face { fill: url(#hatch-red); }
.tower.broken .iso-columns line { stroke: #ffc9c9; }
.tower.broken .solid { transform: translateY(4px) scaleY(.16) skewX(-6deg); }
.tower.demolished .face { fill: rgba(12,59,110,.25) !important; stroke: var(--danger); stroke-dasharray: 5 4; }
.tower.demolished .x-roof { stroke: var(--danger); stroke-width: 2; }
.tower.demolished .solid { opacity: .7; }
.tower.unbuilt .solid { transform: scaleY(0); opacity: 0; }
.tower.fire-source .face.top { fill: #2d8fb8; } .tower.fire-source .face { stroke: #7ad7ff; stroke-width: 1.4; }
.tower.fire-sink .face.top { fill: #c27a1f; } .tower.fire-sink .face.left { fill: #8f5512; } .tower.fire-sink .face.right { fill: #6e400c; }
.tower.fire-high .face.top { fill: #d6404f; } .tower.fire-high .face.left { fill: #9c2433; } .tower.fire-high .face.right { fill: #761a27; }
.tower.fire-secret .face { stroke: #ffd166; stroke-width: 1.6; stroke-dasharray: 5 3; }
.tower.route .face { stroke: #ff9f43; stroke-width: 2; }
.tower.heat-1 .face.top { fill: #3f7fb0; } .tower.heat-2 .face.top { fill: #b08d3a; } .tower.heat-3 .face.top { fill: #c26a2a; } .tower.heat-4 .face.top { fill: #cf3f3f; }
.tower.solo .face { stroke: #ffd166; stroke-dasharray: 2 3; stroke-width: 1.4; }
.tower.reno-added .face.top { fill: #2f9a62; } .tower.reno-added .face.left { fill: #1f6e45; } .tower.reno-added .face.right { fill: #175634; }
.tower.reno-changed .face.top { fill: #c9a23a; } .tower.reno-changed .face.left { fill: #8f721f; } .tower.reno-changed .face.right { fill: #6e5715; }
.tower.reno-affected .face { stroke: #ff8f8f; stroke-width: 1.5; }
.arc { fill: none; stroke-width: 1.8; }
.arc.hot { stroke: var(--accent); } .arc.red { stroke: var(--danger); opacity: .85; } .arc.route { stroke: #ff9f43; stroke-width: 2.6; }
.arc.http { stroke-dasharray: 5 4; }
.arrowhead.route { stroke: #ff9f43; }
@media (prefers-reduced-motion: reduce) { .tower .solid { transition: none; } }
.pin circle { fill: var(--accent); stroke: #0c3b6e; stroke-width: 1.5; }
.pin text { font-size: 10px; font-weight: 700; fill: #2b2100 !important; pointer-events: none; }
`;
