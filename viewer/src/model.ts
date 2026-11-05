import type { Blueprint, BlueprintEdge, EdgeKind, Role } from '../../src/types';

export interface Folder {
  key: string; // '' for root, otherwise path like 'services/rides/src'
  name: string; // display name (compressed segments)
  folders: Folder[];
  files: string[]; // node ids directly inside
  all: string[]; // every node id below
  parent?: Folder;
  loc: number;
}

export const ROLE_RANK: Record<Role, number> = { foundation: 6, pillar: 5, beam: 4, wall: 3, entry: 2, orphan: 1 };

export function buildTree(bp: Blueprint): { root: Folder; folders: Map<string, Folder> } {
  const root: Folder = { key: '', name: bp.name, folders: [], files: [], all: [], loc: 0 };
  const byKey = new Map<string, Folder>([['', root]]);
  for (const n of bp.nodes) {
    const parts = n.path.split('/');
    parts.pop();
    let cur = root;
    let key = '';
    for (const p of parts) {
      key = key ? `${key}/${p}` : p;
      let f = byKey.get(key);
      if (!f) {
        f = { key, name: p, folders: [], files: [], all: [], parent: cur, loc: 0 };
        byKey.set(key, f);
        cur.folders.push(f);
      }
      cur = f;
    }
    cur.files.push(n.id);
  }
  // compress chains like src -> app -> lib with a single folder child and no files
  const compress = (f: Folder) => {
    for (const c of f.folders) compress(c);
    if (f !== root) {
      while (f.folders.length === 1 && f.files.length === 0) {
        const only = f.folders[0];
        byKey.delete(f.key);
        f.name = `${f.name}/${only.name}`;
        f.key = only.key;
        f.folders = only.folders;
        f.files = only.files;
        for (const c of f.folders) c.parent = f;
        byKey.set(f.key, f);
      }
    }
  };
  compress(root);
  // root with a single folder and no files: skip straight into it
  const locOf = new Map(bp.nodes.map((n) => [n.id, n.loc]));
  const fill = (f: Folder): string[] => {
    f.all = [...f.files, ...f.folders.flatMap(fill)];
    f.loc = f.all.reduce((s, id) => s + (locOf.get(id) ?? 0), 0);
    f.folders.sort((a, b) => a.name.localeCompare(b.name));
    f.files.sort();
    return f.all;
  };
  fill(root);
  byKey.clear();
  const walk = (f: Folder) => {
    byKey.set(f.key, f);
    f.folders.forEach(walk);
  };
  walk(root);
  return { root, folders: byKey };
}

/**
 * Open the drawing one level at a time (like a site plan, then floor plans)
 * until roughly `budget` blocks are visible.
 */
export function initialExpansion(root: Folder, budget = 36): Set<string> {
  const expanded = new Set<string>(['']);
  let visible = root.folders.length + root.files.length;
  let level = [...root.folders];
  while (level.length) {
    level.sort((a, b) => b.all.length - a.all.length);
    const total = level.reduce((sum, f) => sum + f.folders.length + f.files.length - 1, 0);
    const whole = visible + total <= budget;
    // open a whole level at a time; only the first level may be opened partially (huge repos)
    if (!whole && expanded.size > 1) break;
    const next: Folder[] = [];
    for (const f of level) {
      const add = f.folders.length + f.files.length - 1;
      if (visible + add > budget) continue;
      expanded.add(f.key);
      visible += add;
      next.push(...f.folders);
    }
    if (!whole) break;
    level = next;
  }
  return expanded;
}

export interface Unit {
  key: string; // 'f:<folderKey>' | 'n:<nodeId>'
  kind: 'folder' | 'node';
  folder?: Folder;
  nodeId?: string;
  ids: string[];
}

export interface Container {
  key: string; // 'c:<folderKey>'
  folder: Folder;
}

export interface View {
  units: Map<string, Unit>;
  containers: Map<string, Container>;
  /** node id -> unit key */
  unitOf: Map<string, string>;
  /** ELK-ready nested structure */
  tree: ViewItem[];
  edges: AggEdge[];
}

export type ViewItem = { type: 'unit'; key: string } | { type: 'container'; key: string; children: ViewItem[] };

