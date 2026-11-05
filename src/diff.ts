import fs from 'node:fs';
import { analyze, affectedBy, type AnalyzeOptions } from './analyzer/index.js';
import { changedSince, describeRef, snapshot } from './analyzer/git.js';
import type { Blueprint, DiffInfo } from './types.js';

const sig = (c: string[]) => [...c].sort().join('|');

/** Compare the project at `base` (a git ref) with the working tree: a renovation plan. */
export async function diffAgainst(opts: AnalyzeOptions & { base: string }): Promise<{ head: Blueprint; base: Blueprint; diff: DiffInfo }> {
  const log = opts.onProgress ?? (() => {});
  log(`Surveying ${opts.base}…`);
  const dir = snapshot(opts.root, opts.base);
  let base: Blueprint;
  try {
    base = await analyze({ ...opts, root: dir, light: true, onProgress: () => {} });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  log('Surveying the working tree…');
  const head = await analyze(opts);
  const baseIds = new Set(base.nodes.map((n) => n.id));
  const headIds = new Set(head.nodes.map((n) => n.id));
  const touched = new Set(changedSince(opts.root, opts.base));

  const added = head.nodes.filter((n) => !baseIds.has(n.id)).map((n) => n.id);
  const removed = base.nodes.filter((n) => !headIds.has(n.id)).map((n) => n.id);
  const changed = head.nodes.filter((n) => baseIds.has(n.id) && touched.has(n.id)).map((n) => n.id);
  const seeds = [...added, ...changed];
  const seedSet = new Set(seeds);
  // removed files break whoever imported them in the base drawing
  const brokenByRemoval = removed.length ? affectedBy(removed, base.nodes, base.edges).filter((id) => headIds.has(id)) : [];
  const affected = [...new Set([...affectedBy(seeds, head.nodes, head.edges), ...brokenByRemoval])].filter((id) => !seedSet.has(id));

  const baseCycles = new Set(base.cycles.map(sig));
  const headCycles = new Set(head.cycles.map(sig));
  const newCycles = head.cycles.filter((c) => !baseCycles.has(sig(c)));
  const fixedCycles = base.cycles.filter((c) => !headCycles.has(sig(c))).length;
  const pillarsTouched = changed.filter((id) => ['pillar', 'foundation'].includes(head.metrics[id]?.role));
  const routeKey = (r: { source: string; sink: string }) => `${r.source}>${r.sink}`;
  const baseRoutes = new Set((base.security?.routes ?? []).map(routeKey));
  const newFireRoutes = (head.security?.routes ?? []).filter((r) => !baseRoutes.has(routeKey(r)) && r.severity !== 'low');

  const diff: DiffInfo = {
    base: opts.base,
    baseLabel: describeRef(opts.root, opts.base),
    added,
    removed,
    changed,
    affected,
    newCycles,
    fixedCycles,
    scoreBefore: base.summary.score,
    scoreAfter: head.summary.score,
    pillarsTouched,
    newFireRoutes,
  };
  head.diff = diff;
  return { head, base, diff };
}

// ───────────────────── PR comment (GitHub markdown + mermaid) ─────────────────────

const MARKER = '<!-- blueprint-bot -->';
const pct = (x: number) => `${Math.round(x * 100)}%`;

export function prComment(head: Blueprint, d: DiffInfo, opts: { runUrl?: string } = {}): string {
  const svc = new Map(head.nodes.map((n) => [n.id, n.service]));
  const short = (id: string) => {
    if (id.startsWith('@')) return id;
    const base = id.split('/').slice(-2).join('/');
    const s = svc.get(id);
    return s && !base.startsWith(s) ? `${s.replace(/^@[^/]+\//, '')}:${base.replace(/^src\//, '')}` : base;
  };
  const total = Math.max(1, head.nodes.length);
  const delta = d.scoreAfter - d.scoreBefore;
  const deltaTxt = delta === 0 ? '±0' : delta > 0 ? `+${delta}` : `${delta}`;
  const blast = d.affected.length;
  const level = d.newCycles.length || d.newFireRoutes.some((r) => r.severity === 'high') ? '🔴' : d.pillarsTouched.length || blast / total > 0.25 ? '🟠' : '🟢';
  const L: string[] = [MARKER, `## ▦ Blueprint · structural review ${level}`, ''];
  L.push('| | |', '|---|---|');
  L.push(`| **Health** | ${d.scoreBefore} → **${d.scoreAfter}** (${deltaTxt}) |`);
  L.push(`| **Blast radius** | ${blast} module(s) affected · ${pct(blast / total)} of the building |`);
  L.push(`| **Renovation** | ${d.changed.length} changed · ${d.added.length} new · ${d.removed.length} demolished |`);
  L.push(`| **Pillars touched** | ${d.pillarsTouched.length} |`);
  L.push(`| **Cracks** | ${d.newCycles.length ? `⚠️ ${d.newCycles.length} new` : 'no new cracks'}${d.fixedCycles ? ` · ✅ ${d.fixedCycles} repaired` : ''} |`);
  L.push(`| **Fire routes** | ${d.newFireRoutes.length ? `🔥 ${d.newFireRoutes.length} new` : 'no new routes'} |`);
  L.push('');

  if (d.pillarsTouched.length) {
    L.push('### Load-bearing modules touched', '');
    for (const id of d.pillarsTouched.slice(0, 10)) {
      const m = head.metrics[id];
      const owner = head.nodes.find((n) => n.id === id)?.git?.authors[0]?.name;
      L.push(`- \`${id}\` holds up **${m.impact}** modules (${pct(m.impactPct)})${owner ? ` · mostly built by ${owner}` : ''}`);
    }
    L.push('');
  }
  if (d.newCycles.length) {
    L.push('### ⚠️ New cracks (circular dependencies)', '');
    for (const c of d.newCycles.slice(0, 5)) L.push(`- ${c.map((x) => `\`${short(x)}\``).join(' ⇄ ')}`);
    L.push('');
  }
  if (d.newFireRoutes.length) {
    L.push('### 🔥 New fire routes (untrusted input → dangerous call)', '');
    for (const r of d.newFireRoutes.slice(0, 5)) L.push(`- **${r.severity}** · ${r.kind}: ${r.path.map((x) => `\`${short(x)}\``).join(' → ')}`);
    L.push('');
  }

  // mermaid sketch of the renovation
  const changedSet = new Set(d.changed);
  const addedSet = new Set(d.added);
  const affectedTop = [...d.affected].sort((a, b) => (head.metrics[b]?.impact ?? 0) - (head.metrics[a]?.impact ?? 0)).slice(0, 14);
  const ids = [...new Set([...d.added, ...d.changed].slice(0, 14).concat(affectedTop))];
  if (ids.length) {
    const key = new Map(ids.map((id, i) => [id, `n${i}`]));
    const M: string[] = ['```mermaid', 'flowchart BT'];
    for (const id of ids) {
      const cls = addedSet.has(id) ? 'added' : changedSet.has(id) ? 'changed' : 'affected';
      M.push(`  ${key.get(id)}["${short(id).replace(/"/g, "'")}"]:::${cls}`);
    }
    let edges = 0;
    for (const e of head.edges) {
      if (edges >= 40) break;
      if (e.kind === 'type' || !key.has(e.from) || !key.has(e.to)) continue;
      M.push(`  ${key.get(e.to)} --> ${key.get(e.from)}`);
      edges++;
    }
    M.push(
      '  classDef changed fill:#ffd166,stroke:#8a6d00,color:#2b2100',
      '  classDef added fill:#7ee2a8,stroke:#1d6b41,color:#0b2a18',
      '  classDef affected fill:#ffb3b3,stroke:#a32d2d,color:#3a0d0d',
      '```',
    );
    L.push('<details><summary>Renovation sketch: <b>yellow</b> changed · <b>green</b> new · <b>red</b> affected (arrows point from a module to what stands on it)</summary>', '', ...M, '', '</details>', '');
  }
  if (d.affected.length) {
    L.push(`<details><summary>All ${d.affected.length} affected modules</summary>`, '');
    for (const id of d.affected.slice(0, 200)) L.push(`- \`${id}\``);
    L.push('', '</details>', '');
  }
  L.push(`<sub>Compared with \`${d.baseLabel}\`${opts.runUrl ? ` · [interactive blueprint](${opts.runUrl}) (download the *blueprint* artifact)` : ''} · drawn by [blueprint](https://github.com/gianmateus/blueprint)</sub>`);
  return L.join('\n');
}
