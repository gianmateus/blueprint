#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { Command } from 'commander';
import pc from 'picocolors';
import { analyze, type AnalyzeOptions } from './analyzer/index.js';
import { adjacency, dependentsOf } from './analyzer/metrics.js';
import { renderHtml, serve } from './server.js';
import { renderReport } from './report.js';
import { annotate } from './ai.js';
import { diffAgainst, prComment } from './diff.js';
import { timelapse } from './timelapse.js';
import { VERSION } from './version.js';
import type { Blueprint } from './types.js';

const program = new Command();
program
  .name('blueprint')
  .description('Structural blueprints for codebases. Find the load-bearing modules, simulate demolitions, spot the cracks.')
  .version(VERSION);

const common = (cmd: Command) =>
  cmd
    .option('-i, --ignore <globs...>', 'extra glob patterns to ignore')
    .option('--max-files <n>', 'maximum number of files to analyse', (v) => parseInt(v, 10), 6000)
    .option('--pillar <ratio>', 'share of the system a module must hold up to count as a pillar', parseFloat, 0.15)
    .option('--types', 'draw type-only imports as dependencies too', false);

const optsFrom = (dir: string, o: any): AnalyzeOptions => ({
  root: path.resolve(dir ?? '.'),
  ignore: o.ignore,
  maxFiles: o.maxFiles,
  pillarThreshold: o.pillar,
  includeTypeEdges: o.types,
  onProgress: (m) => process.stderr.write(pc.dim(`  ${m}\n`)),
});

function banner(bp: Blueprint, ms: number) {
  const s = bp.summary;
  const scoreColor = s.score >= 80 ? pc.green : s.score >= 60 ? pc.yellow : pc.red;
  const line = (k: string, v: string | number) => console.log(`  ${pc.dim(k.padEnd(18))}${v}`);
  console.log();
  console.log(`  ${pc.bold(pc.blue('▦ blueprint'))} ${pc.dim('·')} ${pc.bold(bp.name)} ${pc.dim(`(${ms} ms)`)}`);
  console.log();
  line('files', `${s.files} (${s.loc.toLocaleString('en')} loc)`);
  line('load paths', s.edges);
  line('floors', s.floors);
  if (s.services) line('services', s.services);
  line('pillars', `${s.pillars} ${pc.dim(`+ ${s.foundations} foundations`)}`);
  line('cracks', s.cycles ? pc.red(`${s.cycles} cycles (${s.filesInCycles} files)`) : pc.green('none'));
  line('rubble', s.orphans ? pc.yellow(`${s.orphans} unreferenced files`) : pc.green('none'));
  if (bp.security) {
    const sec = bp.security;
    line('fire safety', sec.routes.length || sec.high ? pc.red(`${sec.routes.length} fire routes · ${sec.high} high`) + pc.dim(` · ${sec.secrets} secrets`) : pc.green('no fire routes') + pc.dim(` · ${sec.secrets} secrets`));
  }
  if (bp.git) line('history', `${bp.git.authors} builders${bp.git.soloPillars.length ? pc.yellow(` · ${bp.git.soloPillars.length} pillars known by one person`) : ''}`);
  line('health', scoreColor(pc.bold(`${s.score}/100`)));
  console.log();
}

async function run(dir: string, o: any) {
  const t = Date.now();
  const bp = await analyze(optsFrom(dir, o));
  return { bp, ms: Date.now() - t };
}

