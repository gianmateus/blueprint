import * as vscode from 'vscode';
import fs from 'node:fs';
import path from 'node:path';
import { analyze } from '../../src/analyzer/index';
import { adjacency, dependentsOf } from '../../src/analyzer/metrics';
import type { Blueprint } from '../../src/types';

/**
 * Blueprint inside VS Code: the same analyzer and the same viewer as the CLI,
 * talking to each other through webview messages.
 */

let current: Blueprint | undefined;
let root: string | undefined;
let panel: vscode.WebviewPanel | undefined;
let status: vscode.StatusBarItem;
let busy: Promise<Blueprint | undefined> | undefined;

const ROLE_LABEL: Record<string, string> = {
  foundation: 'foundation',
  pillar: 'pillar',
  beam: 'beam',
  wall: 'wall',
  entry: 'entrance',
  orphan: 'rubble',
};

function workspaceRoot(): string | undefined {
  const editor = vscode.window.activeTextEditor;
  const folder = editor ? vscode.workspace.getWorkspaceFolder(editor.document.uri) : vscode.workspace.workspaceFolders?.[0];
  return folder?.uri.fsPath;
}

async function survey(force = false): Promise<Blueprint | undefined> {
  const r = workspaceRoot();
  if (!r) {
    vscode.window.showWarningMessage('Blueprint: open a folder first.');
    return undefined;
  }
  if (!force && current && root === r) return current;
  if (busy) return busy;
  root = r;
  const pillarThreshold = vscode.workspace.getConfiguration('blueprint').get<number>('pillarThreshold', 0.15);
  busy = (async () => {
    try {
      return await vscode.window.withProgress({ location: vscode.ProgressLocation.Window, title: '▦ Blueprint: surveying…' }, async () => {
        current = await analyze({ root: r, pillarThreshold });
        updateStatus();
        return current;
      });
    } catch (e) {
      vscode.window.showErrorMessage(`Blueprint: ${(e as Error).message}`);
      return undefined;
    } finally {
      busy = undefined;
    }
  })();
  return busy;
}

function relId(file: string): string | undefined {
  if (!root || !file.startsWith(root)) return undefined;
  return path.relative(root, file).split(path.sep).join('/');
}

function updateStatus() {
  const show = vscode.workspace.getConfiguration('blueprint').get<boolean>('statusBar', true);
  const editor = vscode.window.activeTextEditor;
  const id = editor && relId(editor.document.uri.fsPath);
  const m = id && current?.metrics[id];
  if (!show || !m) {
    status.hide();
    return;
  }
  const crack = m.cycle !== undefined ? ' · ⚡ crack' : '';
  status.text = `▦ ${ROLE_LABEL[m.role]} · holds up ${m.impact} (${Math.round(m.impactPct * 100)}%)${crack}`;
  status.tooltip = `Blueprint: ${m.fanIn} files import this one. Removing it would affect ${m.impact} modules. Click for the blast radius.`;
  status.show();
}

function html(webview: vscode.Webview, extPath: string, bp: Blueprint): string {
  const viewer = fs.readFileSync(path.join(extPath, 'dist', 'viewer.html'), 'utf8');
  const json = JSON.stringify(bp).replace(/</g, '\\u003c');
  const csp = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource} data: blob:; style-src 'unsafe-inline'; script-src 'unsafe-inline'; font-src data:;">`;
  return viewer.replace('<head>', `<head>${csp}`).replace('</head>', `<script>window.__BLUEPRINT__=${json};</script></head>`);
}