export interface AggEdge {
  key: string;
  from: string;
  to: string;
  count: number;
  kind: EdgeKind;
  vias: string[];
}

const RANK: Record<EdgeKind, number> = { import: 5, reexport: 4, http: 3, infra: 3, dynamic: 2, type: 1 };

export function buildView(root: Folder, expanded: Set<string>, edges: BlueprintEdge[], showNetwork: boolean): View {
  const units = new Map<string, Unit>();
  const containers = new Map<string, Container>();
  const unitOf = new Map<string, string>();

  const visit = (f: Folder): ViewItem[] => {
    const items: ViewItem[] = [];
    for (const c of f.folders) {
      if (expanded.has(c.key)) {
        const key = `c:${c.key}`;
        containers.set(key, { key, folder: c });
        items.push({ type: 'container', key, children: visit(c) });
      } else {
        const key = `f:${c.key}`;
        units.set(key, { key, kind: 'folder', folder: c, ids: c.all });
        c.all.forEach((id) => unitOf.set(id, key));
        items.push({ type: 'unit', key });
      }
    }
    for (const id of f.files) {
      const key = `n:${id}`;
      units.set(key, { key, kind: 'node', nodeId: id, ids: [id] });
      unitOf.set(id, key);
      items.push({ type: 'unit', key });
    }
    return items;
  };
  const tree = visit(root);

  const agg = new Map<string, AggEdge>();
  for (const e of edges) {
    if (!showNetwork && (e.kind === 'http' || e.kind === 'infra')) continue;
    const a = unitOf.get(e.from);
    const b = unitOf.get(e.to);
    if (!a || !b || a === b) continue;
    const key = `${a}->${b}`;
    const prev = agg.get(key);
    if (!prev) agg.set(key, { key, from: a, to: b, count: 1, kind: e.kind, vias: e.via ? [e.via] : [] });
    else {
      prev.count++;
      if (RANK[e.kind] > RANK[prev.kind]) prev.kind = e.kind;
      if (e.via && !prev.vias.includes(e.via) && prev.vias.length < 4) prev.vias.push(e.via);
    }
  }
  return { units, containers, unitOf, tree, edges: [...agg.values()] };
}

/** strongest role inside a folder */
export function folderRole(ids: string[], bp: Blueprint): Role {
  let best: Role = 'orphan';
  for (const id of ids) {
    const r = bp.metrics[id]?.role;
    if (r && ROLE_RANK[r] > ROLE_RANK[best]) best = r;
  }
  return best;
}

export function makeRev(bp: Blueprint): Map<string, string[]> {
  const rev = new Map<string, string[]>();
  for (const n of bp.nodes) rev.set(n.id, []);
  for (const e of bp.edges) {
    if (e.kind === 'type' || e.from === e.to) continue;
    const r = rev.get(e.to);
    if (r && !r.includes(e.from)) r.push(e.from);
  }
  return rev;
}

/** BFS upward from the removed modules: who falls, and in which wave. */
export function collapse(removed: string[], seeds: string[], rev: Map<string, string[]>): Map<string, number> {
  const removedSet = new Set(removed);
  const level = new Map<string, number>();
  const queue: string[] = [];
  for (const s of seeds) if (!removedSet.has(s) && !level.has(s)) {
    level.set(s, 1);
    queue.push(s);
  }
  for (const r of removed) for (const p of rev.get(r) ?? []) if (!removedSet.has(p) && !level.has(p)) {
    level.set(p, 1);
    queue.push(p);
  }
  while (queue.length) {
    const v = queue.shift()!;
    for (const p of rev.get(v) ?? []) {
      if (!removedSet.has(p) && !level.has(p)) {
        level.set(p, level.get(v)! + 1);
        queue.push(p);
      }
    }
  }
  return level;
}

const nodeIndexCache = new WeakMap<Blueprint, Map<string, Blueprint['nodes'][number]>>();
export function nodeIndex(bp: Blueprint) {
  let m = nodeIndexCache.get(bp);
  if (!m) {
    m = new Map(bp.nodes.map((n) => [n.id, n]));
    nodeIndexCache.set(bp, m);
  }
  return m;
}

export function basename(id: string) {
  const i = id.lastIndexOf('/');
  return i >= 0 ? id.slice(i + 1) : id;
}
