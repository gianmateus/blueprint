import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import type { Blueprint, Note } from './types.js';
import { loadNotes, saveNotes } from './store.js';

const here = path.dirname(fileURLToPath(import.meta.url));

/** The viewer is a single self-contained HTML file built by Vite. */
export function viewerHtml(): string {
  const candidates = [
    path.join(here, 'viewer', 'index.html'), // dist/cli.js -> dist/viewer
    path.join(here, '..', 'dist', 'viewer', 'index.html'), // tsx src/cli.ts
    path.join(here, '..', 'viewer', 'dist', 'index.html'),
  ];
  for (const c of candidates) if (fs.existsSync(c)) return fs.readFileSync(c, 'utf8');
  throw new Error('Viewer not built. Run `npm run build` first.');
}

/** Embed a blueprint into the viewer so the page works offline, from a file, or on GitHub Pages. */
export function renderHtml(bp: Blueprint): string {
  const json = JSON.stringify(bp).replace(/</g, '\\u003c').replaceAll(String.fromCharCode(0x2028), '\\u2028').replaceAll(String.fromCharCode(0x2029), '\\u2029');
  const title = `${bp.name} · blueprint`.replace(/[<>&"]/g, '');
  return viewerHtml()
    .replace(/<title>.*?<\/title>/, `<title>${title}</title>`)
    .replace('</head>', `<script>window.__BLUEPRINT__=${json};</script></head>`);
}

export interface ServeOptions {
  root: string;
  port: number;
  host?: string;
  getBlueprint: () => Blueprint;
}

export function serve(opts: ServeOptions) {
  const clients = new Set<http.ServerResponse>();
  const send = (res: http.ServerResponse, status: number, body: unknown, type = 'application/json') => {
    res.writeHead(status, { 'content-type': type, 'cache-control': 'no-store' });
    res.end(typeof body === 'string' ? body : JSON.stringify(body));
  };
  const readBody = (req: http.IncomingMessage) =>
    new Promise<any>((resolve, reject) => {
      let data = '';
      req.on('data', (c) => {
        data += c;
        if (data.length > 1e6) req.destroy();
      });
      req.on('end', () => {
        try {
          resolve(data ? JSON.parse(data) : {});
        } catch (e) {
          reject(e);
        }
      });
    });

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    try {
      if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
        return send(res, 200, renderHtml({ ...opts.getBlueprint(), live: true }), 'text/html; charset=utf-8');
      }
      if (req.method === 'GET' && url.pathname === '/api/blueprint') return send(res, 200, { ...opts.getBlueprint(), live: true });
      if (req.method === 'GET' && url.pathname === '/api/events') {
        res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' });
        res.write(': connected\n\n');
        clients.add(res);
        req.on('close', () => clients.delete(res));
        return;
      }
      if (req.method === 'GET' && url.pathname === '/api/source') {
        const id = url.searchParams.get('id') ?? '';
        const bp = opts.getBlueprint();
        const node = bp.nodes.find((n) => n.id === id && n.kind === 'file');
        if (!node) return send(res, 404, { error: 'unknown file' });
        const abs = path.resolve(opts.root, node.id);
        if (!abs.startsWith(path.resolve(opts.root) + path.sep)) return send(res, 400, { error: 'bad path' });
        return send(res, 200, fs.readFileSync(abs, 'utf8'), 'text/plain; charset=utf-8');
      }
      if (url.pathname === '/api/notes') {
        if (req.method === 'GET') return send(res, 200, loadNotes(opts.root));
        if (req.method === 'POST') {
          const body = await readBody(req);
          const text = String(body.text ?? '').trim().slice(0, 4000);
          const target = String(body.target ?? '').slice(0, 500);
          if (!text || !target) return send(res, 400, { error: 'target and text are required' });
          const notes = loadNotes(opts.root);
          const note: Note = { id: randomUUID(), target, text, author: body.author ? String(body.author).slice(0, 80) : undefined, createdAt: new Date().toISOString() };
          notes.push(note);
          saveNotes(opts.root, notes);
          return send(res, 201, note);
        }
      }
      const del = url.pathname.match(/^\/api\/notes\/([\w-]+)$/);
      if (del && req.method === 'DELETE') {
        const notes = loadNotes(opts.root).filter((n) => n.id !== del[1]);
        saveNotes(opts.root, notes);
        return send(res, 204, '');
      }
      send(res, 404, { error: 'not found' });
    } catch (err) {
      send(res, 500, { error: (err as Error).message });
    }
  });

  return {
    server,
    listen: () =>
      new Promise<number>((resolve, reject) => {
        const tryPort = (p: number, attempts: number) => {
          server.once('error', (e: NodeJS.ErrnoException) => {
            if (e.code === 'EADDRINUSE' && attempts > 0) tryPort(p + 1, attempts - 1);
            else reject(e);
          });
          server.listen(p, opts.host ?? '127.0.0.1', () => resolve(p));
        };
        tryPort(opts.port, 10);
      }),
    /** tell open viewers to reload the blueprint */
    notify: () => {
      for (const c of clients) c.write(`event: update\ndata: ${Date.now()}\n\n`);
    },
  };
}
