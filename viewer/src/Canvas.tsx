import { forwardRef, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { select } from 'd3-selection';
import { zoom as d3zoom, zoomIdentity, type ZoomBehavior } from 'd3-zoom';
import 'd3-transition';
import type { Blueprint, Role } from '../../src/types';
import type { Layout } from './layout';
import { unitLabel } from './layout';
import { folderRole, nodeIndex, type View } from './model';

export interface UnitState {
  state: 'demolished' | 'broken';
  level: number;
  frac: number;
}

/** extra classes from the active layer (fire safety, history, renovation, time-lapse) */
export interface Decor {
  unit: Map<string, string>;
  edge: Map<string, string>;
  /** a layer is active: units without a class are dimmed */
  active: boolean;
}

export interface CanvasHandle {
  fit: (animate?: boolean) => void;
  focus: (key: string) => void;
  svg: () => SVGSVGElement | null;
}

interface Props {
  bp: Blueprint;
  view: View;
  layout: Layout;
  mode: 'inspect' | 'demolish';
  selected?: string;
  status: Map<string, UnitState>;
  containerBroken: Set<string>;
  matches: Set<string>;
  cycleUnits: Set<string>;
  noteCounts: Map<string, number>;
  decor: Decor;
  onClickUnit: (key: string) => void;
  onToggleFolder: (folderKey: string) => void;
  onSelect: (key: string) => void;
  totalLoc: number;
  floors: number;
  floorsLabel: string;
}

const pts = (p: { x: number; y: number }[]) => p.map((q) => `${q.x},${q.y}`).join(' ');

export const Canvas = forwardRef<CanvasHandle, Props>(function Canvas(props, ref) {
  const { bp, view, layout, mode, selected, status, matches } = props;
  const svgRef = useRef<SVGSVGElement>(null);
  const worldRef = useRef<SVGGElement>(null);
  const zoomRef = useRef<ZoomBehavior<SVGSVGElement, unknown> | undefined>(undefined);
  const [hover, setHover] = useState<string | undefined>();
  const [far, setFar] = useState(false);
  const nodes = nodeIndex(bp);

  useLayoutEffect(() => {
    const svg = select(svgRef.current!);
    const z = d3zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.05, 4])
      .filter((ev: any) => (!ev.ctrlKey || ev.type === 'wheel') && !ev.button && ev.type !== 'dblclick')
      .on('zoom', (ev) => {
        worldRef.current!.setAttribute('transform', ev.transform.toString());
        setFar(ev.transform.k < 0.45);
      });
    svg.call(z);
    zoomRef.current = z;
  }, []);

  const fit = (animate = true) => {
    const svg = svgRef.current;
    if (!svg || !zoomRef.current) return;
    const { width, height } = svg.getBoundingClientRect();
    const b = layout.bounds;
    const pad = 70;
    const k = Math.min(1.4, Math.min((width - pad * 2) / Math.max(1, b.w), (height - pad * 2) / Math.max(1, b.h)));
    const t = zoomIdentity.translate((width - b.w * k) / 2 - b.x * k, (height - b.h * k) / 2 - b.y * k).scale(k);
    const sel = select(svg);
    if (animate) (sel.transition().duration(650) as any).call(zoomRef.current.transform, t);
    else sel.call(zoomRef.current.transform, t);
  };

  useImperativeHandle(ref, () => ({
    fit,
    focus: (key: string) => {
      const box = layout.boxes.get(key);
      const svg = svgRef.current;
      if (!box || !svg || !zoomRef.current) return;
      const { width, height } = svg.getBoundingClientRect();
      const k = Math.min(1.6, Math.max(0.7, (width * 0.35) / box.w));
      const t = zoomIdentity.translate(width / 2 - (box.x + box.w / 2) * k, height / 2 - (box.y + box.h / 2) * k).scale(k);
      (select(svg).transition().duration(600) as any).call(zoomRef.current.transform, t);
    },
    svg: () => svgRef.current,
  }));

  // hovering / selecting lights up the load paths
  const demolishing = status.size > 0;
  const focusKey = demolishing ? undefined : hover ?? (selected && view.units.has(selected) ? selected : undefined);
  const hotEdges = useMemo(() => {
    const s = new Set<string>();
    if (!focusKey) return s;
    for (const e of view.edges) if (e.from === focusKey || e.to === focusKey) s.add(e.key);
    return s;
  }, [focusKey, view]);
  const neighbours = useMemo(() => {
    const s = new Set<string>();
    if (!focusKey) return s;
    for (const e of view.edges) {
      if (e.from === focusKey) s.add(e.to);
      if (e.to === focusKey) s.add(e.from);
    }
    return s;
  }, [focusKey, view]);

  const b = layout.bounds;

  return (
    <svg ref={svgRef} className={`canvas mode-${mode} ${far ? 'far' : ''} ${focusKey ? 'focusing' : ''} ${demolishing ? 'demolishing' : ''}`} xmlns="http://www.w3.org/2000/svg">
      <defs>
        <pattern id="grid-minor" width="12" height="12" patternUnits="userSpaceOnUse">
          <path d="M12 0H0V12" fill="none" stroke="rgba(190,220,255,0.07)" strokeWidth="0.6" />
        </pattern>
        <pattern id="grid-major" width="60" height="60" patternUnits="userSpaceOnUse">
          <rect width="60" height="60" fill="url(#grid-minor)" />
          <path d="M60 0H0V60" fill="none" stroke="rgba(190,220,255,0.14)" strokeWidth="0.8" />
        </pattern>
        <pattern id="hatch" width="7" height="7" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <line x1="0" y1="0" x2="0" y2="7" stroke="rgba(225,238,255,0.38)" strokeWidth="1.4" />
        </pattern>
        <pattern id="hatch-red" width="7" height="7" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <line x1="0" y1="0" x2="0" y2="7" stroke="rgba(255,140,140,0.5)" strokeWidth="1.4" />
        </pattern>
        {['base', 'hot', 'red', 'net', 'infra'].map((k) => (
          <marker key={k} id={`arrow-${k}`} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M1 1.5L9 5L1 8.5" fill="none" className={`arrowhead ${k}`} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </marker>
        ))}
      </defs>

      <rect className="paper" x="-20000" y="-20000" width="40000" height="40000" fill="url(#grid-major)" />
      <g ref={worldRef}>
        {/* overall dimension lines, like a real drawing */}
        <g className="dimension">
          <line x1={b.x + 30} y1={-26} x2={b.x + b.w - 30} y2={-26} />
          <line x1={b.x + 30} y1={-34} x2={b.x + 30} y2={-18} />
          <line x1={b.x + b.w - 30} y1={-34} x2={b.x + b.w - 30} y2={-18} />
          <text x={b.x + b.w / 2} y={-32} textAnchor="middle">
            {props.totalLoc.toLocaleString('en')} LOC
          </text>
          <line x1={-26} y1={b.y + 30} x2={-26} y2={b.y + b.h - 30} />
          <line x1={-34} y1={b.y + 30} x2={-18} y2={b.y + 30} />
          <line x1={-34} y1={b.y + b.h - 30} x2={-18} y2={b.y + b.h - 30} />
          <text x={-34} y={b.y + b.h / 2} textAnchor="middle" transform={`rotate(-90 ${-34} ${b.y + b.h / 2})`}>
            {props.floors} {props.floorsLabel}
          </text>
        </g>

        {[...view.containers.values()].map((c) => {
          const box = layout.boxes.get(c.key);
          if (!box) return null;
          const broken = props.containerBroken.has(c.key);
          const isSel = selected === c.key;
          return (
            <g key={c.key} className={`room ${broken ? 'broken' : ''} ${isSel ? 'selected' : ''}`}>
              <rect x={box.x} y={box.y} width={box.w} height={box.h} rx="2" />
              <g
                className="room-label"
                onClick={(e) => {
                  e.stopPropagation();
                  props.onSelect(c.key);
                }}
                onDoubleClick={(e) => {
                  e.stopPropagation();
                  props.onToggleFolder(c.folder.key);
                }}
              >
                <rect x={box.x + 10} y={box.y + 9} width={Math.min(box.w - 20, c.folder.name.length * 8.9 + 36)} height="20" className="room-tag" />
                <text x={box.x + 18} y={box.y + 23}>
                  ▤ {c.folder.name.toUpperCase()}
                </text>
              </g>
              <text className="room-loc" x={box.x + box.w - 12} y={box.y + 23} textAnchor="end">
                {c.folder.all.length} · {c.folder.loc.toLocaleString('en')} loc
              </text>
            </g>
          );
        })}

        <g className="edges">
          {view.edges.map((e) => {
            const p = layout.edges.get(e.key);
            if (!p) return null;
            const fromS = status.get(e.from);
            const toS = status.get(e.to);
            const red = !!fromS && fromS.state === 'broken' && !!toS;
            const hot = hotEdges.has(e.key);
            const layerCls = props.decor.edge.get(e.key) ?? '';
            const cls = ['edge', e.kind, hot ? 'hot' : '', red ? 'red' : '', layerCls, focusKey && !hot ? 'dim' : '', props.decor.active && !layerCls && !hot ? 'layer-dim' : ''].join(' ');
            const marker = red ? 'red' : hot ? 'hot' : e.kind === 'http' ? 'net' : e.kind === 'infra' ? 'infra' : 'base';
            return (
              <polyline key={e.key} className={cls} points={pts(p)} markerEnd={`url(#arrow-${marker})`} strokeWidth={Math.min(3, 0.9 + Math.log2(e.count) * 0.5)}>
                <title>
                  {e.count} {e.kind}
                  {e.vias.length ? ` · ${e.vias.join(', ')}` : ''}
                </title>
              </polyline>
            );
          })}
        </g>

        <g className="units">
          {[...view.units.values()].map((u) => {
            const box = layout.boxes.get(u.key);
            if (!box) return null;
            const node = u.nodeId ? nodes.get(u.nodeId) : undefined;
            const m = u.nodeId ? bp.metrics[u.nodeId] : undefined;
            const role: Role = m?.role ?? folderRole(u.ids, bp);
            const st = status.get(u.key);
            const { title, sub } = unitLabel(u.key, view, bp);
            const isSel = selected === u.key;
            const cls = [
              'unit',
              u.kind,
              node?.kind ?? 'file',
              `role-${role}`,
              st?.state ?? '',
              isSel ? 'selected' : '',
              matches.has(u.key) ? 'match' : '',
              props.cycleUnits.has(u.key) ? 'cracked' : '',
              focusKey && focusKey !== u.key && !neighbours.has(u.key) ? 'dim' : '',
              props.decor.unit.get(u.key) ?? (props.decor.active ? 'layer-dim' : ''),
            ].join(' ');
            const { x, y, w, h } = box;
            const delay = st?.state === 'broken' ? `${Math.min(st.level, 12) * 110}ms` : '0ms';
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
                <g className="shake">
                  {node?.kind === 'infra' ? (
                    <>
                      <path className="body" d={`M${x} ${y + 10} A${w / 2} 10 0 0 1 ${x + w} ${y + 10} V${y + h - 10} A${w / 2} 10 0 0 1 ${x} ${y + h - 10} Z`} />
                      <path className="line" d={`M${x} ${y + 10} A${w / 2} 10 0 0 0 ${x + w} ${y + 10}`} />
                    </>
                  ) : (
                    <rect className="body" x={x} y={y} width={w} height={h} rx="1.5" />
                  )}
                  {role === 'foundation' && node?.kind !== 'infra' && <rect className="hatch" x={x} y={y} width={w} height={h} />}
                  {u.kind === 'folder' && <rect className="inner" x={x + 4} y={y + 4} width={w - 8} height={h - 8} />}
                  {(role === 'pillar' || role === 'foundation') && node?.kind !== 'infra' && (
                    <g className="columns">
                      <rect x={x - 3} y={y - 3} width="7" height="7" />
                      <rect x={x + w - 4} y={y - 3} width="7" height="7" />
                      <rect x={x - 3} y={y + h - 4} width="7" height="7" />
                      <rect x={x + w - 4} y={y + h - 4} width="7" height="7" />
                    </g>
                  )}
                  {role === 'entry' && node?.kind === 'file' && <path className="door" d={`M${x + 10} ${y + h} v-14 A14 14 0 0 1 ${x + 24} ${y + h}`} />}
                  {node?.kind === 'service' && <path className="door" d={`M${x + w / 2 - 10} ${y + h} v-10 h20 v10`} />}
                  {props.cycleUnits.has(u.key) && <path className="crack" d={`M${x + w - 16} ${y} l4 5 l-5 4 l5 5 l-3 4`} />}
                  <text className="title" x={x + w / 2} y={y + (node?.kind === 'infra' ? h / 2 + 2 : h / 2 - 3)} textAnchor="middle">
                    {title}
                  </text>
                  <text className="sub" x={x + w / 2} y={y + (node?.kind === 'infra' ? h / 2 + 17 : h / 2 + 13)} textAnchor="middle">
                    {sub}
                  </text>
                  {(props.noteCounts.get(u.key) ?? 0) > 0 && (
                    <g className="pin">
                      <circle cx={x} cy={y} r="8" />
                      <text x={x} y={y + 3.5} textAnchor="middle">
                        {props.noteCounts.get(u.key)}
                      </text>
                    </g>
                  )}
                  {st?.state === 'demolished' && (
                    <g className="x-mark">
                      <line x1={x} y1={y} x2={x + w} y2={y + h} />
                      <line x1={x + w} y1={y} x2={x} y2={y + h} />
                    </g>
                  )}
                </g>
              </g>
            );
          })}
        </g>
      </g>
    </svg>
  );
});
