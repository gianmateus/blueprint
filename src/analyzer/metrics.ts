import type { BlueprintEdge, BlueprintNode, NodeMetrics, Role, Summary, ServiceInfo } from '../types.js';

export interface MetricsOptions {
  /** share of the building a node must hold up to be a pillar (default 0.15) */
  pillarThreshold?: number;
  /** share for a beam (default 0.05) */
  beamThreshold?: number;
}

export interface MetricsResult {
  metrics: Record<string, NodeMetrics>;
  cycles: string[][];
}

/** Edges that represent a real runtime dependency (type-only imports don't hold anything up). */
export const isStructural = (e: BlueprintEdge) => e.kind !== 'type';

/** Tarjan's strongly connected components (iterative, safe for big graphs). */
export function stronglyConnected(ids: string[], out: Map<string, string[]>): string[][] {
  let index = 0;
  const idx = new Map<string, number>();
  const low = new Map<string, number>();
  const onStack = new Set<string>();
  const stack: string[] = [];
  const result: string[][] = [];

  for (const start of ids) {
    if (idx.has(start)) continue;
    const work: [string, number][] = [[start, 0]];
    while (work.length) {
      const frame = work[work.length - 1];
      const [v, i] = frame;
      if (i === 0) {
        idx.set(v, index);
        low.set(v, index);
        index++;
        stack.push(v);
        onStack.add(v);
      }
      const nbrs = out.get(v) ?? [];
      if (i < nbrs.length) {
        frame[1]++;
        const w = nbrs[i];
        if (!idx.has(w)) work.push([w, 0]);
        else if (onStack.has(w)) low.set(v, Math.min(low.get(v)!, idx.get(w)!));
        continue;
      }
      work.pop();
      if (work.length) {
        const parent = work[work.length - 1][0];
        low.set(parent, Math.min(low.get(parent)!, low.get(v)!));
      }
      if (low.get(v) === idx.get(v)) {
        const comp: string[] = [];
        let w: string;
        do {
          w = stack.pop()!;
          onStack.delete(w);
          comp.push(w);
        } while (w !== v);
        result.push(comp);
      }
    }
  }
  return result;
}

/** All nodes that transitively depend on `start` (reverse reachability), excluding start. */
export function dependentsOf(start: string | string[], rev: Map<string, string[]>): Set<string> {
  const starts = Array.isArray(start) ? start : [start];
  const seen = new Set<string>(starts);
  const queue = [...starts];
  while (queue.length) {
    const v = queue.shift()!;
    for (const p of rev.get(v) ?? []) {
      if (!seen.has(p)) {
        seen.add(p);
        queue.push(p);
      }
    }
  }
  for (const s of starts) seen.delete(s);
  return seen;
}

export function adjacency(nodes: BlueprintNode[], edges: BlueprintEdge[]) {
  const out = new Map<string, string[]>();
  const rev = new Map<string, string[]>();
  for (const n of nodes) {
    out.set(n.id, []);
    rev.set(n.id, []);
  }
  for (const e of edges) {
    if (!isStructural(e) || e.from === e.to || !out.has(e.from) || !out.has(e.to)) continue;
    const o = out.get(e.from)!;
    if (!o.includes(e.to)) o.push(e.to);
    const r = rev.get(e.to)!;
    if (!r.includes(e.from)) r.push(e.from);
  }
  return { out, rev };
}

export function computeMetrics(nodes: BlueprintNode[], edges: BlueprintEdge[], opts: MetricsOptions = {}): MetricsResult {
  const pillarT = opts.pillarThreshold ?? 0.15;
  const beamT = opts.beamThreshold ?? 0.05;
  const ids = nodes.map((n) => n.id);
  const { out, rev } = adjacency(nodes, edges);

  // cycles = "cracks"
  const sccs = stronglyConnected(ids, out);
  const cycles = sccs.filter((c) => c.length > 1).sort((a, b) => b.length - a.length);
  const cycleOf = new Map<string, number>();
  cycles.forEach((c, i) => c.forEach((id) => cycleOf.set(id, i)));

  // floors: longest path down to the foundation, computed on the condensation DAG
  const compOf = new Map<string, number>();
  sccs.forEach((c, i) => c.forEach((id) => compOf.set(id, i)));
  // Tarjan emits components in reverse topological order: dependencies first.
  const compFloor = new Array<number>(sccs.length).fill(0);
  sccs.forEach((comp, ci) => {
    let f = 0;
    for (const v of comp) for (const w of out.get(v) ?? []) {
      const cw = compOf.get(w)!;
      if (cw !== ci) f = Math.max(f, compFloor[cw] + 1);
    }
    compFloor[ci] = f;
  });

  const total = Math.max(1, nodes.length - 1);
  const metrics: Record<string, NodeMetrics> = {};
  for (const n of nodes) {
    const impact = dependentsOf(n.id, rev).size;
    const impactPct = impact / total;
    const fanIn = rev.get(n.id)!.length;
    const fanOut = out.get(n.id)!.length;
    let role: Role;
    if (impact >= 3 && impactPct >= pillarT) role = fanOut === 0 ? 'foundation' : 'pillar';
    else if (impact >= 2 && impactPct >= beamT) role = 'beam';
    else if (impact > 0) role = 'wall';
    else role = n.isEntry || n.isTest || n.kind !== 'file' ? 'entry' : 'orphan';
    metrics[n.id] = { fanIn, fanOut, impact, impactPct, role, floor: compFloor[compOf.get(n.id)!] };
    const c = cycleOf.get(n.id);
    if (c !== undefined) metrics[n.id].cycle = c;
  }
  return { metrics, cycles };
}