// ── blueprint [dir]  (default: analyse + open the interactive viewer) ──
common(
  program
    .command('serve [dir]', { isDefault: true })
    .description('analyse a project and open the interactive blueprint in your browser')
    .option('-p, --port <n>', 'port', (v) => parseInt(v, 10), 4377)
    .option('--host <host>', 'host to bind', '127.0.0.1')
    .option('--no-open', 'do not open the browser')
    .option('-w, --watch', 're-draw the blueprint when files change', false),
).action(async (dir: string, o) => {
  const root = path.resolve(dir ?? '.');
  let { bp, ms } = await run(root, o);
  banner(bp, ms);
  const app = serve({ root, port: o.port, host: o.host, getBlueprint: () => bp });
  const port = await app.listen();
  const url = `http://${o.host === '0.0.0.0' ? 'localhost' : o.host}:${port}`;
  console.log(`  ${pc.bold('Blueprint ready →')} ${pc.cyan(url)}`);
  if (o.watch) {
    console.log(pc.dim('  watching for changes…'));
    let timer: NodeJS.Timeout | undefined;
    let busy = false;
    fs.watch(root, { recursive: true }, (_e, file) => {
      const f = String(file ?? '');
      if (!/\.[cm]?[jt]sx?$|compose\.ya?ml$|package\.json$/.test(f) || /node_modules|\.git[\\/]|[\\/]dist[\\/]|\.blueprint/.test(f)) return;
      clearTimeout(timer);
      timer = setTimeout(async () => {
        if (busy) return;
        busy = true;
        try {
          const next = await analyze({ ...optsFrom(root, o), onProgress: () => {} });
          bp = next;
          app.notify();
          console.log(pc.dim(`  ↻ redrawn (${f})`));
        } catch (e) {
          console.error(pc.red(`  ${(e as Error).message}`));
        } finally {
          busy = false;
        }
      }, 400);
    });
  }
  if (o.open) {
    try {
      const { default: open } = await import('open');
      await open(url);
    } catch {
      /* headless */
    }
  }
});

// ── blueprint analyze ──
common(
  program
    .command('analyze [dir]')
    .description('write the blueprint as JSON (for CI, scripts or other tools)')
    .option('-o, --out <file>', 'output file', 'blueprint.json'),
).action(async (dir, o) => {
  const { bp, ms } = await run(dir, o);
  banner(bp, ms);
  fs.writeFileSync(o.out, JSON.stringify(bp, null, 2));
  console.log(`  wrote ${pc.cyan(o.out)}`);
});

// ── blueprint export ──
common(
  program
    .command('export [dir]')
    .description('export a self-contained HTML blueprint you can open offline or host anywhere (GitHub Pages, Netlify…)')
    .option('-o, --out <file>', 'output file', 'blueprint.html'),
).action(async (dir, o) => {
  const { bp, ms } = await run(dir, o);
  banner(bp, ms);
  fs.writeFileSync(o.out, renderHtml(bp));
  console.log(`  wrote ${pc.cyan(o.out)} ${pc.dim(`(${Math.round(fs.statSync(o.out).size / 1024)} KB)`)}`);
});

// ── blueprint report ──
common(
  program
    .command('report [dir]')
    .description('write a structural inspection report (Markdown); use --ci to fail the build on cracks or a low score')
    .option('-o, --out <file>', 'output file', 'BLUEPRINT_REPORT.md')
    .option('--lang <lang>', 'en | pt', 'en')
    .option('--ci', 'exit with code 1 when the thresholds below are not met', false)
    .option('--max-cycles <n>', 'maximum allowed circular dependencies', (v) => parseInt(v, 10), 0)
    .option('--min-score <n>', 'minimum allowed health score', (v) => parseInt(v, 10), 0),
).action(async (dir, o) => {
  const { bp, ms } = await run(dir, o);
  banner(bp, ms);
  fs.writeFileSync(o.out, renderReport(bp, o.lang === 'pt' ? 'pt' : 'en'));
  console.log(`  wrote ${pc.cyan(o.out)}`);
  if (o.ci) {
    const problems: string[] = [];
    if (bp.summary.cycles > o.maxCycles) problems.push(`${bp.summary.cycles} circular dependencies (max ${o.maxCycles})`);
    if (bp.summary.score < o.minScore) problems.push(`health ${bp.summary.score} < ${o.minScore}`);
    if (problems.length) {
      console.error(pc.red(`\n  ✖ structural check failed: ${problems.join(', ')}`));
      process.exit(1);
    }
    console.log(pc.green('\n  ✔ structural check passed'));
  }
});

