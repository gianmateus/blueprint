import { describe, expect, it } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { analyze } from './index.js';
import { parseFile } from './parse.js';
import { computeMetrics, dependentsOf, adjacency, stronglyConnected } from './metrics.js';
import { pointsAt } from './services.js';
import { renderReport } from '../report.js';
import type { BlueprintEdge, BlueprintNode } from '../types.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const example = path.resolve(here, '../../examples/ride-hailing');

describe('parseFile', () => {
  it('finds imports, re-exports, requires, dynamic imports and exports', () => {
    const p = parseFile(
      'a.ts',
      `import x, { a, b as c } from './one';
       import type { T } from './types';
       import * as ns from './ns';
       import './side-effect';
       export * from './barrel';
       export { z } from './zed';
       const fs = require('fs');
       export async function load() { return import('./lazy'); }
       export class Thing {}
       export const value = 1, arrow = () => 2;
       export type Alias = string;
       export default function () {}
       const url = process.env.API_URL;
       const cfg = loadConfig(['DATABASE_URL']);`,
    );
    const by = Object.fromEntries(p.imports.map((i) => [i.specifier, i]));
    expect(by['./one'].symbols).toEqual(['default', 'a', 'b']);
    expect(by['./types'].kind).toBe('type');
    expect(by['./ns'].symbols).toEqual(['*']);
    expect(by['./side-effect'].sideEffect).toBe(true);
    expect(by['./barrel'].kind).toBe('reexport');
    expect(by['./zed'].symbols).toEqual(['z']);
    expect(by['fs'].kind).toBe('import');
    expect(by['./lazy'].kind).toBe('dynamic');
    const names = p.exports.map((e) => `${e.name}:${e.kind}`);
    expect(names).toEqual(expect.arrayContaining(['load:function', 'Thing:class', 'value:const', 'arrow:function', 'Alias:type', 'default:function', 'z:other']));
    expect(p.env).toEqual(expect.arrayContaining(['API_URL', 'DATABASE_URL']));
  });
});

describe('graph algorithms', () => {
  const node = (id: string): BlueprintNode => ({ id, kind: 'file', path: id, loc: 1, exports: [], externals: [], isEntry: false, isTest: false });
  const edge = (from: string, to: string): BlueprintEdge => ({ from, to, kind: 'import' });

  it('finds cycles with Tarjan', () => {
    const out = new Map([
      ['a', ['b']],
      ['b', ['c']],
      ['c', ['a', 'd']],
      ['d', []],
    ]);
    const sccs = stronglyConnected(['a', 'b', 'c', 'd'], out);
    expect(sccs.find((c) => c.length === 3)?.sort()).toEqual(['a', 'b', 'c']);
  });

  it('computes impact, roles and floors', () => {
    const nodes = ['app', 'svc', 'util', 'dead'].map(node);
    nodes[0].isEntry = true;
    const edges = [edge('app', 'svc'), edge('svc', 'util'), edge('app', 'util')];
    const { metrics } = computeMetrics(nodes, edges, { pillarThreshold: 0.5 });
    expect(metrics.util.impact).toBe(2);
    expect(metrics.util.floor).toBe(0);
    expect(metrics.app.floor).toBe(2);
    expect(metrics.app.role).toBe('entry');
    expect(metrics.dead.role).toBe('orphan');
    const { rev } = adjacency(nodes, edges);
    expect([...dependentsOf('util', rev)].sort()).toEqual(['app', 'svc']);
  });

  it('ignores type-only edges for structure', () => {
    const nodes = ['a', 'b'].map(node);
    const { metrics } = computeMetrics(nodes, [{ from: 'a', to: 'b', kind: 'type' }]);
    expect(metrics.b.impact).toBe(0);
  });
});

describe('pointsAt', () => {
  it('matches service hostnames inside URLs', () => {
    expect(pointsAt('http://users:4001', 'users')).toBe(true);
    expect(pointsAt('postgres://app:app@postgres:5432/db', 'postgres')).toBe(true);
    expect(pointsAt('redis://redis:6379', 'redis')).toBe(true);
    expect(pointsAt('http://superusers:4001', 'users')).toBe(false);
  });
});

describe('analyze (ride-hailing example)', async () => {
  const bp = await analyze({ root: example });
  const m = bp.metrics;
  const edge = (from: string, to: string) => bp.edges.find((e) => e.from === from && e.to === to);

  it('resolves workspace packages to their sources', () => {
    expect(edge('services/gateway/src/index.ts', 'packages/shared/src/index.ts')).toBeTruthy();
  });
  it('marks the shared logger as a foundation', () => {
    expect(m['packages/shared/src/logger.ts'].role).toBe('foundation');
  });
  it('finds the matching <-> eta crack', () => {
    expect(bp.cycles).toContainEqual(expect.arrayContaining(['services/rides/src/domain/matching.ts', 'services/rides/src/domain/eta.ts']));
  });
  it('flags legacy code as rubble', () => {
    expect(m['services/rides/src/legacy/surgeV1.ts'].role).toBe('orphan');
  });
  it('connects services over the network via env vars', () => {
    const e = edge('services/gateway/src/middleware/auth.ts', 'services/users/src/index.ts');
    expect(e?.kind).toBe('http');
    expect(e?.via).toBe('USERS_URL');
    expect(edge('services/rides/src/repo.ts', '@infra/postgres')?.kind).toBe('infra');
    expect(edge('services/rides/src/clients/pricing.ts', 'services/pricing/app.py')?.via).toBe('PRICING_URL');
  });
  it('tracks who uses each export', () => {
    const http = bp.nodes.find((n) => n.id === 'packages/shared/src/index.ts')!.exports.find((e) => e.name === 'httpJson')!;
    expect(http.usedBy).toContain('services/rides/src/clients/users.ts');
  });
  it('renders a report in both languages', () => {
    expect(renderReport(bp, 'en')).toContain('Structural inspection report');
    expect(renderReport(bp, 'pt')).toContain('Laudo de vistoria estrutural');
  });
});
