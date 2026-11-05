import fs from 'node:fs';
import { analyze, type AnalyzeOptions } from './analyzer/index.js';
import { firstParentCommits, snapshot } from './analyzer/git.js';
import { saveTimeline } from './store.js';
import type { TimelineFrame } from './types.js';

/**
 * Film the construction: analyse evenly spaced commits of the history (each one
 * extracted with `git archive`, the working tree is never touched).
 */
export async function timelapse(opts: AnalyzeOptions & { frames?: number; onFrame?: (i: number, total: number, f: TimelineFrame) => void }): Promise<TimelineFrame[]> {
  const commits = firstParentCommits(opts.root);
  if (!commits.length) throw new Error('No git history found. Run inside a git repository with at least one commit.');
  const n = Math.min(opts.frames ?? 24, commits.length);
  const picks: number[] = [];
  for (let i = 0; i < n; i++) picks.push(n === 1 ? commits.length - 1 : Math.round((i * (commits.length - 1)) / (n - 1)));
  const unique = [...new Set(picks)];
  const frames: TimelineFrame[] = [];
  for (const [i, idx] of unique.entries()) {
    const c = commits[idx];
    const dir = snapshot(opts.root, c.sha);
    try {
      const bp = await analyze({ ...opts, root: dir, light: true, onProgress: () => {} });
      const frame: TimelineFrame = {
        sha: c.sha.slice(0, 10),
        date: c.date,
        subject: c.subject.slice(0, 120),
        author: c.author,
        nodes: bp.nodes.map((x) => x.id),
        cycleNodes: bp.cycles.flat(),
        score: bp.summary.score,
        loc: bp.summary.loc,
        files: bp.summary.files,
      };
      frames.push(frame);
      opts.onFrame?.(i + 1, unique.length, frame);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
  saveTimeline(opts.root, frames);
  return frames;
}
