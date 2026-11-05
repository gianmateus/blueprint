import fs from 'node:fs';
import path from 'node:path';
import fg from 'fast-glob';
import { parseFile, type ParsedFile } from './parse.js';
import { Resolver, type WorkspacePackage } from './resolve.js';
import { computeMetrics, summarize } from './metrics.js';
import { findComposeServices, isInfra, pointsAt, toServiceInfo } from './services.js';
import { findGoModules, parseGo, parsePython, resolveGo, resolvePython } from './polyglot.js';
import { hasSecurity } from './security.js';
import { gitHistory } from './git.js';
import { dependentsOf, adjacency } from './metrics.js';
import { loadAnnotations, loadNotes, loadOverview, loadTimeline } from '../store.js';
import type { Blueprint, BlueprintEdge, BlueprintNode, EdgeKind, FireRoute, ServiceInfo, Severity } from '../types.js';
import { VERSION } from '../version.js';

export interface AnalyzeOptions {
  root: string;
  ignore?: string[];
  maxFiles?: number;
  pillarThreshold?: number;
  /** include type-only imports as edges (they never hold anything up, but are useful to see) */
  includeTypeEdges?: boolean;
  /** read construction history from git (default true) */
  git?: boolean;
  /** skip git history and everything stored in .blueprint/ (used for snapshots) */
  light?: boolean;
  onProgress?: (msg: string) => void;
}

export const DEFAULT_IGNORE = [
  '**/node_modules/**',
  '**/.git/**',
  '**/dist/**',
  '**/build/**',
  '**/out/**',
  '**/.next/**',
  '**/.nuxt/**',
  '**/.svelte-kit/**',
  '**/.turbo/**',
  '**/.cache/**',
  '**/coverage/**',
  '**/vendor/**',
  '**/.blueprint/**',
  '**/*.d.ts',
  '**/*.min.js',
  '**/*.bundle.js',
  '**/*.generated.*',
  '**/.venv/**',
  '**/venv/**',
  '**/__pycache__/**',
  '**/site-packages/**',
  '**/.tox/**',
  '**/.mypy_cache/**',
  '**/*_pb2.py',
  '**/*.pb.go',
];

const SOURCE_GLOB = '**/*.{ts,tsx,mts,cts,js,jsx,mjs,cjs,py,go}';
const TEST_RE = /(^|\/)(__tests__|__mocks__|tests?|e2e|spec)\/|\.(test|spec|e2e|stories|story)\.[cm]?[jt]sx?$|(^|\/)test_[^/]*\.py$|_test\.(py|go)$|(^|\/)conftest\.py$/;
const CONFIG_RE = /(^|\/)[^/]*\.config\.[cm]?[jt]s$|(^|\/)\.[^/]*rc\.[cm]?js$|(^|\/)(gulpfile|gruntfile|jest\.setup|setupTests|vitest\.setup)\.[cm]?[jt]s$/i;
const ENTRY_NAME_RE = /(^|\/)(index|main|server|app|cli|worker|bootstrap|start|entry|handler|lambda|function|manage|wsgi|asgi|__main__)\.([cm]?[jt]sx?|py|go)$/;
const NEXT_ROUTE_RE = /(^|\/)(app\/(.*\/)?(page|layout|route|loading|error|not-found|template|default|global-error|opengraph-image|sitemap|robots)|pages\/.*|middleware|instrumentation)\.[cm]?[jt]sx?$/;
const SCRIPT_DIR_RE = /(^|\/)(scripts|bin|tools|examples?|benchmarks?|bench|fixtures|playground|docs?)\//;

const KIND_RANK: Record<EdgeKind, number> = { import: 5, reexport: 4, http: 3, infra: 3, dynamic: 2, type: 1 };