export function summarize(nodes: BlueprintNode[], edges: BlueprintEdge[], m: MetricsResult, services: ServiceInfo[]): Summary {
  const files = nodes.filter((n) => n.kind === 'file');
  const N = Math.max(1, nodes.length);
  const vals = Object.values(m.metrics);
  const count = (r: string) => vals.filter((v) => v.role === r).length;
  const filesInCycles = m.cycles.reduce((s, c) => s + c.length, 0);
  const floors = vals.reduce((mx, v) => Math.max(mx, v.floor), 0) + (nodes.length ? 1 : 0);
  const orphans = count('orphan');
  const pillars = count('pillar');
  const foundations = count('foundation');

  const ext = new Map<string, number>();
  for (const n of files) for (const e of n.externals) if (!e.startsWith('node:')) ext.set(e, (ext.get(e) ?? 0) + 1);
  const topExternals = [...ext.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15).map(([name, count]) => ({ name, count }));

  // Structural health score. Deliberately simple and explainable.
  const breakdown: { label: string; penalty: number }[] = [];
  const cyclePenalty = Math.min(30, Math.round((filesInCycles / N) * 100 * 1.2 + m.cycles.length * 1.5));
  if (cyclePenalty) breakdown.push({ label: 'cracks', penalty: cyclePenalty });
  const orphanPenalty = Math.min(15, Math.round((orphans / N) * 100 * 0.6));
  if (orphanPenalty) breakdown.push({ label: 'rubble', penalty: orphanPenalty });
  // coupling: on average, how much of the building does a module hold up? (smooth, unlike counting pillars)
  const structural = vals.filter((v) => v.role !== 'foundation');
  const avgLoad = structural.reduce((sum, v) => sum + v.impactPct, 0) / Math.max(1, structural.length);
  const concentrationPenalty = Math.min(12, Math.round(Math.max(0, avgLoad - 0.08) * 60));
  if (concentrationPenalty) breakdown.push({ label: 'load', penalty: concentrationPenalty });
  const heightPenalty = Math.min(10, Math.max(0, Math.round((floors - 15) / 1.5)));
  if (heightPenalty) breakdown.push({ label: 'height', penalty: heightPenalty });
  const giant = files.filter((f) => f.loc > 800).length;
  const giantPenalty = Math.min(10, Math.round((giant / Math.max(1, files.length)) * 100 * 1.5 + Math.min(giant, 3)));
  if (giantPenalty) breakdown.push({ label: 'giants', penalty: giantPenalty });
  // fire safety: dangerous calls and hard-coded secrets
  let high = 0;
  let medium = 0;
  for (const n of nodes) {
    for (const f of [...(n.security?.sinks ?? []), ...(n.security?.secrets ?? [])]) {
      if (f.severity === 'high') high++;
      else if (f.severity === 'medium') medium++;
    }
  }
  const firePenalty = Math.min(10, Math.round(high * 2.5 + medium * 0.75));
  if (firePenalty) breakdown.push({ label: 'fire', penalty: firePenalty });
  const score = Math.max(0, 100 - breakdown.reduce((s, b) => s + b.penalty, 0));

  return {
    files: files.length,
    loc: files.reduce((s, f) => s + f.loc, 0),
    edges: edges.length,
    floors,
    pillars,
    foundations,
    orphans,
    cycles: m.cycles.length,
    filesInCycles,
    services: services.filter((s) => s.kind !== 'package').length,
    score,
    scoreBreakdown: breakdown,
    topExternals,
  };
}