// ── blueprint impact ──
common(
  program
    .command('impact [targets...]')
    .description('what breaks if these files change or disappear? (use --since <git-ref> for a PR blast radius)')
    .option('-C, --cwd <dir>', 'project root', '.')
    .option('--since <ref>', 'use the files changed since a git ref, e.g. main')
    .option('--json', 'print JSON', false),
).action(async (targets: string[], o) => {
  const root = path.resolve(o.cwd);
  const bp = await analyze({ ...optsFrom(root, o), onProgress: () => {} });
  let ids = targets.map((t) => path.relative(root, path.resolve(t)).split(path.sep).join('/'));
  if (o.since) {
    const out = execFileSync('git', ['diff', '--name-only', `${o.since}...HEAD`], { cwd: root, encoding: 'utf8' });
    const status = execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' });
    const top = execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd: root, encoding: 'utf8' }).trim();
    const changed = [...out.split('\n'), ...status.split('\n').map((l) => l.slice(3))]
      .filter(Boolean)
      .map((f) => path.relative(root, path.join(top, f)).split(path.sep).join('/'));
    ids.push(...changed);
  }
  const known = new Set(bp.nodes.map((n) => n.id));
  ids = [...new Set(ids)].filter((id) => known.has(id));
  if (!ids.length) {
    console.error(pc.yellow('  No analysed files matched. Pass file paths or --since <ref>.'));
    process.exit(2);
  }
  const { rev } = adjacency(bp.nodes, bp.edges);
  const hit = [...dependentsOf(ids, rev)].sort((a, b) => bp.metrics[b].impact - bp.metrics[a].impact);
  if (o.json) {
    console.log(JSON.stringify({ changed: ids, affected: hit, affectedPct: hit.length / Math.max(1, bp.nodes.length) }, null, 2));
    return;
  }
  console.log();
  console.log(`  ${pc.bold('Demolishing')} ${ids.length} file(s):`);
  for (const id of ids) console.log(`    ${pc.red('✖')} ${id}`);
  console.log();
  const share = Math.round((hit.length / Math.max(1, bp.nodes.length)) * 100);
  console.log(`  ${pc.bold(String(hit.length))} module(s) would be affected ${pc.dim(`(${share}% of the building)`)}`);
  for (const id of hit.slice(0, 40)) console.log(`    ${pc.yellow('▾')} ${id}`);
  if (hit.length > 40) console.log(pc.dim(`    … and ${hit.length - 40} more`));
  console.log();
});

// ── blueprint diff ──
common(
  program
    .command('diff [dir]')
    .description('renovation plan: compare the working tree with a git ref (what changed, blast radius, new cracks, new fire routes)')
    .requiredOption('-b, --base <ref>', 'git ref to compare with, e.g. main or origin/main')
    .option('--format <fmt>', 'text | md | json', 'text')
    .option('-o, --out <file>', 'write the md/json output to a file')
    .option('--html <file>', 'also export an interactive blueprint with the renovation highlighted')
    .option('--json <file>', 'also write the diff as JSON')
    .option('--run-url <url>', 'link to the CI run, shown in the PR comment'),
).action(async (dir, o) => {
  const root = path.resolve(dir ?? '.');
  const { head, diff } = await diffAgainst({ ...optsFrom(root, o), base: o.base });
  if (o.html) fs.writeFileSync(o.html, renderHtml(head));
  if (o.json) fs.writeFileSync(o.json, JSON.stringify(diff, null, 2));
  if (o.format === 'md' || o.format === 'json') {
    const text = o.format === 'md' ? prComment(head, diff, { runUrl: o.runUrl }) : JSON.stringify(diff, null, 2);
    if (o.out) fs.writeFileSync(o.out, text);
    else console.log(text);
    return;
  }
  const total = Math.max(1, head.nodes.length);
  console.log();
  console.log(`  ${pc.bold(pc.blue('▦ renovation'))} ${pc.dim('vs')} ${diff.baseLabel}`);
  console.log();
  console.log(`  health        ${diff.scoreBefore} → ${pc.bold(String(diff.scoreAfter))}`);
  console.log(`  renovation    ${diff.changed.length} changed · ${pc.green(diff.added.length + ' new')} · ${pc.red(diff.removed.length + ' demolished')}`);
  console.log(`  blast radius  ${pc.bold(String(diff.affected.length))} modules (${Math.round((diff.affected.length / total) * 100)}%)`);
  console.log(`  pillars       ${diff.pillarsTouched.length ? pc.yellow(diff.pillarsTouched.join(', ')) : 'none touched'}`);
  console.log(`  cracks        ${diff.newCycles.length ? pc.red(diff.newCycles.length + ' new') : pc.green('no new cracks')}${diff.fixedCycles ? pc.green(` · ${diff.fixedCycles} repaired`) : ''}`);
  console.log(`  fire routes   ${diff.newFireRoutes.length ? pc.red(diff.newFireRoutes.length + ' new') : pc.green('none new')}`);
  console.log();
});

