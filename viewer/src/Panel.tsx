import { useEffect, useMemo, useState } from 'react';
import type { Blueprint, Note, Role } from '../../src/types';
import type { Dict } from './i18n';
import { collapse, folderRole, makeRev, nodeIndex, ROLE_RANK, type Folder } from './model';
import type { Demolition } from './App';

export type Target = { type: 'node'; id: string; key: string } | { type: 'folder'; folder: Folder; key: string; open: boolean };

interface Props {
  bp: Blueprint;
  t: Dict;
  tab: 'inspect' | 'report' | 'safety' | 'notes';
  setTab: (t: 'inspect' | 'report' | 'safety' | 'notes') => void;
  target?: Target;
  notes: Note[];
  onAddNote: (target: string, text: string) => void;
  onDeleteNote: (id: string) => void;
  onReveal: (id: string) => void;
  onDemolish: (unitKey: string) => void;
  onDemolishExport: (fileId: string, name: string, usedBy: string[]) => void;
  onToggleFolder: (folderKey: string) => void;
  fall: Map<string, number>;
  demo: Demolition;
  route?: number;
  onRoute: (i: number | undefined) => void;
}

/** inside the VS Code extension the page can ask the editor to open a file */
export const vscode: { postMessage: (m: unknown) => void } | undefined = (window as any).__vscode;
const openInEditor = (id: string, line?: number) => vscode?.postMessage({ type: 'open', id, line });

const pct = (x: number) => `${Math.round(x * 100)}%`;

function RoleBadge({ role, t }: { role: Role; t: Dict }) {
  return <span className={`badge role-${role}`}>{t.role[role]}</span>;
}

function FileLink({ id, onReveal, extra }: { id: string; onReveal: (id: string) => void; extra?: string }) {
  const virtual = id.startsWith('@');
  return (
    <button className="file-link" onClick={() => onReveal(id)} title={id}>
      <span className="fl-path">{virtual ? id : id.split('/').slice(-3).join('/')}</span>
      {extra && <span className="fl-extra">{extra}</span>}
    </button>
  );
}

export function Panel(p: Props) {
  const { bp, t } = p;
  return (
    <aside className="panel" onClick={(e) => e.stopPropagation()}>
      <nav className="tabs">
        {(bp.security ? (['inspect', 'report', 'safety', 'notes'] as const) : (['inspect', 'report', 'notes'] as const)).map((k) => (
          <button key={k} className={p.tab === k ? 'on' : ''} onClick={() => p.setTab(k)}>
            {k === 'inspect' ? t.tabInspect : k === 'report' ? t.tabReport : k === 'safety' ? `${t.tabSafety}${bp.security?.routes.length ? ` (${bp.security.routes.length})` : ''}` : `${t.tabNotes}${p.notes.length ? ` (${p.notes.length})` : ''}`}
          </button>
        ))}
      </nav>
      <div className="panel-body">
        {p.tab === 'inspect' && (p.target ? p.target.type === 'node' ? <NodeView {...p} id={p.target.id} /> : <FolderView {...p} folder={p.target.folder} open={p.target.open} /> : <p className="muted">{t.pickSomething}</p>)}
        {p.tab === 'report' && <Report bp={bp} t={t} onReveal={p.onReveal} />}
        {p.tab === 'safety' && <Safety {...p} />}
        {p.tab === 'notes' && <AllNotes {...p} />}
      </div>
    </aside>
  );
}

