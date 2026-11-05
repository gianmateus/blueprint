import { forwardRef, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { select } from 'd3-selection';
import { zoom as d3zoom, zoomIdentity, type ZoomBehavior } from 'd3-zoom';
import 'd3-transition';
import type { Blueprint, Role } from '../../src/types';
import type { Layout } from './layout';
import { unitLabel } from './layout';
import { folderRole, nodeIndex, type View, type ViewItem } from './model';
import type { CanvasHandle, Decor, UnitState } from './Canvas';

/**
 * The 3D isometric view: every module is a tower standing on its folder's plot.
 * Pure SVG (no WebGL), so it stays crisp, exportable and blueprint-styled.
 */

const C = Math.cos(Math.PI / 6); // 0.866
const S = 0.5;
const P = (x: number, y: number, z: number): [number, number] => [(x - y) * C, (x + y) * S - z];
const poly = (pts: [number, number][]) => pts.map((p) => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ');
const PLOT_STEP = 7;

interface Props {
  bp: Blueprint;
  view: View;
  layout: Layout;
  mode: 'inspect' | 'demolish';
  selected?: string;
  status: Map<string, UnitState>;
  matches: Set<string>;
  cycleUnits: Set<string>;
  noteCounts: Map<string, number>;
  decor: Decor;
  heightMode: 'load' | 'size';
  onClickUnit: (key: string) => void;
  onToggleFolder: (folderKey: string) => void;
  onSelect: (key: string) => void;
}

export const Iso = forwardRef<CanvasHandle, Props>(function Iso(props, ref) {
  const { bp, view, layout, mode, selected, status, matches, decor } = props;
  const svgRef = useRef<SVGSVGElement>(null);
  const worldRef = useRef<SVGGElement>(null);
  const zoomRef = useRef<ZoomBehavior<SVGSVGElement, unknown> | undefined>(undefined);
  const [hover, setHover] = useState<string | undefined>();
  const [far, setFar] = useState(false);
  const nodes = nodeIndex(bp);

  // terrace height of each unit / container (nested folders step up)
  const depth = useMemo(() => {
    const d = new Map<string, number>();
    const walk = (items: ViewItem[], level: number) => {
      for (const it of items) {
        d.set(it.key, level);
        if (it.type === 'container') walk(it.children, level + 1);
      }
    };
    walk(view.tree, 0);
    return d;
  }, [view]);

  const heightOf = (key: string): number => {
    const u = view.units.get(key)!;
    const node = u.nodeId ? nodes.get(u.nodeId) : undefined;
    if (node?.kind === 'infra') return 34;
    if (props.heightMode === 'size') {
      const loc = u.kind === 'folder' ? u.folder!.loc : node?.loc ?? 0;
      return 10 + 24 * Math.log2(1 + loc / 25);
    }
    const pct = u.ids.reduce((mx, id) => Math.max(mx, bp.metrics[id]?.impactPct ?? 0), 0);
    return 12 + 230 * Math.sqrt(pct);
  };

  // geometry for every tower, painter-sorted far → near
  const towers = useMemo(() => {
    const list = [...view.units.values()]
      .map((u) => {
        const b = layout.boxes.get(u.key);
        if (!b) return null;
        const inset = 6;
        const x = b.x + inset;
        const y = b.y + inset;
        const w = Math.max(10, b.w - inset * 2);
        const h = Math.max(10, b.h - inset * 2);
        const z0 = ((depth.get(u.key) ?? 0) + 0) * PLOT_STEP;
        const H = heightOf(u.key);
        return { u, x, y, w, h, z0, z1: z0 + H, H };
      })
      .filter(Boolean) as { u: View['units'] extends Map<string, infer U> ? U : never; x: number; y: number; w: number; h: number; z0: number; z1: number; H: number }[];
    list.sort((a, b) => a.x + a.y + (a.w + a.h) / 2 - (b.x + b.y + (b.w + b.h) / 2));
    return list;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, layout, depth, props.heightMode, bp]);

  const towerByKey = useMemo(() => new Map(towers.map((t) => [t.u.key, t])), [towers]);

  const plots = useMemo(
    () =>
      [...view.containers.values()]
        .map((c) => {
          const b = layout.boxes.get(c.key);
          if (!b) return null;
          return { c, b, z: (depth.get(c.key) ?? 0) * PLOT_STEP };
        })
        .filter(Boolean)
        .sort((a, b) => a!.z - b!.z) as { c: View['containers'] extends Map<string, infer T> ? T : never; b: { x: number; y: number; w: number; h: number }; z: number }[],
    [view, layout, depth],
  );

  const bounds = useMemo(() => {
    let minX = Infinity,
      minY = Infinity,
      maxX = -Infinity,
      maxY = -Infinity;
    const add = ([sx, sy]: [number, number]) => {
      minX = Math.min(minX, sx);
      maxX = Math.max(maxX, sx);
      minY = Math.min(minY, sy);
      maxY = Math.max(maxY, sy);
    };
    const B = layout.bounds;
    add(P(B.x, B.y, 0));
    add(P(B.x + B.w, B.y, 0));
    add(P(B.x, B.y + B.h, 0));
    add(P(B.x + B.w, B.y + B.h, 0));
    for (const t of towers) add(P(t.x, t.y, t.z1));
    return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
  }, [towers, layout]);

  useLayoutEffect(() => {
    const svg = select(svgRef.current!);
    const z = d3zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.05, 4])
      .filter((ev: any) => (!ev.ctrlKey || ev.type === 'wheel') && !ev.button && ev.type !== 'dblclick')
      .on('zoom', (ev) => {
        worldRef.current!.setAttribute('transform', ev.transform.toString());
        setFar(ev.transform.k < 0.5);
      });
    svg.call(z);
    zoomRef.current = z;
  }, []);

  const fit = (animate = true) => {
    const svg = svgRef.current;
    if (!svg || !zoomRef.current) return;
    const { width, height } = svg.getBoundingClientRect();
    const pad = 60;
    const k = Math.min(1.5, Math.min((width - pad * 2) / Math.max(1, bounds.w), (height - pad * 2) / Math.max(1, bounds.h)));
    const t = zoomIdentity.translate((width - bounds.w * k) / 2 - bounds.x * k, (height - bounds.h * k) / 2 - bounds.y * k).scale(k);
    const sel = select(svg);
    if (animate) (sel.transition().duration(700) as any).call(zoomRef.current.transform, t);
    else sel.call(zoomRef.current.transform, t);
  };

  useImperativeHandle(ref, () => ({
    fit,
    focus: (key: string) => {
      const svg = svgRef.current;
      if (!svg || !zoomRef.current) return;
      const t = towerByKey.get(key);
      const b = layout.boxes.get(key);
      let cx: number, cy: number, size: number;
      if (t) [cx, cy] = P(t.x + t.w / 2, t.y + t.h / 2, t.z1 / 2), (size = t.w + t.h);
      else if (b) [cx, cy] = P(b.x + b.w / 2, b.y + b.h / 2, 0), (size = b.w + b.h);
      else return;
      const { width, height } = svg.getBoundingClientRect();
      const k = Math.min(1.8, Math.max(0.6, (width * 0.3) / size));
      (select(svg).transition().duration(650) as any).call(zoomRef.current.transform, zoomIdentity.translate(width / 2 - cx * k, height / 2 - cy * k).scale(k));
    },
    svg: () => svgRef.current,
  }));

  const demolishing = status.size > 0;
  const focusKey = demolishing ? undefined : hover ?? (selected && view.units.has(selected) ? selected : undefined);
  const arcs = useMemo(() => {
    // floating load paths: on hover, or the collapse waves during a demolition
    const list: { key: string; from: string; to: string; kind: string; red: boolean }[] = [];
    for (const e of view.edges) {
      if (focusKey && (e.from === focusKey || e.to === focusKey)) list.push({ key: e.key, from: e.from, to: e.to, kind: e.kind, red: false });
      else if (demolishing && status.get(e.from)?.state === 'broken' && status.has(e.to)) list.push({ key: e.key, from: e.from, to: e.to, kind: e.kind, red: true });
      else if (decor.edge.get(e.key) === 'route') list.push({ key: e.key, from: e.from, to: e.to, kind: 'route', red: false });
      if (list.length > 220) break;
    }
    return list;
  }, [focusKey, demolishing, status, view, decor]);

  const roofCenter = (k: string): [number, number] | undefined => {
    const t = towerByKey.get(k);
    return t ? P(t.x + t.w / 2, t.y + t.h / 2, t.z1) : undefined;
  };

  return (
    <svg ref={svgRef} className={`canvas iso mode-${mode} ${far ? 'far' : ''} ${focusKey ? 'focusing' : ''} ${demolishing ? 'demolishing' : ''}`} xmlns="http://www.w3.org/2000/svg">
      <defs>
        <pattern id="iso-grid" width="40" height="40" patternUnits="userSpaceOnUse" patternTransform={`matrix(${C} ${S} ${-C} ${S} 0 0)`}>
          <path d="M40 0H0V40" fill="none" stroke="rgba(190,220,255,0.12)" strokeWidth="0.8" />
        </pattern>
        <pattern id="hatch" width="7" height="7" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <line x1="0" y1="0" x2="0" y2="7" stroke="rgba(225,238,255,0.35)" strokeWidth="1.3" />
        </pattern>
        <pattern id="hatch-red" width="7" height="7" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <line x1="0" y1="0" x2="0" y2="7" stroke="rgba(255,140,140,0.5)" strokeWidth="1.3" />
        </pattern>
        {['base', 'hot', 'red', 'net', 'infra', 'route'].map((k) => (
          <marker key={k} id={`iso-arrow-${k}`} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M1 1.5L9 5L1 8.5" fill="none" className={`arrowhead ${k}`} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </marker>
        ))}
      </defs>
      <rect className="paper" x="-20000" y="-20000" width="40000" height="40000" fill="#0c3b6e" />
      <g ref={worldRef}>
        {/* the site: an isometric ground grid under the whole drawing */}
        {(() => {
          const B = layout.bounds;
          const m = 60;
          return (
            <polygon
              className="ground"
              points={poly([P(B.x - m, B.y - m, 0), P(B.x + B.w + m, B.y - m, 0), P(B.x + B.w + m, B.y + B.h + m, 0), P(B.x - m, B.y + B.h + m, 0)])}
              fill="url(#iso-grid)"
            />
          );
        })()}

        {plots.map(({ c, b, z }) => {
          const pts = poly([P(b.x, b.y, z), P(b.x + b.w, b.y, z), P(b.x + b.w, b.y + b.h, z), P(b.x, b.y + b.h, z)]);
          const side = poly([P(b.x, b.y + b.h, z), P(b.x + b.w, b.y + b.h, z), P(b.x + b.w, b.y + b.h, z - PLOT_STEP), P(b.x, b.y + b.h, z - PLOT_STEP)]);
          const sideR = poly([P(b.x + b.w, b.y, z), P(b.x + b.w, b.y + b.h, z), P(b.x + b.w, b.y + b.h, z - PLOT_STEP), P(b.x + b.w, b.y, z - PLOT_STEP)]);
          const [lx, ly] = P(b.x + 14, b.y + 22, z);
          return (
            <g key={c.key} className={`plot ${selected === c.key ? 'selected' : ''} ${decor.unit.get(c.key) ?? ''}`}>
              {z > 0 && <polygon className="plot-side" points={side} />}
              {z > 0 && <polygon className="plot-side r" points={sideR} />}
              <polygon className="plot-top" points={pts} />
              <g
                transform={`translate(${lx.toFixed(1)} ${ly.toFixed(1)}) matrix(${C} ${S} ${-C} ${S} 0 0)`}
                className="plot-label"
                onClick={(e) => {
                  e.stopPropagation();
                  props.onSelect(c.key);
                }}
                onDoubleClick={(e) => {
                  e.stopPropagation();
                  props.onToggleFolder(c.folder.key);
                }}
              >
                <text x="0" y="0">
                  ▤ {c.folder.name.toUpperCase()}
                </text>
              </g>
            </g>
          );
        })}

        {/* load paths drawn on the ground, like conduits in a floor plan */}
        <g className="ground-edges">
          {view.edges.map((e) => {
            const pts = layout.edges.get(e.key);
            if (!pts) return null;
            const z = Math.min(depth.get(e.from) ?? 0, depth.get(e.to) ?? 0) * PLOT_STEP;
            return <polyline key={e.key} className={`gedge ${e.kind}`} points={poly(pts.map((p) => P(p.x, p.y, z)))} />;
          })}
        </g>

        {towers.map((t) => {
          const { u, x, y, w, h, z0, z1, H } = t;
          const node = u.nodeId ? nodes.get(u.nodeId) : undefined;
          const role: Role = u.nodeId ? bp.metrics[u.nodeId]?.role ?? 'wall' : folderRole(u.ids, bp);
          const st = status.get(u.key);
          const { title, sub } = unitLabel(u.key, view, bp);
          const layerCls = decor.unit.get(u.key) ?? (decor.active ? 'layer-dim' : '');
          const cls = [
            'tower',
            u.kind,
            node?.kind ?? 'file',
            `role-${role}`,
            st?.state ?? '',
            selected === u.key ? 'selected' : '',
            matches.has(u.key) ? 'match' : '',
            props.cycleUnits.has(u.key) ? 'cracked' : '',
            focusKey && focusKey !== u.key && !arcs.some((a) => a.from === u.key || a.to === u.key) ? 'dim' : '',
            layerCls,
          ].join(' ');
          const delay = st?.state === 'broken' ? `${Math.min(st.level, 12) * 120}ms` : '0ms';
          const top = poly([P(x, y, z1), P(x + w, y, z1), P(x + w, y + h, z1), P(x, y + h, z1)]);
          const left = poly([P(x, y + h, z0), P(x + w, y + h, z0), P(x + w, y + h, z1), P(x, y + h, z1)]);
          const right = poly([P(x + w, y, z0), P(x + w, y + h, z0), P(x + w, y + h, z1), P(x + w, y, z1)]);
          const [tx, ty] = P(x + w / 2, y + h / 2, z1);
          const labelSize = Math.min(13, Math.max(8, (w / Math.max(4, title.length)) * 1.6));
          const isCyl = node?.kind === 'infra';
          return (
            <g
              key={u.key}
              className={cls}
              style={{ ['--delay' as any]: delay }}
              onMouseEnter={() => setHover(u.key)}
              onMouseLeave={() => setHover(undefined)}
              onClick={(e) => {
                e.stopPropagation();
                props.onClickUnit(u.key);
              }}
              onDoubleClick={(e) => {
                e.stopPropagation();
                if (u.folder) props.onToggleFolder(u.folder.key);
              }}
            >
              <polygon className="shadow" points={poly([P(x, y, z0), P(x + w, y, z0), P(x + w, y + h, z0), P(x, y + h, z0)])} />
              <g className="solid">
                {isCyl ? (
                  <Cylinder x={x} y={y} w={w} h={h} z0={z0} z1={z1} />
                ) : (
                  <>
                    <polygon className="face left" points={left} />
                    <polygon className="face right" points={right} />
                    <polygon className="face top" points={top} />
                    {role === 'foundation' && <polygon className="hatch-face" points={left} />}
                    {role === 'foundation' && <polygon className="hatch-face" points={right} />}
                    {(role === 'pillar' || role === 'foundation') && (
                      <g className="iso-columns">
                        {[P(x, y + h, z0), P(x + w, y + h, z0), P(x + w, y, z0)].map(([sx, sy], i) => (
                          <line key={i} x1={sx} y1={sy} x2={sx} y2={sy - H} />
                        ))}
                      </g>
                    )}
                    {u.kind === 'folder' && <polygon className="inner-roof" points={poly([P(x + 5, y + 5, z1), P(x + w - 5, y + 5, z1), P(x + w - 5, y + h - 5, z1), P(x + 5, y + h - 5, z1)])} />}
                    {role === 'entry' && node?.kind !== 'infra' && (
                      <polygon className="iso-door" points={poly([P(x + w * 0.35, y + h, z0), P(x + w * 0.35 + 9, y + h, z0), P(x + w * 0.35 + 9, y + h, z0 + Math.min(16, H * 0.7)), P(x + w * 0.35, y + h, z0 + Math.min(16, H * 0.7))])} />
                    )}
                    {props.cycleUnits.has(u.key) && (() => {
                      const [a, b2] = P(x + w, y + h * 0.3, z1);
                      return <path className="crack" d={`M${a} ${b2} l-3 ${Math.min(14, H * 0.25)} l5 ${Math.min(10, H * 0.2)} l-4 ${Math.min(14, H * 0.25)}`} />;
                    })()}
                    {st?.state === 'demolished' && <path className="x-roof" d={`M${P(x, y, z1).join(' ')} L${P(x + w, y + h, z1).join(' ')} M${P(x + w, y, z1).join(' ')} L${P(x, y + h, z1).join(' ')}`} />}
                  </>
                )}
                <g transform={`translate(${tx.toFixed(1)} ${ty.toFixed(1)}) matrix(${C} ${S} ${-C} ${S} 0 0)`} className="roof-label">
                  <text x="0" y={isCyl ? -2 : 1} textAnchor="middle" fontSize={labelSize}>
                    {title}
                  </text>
                  {w > 70 && (
                    <text className="roof-sub" x="0" y={labelSize + 2} textAnchor="middle" fontSize={Math.max(7, labelSize * 0.72)}>
                      {sub}
                    </text>
                  )}
                </g>
                {(props.noteCounts.get(u.key) ?? 0) > 0 && (
                  <g className="pin">
                    <circle cx={P(x, y, z1)[0]} cy={P(x, y, z1)[1]} r="8" />
                    <text x={P(x, y, z1)[0]} y={P(x, y, z1)[1] + 3.5} textAnchor="middle">
                      {props.noteCounts.get(u.key)}
                    </text>
                  </g>
                )}
              </g>
            </g>
          );
        })}

        <g className="arcs">
          {arcs.map((a) => {
            const p1 = roofCenter(a.from);
            const p2 = roofCenter(a.to);
            if (!p1 || !p2) return null;
            const mx = (p1[0] + p2[0]) / 2;
            const my = Math.min(p1[1], p2[1]) - 40 - Math.hypot(p2[0] - p1[0], p2[1] - p1[1]) * 0.15;
            const cls = a.red ? 'red' : a.kind === 'route' ? 'route' : 'hot';
            return <path key={a.key} className={`arc ${cls} ${a.kind}`} d={`M${p1[0]} ${p1[1]} Q${mx} ${my} ${p2[0]} ${p2[1]}`} markerEnd={`url(#iso-arrow-${cls})`} />;
          })}
        </g>
      </g>
    </svg>
  );
});

function Cylinder({ x, y, w, h, z0, z1 }: { x: number; y: number; w: number; h: number; z0: number; z1: number }) {
  const cx = x + w / 2;
  const cy = y + h / 2;
  const r = Math.min(w, h) / 2;
  const [sx0, sy0] = P(cx, cy, z0);
  const [, sy1] = P(cx, cy, z1);
  const rx = r * C * 1.414;
  const ry = r * S * 1.414;
  return (
    <>
      <path className="face left" d={`M${sx0 - rx} ${sy1} V${sy0} A${rx} ${ry} 0 0 0 ${sx0 + rx} ${sy0} V${sy1} Z`} />
      <ellipse className="face top" cx={sx0} cy={sy1} rx={rx} ry={ry} />
      <path className="cyl-ring" d={`M${sx0 - rx} ${(sy0 + sy1) / 2} A${rx} ${ry} 0 0 0 ${sx0 + rx} ${(sy0 + sy1) / 2}`} />
    </>
  );
}
