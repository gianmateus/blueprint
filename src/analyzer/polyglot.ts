import fs from 'node:fs';
import path from 'node:path';
import type { Finding } from '../types.js';
import type { ParsedFile, RawImport, RawExport } from './parse.js';
import { emptySecurity, envSecret, literalSecret } from './security.js';

/**
 * Python and Go support. These languages have simple, regular import syntax,
 * so a careful line scanner is enough to draw the structure (no native parser needed).
 */

const URL_HINT = /^[a-z][a-z0-9+.-]*:\/\/|^\/\/|:\d{2,5}(\/|$)/i;
const STRING_LIT = /(?:[rbfuRBFU]{0,2})("([^"\\\n]|\\.)*"|'([^'\\\n]|\\.)*')/g;
const unquote = (s: string) => s.replace(/^[rbfuRBFU]{0,2}(["'])/, '').replace(/["']$/, '');
const countLoc = (text: string) => text.split('\n').filter((l) => l.trim() && !/^\s*(#|\/\/)/.test(l)).length;

function addFinding(list: Finding[], f: Finding | undefined) {
  if (f && list.length < 40 && !list.some((x) => x.kind === f.kind && x.line === f.line)) list.push(f);
}

function scanStrings(lines: string[], urls: Set<string>, secrets: Finding[], assignRe: RegExp) {
  lines.forEach((l, i) => {
    const assign = l.match(assignRe);
    for (const m of l.matchAll(STRING_LIT)) {
      const v = unquote(m[0]);
      if (v.length < 300 && URL_HINT.test(v)) urls.add(v);
      addFinding(secrets, literalSecret(v, i + 1, assign?.[1]));
    }
  });
}

// ───────────────────────────── Python ─────────────────────────────

export function parsePython(text: string): ParsedFile {
  const imports: RawImport[] = [];
  const exports: RawExport[] = [];
  const env = new Set<string>();
  const urls = new Set<string>();
  const security = emptySecurity();
  // join parenthesised multi-line imports
  const joined = text.replace(/^([ \t]*from\s+[.\w]+\s+import\s*)\(([\s\S]*?)\)/gm, (_m, head, body) => head + body.replace(/\s*\n\s*/g, ' ').replace(/#[^\n]*/g, ''));
  const lines = joined.split('\n');
  lines.forEach((raw, i) => {
    const line = raw.replace(/\s+#.*$/, '');
    const n = i + 1;
    let m: RegExpMatchArray | null;
    if ((m = line.match(/^\s*from\s+([.\w]+)\s+import\s+(.+)$/))) {
      const names = m[2].replace(/\\$/, '').split(',').map((s) => s.trim().split(/\s+as\s+/)[0]).filter(Boolean);
      imports.push({ specifier: m[1], kind: /^\s/.test(raw) ? 'dynamic' : 'import', symbols: names.includes('*') ? ['*'] : names });
    } else if ((m = line.match(/^\s*import\s+(.+)$/))) {
      for (const part of m[1].split(',')) {
        const mod = part.trim().split(/\s+as\s+/)[0];
        if (mod) imports.push({ specifier: mod, kind: /^\s/.test(raw) ? 'dynamic' : 'import', symbols: ['*'] });
      }
    }
    if ((m = line.match(/^(?:async\s+)?def\s+([A-Za-z]\w*)/))) exports.push({ name: m[1], kind: 'function', line: n });
    else if ((m = line.match(/^class\s+([A-Za-z]\w*)/))) exports.push({ name: m[1], kind: 'class', line: n });
    else if ((m = line.match(/^([A-Za-z]\w*)\s*(:\s*[\w\[\], .]+)?\s*=(?!=)/))) {
      if (!exports.some((e) => e.name === m![1])) exports.push({ name: m[1], kind: 'const', line: n });
    }
    for (const e of line.matchAll(/os\.environ\[\s*["'](\w+)["']\s*\]|os\.(?:environ\.get|getenv)\(\s*["'](\w+)["']|environ\[\s*["'](\w+)["']/g)) {
      const name = e[1] ?? e[2] ?? e[3];
      env.add(name);
      addFinding(security.secrets, envSecret(name, n));
    }
    // fire safety
    if ((m = line.match(/@\w+\.(route|get|post|put|patch|delete|api_route|websocket)\(\s*["']([^"']*)/))) {
      addFinding(security.sources, { kind: 'http-route', severity: 'info', line: n, detail: `${m[1].toUpperCase()} ${m[2]}` });
    }
    if ((m = line.match(/\brequest\.(args|form|json|get_json|values|files|data|body|query_params|GET|POST|cookies|headers)\b/))) {
      if (!security.sources.some((s) => s.detail === `request.${m![1]}`)) addFinding(security.sources, { kind: 'request-input', severity: 'info', line: n, detail: `request.${m[1]}` });
    }
    if (/\.(execute|executemany|raw|exec_driver_sql)\(\s*(f["']|["'][^"']*["']\s*(%|\+|\.format))/.test(line) || /\btext\(\s*f["']/.test(line)) {
      addFinding(security.sinks, { kind: 'sql-injection', severity: 'medium', line: n, detail: 'SQL built with f-string / % / + / .format' });
    }
    if (/\bos\.(system|popen)\(|\bsubprocess\.\w+\([^)]*shell\s*=\s*True/.test(line)) {
      addFinding(security.sinks, { kind: 'command-exec', severity: 'high', line: n, detail: 'shell command' });
    }
    if (/(^|[^\w.])(eval|exec)\(/.test(line)) addFinding(security.sinks, { kind: 'code-eval', severity: 'high', line: n, detail: 'eval/exec' });
    if (/\bpickle\.loads?\(|\byaml\.load\((?![^)]*SafeLoader)|\bmarshal\.loads\(/.test(line)) {
      addFinding(security.sinks, { kind: 'deserialization', severity: 'high', line: n, detail: 'unsafe deserialization' });
    }
    if (/\brequests\.(get|post|put|request)\(\s*f["'][^"']*\{[^}]*request/.test(line)) addFinding(security.sinks, { kind: 'ssrf', severity: 'medium', line: n, detail: 'URL built from request data' });
  });
  scanStrings(lines, urls, security.secrets, /^\s*([A-Za-z_]\w*)\s*=/);
  return { imports, exports: exports.filter((e) => !e.name.startsWith('_')), loc: countLoc(text), env: [...env], urls: [...urls], security };
}

/** Resolve a Python module to files inside the project. */
export function resolvePython(spec: string, fromFile: string, root: string, fileSet: Set<string>, symbols: string[]): string[] | { external: string } {
  const tryMod = (base: string, parts: string[]) => {
    const p = path.join(base, ...parts);
    if (fileSet.has(p + '.py')) return p + '.py';
    if (fileSet.has(path.join(p, '__init__.py'))) return path.join(p, '__init__.py');
    return undefined;
  };
  const collect = (base: string, parts: string[]): string[] => {
    const out: string[] = [];
    // `from pkg import sub` may import submodules
    for (const s of symbols) {
      if (s === '*') continue;
      const sub = tryMod(base, [...parts, s]);
      if (sub) out.push(sub);
    }
    if (!out.length) {
      const mod = parts.length ? tryMod(base, parts) : fileSet.has(path.join(base, '__init__.py')) ? path.join(base, '__init__.py') : undefined;
      if (mod) out.push(mod);
    }
    return out;
  };
  const dots = spec.match(/^\.+/)?.[0].length ?? 0;
  const parts = spec.slice(dots).split('.').filter(Boolean);
  if (dots) {
    let base = path.dirname(fromFile);
    for (let i = 1; i < dots; i++) base = path.dirname(base);
    return collect(base, parts);
  }
  // absolute import: try the file's own folders up to the root, then <root>/src
  const bases: string[] = [];
  let d = path.dirname(fromFile);
  while (d.startsWith(root)) {
    bases.push(d);
    if (d === root) break;
    d = path.dirname(d);
  }
  bases.push(path.join(root, 'src'));
  for (const b of bases) {
    const hit = collect(b, parts);
    if (hit.length) return hit;
  }
  return { external: parts[0] ?? spec };
}

// ───────────────────────────── Go ─────────────────────────────

export function parseGo(text: string): ParsedFile & { isMain: boolean } {
  const imports: RawImport[] = [];
  const exports: RawExport[] = [];
  const env = new Set<string>();
  const urls = new Set<string>();
  const security = emptySecurity();
  const lines = text.split('\n');
  let inImport = false;
  let inBlock: 'var' | 'const' | 'type' | null = null;
  let isMain = false;
  lines.forEach((raw, i) => {
    const line = raw.replace(/\/\/.*$/, '');
    const n = i + 1;
    let m: RegExpMatchArray | null;
    if (/^package\s+main\b/.test(line)) isMain = true;
    if (inImport) {
      if (/^\s*\)/.test(line)) inImport = false;
      else if ((m = line.match(/^\s*(?:[\w.]+\s+)?"([^"]+)"/))) imports.push({ specifier: m[1], kind: 'import', symbols: ['*'] });
    } else if (/^import\s*\(/.test(line)) inImport = true;
    else if ((m = line.match(/^import\s+(?:[\w.]+\s+)?"([^"]+)"/))) imports.push({ specifier: m[1], kind: 'import', symbols: ['*'] });

    if (inBlock) {
      if (/^\)/.test(line)) inBlock = null;
      else if ((m = line.match(/^\s+([A-Z]\w*)/))) exports.push({ name: m[1], kind: inBlock === 'type' ? 'type' : 'const', line: n });
    } else if ((m = line.match(/^(var|const|type)\s*\(/))) inBlock = m[1] as 'var' | 'const' | 'type';
    else if ((m = line.match(/^func\s+(?:\([^)]*\)\s*)?([A-Z]\w*)/))) exports.push({ name: m[1], kind: 'function', line: n });
    else if ((m = line.match(/^type\s+([A-Z]\w*)\s+(struct|interface)?/))) exports.push({ name: m[1], kind: m[2] === 'interface' ? 'interface' : 'type', line: n });
    else if ((m = line.match(/^(?:var|const)\s+([A-Z]\w*)/))) exports.push({ name: m[1], kind: 'const', line: n });

    for (const e of line.matchAll(/os\.(?:Getenv|LookupEnv)\(\s*"(\w+)"/g)) {
      env.add(e[1]);
      addFinding(security.secrets, envSecret(e[1], n));
    }
    if ((m = line.match(/\.(HandleFunc|Handle|GET|POST|PUT|PATCH|DELETE|Get|Post|Put|Patch|Delete|Any)\(\s*"(\/[^"]*)"/))) {
      addFinding(security.sources, { kind: 'http-route', severity: 'info', line: n, detail: `${m[1].toUpperCase().replace('HANDLEFUNC', 'ANY').replace('HANDLE', 'ANY')} ${m[2]}` });
    }
    if ((m = line.match(/\b(r\.URL\.Query\(\)|r\.FormValue|r\.PostFormValue|r\.Body|c\.Param|c\.Query|c\.PostForm|c\.Bind\w*|c\.ShouldBind\w*|chi\.URLParam|mux\.Vars)/))) {
      if (!security.sources.some((s) => s.detail === m![1])) addFinding(security.sources, { kind: 'request-input', severity: 'info', line: n, detail: m[1] });
    }
    if (/\.(Query|QueryRow|Exec|QueryContext|ExecContext)\(\s*(ctx,\s*)?(fmt\.Sprintf|"[^"]*"\s*\+)/.test(line)) {
      addFinding(security.sinks, { kind: 'sql-injection', severity: 'medium', line: n, detail: 'SQL built with Sprintf / +' });
    }
    if ((m = line.match(/exec\.Command(Context)?\(([^)]*)/))) {
      const dyn = /"(sh|bash)"\s*,\s*"-c"/.test(m[2]) || !/^\s*(ctx,\s*)?"[^"]*"(\s*,\s*"[^"]*")*\s*$/.test(m[2]);
      addFinding(security.sinks, { kind: 'command-exec', severity: dyn ? 'high' : 'low', line: n, detail: dyn ? 'dynamic command' : 'fixed command' });
    }
    if (/template\.HTML\(/.test(line)) addFinding(security.sinks, { kind: 'xss', severity: 'medium', line: n, detail: 'template.HTML() skips escaping' });
    if (/http\.(Get|Post)\(\s*(fmt\.Sprintf|[^")]*\+)[^)]*\b(r\.|c\.|req)/.test(line)) addFinding(security.sinks, { kind: 'ssrf', severity: 'medium', line: n, detail: 'URL built from request data' });
  });
  scanStrings(lines, urls, security.secrets, /^\s*(?:var|const)?\s*([A-Za-z_]\w*)\s*:?=/);
  return { imports, exports, loc: countLoc(text), env: [...env], urls: [...urls], security, isMain };
}

export interface GoModule {
  path: string;
  dir: string;
}

export function findGoModules(goModFiles: string[]): GoModule[] {
  const mods: GoModule[] = [];
  for (const f of goModFiles) {
    const m = fs.readFileSync(f, 'utf8').match(/^module\s+(\S+)/m);
    if (m) mods.push({ path: m[1], dir: path.dirname(f) });
  }
  return mods.sort((a, b) => b.path.length - a.path.length);
}

/** Go imports packages (directories): link to every non-test file of the package. */
export function resolveGo(spec: string, mods: GoModule[], filesByDir: Map<string, string[]>): string[] | { external: string } {
  for (const m of mods) {
    if (spec !== m.path && !spec.startsWith(m.path + '/')) continue;
    const dir = path.join(m.dir, spec.slice(m.path.length + 1));
    const files = (filesByDir.get(dir) ?? []).filter((f) => f.endsWith('.go') && !f.endsWith('_test.go'));
    return files;
  }
  const parts = spec.split('/');
  return { external: parts[0].includes('.') ? parts.slice(0, 3).join('/') : spec };
}
