/**
 * The Blueprint document: everything the analyzer knows about a codebase.
 * Shared by the CLI (which produces it) and the viewer (which draws it).
 */

export type EdgeKind =
  | 'import' // static import / require
  | 'reexport' // export ... from
  | 'dynamic' // import() / lazy require
  | 'type' // import type (no runtime dependency)
  | 'http' // service -> service over the network (v2)
  | 'infra'; // service -> database / cache / queue (v2)

export type NodeKind = 'file' | 'service' | 'infra';

export type ExportKind =
  | 'function'
  | 'class'
  | 'const'
  | 'type'
  | 'interface'
  | 'enum'
  | 'default'
  | 'other';

export interface ExportInfo {
  name: string;
  kind: ExportKind;
  line: number;
  /** file ids that import this symbol by name (namespace/side-effect imports are not counted here) */
  usedBy: string[];
}

export interface BlueprintNode {
  /** posix path relative to the project root, or `@infra/<name>` / `@service/<name>` for virtual nodes */
  id: string;
  kind: NodeKind;
  /** path segments used to build the folder tree */
  path: string;
  loc: number;
  exports: ExportInfo[];
  /** npm packages imported by this file (the "materials") */
  externals: string[];
  /** docker-compose service / workspace package this node belongs to */
  service?: string;
  isEntry: boolean;
  isTest: boolean;
  /** env vars read via process.env.X */
  env?: string[];
  /** v2: image for infra nodes, e.g. postgres:16 */
  image?: string;
  /** source language */
  lang?: 'ts' | 'js' | 'py' | 'go';
  /** fire-safety findings: where untrusted input enters, dangerous calls, secrets */
  security?: NodeSecurity;
  /** construction history from git */
  git?: GitInfo;
}

export type Severity = 'high' | 'medium' | 'low' | 'info';

export interface Finding {
  kind: string;
  severity: Severity;
  line: number;
  detail: string;
}

export interface NodeSecurity {
  /** untrusted input enters here (HTTP routes, request bodies, webhooks…) */
  sources: Finding[];
  /** dangerous operations (raw SQL, shell exec, eval, innerHTML…) */
  sinks: Finding[];
  /** secrets read from env or hard-coded */
  secrets: Finding[];
}

/** A module-level path from a file that receives untrusted input to a file with a dangerous call. */
export interface FireRoute {
  source: string;
  sink: string;
  path: string[];
  kind: string;
  severity: Severity;
}

export interface GitInfo {
  commits: number;
  authors: { name: string; commits: number }[];
  /** fewest people who made >= 80% of the commits */
  busFactor: number;
  lastChange: string;
  created: string;
}

export interface DiffInfo {
  base: string;
  baseLabel: string;
  added: string[];
  removed: string[];
  changed: string[];
  /** modules affected by the change (reverse dependents of added + changed) */
  affected: string[];
  newCycles: string[][];
  fixedCycles: number;
  scoreBefore: number;
  scoreAfter: number;
  pillarsTouched: string[];
  newFireRoutes: FireRoute[];
}

export interface TimelineFrame {
  sha: string;
  date: string;
  subject: string;
  author: string;
  /** node ids present at this commit */
  nodes: string[];
  cycleNodes: string[];
  score: number;
  loc: number;
  files: number;
}

export interface BlueprintEdge {
  from: string;
  to: string;
  kind: EdgeKind;
  /** imported symbol names, when known */
  symbols?: string[];
  /** how the connection was detected: env var, URL, depends_on */
  via?: string;
}

export type Role =
  | 'foundation' // high impact and depends on nothing internal
  | 'pillar' // removing it brings down a big share of the building
  | 'beam' // meaningful share
  | 'wall' // someone depends on it
  | 'entry' // nothing depends on it, but it's an entry point / test / config
  | 'orphan'; // nothing depends on it and it isn't an entry: possible dead code

export interface NodeMetrics {
  fanIn: number;
  fanOut: number;
  /** number of nodes that (transitively) depend on this one */
  impact: number;
  /** impact / (total nodes - 1) */
  impactPct: number;
  role: Role;
  /** floor in the building: 0 = foundation level */
  floor: number;
  /** index into Blueprint.cycles if the node is part of a circular dependency */
  cycle?: number;
}

export interface ServiceInfo {
  name: string;
  kind: 'app' | 'infra' | 'package';
  dir?: string;
  image?: string;
  /** node id treated as the service's front door */
  entry?: string;
  ports?: string[];
  source: 'docker-compose' | 'workspace';
}

export interface Summary {
  files: number;
  loc: number;
  edges: number;
  floors: number;
  pillars: number;
  foundations: number;
  orphans: number;
  cycles: number;
  filesInCycles: number;
  services: number;
  /** 0-100 structural health score */
  score: number;
  scoreBreakdown: { label: string; penalty: number }[];
  topExternals: { name: string; count: number }[];
}

export interface Annotation {
  summary: string;
  hash: string;
  model: string;
  at: string;
}

export interface Note {
  id: string;
  /** node id or folder path */
  target: string;
  text: string;
  author?: string;
  createdAt: string;
}

export interface Blueprint {
  schema: 1;
  name: string;
  generatedAt: string;
  tool: { name: string; version: string };
  nodes: BlueprintNode[];
  edges: BlueprintEdge[];
  services: ServiceInfo[];
  metrics: Record<string, NodeMetrics>;
  cycles: string[][];
  summary: Summary;
  annotations?: Record<string, Annotation>;
  overview?: string;
  notes?: Note[];
  security?: { routes: FireRoute[]; high: number; medium: number; low: number; secrets: number };
  git?: { commits: number; authors: number; hotspots: string[]; soloPillars: string[] };
  diff?: DiffInfo;
  timeline?: TimelineFrame[];
  /** true when served by `blueprint serve` (notes can be saved to disk) */
  live?: boolean;
}
