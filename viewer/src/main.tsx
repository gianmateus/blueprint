import { createRoot } from 'react-dom/client';
import type { Blueprint } from '../../src/types';
import { App } from './App';
import { CANVAS_CSS } from './canvasCss';
import './styles.css';

declare global {
  interface Window {
    __BLUEPRINT__?: Blueprint;
  }
}

// VS Code webview: acquireVsCodeApi may be called only once
const acquire = (window as any).acquireVsCodeApi;
if (typeof acquire === 'function') (window as any).__vscode = acquire();

const style = document.createElement('style');
style.textContent = CANVAS_CSS;
document.head.appendChild(style);

async function load(): Promise<Blueprint> {
  if (window.__BLUEPRINT__) return window.__BLUEPRINT__;
  for (const url of ['/api/blueprint', './blueprint.json']) {
    try {
      const r = await fetch(url);
      if (r.ok) return await r.json();
    } catch {
      /* try next */
    }
  }
  throw new Error('No blueprint data found. Run `blueprint` in your project to open this page.');
}

const root = createRoot(document.getElementById('root')!);
load()
  .then((bp) => root.render(<App initial={bp} />))
  .catch((e) => root.render(<div className="fatal">{String(e.message ?? e)}</div>));