function gitignorePatterns(root: string): string[] {
  const file = path.join(root, '.gitignore');
  if (!fs.existsSync(file)) return [];
  const out: string[] = [];
  for (let line of fs.readFileSync(file, 'utf8').split('\n')) {
    line = line.trim();
    if (!line || line.startsWith('#') || line.startsWith('!') || line.includes('*')) continue;
    const clean = line.replace(/^\//, '').replace(/\/$/, '');
    if (clean) out.push(`**/${clean}/**`, `${clean}/**`);
  }
  return out;
}

const posix = (p: string) => p.split(path.sep).join('/');
const langOf = (f: string): BlueprintNode['lang'] => (f.endsWith('.py') ? 'py' : f.endsWith('.go') ? 'go' : /\.[cm]?tsx?$/.test(f) ? 'ts' : 'js');
const SEV_RANK: Record<Severity, number> = { high: 3, medium: 2, low: 1, info: 0 };
const HTTP_EXPORTS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']);

export async function analyze(opts: AnalyzeOptions): Promise<Blueprint> {
  const root = path.resolve(opts.root);
  if (!fs.existsSync(root)) throw new Error(`Path not found: ${root}`);
  const log = opts.onProgress ?? (() => {});
  const ignore = [...DEFAULT_IGNORE, ...gitignorePatterns(root), ...(opts.ignore ?? [])];
  const rel = (abs: string) => posix(path.relative(root, abs));

  // ── 1. survey the site ────────────────────────────────────────────────
  log('Surveying the site…');
  let files = (await fg(SOURCE_GLOB, { cwd: root, absolute: true, ignore, dot: false, followSymbolicLinks: false })).map((f) => path.normalize(f));
  files.sort();
  const max = opts.maxFiles ?? 6000;
  if (files.length > max) {
    log(`Found ${files.length} files; analysing the first ${max} (use --max-files to change).`);
    files = files.slice(0, max);
  }
  const fileSet = new Set(files);

  const pkgFiles = await fg('**/package.json', { cwd: root, absolute: true, ignore });
  const workspaces: WorkspacePackage[] = [];
  for (const f of pkgFiles) {
    try {
      const pkg = JSON.parse(fs.readFileSync(f, 'utf8'));
      if (pkg.name) workspaces.push({ name: pkg.name, dir: path.dirname(path.normalize(f)), pkg });
    } catch {
      /* ignore broken package.json */
    }
  }
  workspaces.sort((a, b) => b.name.length - a.name.length);
  const rootPkg = workspaces.find((w) => w.dir === root)?.pkg;
  const name = rootPkg?.name ?? path.basename(root);

  // ── 2. read every room ────────────────────────────────────────────────
  log(`Reading ${files.length} files…`);
  const parsed = new Map<string, ParsedFile>();
  const goMain = new Set<string>();
  const empty = (loc: number): ParsedFile => ({ imports: [], exports: [], loc, env: [], urls: [], security: { sources: [], sinks: [], secrets: [] } });
  for (const f of files) {
    let text = '';
    try {
      text = fs.readFileSync(f, 'utf8');
    } catch {
      continue;
    }
    if (text.length > 1_500_000) {
      parsed.set(f, empty(text.split('\n').length));
      continue;
    }
    try {
      if (f.endsWith('.py')) parsed.set(f, parsePython(text));
      else if (f.endsWith('.go')) {
        const g = parseGo(text);
        if (g.isMain) goMain.add(f);
        parsed.set(f, g);
      } else parsed.set(f, parseFile(f, text));
    } catch {
      parsed.set(f, empty(text.split('\n').length));
    }
  }

  // entry points declared in package.json files
  const declaredEntries = new Set<string>();
  const resolver = new Resolver(root, fileSet, workspaces);
  for (const ws of workspaces) {
    const p = ws.pkg;
    const fields: string[] = [];
    for (const v of [p.main, p.module, p.source, p.browser]) if (typeof v === 'string') fields.push(v);
    if (typeof p.bin === 'string') fields.push(p.bin);
    else if (p.bin) fields.push(...Object.values<string>(p.bin));
    const collect = (x: any) => {
      if (typeof x === 'string') fields.push(x);
      else if (x && typeof x === 'object') Object.values(x).forEach(collect);
    };
    collect(p.exports);
    for (const script of Object.values<string>(p.scripts ?? {})) {
      for (const m of String(script).matchAll(/(?:^|\s)((?:\.\/)?[\w./-]+\.[cm]?[jt]sx?)(?=\s|$)/g)) fields.push(m[1]);
    }
    for (const fld of fields) {
      const noExt = fld.replace(/\.d\.ts$|\.[^./]+$/, '');
      for (const cand of [noExt, noExt.replace(/^\.?\/?(dist|lib|build|out)\//, 'src/')]) {
        const hit = resolver.resolve('./' + cand.replace(/^\.\//, ''), path.join(ws.dir, '__entry__.ts'));
        if (typeof hit === 'string') declaredEntries.add(hit);
      }
    }
  }

  // ── 3. nodes & edges ──────────────────────────────────────────────────
  log('Drawing the load paths…');
  const nodes: BlueprintNode[] = [];
  const nodeById = new Map<string, BlueprintNode>();
  const edgeMap = new Map<string, BlueprintEdge>();
  const addEdge = (e: BlueprintEdge) => {
    if (e.from === e.to) return;
    const key = `${e.from}\u0000${e.to}`;
    const prev = edgeMap.get(key);
    if (!prev) {
      edgeMap.set(key, { ...e, symbols: e.symbols?.length ? [...new Set(e.symbols)] : undefined });
      return;
    }
    if (KIND_RANK[e.kind] > KIND_RANK[prev.kind]) prev.kind = e.kind;
    if (e.symbols?.length) prev.symbols = [...new Set([...(prev.symbols ?? []), ...e.symbols])];
    if (e.via && !prev.via) prev.via = e.via;
  };

  for (const f of files) {
    const p = parsed.get(f);
    if (!p) continue;
    const id = rel(f);
    const isTest = TEST_RE.test(id);
    const isEntry =
      declaredEntries.has(f) ||
      goMain.has(f) ||
      CONFIG_RE.test(id) ||
      NEXT_ROUTE_RE.test(id) ||
      SCRIPT_DIR_RE.test(id) ||
      (ENTRY_NAME_RE.test(id) && id.split('/').length <= 3);
    const node: BlueprintNode = {
      id,
      kind: 'file',
      path: id,
      loc: p.loc,
      exports: p.exports.map((e) => ({ ...e, usedBy: [] })),
      externals: [],
      isEntry,
      isTest,
      env: p.env.length ? p.env : undefined,
      lang: langOf(f),
    };
    // Next.js route handlers: exported GET/POST… receive untrusted input
    if (NEXT_ROUTE_RE.test(id)) for (const e of p.exports) if (HTTP_EXPORTS.has(e.name)) p.security.sources.push({ kind: 'http-route', severity: 'info', line: e.line, detail: `${e.name} ${id.replace(/^.*?app\//, '/').replace(/\/route\.[^/]+$/, '')}` });
    // tests are full of fake secrets and toy servers: they are not part of the fire survey
    if (!isTest && hasSecurity(p.security)) {
      // build scripts and tooling run commands by design: keep the finding, lower the alarm
      if (SCRIPT_DIR_RE.test(id)) for (const f of p.security.sinks) f.severity = 'low';
      node.security = p.security;
    }
    nodes.push(node);
    nodeById.set(id, node);
  }

  const goMods = findGoModules(await fg('**/go.mod', { cwd: root, absolute: true, ignore }));
  const filesByDir = new Map<string, string[]>();
  for (const f of files) {
    const d = path.dirname(f);
    if (!filesByDir.has(d)) filesByDir.set(d, []);
    filesByDir.get(d)!.push(f);
  }
  for (const f of files) {
    const p = parsed.get(f);
    if (!p) continue;
    const from = rel(f);
    const node = nodeById.get(from)!;
    const ext = new Set<string>();
    const lang = node.lang;
    if (lang === 'py' || lang === 'go') {
      for (const imp of p.imports) {
        const r = lang === 'py' ? resolvePython(imp.specifier, f, root, fileSet, imp.symbols) : resolveGo(imp.specifier, goMods, filesByDir);
        if (!Array.isArray(r)) {
          ext.add(r.external);
          continue;
        }
        for (const target of r) {
          const to = rel(target);
          if (to === from || !nodeById.has(to)) continue;
          addEdge({ from, to, kind: imp.kind === 'dynamic' ? 'dynamic' : 'import', symbols: lang === 'py' ? imp.symbols : undefined });
          markUsage(nodeById.get(to)!, imp.symbols, from);
        }
      }
      node.externals = [...ext].sort();
      continue;
    }
    for (const imp of p.imports) {
      const r = resolver.resolve(imp.specifier, f);
      if (!r) continue;
      if (typeof r === 'object') {
        ext.add(r.external);
        continue;
      }
      const to = rel(r);
      if (!nodeById.has(to)) continue;
      if (imp.kind === 'type' && !opts.includeTypeEdges) {
        // still record symbol usage, but no structural edge
        markUsage(nodeById.get(to)!, imp.symbols, from);
        continue;
      }
      addEdge({ from, to, kind: imp.kind, symbols: imp.symbols });
      markUsage(nodeById.get(to)!, imp.symbols, from);
    }
    node.externals = [...ext].sort();
  }

  // ── 4. v2: services, infrastructure, network edges ────────────────────
  log('Looking for services…');
  const services: ServiceInfo[] = [];
  const compose = findComposeServices(root, ignore);
  const serviceEntry = new Map<string, string>();
  const appDirs = compose.filter((s) => s.dir && !isInfra(s)).sort((a, b) => b.dir!.length - a.dir!.length);

  for (const s of compose) {
    const info = toServiceInfo(s, root);
    services.push(info);
    if (info.kind === 'infra') {
      const id = `@infra/${s.name}`;
      const n: BlueprintNode = { id, kind: 'infra', path: id, loc: 0, exports: [], externals: [], isEntry: false, isTest: false, image: s.image, service: s.name };
      nodes.push(n);
      nodeById.set(id, n);
      serviceEntry.set(s.name, id);
      info.entry = id;
    }
  }
  // assign files to services (longest matching build context wins)
  for (const n of nodes) {
    if (n.kind !== 'file') continue;
    const abs = path.join(root, n.id);
    const svc = appDirs.find((s) => abs === s.dir || abs.startsWith(s.dir! + path.sep));
    if (svc) n.service = svc.name;
    else {
      const ws = workspaces.filter((w) => w.dir !== root && abs.startsWith(w.dir + path.sep)).sort((a, b) => b.dir.length - a.dir.length)[0];
      if (ws) n.service = ws.name;
    }
  }
  for (const s of compose) {
    if (isInfra(s)) continue;
    const info = services.find((x) => x.name === s.name)!;
    const own = nodes.filter((n) => n.kind === 'file' && n.service === s.name);
    let entry: string | undefined;
    if (own.length) {
      const score = (n: BlueprintNode) =>
        (declaredEntries.has(path.join(root, n.id)) ? 100 : 0) +
        (/(^|\/)(server|main|index|app)\.([cm]?[jt]sx?|py|go)$/.test(n.id) ? 20 : 0) +
        (goMain.has(path.join(root, n.id)) ? 30 : 0) +
        (/\/src\/[^/]+$/.test(n.id) ? 10 : 0) -
        n.id.split('/').length -
        (n.isTest ? 200 : 0);
      entry = own.slice().sort((a, b) => score(b) - score(a))[0].id;
      nodeById.get(entry)!.isEntry = true;
    } else {
      // a service we can't read (Go, Python, a prebuilt image…): still a building on the site plan
      const id = `@service/${s.name}`;
      const dirRel = s.dir ? posix(path.relative(root, s.dir)) : '';
      const n: BlueprintNode = {
        id,
        kind: 'service',
        path: dirRel && dirRel !== '' ? `${dirRel}/${s.name} (service)` : `@services/${s.name}`,
        loc: 0,
        exports: [],
        externals: [],
        isEntry: true,
        isTest: false,
        image: s.image,
        service: s.name,
      };
      nodes.push(n);
      nodeById.set(id, n);
      entry = id;
    }
    serviceEntry.set(s.name, entry);
    info.entry = entry;
  }

  for (const a of compose) {
    if (isInfra(a)) continue;
    const aEntry = serviceEntry.get(a.name)!;
    const aFiles = nodes.filter((n) => n.kind === 'file' && n.service === a.name);
    const linked = new Set<string>();
    for (const b of compose) {
      if (b.name === a.name) continue;
      const bEntry = serviceEntry.get(b.name)!;
      const kind: EdgeKind = isInfra(b) ? 'infra' : 'http';
      for (const [k, v] of Object.entries(a.env)) {
        if (!pointsAt(v, b.name)) continue;
        const users = aFiles.filter((n) => n.env?.includes(k));
        if (users.length) users.forEach((u) => addEdge({ from: u.id, to: bEntry, kind, via: k }));
        else addEdge({ from: aEntry, to: bEntry, kind, via: k });
        linked.add(b.name);
      }
      for (const n of aFiles) {
        const url = parsed.get(path.join(root, n.id))?.urls.find((u) => pointsAt(u.replace(/^[a-z+]+:\/\//i, '//'), b.name));
        if (url) {
          addEdge({ from: n.id, to: bEntry, kind, via: url });
          linked.add(b.name);
        }
      }
      if (a.dependsOn.includes(b.name) && !linked.has(b.name)) addEdge({ from: aEntry, to: bEntry, kind, via: 'depends_on' });
    }
  }

  if (!compose.length) {
    for (const ws of workspaces) {
      if (ws.dir === root) continue;
      services.push({ name: ws.name, kind: 'package', dir: rel(ws.dir), source: 'workspace' });
    }
  }

  // ── 5. structural analysis ────────────────────────────────────────────
  log('Calculating loads…');
  const edges = [...edgeMap.values()];
  const m = computeMetrics(nodes, edges, { pillarThreshold: opts.pillarThreshold });
  const summary = summarize(nodes, edges, m, services);

  // ── 6. fire safety: from where input enters to where it can do damage ──
  log('Walking the fire routes…');
  const security = fireRoutes(nodes, edges);

  // ── 7. construction history ───────────────────────────────────────────
  let gitSummary: Blueprint['git'];
  if (opts.git !== false && !opts.light) {
    log('Reading the construction history…');
    const hist = gitHistory(root);
    if (hist) {
      const authors = new Set<string>();
      let commits = 0;
      for (const n of nodes) {
        const g = hist.get(n.id);
        if (g) {
          n.git = g;
          g.authors.forEach((a) => authors.add(a.name));
          commits = Math.max(commits, g.commits);
        }
      }
      const withGit = nodes.filter((n) => n.git);
      const hotspots = withGit
        .map((n) => ({ id: n.id, heat: n.git!.commits * (m.metrics[n.id].impact + 1) }))
        .sort((a, b) => b.heat - a.heat)
        .slice(0, 10)
        .map((h) => h.id);
      const soloPillars =
        authors.size > 1
          ? withGit.filter((n) => ['pillar', 'foundation'].includes(m.metrics[n.id].role) && n.git!.busFactor === 1 && n.git!.commits >= 2).map((n) => n.id)
          : [];
      gitSummary = { commits, authors: authors.size, hotspots, soloPillars };
    }
  }

  const bp: Blueprint = {
    schema: 1,
    name,
    generatedAt: new Date().toISOString(),
    tool: { name: 'code-blueprint', version: VERSION },
    nodes,
    edges,
    services,
    metrics: m.metrics,
    cycles: m.cycles,
    summary,
  };
  if (security.routes.length || security.high + security.medium + security.low + security.secrets) bp.security = security;
  if (gitSummary) bp.git = gitSummary;
  if (opts.light) return bp;
  const timeline = loadTimeline(root);
  if (timeline.length) bp.timeline = timeline;
  const annotations = loadAnnotations(root);
  if (Object.keys(annotations).length) bp.annotations = annotations;
  const overview = loadOverview(root);
  if (overview) bp.overview = overview;
  const notes = loadNotes(root);
  if (notes.length) bp.notes = notes;
  return bp;
}

export function fireRoutes(nodes: BlueprintNode[], edges: BlueprintEdge[]): NonNullable<Blueprint['security']> {
  const { out } = adjacency(nodes, edges);
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const sinkSev = (n: BlueprintNode) => n.security!.sinks.reduce((mx, s) => (SEV_RANK[s.severity] > SEV_RANK[mx] ? s.severity : mx), 'info' as Severity);
  const routes: FireRoute[] = [];
  const sources = nodes.filter((n) => n.security?.sources.length);
  for (const src of sources) {
    const parent = new Map<string, string | null>([[src.id, null]]);
    const queue = [src.id];
    while (queue.length) {
      const v = queue.shift()!;
      const depth = (() => {
        let d = 0;
        for (let p = parent.get(v); p; p = parent.get(p)) d++;
        return d;
      })();
      const node = byId.get(v)!;
      if (node.security?.sinks.some((s) => s.severity !== 'info')) {
        const pathIds: string[] = [];
        for (let p: string | null | undefined = v; p; p = parent.get(p)) pathIds.unshift(p);
        let severity = sinkSev(node);
        // request data a hop or two away from a medium-risk call: treat as high
        const readsInput = src.security!.sources.some((s) => s.kind === 'request-input');
        if (severity === 'medium' && readsInput && pathLen(parent, v) <= 2) severity = 'high';
        const kinds = [...new Set(node.security.sinks.filter((s) => s.severity !== 'info').map((s) => s.kind))];
        routes.push({ source: src.id, sink: v, path: pathIds, kind: kinds.join(', '), severity });
      }
      if (depth >= 8) continue;
      for (const w of out.get(v) ?? []) if (!parent.has(w)) {
        parent.set(w, v);
        queue.push(w);
      }
    }
  }
  routes.sort((a, b) => SEV_RANK[b.severity] - SEV_RANK[a.severity] || a.path.length - b.path.length);
  const perSink = new Map<string, number>();
  const kept = routes.filter((r) => {
    const n = perSink.get(r.sink) ?? 0;
    perSink.set(r.sink, n + 1);
    return n < 3;
  });
  routes.length = 0;
  routes.push(...kept);
  let high = 0, medium = 0, low = 0, secrets = 0;
  for (const n of nodes) {
    for (const s of n.security?.sinks ?? []) s.severity === 'high' ? high++ : s.severity === 'medium' ? medium++ : s.severity === 'low' ? low++ : 0;
    for (const s of n.security?.secrets ?? []) if (s.severity === 'high') { high++; secrets++; } else secrets++;
  }
  return { routes: routes.slice(0, 300), high, medium, low, secrets };
}

function pathLen(parent: Map<string, string | null>, v: string) {
  let d = 0;
  for (let p = parent.get(v); p; p = parent.get(p)) d++;
  return d;
}

/** used by diff: modules affected if these change */
export function affectedBy(ids: string[], nodes: BlueprintNode[], edges: BlueprintEdge[]): string[] {
  const { rev } = adjacency(nodes, edges);
  return [...dependentsOf(ids, rev)];
}

function markUsage(target: BlueprintNode, symbols: string[], from: string) {
  for (const s of symbols) {
    if (s === '*') continue;
    const exp = target.exports.find((e) => e.name === s);
    if (exp && !exp.usedBy.includes(from)) exp.usedBy.push(from);
  }
}