// ── blueprint timelapse ──
common(
  program
    .command('timelapse [dir]')
    .description('film the construction from git history (saved in .blueprint/timeline.json and played in the viewer)')
    .option('-n, --frames <n>', 'number of frames (commits) to sample', (v) => parseInt(v, 10), 24),
).action(async (dir, o) => {
  const root = path.resolve(dir ?? '.');
  console.log(`\n  ${pc.bold('Filming')} the construction…`);
  try {
    const frames = await timelapse({
      ...optsFrom(root, o),
      onProgress: () => {},
      frames: o.frames,
      onFrame: (i, t, f) => console.log(pc.dim(`  [${i}/${t}] ${f.date.slice(0, 10)} ${f.sha.slice(0, 7)} · ${f.files} files · ${f.subject.slice(0, 60)}`)),
    });
    console.log(`\n  ${pc.green('✔')} ${frames.length} frames saved to ${pc.cyan('.blueprint/timeline.json')}. Run ${pc.cyan('blueprint')} and press ${pc.bold('▶')} in the viewer.\n`);
  } catch (e) {
    console.error(pc.red(`\n  ${(e as Error).message}\n`));
    process.exit(1);
  }
});

// ── blueprint annotate ──
common(
  program
    .command('annotate [dir]')
    .description('let an LLM write a one-line note on each load-bearing module (saved in .blueprint/annotations.json)')
    .option('--provider <name>', 'anthropic | openai (any OpenAI-compatible API, incl. Ollama)')
    .option('--model <model>', 'model id')
    .option('--base-url <url>', 'API base URL (e.g. http://localhost:11434/v1 for Ollama)')
    .option('--limit <n>', 'how many modules to annotate, most load-bearing first', (v) => parseInt(v, 10), 40)
    .option('--lang <lang>', 'language of the notes: en | pt | de | it | es', 'en')
    .option('--force', 're-annotate even if the file did not change', false)
    .option('--no-overview', 'skip the architecture overview'),
).action(async (dir, o) => {
  const root = path.resolve(dir ?? '.');
  const { bp } = await run(root, o);
  console.log(`\n  ${pc.bold('Annotating')} the most load-bearing modules…`);
  try {
    const r = await annotate(bp, {
      root,
      provider: o.provider,
      model: o.model,
      baseUrl: o.baseUrl,
      limit: o.limit,
      lang: o.lang,
      force: o.force,
      overview: o.overview,
      onProgress: (d, t, id) => console.log(pc.dim(`  [${d}/${t}] ${id}`)),
    });
    console.log(`\n  ${pc.green('✔')} ${r.annotated} new note(s), ${r.total - r.annotated} unchanged. Saved to ${pc.cyan('.blueprint/')}`);
    if (r.overview) console.log(`\n  ${pc.dim(r.overview)}\n`);
  } catch (e) {
    console.error(pc.red(`\n  ${(e as Error).message}\n`));
    process.exit(1);
  }
});

program.parseAsync().catch((e) => {
  console.error(pc.red(`\n  ${(e as Error).message}\n`));
  process.exit(1);
});
