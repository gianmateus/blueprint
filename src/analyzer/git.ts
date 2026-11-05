import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { GitInfo } from '../types.js';

const git = (cwd: string, args: string[], maxBuffer = 512 * 1024 * 1024) =>
  execFileSync('git', args, { cwd, encoding: 'utf8', maxBuffer, stdio: ['ignore', 'pipe', 'ignore'] });

export function gitTop(root: string): string | undefined {
  try {
    return git(root, ['rev-parse', '--show-toplevel']).trim();
  } catch {
    return undefined;
  }
}

/** posix prefix of `root` inside the git repo ('' when root is the repo itself) */
export function gitPrefix(root: string): string | undefined {
  const top = gitTop(root);
  if (!top) return undefined;
  return path.relative(fs.realpathSync(top), fs.realpathSync(root)).split(path.sep).join('/');
}

/**
 * Construction history in one `git log` pass: who changed each file, how often, and when.
 * Keys are paths relative to `root`.
 */
export function gitHistory(root: string, maxCommits = 4000): Map<string, GitInfo> | undefined {
  const prefix = gitPrefix(root);
  if (prefix === undefined) return undefined;
  let out: string;
  try {
    out = git(root, ['log', '--no-merges', `--max-count=${maxCommits}`, '--format=@@%aN%x09%aI', '--name-only', '--', '.']);
  } catch {
    return undefined;
  }
  type Acc = { authors: Map<string, number>; commits: number; first: string; last: string };
  const acc = new Map<string, Acc>();
  let author = '';
  let date = '';
  for (const line of out.split('\n')) {
    if (line.startsWith('@@')) {
      [author, date] = line.slice(2).split('\t');
      continue;
    }
    if (!line) continue;
    let rel = line;
    if (prefix) {
      if (!line.startsWith(prefix + '/')) continue;
      rel = line.slice(prefix.length + 1);
    }
    let a = acc.get(rel);
    if (!a) {
      // log is newest-first: the first time we see a file is its last change
      a = { authors: new Map(), commits: 0, first: date, last: date };
      acc.set(rel, a);
    }
    a.commits++;
    a.first = date;
    a.authors.set(author, (a.authors.get(author) ?? 0) + 1);
  }
  const result = new Map<string, GitInfo>();
  for (const [file, a] of acc) {
    const authors = [...a.authors.entries()].sort((x, y) => y[1] - x[1]).map(([name, commits]) => ({ name, commits }));
    let sum = 0;
    let busFactor = 0;
    for (const au of authors) {
      sum += au.commits;
      busFactor++;
      if (sum >= a.commits * 0.8) break;
    }
    result.set(file, { commits: a.commits, authors: authors.slice(0, 5), busFactor, lastChange: a.last, created: a.first });
  }
  return result;
}

export interface Commit {
  sha: string;
  date: string;
  author: string;
  subject: string;
}

export function firstParentCommits(root: string): Commit[] {
  const out = git(root, ['log', '--first-parent', '--format=%H%x09%aI%x09%aN%x09%s', '--', '.']);
  return out
    .split('\n')
    .filter(Boolean)
    .map((l) => {
      const [sha, date, author, ...rest] = l.split('\t');
      return { sha, date, author, subject: rest.join('\t') };
    })
    .reverse();
}

/** Extract the project at `ref` into a temp folder (no checkout, the working tree is untouched). */
export function snapshot(root: string, ref: string): string {
  const prefix = gitPrefix(root) ?? '';
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'blueprint-'));
  const tree = prefix ? `${ref}:${prefix}` : ref;
  const archive = spawnSync('git', ['archive', '--format=tar', tree], { cwd: root, maxBuffer: 2 * 1024 * 1024 * 1024 });
  if (archive.status !== 0) {
    fs.rmSync(dir, { recursive: true, force: true });
    throw new Error(`git archive failed for ${ref}: ${archive.stderr.toString().trim()}`);
  }
  const tar = spawnSync('tar', ['-x', '-C', dir], { input: archive.stdout, maxBuffer: 16 * 1024 * 1024 });
  if (tar.status !== 0) throw new Error(`tar failed: ${tar.stderr.toString().trim()}`);
  return dir;
}

export function changedSince(root: string, base: string): string[] {
  const prefix = gitPrefix(root) ?? '';
  const names = new Set<string>();
  const add = (list: string) =>
    list
      .split('\n')
      .filter(Boolean)
      .forEach((f) => names.add(f));
  add(git(root, ['diff', '--name-only', `${base}...HEAD`]));
  add(git(root, ['diff', '--name-only']));
  add(git(root, ['diff', '--name-only', '--cached']));
  add(git(root, ['ls-files', '--others', '--exclude-standard', '--full-name']));
  return [...names].filter((f) => !prefix || f.startsWith(prefix + '/')).map((f) => (prefix ? f.slice(prefix.length + 1) : f));
}

export function describeRef(root: string, ref: string): string {
  try {
    return git(root, ['log', '-1', '--format=%h %s', ref]).trim();
  } catch {
    return ref;
  }
}
