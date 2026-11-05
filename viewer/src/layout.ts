import ELK from 'elkjs/lib/elk.bundled.js';
import type { Blueprint } from '../../src/types';
import { basename, nodeIndex, type View, type ViewItem } from './model';

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}
export interface Layout {
  boxes: Map<string, Box>;
  edges: Map<string, { x: number; y: number }[]>;
  bounds: Box;
}

const elk = new ELK();
const CHAR = 7.3;

export function unitLabel(key: string, view: View, bp: Blueprint): { title: string; sub: string } {
  const u = view.units.get(key)!;
  if (u.kind === 'folder') {
    const f = u.folder!;
    return { title: f.name + '/', sub: `${f.all.length} ${f.all.length === 1 ? 'file' : 'files'} · ${f.loc.toLocaleString('en')} loc` };
  }
  const n = nodeIndex(bp).get(u.nodeId!);
  const m = bp.metrics[u.nodeId!];
  if (n?.kind === 'infra') return { title: n.service ?? basename(n.id), sub: n.image ?? 'infra' };
  if (n?.kind === 'service') return { title: n.service ?? basename(n.id), sub: n.image ?? 'service' };
  return { title: basename(u.nodeId!), sub: `${n?.loc ?? 0} loc · ↑${m?.impact ?? 0}` };
}

export function unitSize(key: string, view: View, bp: Blueprint): { w: number; h: number } {
  const { title, sub } = unitLabel(key, view, bp);
  const chars = Math.max(title.length * 1.05, sub.length * 0.9);
  const w = Math.round(Math.min(280, Math.max(118, chars * CHAR + 34)));
  const u = view.units.get(key)!;
  const node = u.nodeId ? nodeIndex(bp).get(u.nodeId) : undefined;
  if (node?.kind === 'infra') return { w: Math.max(w, 130), h: 70 };
  return { w, h: u.kind === 'folder' ? 58 : 50 };
}

export async function layoutView(view: View, bp: Blueprint): Promise<Layout> {
  const toElk = (items: ViewItem[]): any[] =>
    items.map((it) => {
      if (it.type === 'unit') {
        const { w, h } = unitSize(it.key, view, bp);
        return { id: it.key, width: w, height: h };
      }
      const name = view.containers.get(it.key)!.folder.name;
      const minW = Math.max(180, name.length * 9.4 + 160);
      return {
        id: it.key,
        layoutOptions: {
          'elk.padding': '[top=42,left=22,bottom=22,right=22]',
          'elk.nodeSize.constraints': 'MINIMUM_SIZE',
          'elk.nodeSize.minimum': `(${minW}, 80)`,
        },
        children: toElk(it.children),
      };
    });

  const graph = {
    id: 'root',
    layoutOptions: {
      'elk.algorithm': 'layered',
      'elk.direction': 'DOWN',
      'elk.hierarchyHandling': 'INCLUDE_CHILDREN',
      'elk.edgeRouting': 'ORTHOGONAL',
      'elk.layered.spacing.nodeNodeBetweenLayers': '54',
      'elk.layered.spacing.edgeNodeBetweenLayers': '18',
      'elk.spacing.nodeNode': '26',
      'elk.spacing.edgeNode': '14',
      'elk.spacing.edgeEdge': '7',
      'elk.spacing.componentComponent': '48',
      'elk.layered.nodePlacement.strategy': 'BRANDES_KOEPF',
      'elk.layered.mergeEdges': 'true',
      'elk.layered.crossingMinimization.strategy': 'LAYER_SWEEP',
      'elk.json.edgeCoords': 'ROOT',
      'elk.json.shapeCoords': 'ROOT',
      'elk.padding': '[top=30,left=30,bottom=30,right=30]',
    },
    children: toElk(view.tree),
    edges: view.edges.map((e) => ({ id: e.key, sources: [e.from], targets: [e.to] })),
  };

  const res: any = await elk.layout(graph as any);
  const boxes = new Map<string, Box>();
  const walk = (n: any) => {
    for (const c of n.children ?? []) {
      boxes.set(c.id, { x: c.x, y: c.y, w: c.width, h: c.height });
      walk(c);
    }
  };
  walk(res);
  const edges = new Map<string, { x: number; y: number }[]>();
  const collect = (n: any) => {
    for (const e of n.edges ?? []) {
      const s = e.sections?.[0];
      if (s) edges.set(e.id, [s.startPoint, ...(s.bendPoints ?? []), s.endPoint]);
    }
    for (const c of n.children ?? []) collect(c);
  };
  collect(res);
  return { boxes, edges, bounds: { x: 0, y: 0, w: res.width ?? 800, h: res.height ?? 600 } };
}
