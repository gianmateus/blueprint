import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import type { Annotation, Blueprint } from './types.js';
import { loadAnnotations, saveAnnotations, saveOverview } from './store.js';

export interface AnnotateOptions {
  root: string;
  provider?: 'anthropic' | 'openai';
  model?: string;
  baseUrl?: string;
  limit?: number;
  lang?: string;
  concurrency?: number;
  force?: boolean;
  overview?: boolean;
  onProgress?: (done: number, total: number, id: string) => void;
}

const LANG_NAME: Record<string, string> = { en: 'English', pt: 'Brazilian Portuguese', de: 'German', it: 'Italian', es: 'Spanish' };

type Complete = (prompt: string, maxTokens: number) => Promise<string>;

export function makeClient(opts: AnnotateOptions): { complete: Complete; model: string } {
  const provider = opts.provider ?? (process.env.ANTHROPIC_API_KEY ? 'anthropic' : process.env.OPENAI_API_KEY || opts.baseUrl ? 'openai' : undefined);
  if (!provider) {
    throw new Error(
      'No AI provider configured. Set ANTHROPIC_API_KEY (or OPENAI_API_KEY), or point --base-url at any OpenAI-compatible server, e.g. Ollama: --provider openai --base-url http://localhost:11434/v1 --model llama3.1',
    );
  }
  if (provider === 'anthropic') {
    const key = process.env.ANTHROPIC_API_KEY;
    if (!key) throw new Error('ANTHROPIC_API_KEY is not set.');
    const model = opts.model ?? process.env.BLUEPRINT_MODEL ?? 'claude-haiku-5-5';
    const base = (opts.baseUrl ?? 'https://api.anthropic.com').replace(/\/$/, '');
    return {
      model,
      complete: async (prompt, maxTokens) => {
        const res = await fetchRetry(`${base}/v1/messages`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
          body: JSON.stringify({ model, max_tokens: maxTokens, messages: [{ role: 'user', content: prompt }] }),
        });
        const data: any = await res.json();
        return (data.content ?? []).map((c: any) => c.text ?? '').join('').trim();
      },
    };
  }
  const key = process.env.OPENAI_API_KEY ?? 'not-needed';
  const model = opts.model ?? process.env.BLUEPRINT_MODEL;
  if (!model) throw new Error('Pass --model for OpenAI-compatible providers.');
  const base = (opts.baseUrl ?? 'https://api.openai.com/v1').replace(/\/$/, '');
  return {
    model,
    complete: async (prompt, maxTokens) => {
      const res = await fetchRetry(`${base}/chat/completions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
        body: JSON.stringify({ model, max_tokens: maxTokens, messages: [{ role: 'user', content: prompt }] }),
      });
      const data: any = await res.json();
      return String(data.choices?.[0]?.message?.content ?? '').trim();
    },
  };
}

async function fetchRetry(url: string, init: RequestInit, tries = 3): Promise<Response> {
  for (let i = 0; ; i++) {
    const res = await fetch(url, init);
    if (res.ok) return res;
    if (i < tries - 1 && (res.status === 429 || res.status >= 500)) {
      await new Promise((r) => setTimeout(r, 1500 * (i + 1)));
      continue;
    }
    throw new Error(`AI request failed (${res.status}): ${(await res.text()).slice(0, 300)}`);
  }
}

const hash = (s: string) => crypto.createHash('sha1').update(s).digest('hex').slice(0, 12);

export function filePrompt(bp: Blueprint, id: string, source: string, lang: string): string {
  const m = bp.metrics[id];
  const node = bp.nodes.find((n) => n.id === id)!;
  const dependents = bp.edges.filter((e) => e.to === id).map((e) => e.from).slice(0, 8);
  return [
    `You are documenting the architecture of the codebase "${bp.name}" as if it were a building blueprint.`,
    `File: ${id}`,
    `Structural role: ${m.role} (holds up ${m.impact} other modules, ${Math.round(m.impactPct * 100)}% of the system; ${m.fanIn} direct dependents).`,
    dependents.length ? `Directly used by: ${dependents.join(', ')}` : '',
    node.exports.length ? `Exports: ${node.exports.map((e) => e.name).slice(0, 20).join(', ')}` : '',
    '',
    'Source (may be truncated):',
    '```',
    source.slice(0, 9000),
    '```',
    '',
    `In ${LANG_NAME[lang] ?? lang}, write one or two short sentences (max 40 words) saying what this file does and why other parts depend on it. Plain text, no preamble, no markdown.`,
  ]
    .filter((l) => l !== '')
    .join('\n');
}

export async function annotate(bp: Blueprint, opts: AnnotateOptions) {
  const { complete, model } = makeClient(opts);
  const lang = opts.lang ?? 'en';
  const existing = loadAnnotations(opts.root);
  const targets = bp.nodes
    .filter((n) => n.kind === 'file')
    .sort((a, b) => bp.metrics[b.id].impact - bp.metrics[a.id].impact || b.loc - a.loc)
    .slice(0, opts.limit ?? 40);

  const jobs: { id: string; source: string; h: string }[] = [];
  for (const n of targets) {
    const source = fs.readFileSync(path.join(opts.root, n.id), 'utf8');
    const h = hash(source + lang);
    if (!opts.force && existing[n.id]?.hash === h) continue;
    jobs.push({ id: n.id, source, h });
  }

  let done = 0;
  const queue = [...jobs];
  const worker = async () => {
    while (queue.length) {
      const job = queue.shift()!;
      const summary = (await complete(filePrompt(bp, job.id, job.source, lang), 160)).replace(/\s+/g, ' ');
      existing[job.id] = { summary, hash: job.h, model, at: new Date().toISOString() } satisfies Annotation;
      saveAnnotations(opts.root, existing);
      opts.onProgress?.(++done, jobs.length, job.id);
    }
  };
  await Promise.all(Array.from({ length: Math.min(opts.concurrency ?? 4, jobs.length) }, worker));

  let overview: string | undefined;
  if (opts.overview !== false) {
    const top = targets.filter((n) => existing[n.id]).slice(0, 25);
    const prompt = [
      `You are an architect writing the cover note of a structural blueprint for the codebase "${bp.name}".`,
      `Survey: ${bp.summary.files} files, ${bp.summary.loc} lines, ${bp.summary.services} services, ${bp.summary.cycles} circular dependencies, ${bp.summary.orphans} unreferenced files, health score ${bp.summary.score}/100.`,
      bp.services.length ? `Services: ${bp.services.map((s) => `${s.name} (${s.kind})`).join(', ')}` : '',
      'Most load-bearing modules:',
      ...top.map((n) => `- ${n.id} [${bp.metrics[n.id].role}, holds up ${bp.metrics[n.id].impact}]: ${existing[n.id].summary}`),
      '',
      `In ${LANG_NAME[lang] ?? lang}, write a 4-6 sentence overview of how this system is built: its main parts, what everything stands on, and the biggest structural risk. Plain text, no preamble.`,
    ]
      .filter(Boolean)
      .join('\n');
    overview = await complete(prompt, 450);
    saveOverview(opts.root, overview);
  }
  return { annotated: jobs.length, total: targets.length, overview };
}