async function openPanel(ctx: vscode.ExtensionContext) {
  const bp = await survey();
  if (!bp) return;
  if (panel) {
    panel.reveal(vscode.ViewColumn.Beside);
    return;
  }
  panel = vscode.window.createWebviewPanel('blueprint', `▦ ${bp.name}`, vscode.ViewColumn.Beside, { enableScripts: true, retainContextWhenHidden: true });
  panel.webview.html = html(panel.webview, ctx.extensionPath, bp);
  panel.onDidDispose(() => (panel = undefined));
  panel.webview.onDidReceiveMessage(async (m) => {
    if (m?.type === 'open' && typeof m.id === 'string' && root) {
      const file = path.join(root, m.id);
      if (!file.startsWith(root) || !fs.existsSync(file)) return;
      const doc = await vscode.workspace.openTextDocument(file);
      const line = Math.max(0, (m.line ?? 1) - 1);
      await vscode.window.showTextDocument(doc, { viewColumn: vscode.ViewColumn.One, selection: new vscode.Range(line, 0, line, 0) });
    }
    if (m?.type === 'save' && typeof m.name === 'string' && typeof m.base64 === 'string') {
      const target = await vscode.window.showSaveDialog({ defaultUri: vscode.Uri.file(path.join(root ?? '', m.name)) });
      if (target) {
        await vscode.workspace.fs.writeFile(target, Buffer.from(m.base64, 'base64'));
        vscode.window.showInformationMessage(`Blueprint saved to ${target.fsPath}`);
      }
    }
  });
}

async function impact() {
  const editor = vscode.window.activeTextEditor;
  const bp = await survey();
  const id = editor && relId(editor.document.uri.fsPath);
  if (!bp || !id || !bp.metrics[id]) {
    vscode.window.showInformationMessage('Blueprint: this file is not part of the blueprint.');
    return;
  }
  const { rev } = adjacency(bp.nodes, bp.edges);
  const hit = [...dependentsOf(id, rev)].sort((a, b) => bp.metrics[b].impact - bp.metrics[a].impact);
  if (!hit.length) {
    vscode.window.showInformationMessage(`Blueprint: nothing depends on ${path.basename(id)}. It is not load-bearing.`);
    return;
  }
  const pick = await vscode.window.showQuickPick(
    hit.map((h) => ({ label: path.basename(h), description: h, detail: `${ROLE_LABEL[bp.metrics[h].role]} · holds up ${bp.metrics[h].impact}` })),
    { title: `Changing ${path.basename(id)} can affect ${hit.length} modules (${Math.round((hit.length / bp.nodes.length) * 100)}% of the building)`, matchOnDescription: true },
  );
  if (pick && root && !pick.description!.startsWith('@')) {
    await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(path.join(root, pick.description!)));
  }
}

export function activate(ctx: vscode.ExtensionContext) {
  status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 50);
  status.command = 'blueprint.impact';
  ctx.subscriptions.push(
    status,
    vscode.commands.registerCommand('blueprint.open', () => openPanel(ctx)),
    vscode.commands.registerCommand('blueprint.impact', impact),
    vscode.commands.registerCommand('blueprint.refresh', async () => {
      const bp = await survey(true);
      if (bp) panel?.webview.postMessage({ type: 'update', blueprint: bp });
    }),
    vscode.commands.registerCommand('blueprint.reveal', async () => {
      await openPanel(ctx);
      const id = vscode.window.activeTextEditor && relId(vscode.window.activeTextEditor.document.uri.fsPath);
      if (id) setTimeout(() => panel?.webview.postMessage({ type: 'reveal', id }), 400);
    }),
    vscode.window.onDidChangeActiveTextEditor(updateStatus),
    vscode.workspace.onDidSaveTextDocument(debounce(async () => {
      if (!current) return;
      const bp = await survey(true);
      if (bp) panel?.webview.postMessage({ type: 'update', blueprint: bp });
    }, 600)),
  );
  // survey in the background so the status bar is ready
  survey().catch(() => undefined);
}

export function deactivate() {}

function debounce<T extends (...a: any[]) => void>(fn: T, ms: number) {
  let t: NodeJS.Timeout | undefined;
  return (...a: Parameters<T>) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...a), ms);
  };
}
