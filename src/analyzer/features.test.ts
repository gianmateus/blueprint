import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { analyze } from './index.js';
import { parseGo, parsePython } from './polyglot.js';
import { scanTs } from './security.js';
import { diffAgainst, prComment } from '../diff.js';
import { timelapse } from '../timelapse.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const example = path.resolve(here, '../../examples/ride-hailing');

describe('python and go', () => {
  it('parses python imports, exports, env and fire safety', () => {
    const p = parsePython(`import os
from .model import (
    quote_price,
    surge,
)
from flask import Flask, request

@app.post("/quote")
def quote():
    body = request.get_json()
    cur.execute(f"select * from t where id = {body['id']}")
    key = os.environ.get("API_KEY")
`);
    expect(p.imports.map((i) => i.specifier)).toEqual(['os', '.model', 'flask']);
    expect(p.imports[1].symbols).toEqual(['quote_price', 'surge']);
    expect(p.exports.map((e) => e.name)).toContain('quote');
    expect(p.env).toContain('API_KEY');
    expect(p.security.sources.map((s) => s.kind)).toEqual(expect.arrayContaining(['http-route', 'request-input']));
    expect(p.security.sinks[0].kind).toBe('sql-injection');
  });

  it('parses go imports, exported names and handlers', () => {
    const g = parseGo(`package main

import (
\t"net/http"
\tstore "github.com/acme/app/store"
)

func main() { http.HandleFunc("/x", Handle) }
func Handle(w http.ResponseWriter, r *http.Request) { db.Query(fmt.Sprintf("select %s", r.URL.Query().Get("q"))) }
type Config struct {}
`);
    expect(g.isMain).toBe(true);
    expect(g.imports.map((i) => i.specifier)).toEqual(['net/http', 'github.com/acme/app/store']);
    expect(g.exports.map((e) => e.name)).toEqual(['Handle', 'Config']);
    expect(g.security.sinks.map((s) => s.kind)).toContain('sql-injection');
  });
});

describe('fire safety (TypeScript)', () => {
  const scan = (code: string) => scanTs(ts.createSourceFile('x.ts', code, ts.ScriptTarget.Latest, true), ['node:child_process']);
  it('flags raw SQL, shell commands, eval and secrets, but not parameterised queries', () => {
    const s = scan(`
      app.get('/u/:id', (req) => db.query(\`select * from u where id = \${req.params.id}\`));
      db.query('select * from u where id = $1', [id]);
      execSync(\`rm -rf \${dir}\`);
      eval(code);
      const apiKey = 'abcd1234efgh5678';
      const token = process.env.GITHUB_TOKEN;
    `);
    expect(s.sources.map((x) => x.kind)).toEqual(expect.arrayContaining(['http-route', 'request-input']));
    expect(s.sinks.map((x) => x.kind).sort()).toEqual(['code-eval', 'command-exec', 'sql-injection']);
    expect(s.secrets.map((x) => x.kind)).toEqual(expect.arrayContaining(['hardcoded-secret', 'env-secret']));
  });
});

describe('example: polyglot services and fire routes', async () => {
  const bp = await analyze({ root: example, git: false });
  const edge = (a: string, b: string) => bp.edges.find((e) => e.from === a && e.to === b);
  it('links python and go files', () => {
    expect(edge('services/pricing/app.py', 'services/pricing/model.py')).toBeTruthy();
    expect(edge('services/geo/main.go', 'services/geo/handlers/locate.go')).toBeTruthy();
    expect(edge('services/rides/src/clients/geo.ts', 'services/geo/main.go')?.via).toBe('GEO_URL');
  });
  it('finds the SQL injection route and the hard-coded key', () => {
    const r = bp.security!.routes.find((x) => x.sink === 'services/payments/src/reports.ts' && x.source === 'services/payments/src/http.ts');
    expect(r?.severity).toBe('high');
    const stripe = bp.nodes.find((n) => n.id === 'services/payments/src/stripeClient.ts')!;
    expect(stripe.security?.secrets.some((s) => s.kind === 'hardcoded-secret')).toBe(true);
  });
});

describe('git: history, diff and time-lapse', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bp-git-'));
  const git = (...a: string[]) => execFileSync('git', a, { cwd: dir, stdio: 'pipe' });
  const write = (f: string, c: string) => {
    fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true });
    fs.writeFileSync(path.join(dir, f), c);
  };
  git('init', '-q', '-b', 'main');
  git('config', 'user.email', 't@t');
  git('config', 'user.name', 'Tester');
  write('src/a.ts', "export const a = 1;\n");
  write('src/b.ts', "import { a } from './a';\nexport const b = a + 1;\n");
  git('add', '-A');
  git('commit', '-qm', 'first');
  write('src/c.ts', "import { b } from './b';\nexport const c = b;\n");
  write('src/a.ts', "import { c } from './c';\nexport const a = 1;\nexport const d = c;\n");
  git('add', '-A');
  git('commit', '-qm', 'second: adds a crack');

  it('reads who built each file', async () => {
    const bp = await analyze({ root: dir });
    expect(bp.nodes.find((n) => n.id === 'src/a.ts')?.git?.commits).toBe(2);
    expect(bp.nodes.find((n) => n.id === 'src/a.ts')?.git?.authors[0].name).toBe('Tester');
  });
  it('diffs against a ref and writes a PR comment', async () => {
    const { head, diff } = await diffAgainst({ root: dir, base: 'HEAD~1' });
    expect(diff.added).toEqual(['src/c.ts']);
    expect(diff.changed).toEqual(['src/a.ts']);
    expect(diff.newCycles.length).toBe(1);
    const md = prComment(head, diff);
    expect(md).toContain('<!-- blueprint-bot -->');
    expect(md).toContain('```mermaid');
  });
  it('films a time-lapse', async () => {
    const frames = await timelapse({ root: dir, frames: 5 });
    expect(frames.map((f) => f.files)).toEqual([2, 3]);
    expect(frames[1].cycleNodes.length).toBe(3);
  });
});