function NodeView(p: Props & { id: string }) {
  const { bp, t, id, onReveal } = p;
  const node = nodeIndex(bp).get(id);
  const m = bp.metrics[id];
  const [source, setSource] = useState<string | undefined>();
  useEffect(() => setSource(undefined), [id]);
  const out = useMemo(() => bp.edges.filter((e) => e.from === id), [bp, id]);
  const inn = useMemo(() => bp.edges.filter((e) => e.to === id), [bp, id]);
  if (!node || !m) return null;
  const note = bp.annotations?.[id];
  const cycle = m.cycle !== undefined ? bp.cycles[m.cycle] : undefined;
  const kindLabel = (k: string, via?: string) =>
    k === 'http' ? `${t.network_http}${via ? ` ${t.via} ${via}` : ''}` : k === 'infra' ? `${t.network_infra}${via ? ` ${t.via} ${via}` : ''}` : k === 'dynamic' ? t.dynamic : k === 'reexport' ? t.reexport : '';

  const loadSource = async () => {
    if (source !== undefined) return setSource(undefined);
    const r = await fetch(`/api/source?id=${encodeURIComponent(id)}`);
    setSource(r.ok ? await r.text() : '');
  };
  const exportLines = new Set(node.exports.map((e) => e.line));

  return (
    <div className="inspect">
      <div className="crumbs">{id.split('/').slice(0, -1).join(' / ') || node.kind}</div>
      <h2 className="node-title">{id.split('/').pop()}</h2>
      <div className="role-row">
        <RoleBadge role={m.role} t={t} />
        {node.service && <span className="badge svc">{node.service}</span>}
        {node.isTest && <span className="badge">test</span>}
      </div>
      <p className="role-hint">{t.roleHint[m.role]}</p>

      {note && (
        <blockquote className="ai-note">
          <div className="ai-head">✎ {t.aiNote}</div>
          {note.summary}
        </blockquote>
      )}

      <div className="stats">
        <div>
          <b>{node.loc}</b>
          <span>{t.loc}</span>
        </div>
        <div>
          <b>{m.fanIn}</b>
          <span>{t.fanIn}</span>
        </div>
        <div>
          <b>{m.fanOut}</b>
          <span>{t.fanOut}</span>
        </div>
        <div className={m.impactPct >= 0.15 ? 'hot' : ''}>
          <b>{m.impact}</b>
          <span>
            {t.holds} · {pct(m.impactPct)}
          </span>
        </div>
        <div>
          <b>{m.floor}</b>
          <span>{t.floor}</span>
        </div>
      </div>
      <div className="impact-bar">
        <div style={{ width: pct(m.impactPct) }} />
      </div>

      {cycle && (
        <div className="crack-box">
          <b>⚡ {t.crack}</b> {t.crackHint}{' '}
          {cycle
            .filter((x) => x !== id)
            .map((x) => (
              <FileLink key={x} id={x} onReveal={onReveal} />
            ))}
        </div>
      )}

      <div className="actions">
        <button className="danger" onClick={() => p.onDemolish(`n:${id}`)}>
          ⚒ {t.demolishThis}
        </button>
        {bp.live && node.kind === 'file' && <button onClick={loadSource}>{source !== undefined ? t.hideSource : t.viewSource}</button>}
        {vscode && node.kind === 'file' && <button onClick={() => openInEditor(id)}>↗ {t.openInEditor}</button>}
      </div>

      {source !== undefined && (
        <pre className="source">
          {source.split('\n').map((l, i) => (
            <div key={i} className={exportLines.has(i + 1) ? 'exp' : ''}>
              <span className="ln">{i + 1}</span>
              {l || ' '}
            </div>
          ))}
        </pre>
      )}

      {node.security && (
        <section>
          <h3>⚠ {t.layerFire}</h3>
          {[
            [t.entrances, node.security.sources],
            [t.hazards, node.security.sinks],
            [t.secretsTitle, node.security.secrets],
          ].map(([label, list]) =>
            (list as typeof node.security.sources).length ? (
              <div key={label as string}>
                <div className="muted small">{label as string}</div>
                {(list as typeof node.security.sources).map((f, i) => (
                  <div key={i} className="finding" onClick={() => openInEditor(id, f.line)}>
                    <span className={`sev ${f.severity}`}>{f.severity}</span>
                    <span>{f.detail}</span>
                    <span className="ln">:{f.line}</span>
                  </div>
                ))}
              </div>
            ) : null,
          )}
        </section>
      )}

      {node.git && (
        <section>
          <h3>⌛ {t.history}</h3>
          {node.git.busFactor === 1 && ['pillar', 'foundation'].includes(m.role) && (bp.git?.authors ?? 0) > 1 && <div className="warn-box">⚑ {t.busFactor} 1 · {t.busHint}</div>}
          <div className="authors">
            {node.git.authors.map((a) => (
              <div key={a.name} className="author">
                <span>{a.name}</span>
                <div className="bar">
                  <div style={{ width: `${(a.commits / node.git!.commits) * 100}%` }} />
                </div>
                <span className="muted">{a.commits}</span>
              </div>
            ))}
          </div>
          <p className="muted small">
            {node.git.commits} {t.commits} · {t.created} {node.git.created.slice(0, 10)} · {t.lastChange} {node.git.lastChange.slice(0, 10)}
          </p>
        </section>
      )}

      {node.exports.length > 0 && (
        <section>
          <h3>{t.exports}</h3>
          <ul className="exports">
            {node.exports.map((e) => (
              <li key={e.name}>
                <code>{e.name}</code>
                <span className="kind">{e.kind}</span>
                <span className="muted">{e.usedBy.length ? t.usedTimes(e.usedBy.length) : t.unused}</span>
                {e.usedBy.length > 0 && (
                  <button className="mini danger" onClick={() => p.onDemolishExport(id, e.name, e.usedBy)} title={t.demolishExport}>
                    ⚒
                  </button>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section>
        <h3>
          {t.dependsOn} <span className="count">{out.length}</span>
        </h3>
        {out.map((e) => (
          <FileLink key={e.to} id={e.to} onReveal={onReveal} extra={kindLabel(e.kind, e.via)} />
        ))}
        {node.externals.length > 0 && (
          <div className="externals">
            {node.externals.map((x) => (
              <span key={x} className="ext" title={t.external}>
                {x}
              </span>
            ))}
          </div>
        )}
      </section>

      <section>
        <h3>
          {t.usedByList} <span className="count">{inn.length}</span>
        </h3>
        {inn.map((e) => (
          <FileLink key={e.from} id={e.from} onReveal={onReveal} extra={kindLabel(e.kind, e.via)} />
        ))}
      </section>

      <NotesFor {...p} targetId={id} />
    </div>
  );
}

function FolderView(p: Props & { folder: Folder; open: boolean }) {
  const { bp, t, folder, onReveal } = p;
  const rev = useMemo(() => makeRev(bp), [bp]);
  const outside = useMemo(() => {
    const inside = new Set(folder.all);
    return [...collapse(folder.all, [], rev).keys()].filter((x) => !inside.has(x)).length;
  }, [folder, rev, bp]);
  const role = folderRole(folder.all, bp);
  const counts = new Map<Role, number>();
  for (const id of folder.all) {
    const r = bp.metrics[id]?.role;
    if (r) counts.set(r, (counts.get(r) ?? 0) + 1);
  }
  const top = [...folder.all].sort((a, b) => (bp.metrics[b]?.impact ?? 0) - (bp.metrics[a]?.impact ?? 0)).slice(0, 12);
  const total = Math.max(1, bp.nodes.length - folder.all.length);
  return (
    <div className="inspect">
      <div className="crumbs">{folder.key.split('/').slice(0, -1).join(' / ') || '/'}</div>
      <h2 className="node-title">{folder.name}/</h2>
      <div className="role-row">
        <RoleBadge role={role} t={t} />
      </div>
      <div className="stats">
        <div>
          <b>{folder.all.length}</b>
          <span>{t.files}</span>
        </div>
        <div>
          <b>{folder.loc.toLocaleString('en')}</b>
          <span>{t.loc}</span>
        </div>
        <div className={outside / total >= 0.15 ? 'hot' : ''}>
          <b>{outside}</b>
          <span>
            {t.holds} · {pct(outside / total)}
          </span>
        </div>
      </div>
      <div className="role-counts">
        {[...counts.entries()]
          .sort((a, b) => ROLE_RANK[b[0]] - ROLE_RANK[a[0]])
          .map(([r, n]) => (
            <span key={r} className={`badge role-${r}`}>
              {n} {t.role[r]}
            </span>
          ))}
      </div>
      <div className="actions">
        <button className="danger" onClick={() => p.onDemolish(`f:${folder.key}`)}>
          ⚒ {t.demolishThis}
        </button>
        <button onClick={() => p.onToggleFolder(folder.key)}>{p.open ? t.closeRoom : t.openRoom}</button>
      </div>
      <section>
        <h3>{t.pillars}</h3>
        {top.map((id) => (
          <FileLink key={id} id={id} onReveal={onReveal} extra={`${t.role[bp.metrics[id].role]} · ↑${bp.metrics[id].impact}`} />
        ))}
      </section>
      <NotesFor {...p} targetId={folder.key} />
    </div>
  );
}

function NotesFor(p: Props & { targetId: string }) {
  const { t } = p;
  const [text, setText] = useState('');
  const mine = p.notes.filter((n) => n.target === p.targetId);
  return (
    <section className="notes">
      <h3>
        {t.tabNotes} <span className="count">{mine.length}</span>
      </h3>
      {mine.map((n) => (
        <div key={n.id} className="note">
          <p>{n.text}</p>
          <div className="note-meta">
            {n.author ? `${n.author} · ` : ''}
            {n.createdAt.slice(0, 10)}
            <button className="mini" onClick={() => p.onDeleteNote(n.id)} aria-label="delete">
              ×
            </button>
          </div>
        </div>
      ))}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!text.trim()) return;
          p.onAddNote(p.targetId, text.trim());
          setText('');
        }}
      >
        <textarea value={text} onChange={(e) => setText(e.target.value)} placeholder={t.addNote} rows={2} />
        <button type="submit" disabled={!text.trim()}>
          {t.save}
        </button>
      </form>
      <p className="muted small">{p.bp.live ? t.notesDisk : t.notesLocal}</p>
    </section>
  );
}

function AllNotes(p: Props) {
  const { t } = p;
  if (!p.notes.length) return <p className="muted">{t.noNotes}</p>;
  return (
    <div className="notes">
      {p.notes.map((n) => (
        <div key={n.id} className="note">
          <button className="file-link" onClick={() => p.bp.metrics[n.target] && p.onReveal(n.target)}>
            <span className="fl-path">{n.target || '/'}</span>
          </button>
          <p>{n.text}</p>
          <div className="note-meta">{n.createdAt.slice(0, 10)}</div>
        </div>
      ))}
    </div>
  );
}

function Report({ bp, t, onReveal }: { bp: Blueprint; t: Dict; onReveal: (id: string) => void }) {
  const s = bp.summary;
  const byRole = (r: Role) => bp.nodes.filter((n) => bp.metrics[n.id].role === r).sort((a, b) => bp.metrics[b.id].impact - bp.metrics[a.id].impact);
  const pillars = byRole('pillar');
  const foundations = byRole('foundation');
  const rubble = byRole('orphan');
  const R = 46;
  const C = 2 * Math.PI * R;
  const color = s.score >= 80 ? '#7ee2a8' : s.score >= 60 ? '#ffd166' : '#ff6b6b';
  return (
    <div className="report">
      <div className="score">
        <svg viewBox="0 0 120 120" width="120" height="120">
          <circle cx="60" cy="60" r={R} fill="none" stroke="rgba(214,232,255,.15)" strokeWidth="10" />
          <circle cx="60" cy="60" r={R} fill="none" stroke={color} strokeWidth="10" strokeDasharray={`${(C * s.score) / 100} ${C}`} transform="rotate(-90 60 60)" strokeLinecap="butt" />
          <text x="60" y="60" textAnchor="middle" dominantBaseline="central" fontSize="30" fontWeight="700" fill="#e6f0ff">
            {s.score}
          </text>
        </svg>
        <div>
          <h2>{t.health}</h2>
          {s.scoreBreakdown.map((b) => (
            <div key={b.label} className="penalty">
              −{b.penalty} <span>{t.penalty[b.label] ?? b.label}</span>
            </div>
          ))}
        </div>
      </div>
      {bp.diff && (
        <div className="reno">
          <h3>
            ⚙ {t.renovation} <span className="muted">· {t.renoVs} {bp.diff.baseLabel}</span>
          </h3>
          <div>
            {t.health}: {bp.diff.scoreBefore} → <b>{bp.diff.scoreAfter}</b> · {bp.diff.affected.length} {t.renoAffected} · {bp.diff.newCycles.length} {t.newCracks} · {bp.diff.newFireRoutes.length} {t.newRoutes}
          </div>
          <div className="reno-row">
            {bp.diff.added.map((id) => (
              <button key={id} className="chip added" onClick={() => onReveal(id)}>
                + {id.split('/').pop()}
              </button>
            ))}
            {bp.diff.changed.map((id) => (
              <button key={id} className="chip changed" onClick={() => onReveal(id)}>
                ~ {id.split('/').pop()}
              </button>
            ))}
            {bp.diff.removed.map((id) => (
              <span key={id} className="chip removed">
                − {id.split('/').pop()}
              </span>
            ))}
          </div>
        </div>
      )}
      {bp.overview && (
        <blockquote className="ai-note">
          <div className="ai-head">✎ {t.overview}</div>
          {bp.overview}
        </blockquote>
      )}
      <div className="stats">
        <div>
          <b>{s.files}</b>
          <span>{t.files}</span>
        </div>
        <div>
          <b>{s.loc.toLocaleString('en')}</b>
          <span>{t.linesOfCode}</span>
        </div>
        <div>
          <b>{s.edges}</b>
          <span>{t.loadPaths}</span>
        </div>
        <div>
          <b>{s.floors}</b>
          <span>{t.floors}</span>
        </div>
        {s.services > 0 && (
          <div>
            <b>{s.services}</b>
            <span>{t.services}</span>
          </div>
        )}
      </div>

      {bp.services.length > 0 && (
        <section>
          <h3>{t.servicesTitle}</h3>
          <div className="externals">
            {bp.services.map((sv) => (
              <button key={sv.name} className={`ext svc-${sv.kind}`} onClick={() => sv.entry && onReveal(sv.entry)}>
                {sv.kind === 'infra' ? '⛁' : sv.kind === 'app' ? '▣' : '▤'} {sv.name}
              </button>
            ))}
          </div>
        </section>
      )}

      <section>
        <h3>
          {t.pillars} <span className="count">{pillars.length}</span>
        </h3>
        {pillars.slice(0, 12).map((n) => (
          <FileLink key={n.id} id={n.id} onReveal={onReveal} extra={`↑${bp.metrics[n.id].impact} · ${pct(bp.metrics[n.id].impactPct)}`} />
        ))}
        {!pillars.length && <p className="muted">{t.none}</p>}
      </section>
      <section>
        <h3>
          {t.foundations} <span className="count">{foundations.length}</span>
        </h3>
        {foundations.slice(0, 12).map((n) => (
          <FileLink key={n.id} id={n.id} onReveal={onReveal} extra={`↑${bp.metrics[n.id].impact} · ${pct(bp.metrics[n.id].impactPct)}`} />
        ))}
        {!foundations.length && <p className="muted">{t.none}</p>}
      </section>
      <section>
        <h3>
          ⚡ {t.cracks} <span className="count">{bp.cycles.length}</span>
        </h3>
        {bp.cycles.slice(0, 10).map((c, i) => (
          <div key={i} className="cycle">
            {c.map((id, j) => (
              <span key={id}>
                <FileLink id={id} onReveal={onReveal} />
                {j < c.length - 1 && <span className="arrow">⇄</span>}
              </span>
            ))}
          </div>
        ))}
        {!bp.cycles.length && <p className="muted">{t.none}</p>}
      </section>
      <section>
        <h3>
          {t.rubble} <span className="count">{rubble.length}</span>
        </h3>
        {rubble.slice(0, 20).map((n) => (
          <FileLink key={n.id} id={n.id} onReveal={onReveal} extra={`${n.loc} loc`} />
        ))}
        {!rubble.length && <p className="muted">{t.none}</p>}
      </section>
      {bp.git && (
        <section>
          <h3>
            ⌛ {t.hotspots} <span className="count">{bp.git.hotspots.length}</span>
          </h3>
          {bp.git.hotspots.map((id) => (
            <FileLink key={id} id={id} onReveal={onReveal} extra={`${bp.nodes.find((n) => n.id === id)?.git?.commits ?? 0} ${t.commits} · ↑${bp.metrics[id].impact}`} />
          ))}
          {bp.git.soloPillars.length > 0 && (
            <>
              <h3 style={{ marginTop: 14 }}>
                ⚑ {t.soloPillars} <span className="count">{bp.git.soloPillars.length}</span>
              </h3>
              {bp.git.soloPillars.slice(0, 12).map((id) => (
                <FileLink key={id} id={id} onReveal={onReveal} extra={bp.nodes.find((n) => n.id === id)?.git?.authors[0]?.name} />
              ))}
            </>
          )}
        </section>
      )}
      {s.topExternals.length > 0 && (
        <section>
          <h3>{t.materials}</h3>
          <div className="externals">
            {s.topExternals.map((e) => (
              <span key={e.name} className="ext">
                {e.name} <i>×{e.count}</i>
              </span>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function Safety(p: Props) {
  const { bp, t } = p;
  const sec = bp.security!;
  const short = (id: string) => (id.startsWith('@') ? id : id.split('/').slice(-2).join('/'));
  const hazards = bp.nodes.flatMap((n) => (n.security?.sinks ?? []).filter((f) => f.severity !== 'info').map((f) => ({ id: n.id, f })));
  const secrets = bp.nodes.flatMap((n) => (n.security?.secrets ?? []).filter((f) => f.severity === 'high').map((f) => ({ id: n.id, f })));
  const entrances = bp.nodes.filter((n) => n.security?.sources.some((s) => s.kind === 'http-route'));
  return (
    <div className="safety">
      <p className="muted">{t.safetyIntro}</p>
      <section>
        <h3>
          🔥 {t.routes} <span className="count">{sec.routes.length}</span>
        </h3>
        {!sec.routes.length && <p className="muted">{t.noRoutes}</p>}
        {sec.routes.slice(0, 40).map((r, i) => (
          <button key={i} className={`route-item ${p.route === i ? 'on' : ''}`} onClick={() => p.onRoute(p.route === i ? undefined : i)}>
            <span className={`sev ${r.severity}`}>{r.severity}</span>
            <b>{r.kind}</b>
            <div className="chain">
              {r.path.map((id, j) => (
                <span key={j}>
                  {j > 0 && ' → '}
                  <b>{short(id)}</b>
                </span>
              ))}
            </div>
          </button>
        ))}
      </section>
      <section>
        <h3>
          {t.hazards} <span className="count">{hazards.length}</span>
        </h3>
        {hazards.map(({ id, f }, i) => (
          <div key={i} className="finding" onClick={() => p.onReveal(id)}>
            <span className={`sev ${f.severity}`}>{f.severity}</span>
            <span>
              {short(id)} · {f.detail}
            </span>
            <span className="ln">:{f.line}</span>
          </div>
        ))}
      </section>
      <section>
        <h3>
          {t.secretsTitle} <span className="count">{secrets.length}</span>
        </h3>
        {secrets.map(({ id, f }, i) => (
          <div key={i} className="finding" onClick={() => p.onReveal(id)}>
            <span className={`sev ${f.severity}`}>{f.severity}</span>
            <span>
              {short(id)} · {f.detail}
            </span>
            <span className="ln">:{f.line}</span>
          </div>
        ))}
        {!secrets.length && <p className="muted">{t.none}</p>}
      </section>
      <section>
        <h3>
          {t.entrances} <span className="count">{entrances.length}</span>
        </h3>
        {entrances.map((n) => (
          <FileLink key={n.id} id={n.id} onReveal={p.onReveal} extra={n.security!.sources.filter((s) => s.kind === 'http-route').map((s) => s.detail).slice(0, 2).join(', ')} />
        ))}
      </section>
    </div>
  );
}
