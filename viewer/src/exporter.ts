import type { Blueprint } from '../../src/types';
import type { Layout } from './layout';
import type { Dict } from './i18n';
import { CANVAS_CSS } from './canvasCss';

const NS = 'http://www.w3.org/2000/svg';
const esc = (s: string) => s.replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' })[c]!);

/** A full-drawing copy of the canvas: identity transform, embedded styles, title block. */
function buildStandalone(svg: SVGSVGElement, layout: Layout, bp: Blueprint, t: Dict): { markup: string; w: number; h: number } {
  // measure the drawing itself (works for 2D and 3D)
  const liveWorld = svg.querySelector(':scope > g') as SVGGElement | null;
  let measured: { x: number; y: number; w: number; h: number } = layout.bounds;
  try {
    if (liveWorld) {
      const bb = liveWorld.getBBox();
      measured = { x: bb.x, y: bb.y, w: bb.width, h: bb.height };
    }
  } catch {
    /* not rendered */
  }
  const clone = svg.cloneNode(true) as SVGSVGElement;
  const world = clone.querySelector(':scope > g') as SVGGElement;
  world.removeAttribute('transform');
  clone.querySelectorAll('.dim').forEach((el) => el.classList.remove('dim'));
  const pad = 80;
  const b = measured;
  const tbW = 420;
  const tbH = 118;
  const w = Math.max(b.w + pad * 2, tbW + pad * 2);
  const h = b.h + pad * 2 + tbH + 30;
  const x0 = b.x - pad;
  const y0 = b.y - pad;
  clone.setAttribute('viewBox', `${x0} ${y0} ${w} ${h}`);
  clone.setAttribute('width', String(w));
  clone.setAttribute('height', String(h));
  clone.setAttribute('class', svg.classList.contains('iso') ? 'canvas iso' : 'canvas');
  const style = document.createElementNS(NS, 'style');
  style.textContent = CANVAS_CSS;
  clone.insertBefore(style, clone.firstChild);
  const paper = clone.querySelector('.paper');
  if (paper) {
    paper.setAttribute('x', String(x0));
    paper.setAttribute('y', String(y0));
    paper.setAttribute('width', String(w));
    paper.setAttribute('height', String(h));
  }
  const bg = document.createElementNS(NS, 'rect');
  bg.setAttribute('x', String(x0));
  bg.setAttribute('y', String(y0));
  bg.setAttribute('width', String(w));
  bg.setAttribute('height', String(h));
  bg.setAttribute('fill', '#0c3b6e');
  clone.insertBefore(bg, paper ?? clone.firstChild);

  // sheet border + title block, bottom-right
  const s = bp.summary;
  const tx = x0 + w - pad / 2 - tbW;
  const ty = y0 + h - pad / 2 - tbH;
  const g = document.createElementNS(NS, 'g');
  g.innerHTML = `
    <rect x="${x0 + 14}" y="${y0 + 14}" width="${w - 28}" height="${h - 28}" fill="none" stroke="rgba(214,232,255,.6)" stroke-width="1.2"/>
    <rect x="${x0 + 20}" y="${y0 + 20}" width="${w - 40}" height="${h - 40}" fill="none" stroke="rgba(214,232,255,.3)" stroke-width=".6"/>
    <g font-family="ui-monospace,Menlo,Consolas,monospace" fill="#e6f0ff">
      <rect x="${tx}" y="${ty}" width="${tbW}" height="${tbH}" fill="#0c3b6e" stroke="#e6f0ff" stroke-width="1.2"/>
      <line x1="${tx}" y1="${ty + 44}" x2="${tx + tbW}" y2="${ty + 44}" stroke="#e6f0ff" stroke-width=".8"/>
      <line x1="${tx}" y1="${ty + 86}" x2="${tx + tbW}" y2="${ty + 86}" stroke="#e6f0ff" stroke-width=".8"/>
      <line x1="${tx + tbW / 2}" y1="${ty + 44}" x2="${tx + tbW / 2}" y2="${ty + 86}" stroke="#e6f0ff" stroke-width=".8"/>
      <text x="${tx + 12}" y="${ty + 16}" font-size="9" fill="#a9c4ea" letter-spacing="1.5">${esc(t.project.toUpperCase())}</text>
      <text x="${tx + 12}" y="${ty + 36}" font-size="17" font-weight="700">${esc(bp.name)}</text>
      <text x="${tx + 12}" y="${ty + 58}" font-size="9" fill="#a9c4ea" letter-spacing="1.5">${esc(t.health.toUpperCase())}</text>
      <text x="${tx + 12}" y="${ty + 78}" font-size="15" font-weight="700" fill="${s.score >= 80 ? '#7ee2a8' : s.score >= 60 ? '#ffd166' : '#ff6b6b'}">${s.score}/100</text>
      <text x="${tx + tbW / 2 + 12}" y="${ty + 58}" font-size="9" fill="#a9c4ea" letter-spacing="1.5">${esc(t.drawn.toUpperCase())}</text>
      <text x="${tx + tbW / 2 + 12}" y="${ty + 78}" font-size="13">${bp.generatedAt.slice(0, 10)}</text>
      <text x="${tx + 12}" y="${ty + 106}" font-size="11" fill="#a9c4ea">${s.files} ${esc(t.files)} · ${s.loc.toLocaleString('en')} loc · ${s.cycles} ⚡ · ${s.pillars + s.foundations} ${esc(t.pillars.toLowerCase())}</text>
      <text x="${tx + tbW - 12}" y="${ty + 106}" font-size="11" text-anchor="end">▦ blueprint</text>
    </g>`;
  clone.appendChild(g);
  return { markup: new XMLSerializer().serializeToString(clone), w, h };
}

async function download(blob: Blob, name: string) {
  // VS Code webview: hand the file to the extension, which shows a save dialog
  const vs = (window as any).__vscode;
  if (vs) {
    const buf = new Uint8Array(await blob.arrayBuffer());
    let bin = '';
    for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
    vs.postMessage({ type: 'save', name, base64: btoa(bin) });
    return;
  }
  // Inside a claude.ai artifact, files go through the platform's downloads capability.
  const host = (window as any).claude;
  if (host?.use) {
    try {
      const downloads = await host.use('downloads');
      if (downloads) {
        await downloads.save({ filename: name, data: blob });
        return;
      }
    } catch (e: any) {
      if (e?.code === 'declined' || e?.code === 'rate_limited') return;
    }
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

const slug = (s: string) => s.replace(/[^\w.-]+/g, '-').replace(/^-|-$/g, '') || 'blueprint';

export function exportSvg(svg: SVGSVGElement, layout: Layout, bp: Blueprint, t: Dict) {
  const { markup } = buildStandalone(svg, layout, bp, t);
  download(new Blob([markup], { type: 'image/svg+xml' }), `${slug(bp.name)}-blueprint.svg`);
}

export function exportPng(svg: SVGSVGElement, layout: Layout, bp: Blueprint, t: Dict) {
  const { markup, w, h } = buildStandalone(svg, layout, bp, t);
  const scale = Math.min(2, 9000 / Math.max(w, h));
  const img = new Image();
  img.onload = () => {
    const c = document.createElement('canvas');
    c.width = Math.round(w * scale);
    c.height = Math.round(h * scale);
    const ctx = c.getContext('2d')!;
    ctx.scale(scale, scale);
    ctx.drawImage(img, 0, 0, w, h);
    c.toBlob((b) => b && download(b, `${slug(bp.name)}-blueprint.png`), 'image/png');
  };
  img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(markup);
}
