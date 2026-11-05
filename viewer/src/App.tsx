import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Blueprint, Note } from '../../src/types';
import { Canvas, type CanvasHandle, type Decor, type UnitState } from './Canvas';
import { Iso } from './Iso';
import { Timeline } from './Timeline';
import { Panel, type Target } from './Panel';
import { layoutView, type Layout } from './layout';
import { buildTree, buildView, collapse, initialExpansion, makeRev, nodeIndex, type Folder } from './model';
import { dict, type Lang } from './i18n';
import { exportPng, exportSvg } from './exporter';
import { TitleBlock, Legend } from './Overlays';

export interface Demolition {
  removed: string[]; // node ids taken out
  seeds: string[]; // node ids broken directly (e.g. "what if this export disappeared")
  unitKeys: string[];
  label: string;
}

const EMPTY: Demolition = { removed: [], seeds: [], unitKeys: [], label: '' };

const lsGet = (k: string) => {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
};
const lsSet = (k: string, v: string) => {
  try {
    localStorage.setItem(k, v);
  } catch {
    /* storage unavailable */
  }
};

export function App({ initial }: { initial: Blueprint }) {
  const [bp, setBp] = useState(initial);
  const [lang, setLang] = useState<Lang>(() => (lsGet('blueprint.lang') as Lang) ?? (navigator.language?.startsWith('pt') ? 'pt' : 'en'));
  const t = dict[lang];
  const [mode, setMode] = useState<'inspect' | 'demolish'>('inspect');
  const [showNetwork, setShowNetwork] = useState(true);
  const [selected, setSelected] = useState<string | undefined>();
  const [demo, setDemo] = useState<Demolition>(EMPTY);
  const [search, setSearch] = useState('');
  const [toast, setToast] = useState<string | undefined>();
  const [panelOpen, setPanelOpen] = useState(true);
  const [tab, setTab] = useState<'inspect' | 'report' | 'safety' | 'notes'>('inspect');
  const [view3d, setView3d] = useState(false);
  const [heightMode, setHeightMode] = useState<'load' | 'size'>('load');
  const [layer, setLayer] = useState<'none' | 'fire' | 'history' | 'renovation'>(() => (initial.diff ? 'renovation' : 'none'));
  const [route, setRoute] = useState<number | undefined>();
  const [frame, setFrame] = useState<number | undefined>();
  const [playing, setPlaying] = useState(false);
  const [localNotes, setLocalNotes] = useState<Note[]>(() => {
    try {
      return JSON.parse(lsGet(`blueprint.notes.${initial.name}`) ?? '[]');
    } catch {
      return [];
    }
  });
  const canvas = useRef<CanvasHandle>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const pendingFocus = useRef<string | undefined>(undefined);
  const firstLayout = useRef(true);

  useEffect(() => lsSet('blueprint.lang', lang), [lang]);

  const { root, folders } = useMemo(() => buildTree(bp), [bp]);
  const [expanded, setExpanded] = useState<Set<string>>(() => initialExpansion(buildTree(initial).root));
  const view = useMemo(() => buildView(root, expanded, bp.edges, showNetwork), [root, expanded, bp, showNetwork]);
  const [layout, setLayout] = useState<Layout | undefined>();
  const [busy, setBusy] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setBusy(true);
    layoutView(view, bp).then((l) => {
      if (cancelled) return;
      setLayout(l);
      setBusy(false);
    });
    return () => {
      cancelled = true;
    };
  }, [view, bp]);

  // after each new layout: fit the first time, otherwise glide to what just opened/closed
  useEffect(() => {
    if (!layout) return;
    if (firstLayout.current) {
      firstLayout.current = false;
      canvas.current?.fit(false);
    } else if (pendingFocus.current) {
      canvas.current?.focus(pendingFocus.current);
      pendingFocus.current = undefined;
    }
  }, [layout]);

  useEffect(() => {
    requestAnimationFrame(() => canvas.current?.fit(false));
  }, [view3d]);

  // time-lapse playback
  const frames = bp.timeline ?? [];
  useEffect(() => {
    if (!playing) return;
    const id = setInterval(() => {
      setFrame((f) => {
        const next = (f ?? -1) + 1;
        if (next >= frames.length) {
          setPlaying(false);
          return frames.length - 1;
        }
        return next;
      });
    }, 1300);
    return () => clearInterval(id);
  }, [playing, frames.length]);

  // VS Code extension: the editor pushes fresh blueprints and asks us to reveal files
  useEffect(() => {
    if (!(window as any).__vscode) return;
    const onMsg = (ev: MessageEvent) => {
      const m = ev.data;
      if (m?.type === 'update' && m.blueprint) setBp(m.blueprint);
      if (m?.type === 'reveal' && typeof m.id === 'string') revealRef.current?.(m.id);
    };
    window.addEventListener('message', onMsg);
    (window as any).__vscode.postMessage({ type: 'ready' });
    return () => window.removeEventListener('message', onMsg);
  }, []);

  // live mode: redraw when the CLI says files changed
  useEffect(() => {
    if (!bp.live || typeof EventSource === 'undefined') return;
    const es = new EventSource('/api/events');
    es.addEventListener('update', async () => {
      const next = await fetch('/api/blueprint').then((r) => r.json());
      setBp(next);
      setToast(dict[lang].updated);
      setTimeout(() => setToast(undefined), 2200);
    });
    return () => es.close();
  }, [bp.live, lang]);

  const rev = useMemo(() => makeRev(bp), [bp]);
  const fall = useMemo(() => collapse(demo.removed, demo.seeds, rev), [demo, rev]);
  const removedSet = useMemo(() => new Set(demo.removed), [demo]);

  const status = useMemo(() => {
    const s = new Map<string, UnitState>();
    if (!demo.removed.length && !demo.seeds.length) return s;
    for (const u of view.units.values()) {
      let removed = 0;
      let broken = 0;
      let level = Infinity;
      for (const id of u.ids) {
        if (removedSet.has(id)) removed++;
        const l = fall.get(id);
        if (l !== undefined) {
          broken++;
          level = Math.min(level, l);
        }
      }
      if (removed && removed === u.ids.length) s.set(u.key, { state: 'demolished', level: 0, frac: 1 });
      else if (broken || removed) s.set(u.key, { state: 'broken', level: level === Infinity ? 1 : level, frac: (broken + removed) / u.ids.length });
    }
    return s;
  }, [view, fall, removedSet, demo]);

  const containerBroken = useMemo(() => {
    const s = new Set<string>();
    if (!fall.size) return s;
    for (const c of view.containers.values()) if (c.folder.all.some((id) => fall.has(id))) s.add(c.key);
    return s;
  }, [view, fall]);

  const cycleUnits = useMemo(() => {
    const s = new Set<string>();
    const ids = frame !== undefined && frames[frame] ? [frames[frame].cycleNodes] : bp.cycles;
    for (const cyc of ids) for (const id of cyc) {
      const u = view.unitOf.get(id);
      if (u) s.add(u);
    }
    return s;
  }, [bp, view, frame, frames]);

  // the active layer paints the blocks
  const decor = useMemo<Decor>(() => {
    const unit = new Map<string, string>();
    const edge = new Map<string, string>();
    const addCls = (k: string, c: string) => unit.set(k, unit.has(k) ? `${unit.get(k)} ${c}` : c);
    if (frame !== undefined && frames[frame]) {
      const present = new Set(frames[frame].nodes);
      for (const u of view.units.values()) if (!u.ids.some((id) => present.has(id))) unit.set(u.key, 'unbuilt');
      for (const e of view.edges) if (unit.get(e.from) === 'unbuilt' || unit.get(e.to) === 'unbuilt') edge.set(e.key, 'layer-dim');
      return { unit, edge, active: false };
    }
    const byId = nodeIndex(bp);
    if (layer === 'fire') {
      for (const u of view.units.values()) {
        let cls = '';
        for (const id of u.ids) {
          const sec = byId.get(id)?.security;
          if (!sec) continue;
          if (sec.sinks.some((f) => f.severity === 'high') || sec.secrets.some((f) => f.severity === 'high')) cls = 'fire-high';
          else if (!cls.includes('fire-high') && sec.sinks.some((f) => f.severity !== 'info')) cls = 'fire-sink';
          else if (!cls && sec.sources.length) cls = 'fire-source';
          if (sec.secrets.some((f) => f.severity === 'high')) cls += ' fire-secret';
        }
        if (cls) addCls(u.key, cls.trim());
      }
      const r = route !== undefined ? bp.security?.routes[route] : undefined;
      if (r) {
        const keys = r.path.map((id) => view.unitOf.get(id)).filter(Boolean) as string[];
        keys.forEach((k) => addCls(k, 'route'));
        for (let i = 0; i < keys.length - 1; i++) {
          const e = view.edges.find((x) => x.from === keys[i] && x.to === keys[i + 1]);
          if (e) edge.set(e.key, 'route');
        }
      }
      return { unit, edge, active: true };
    }
    if (layer === 'history') {
      let max = 1;
      for (const n of bp.nodes) max = Math.max(max, n.git?.commits ?? 0);
      const solo = new Set(bp.git?.soloPillars ?? []);
      for (const u of view.units.values()) {
        let c = 0;
        let isSolo = false;
        for (const id of u.ids) {
          c = Math.max(c, byId.get(id)?.git?.commits ?? 0);
          if (solo.has(id)) isSolo = true;
        }
        const level = c ? Math.min(4, 1 + Math.floor((c / max) * 3.999)) : 0;
        if (level) addCls(u.key, `heat-${level}`);
        if (isSolo) addCls(u.key, 'solo');
      }
      return { unit, edge, active: false };
    }
    if (layer === 'renovation' && bp.diff) {
      const added = new Set(bp.diff.added);
      const changed = new Set(bp.diff.changed);
      const affected = new Set(bp.diff.affected);
      for (const u of view.units.values()) {
        if (u.ids.some((id) => added.has(id))) addCls(u.key, 'reno-added');
        else if (u.ids.some((id) => changed.has(id))) addCls(u.key, 'reno-changed');
        else if (u.ids.some((id) => affected.has(id))) addCls(u.key, 'reno-affected');
      }
      return { unit, edge, active: true };
    }
    return { unit, edge, active: false };
  }, [frame, frames, layer, route, view, bp]);

  const matches = useMemo(() => {
    const s = new Set<string>();
    const q = search.trim().toLowerCase();
    if (q.length < 2) return s;
    for (const n of bp.nodes) if (n.id.toLowerCase().includes(q)) {
      const u = view.unitOf.get(n.id);
      if (u) s.add(u);
    }
    return s;
  }, [search, bp, view]);

  const folderOfNode = useCallback(
    (id: string): Folder | undefined => {
      for (const f of folders.values()) if (f.files.includes(id)) return f;
      return undefined;
    },
    [folders],
  );

  const reveal = useCallback(
    (id: string) => {
      let f = folderOfNode(id);
      const next = new Set(expanded);
      while (f) {
        next.add(f.key);
        f = f.parent;
      }
      setExpanded(next);
      setSelected(`n:${id}`);
      setTab('inspect');
      setPanelOpen(true);
      pendingFocus.current = `n:${id}`;
      if (next.size === expanded.size) requestAnimationFrame(() => canvas.current?.focus(`n:${id}`));
    },
    [expanded, folderOfNode],
  );

  const revealRef = useRef<(id: string) => void>(undefined);
  revealRef.current = reveal;

  const toggleFolder = useCallback(
    (key: string) => {
      const next = new Set(expanded);
      if (next.has(key)) {
        for (const k of [...next]) if (k === key || k.startsWith(key + '/')) next.delete(k);
        if (selected === `c:${key}`) setSelected(`f:${key}`);
        pendingFocus.current = `f:${key}`;
      } else {
        next.add(key);
        if (selected === `f:${key}`) setSelected(`c:${key}`);
        pendingFocus.current = `c:${key}`;
      }
      next.add('');
      setExpanded(next);
    },
    [expanded, selected],
  );

  const level = (dir: 1 | -1) => {
    const next = new Set(expanded);
    if (dir > 0) {
      for (const u of view.units.values()) if (u.folder) next.add(u.folder.key);
    } else {
      const depth = (k: string) => (k ? k.split('/').length : 0);
      const keys = [...next].filter((k) => k);
      const max = Math.max(0, ...keys.map(depth));
      // collapse the deepest open rooms
      for (const k of keys) if (depth(k) === max) next.delete(k);
    }
    setExpanded(next);
    firstLayout.current = true;
  };

  const demolishUnit = useCallback(
    (key: string) => {
      const ids = key.startsWith('n:') ? [key.slice(2)] : folders.get(key.slice(2))?.all ?? [];
      setDemo((d) => {
        if (d.unitKeys.includes(key)) {
          const unitKeys = d.unitKeys.filter((k) => k !== key);
          const keep = new Set(unitKeys.flatMap((k) => (k.startsWith('n:') ? [k.slice(2)] : folders.get(k.slice(2))?.all ?? [])));
          return { removed: [...keep], seeds: [], unitKeys, label: unitKeys.map(labelOf).join(' + ') };
        }
        const unitKeys = [...d.unitKeys, key];
        return { removed: [...new Set([...d.removed, ...ids])], seeds: d.seeds, unitKeys, label: unitKeys.map(labelOf).join(' + ') };
      });
    },
    [folders],
  );

  const demolishExport = (fileId: string, name: string, usedBy: string[]) => {
    setDemo({ removed: [], seeds: usedBy, unitKeys: [], label: `${fileId.split('/').pop()} › ${name}` });
  };

  const onClickUnit = (key: string) => {
    if (mode === 'demolish') demolishUnit(key);
    else {
      setSelected(key);
      setTab('inspect');
      setPanelOpen(true);
    }
  };

  const rebuild = () => setDemo(EMPTY);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') {
        if (e.key === 'Escape') (e.target as HTMLElement).blur();
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === 'd' || e.key === 'D') setMode((m) => (m === 'demolish' ? 'inspect' : 'demolish'));
      else if (e.key === 'r' || e.key === 'R') rebuild();
      else if (e.key === 'f' || e.key === 'F') canvas.current?.fit();
      else if (e.key === '3') setView3d((v) => !v);
      else if (e.key === '/') {
        e.preventDefault();
        searchRef.current?.focus();
      } else if (e.key === '+' || e.key === '=') level(1);
      else if (e.key === '-') level(-1);
      else if (e.key === 'Escape') {
        setSelected(undefined);
        setMode('inspect');
        rebuild();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const target: Target | undefined = useMemo(() => {
    if (!selected) return undefined;
    if (selected.startsWith('n:')) return { type: 'node', id: selected.slice(2), key: selected };
    const f = folders.get(selected.slice(2));
    return f ? { type: 'folder', folder: f, key: selected, open: expanded.has(f.key) } : undefined;
  }, [selected, folders, expanded]);

  const fallen = fall.size;
  const total = bp.nodes.length;
  const notes = [...(bp.notes ?? []), ...localNotes];

  const addNote = async (targetId: string, text: string) => {
    if (bp.live) {
      const res = await fetch('/api/notes', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ target: targetId, text }) });
      if (res.ok) {
        const note = await res.json();
        setBp((b) => ({ ...b, notes: [...(b.notes ?? []), note] }));
      }
    } else {
      const note: Note = { id: String(Date.now()), target: targetId, text, createdAt: new Date().toISOString() };
      const next = [...localNotes, note];
      setLocalNotes(next);
      lsSet(`blueprint.notes.${bp.name}`, JSON.stringify(next));
    }
  };
  const deleteNote = async (id: string) => {
    if (bp.live && bp.notes?.some((n) => n.id === id)) {
      await fetch(`/api/notes/${id}`, { method: 'DELETE' });
      setBp((b) => ({ ...b, notes: (b.notes ?? []).filter((n) => n.id !== id) }));
    } else {
      const next = localNotes.filter((n) => n.id !== id);
      setLocalNotes(next);
      lsSet(`blueprint.notes.${bp.name}`, JSON.stringify(next));
    }
  };

  const noteCounts = useMemo(() => {
    const c = new Map<string, number>();
    for (const n of notes) {
      const u = view.unitOf.get(n.target) ?? (view.units.has(`f:${n.target}`) ? `f:${n.target}` : undefined);
      if (u) c.set(u, (c.get(u) ?? 0) + 1);
    }
    return c;
  }, [notes, view]);

  const hasNetwork = bp.edges.some((e) => e.kind === 'http' || e.kind === 'infra');

  return (
    <div className={`app ${panelOpen ? 'with-panel' : ''}`}>
      <header className="toolbar">
        <div className="brand">
          <span className="logo">▦</span>
          <span className="brand-name">blueprint</span>
          <span className="sep">/</span>
          <span className="project">{bp.name}</span>
          {bp.live && <span className="live-dot" title={t.live}>● {t.live}</span>}
        </div>
        <div className="search">
          <input
            ref={searchRef}
            value={search}
            placeholder={t.search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                const q = search.trim().toLowerCase();
                const hit = bp.nodes.find((n) => n.id.toLowerCase().endsWith(q)) ?? bp.nodes.find((n) => n.id.toLowerCase().includes(q));
                if (hit) reveal(hit.id);
              }
            }}
          />
          <kbd>/</kbd>
        </div>
        <div className="tools">
          <div className="seg">
            <button className={mode === 'inspect' ? 'on' : ''} onClick={() => setMode('inspect')}>
              {t.inspect}
            </button>
            <button className={mode === 'demolish' ? 'on danger' : ''} onClick={() => setMode('demolish')} title="D">
              ⚒ {t.demolish}
            </button>
          </div>
          <button className="icon" onClick={rebuild} disabled={!demo.removed.length && !demo.seeds.length} title={`${t.rebuild} (R)`}>
            ↺
          </button>
          <div className="seg">
            <button onClick={() => level(-1)} title={t.levelUp}>
              −
            </button>
            <button onClick={() => level(1)} title={t.levelDown}>
              +
            </button>
          </div>
          {hasNetwork && (
            <button className={`icon ${showNetwork ? 'on' : ''}`} onClick={() => setShowNetwork((v) => !v)} title={t.network}>
              ⇢
            </button>
          )}
          <div className="seg">
            <button className={!view3d ? 'on' : ''} onClick={() => setView3d(false)}>
              2D
            </button>
            <button className={view3d ? 'on' : ''} onClick={() => setView3d(true)} title="3">
              3D
            </button>
          </div>
          {view3d && (
            <button onClick={() => setHeightMode((h) => (h === 'load' ? 'size' : 'load'))} title={t.heightHint}>
              ⇕ {heightMode === 'load' ? t.heightLoad.split(': ')[1] : t.heightSize.split(': ')[1]}
            </button>
          )}
          <div className="seg">
            {bp.security && (
              <button className={layer === 'fire' ? 'on fire' : ''} onClick={() => setLayer((l) => (l === 'fire' ? 'none' : 'fire'))}>
                ⚠ {t.layerFire}
              </button>
            )}
            {bp.nodes.some((n) => n.git) && (
              <button className={layer === 'history' ? 'on' : ''} onClick={() => setLayer((l) => (l === 'history' ? 'none' : 'history'))}>
                ⌛ {t.layerHistory}
              </button>
            )}
            {bp.diff && (
              <button className={layer === 'renovation' ? 'on' : ''} onClick={() => setLayer((l) => (l === 'renovation' ? 'none' : 'renovation'))}>
                ⚙ {t.layerReno}
              </button>
            )}
          </div>
          {frames.length > 0 && (
            <button
              className={frame !== undefined ? 'on' : ''}
              onClick={() => {
                if (frame === undefined) {
                  setFrame(0);
                  setPlaying(true);
                } else {
                  setFrame(undefined);
                  setPlaying(false);
                }
              }}
            >
              ▶ {t.timelapse}
            </button>
          )}
          <button className="icon" onClick={() => canvas.current?.fit()} title={`${t.fit} (F)`}>
            ⛶
          </button>
          <div className="seg">
            <button onClick={() => layout && exportSvg(canvas.current!.svg()!, layout, bp, t)}>{t.exportSvg}</button>
            <button onClick={() => layout && exportPng(canvas.current!.svg()!, layout, bp, t)}>{t.exportPng}</button>
          </div>
          <div className="seg">
            <button className={lang === 'en' ? 'on' : ''} onClick={() => setLang('en')}>
              EN
            </button>
            <button className={lang === 'pt' ? 'on' : ''} onClick={() => setLang('pt')}>
              PT
            </button>
          </div>
          <button className="panel-toggle" onClick={() => setPanelOpen((v) => !v)} aria-label="panel">
            {panelOpen ? '⟩' : '⟨'}
          </button>
        </div>
      </header>

      <main className="stage" onClick={() => mode === 'inspect' && setSelected(undefined)}>
        {layout && view3d && (
          <Iso
            ref={canvas}
            bp={bp}
            view={view}
            layout={layout}
            mode={mode}
            selected={selected}
            status={status}
            matches={matches}
            cycleUnits={cycleUnits}
            noteCounts={noteCounts}
            decor={decor}
            heightMode={heightMode}
            onClickUnit={onClickUnit}
            onToggleFolder={toggleFolder}
            onSelect={(k) => {
              setSelected(k);
              setTab('inspect');
              setPanelOpen(true);
            }}
          />
        )}
        {layout && !view3d && (
          <Canvas
            ref={canvas}
            bp={bp}
            view={view}
            layout={layout}
            mode={mode}
            selected={selected}
            status={status}
            containerBroken={containerBroken}
            matches={matches}
            cycleUnits={cycleUnits}
            noteCounts={noteCounts}
            decor={decor}
            onClickUnit={onClickUnit}
            onToggleFolder={toggleFolder}
            onSelect={(k) => {
              setSelected(k);
              setTab('inspect');
              setPanelOpen(true);
            }}
            totalLoc={bp.summary.loc}
            floors={bp.summary.floors}
            floorsLabel={t.floors}
          />
        )}
        {busy && <div className="busy">{t.calculating}</div>}

        {(demo.removed.length > 0 || demo.seeds.length > 0) && (
          <div className="demo-banner" onClick={(e) => e.stopPropagation()}>
            <div className="demo-label">
              {t.demolished}: <b>{demo.label}</b>
            </div>
            <div className="demo-count">
              {fallen ? (
                <>
                  <span className="big">{fallen}</span> <span>{t.down(fallen).replace(/^\d+\s/, '')}</span>
                  <span className="pct">{Math.round((fallen / Math.max(1, total - demo.removed.length)) * 100)}% {t.ofBuilding}</span>
                </>
              ) : (
                <span className="safe">{t.nothingFalls}</span>
              )}
            </div>
            <button onClick={rebuild}>↺ {t.rebuild}</button>
          </div>
        )}
        {mode === 'demolish' && !demo.removed.length && !demo.seeds.length && <div className="mode-hint">⚒ {t.demolish}: click a block · Esc</div>}
        {toast && <div className="toast">{toast}</div>}
        {frame !== undefined && frames[frame] && (
          <Timeline
            frames={frames}
            index={frame}
            playing={playing}
            t={t}
            onPlay={() => {
              if (frame >= frames.length - 1) setFrame(0);
              setPlaying((p) => !p);
            }}
            onSeek={(i) => {
              setPlaying(false);
              setFrame(i);
            }}
            onClose={() => {
              setPlaying(false);
              setFrame(undefined);
            }}
          />
        )}
        {frame === undefined && <Legend t={t} />}
        {frame === undefined && <TitleBlock bp={bp} t={t} />}
        <div className="kbd-hint">{t.keyboard}</div>
      </main>

      {panelOpen && (
        <Panel
          bp={bp}
          t={t}
          tab={tab}
          setTab={setTab}
          target={target}
          notes={notes}
          onAddNote={addNote}
          onDeleteNote={deleteNote}
          onReveal={reveal}
          onDemolish={(key) => {
            demolishUnit(key);
          }}
          onDemolishExport={demolishExport}
          onToggleFolder={toggleFolder}
          fall={fall}
          demo={demo}
          route={route}
          onRoute={(i) => {
            setRoute(i);
            setLayer('fire');
            const r = i !== undefined ? bp.security?.routes[i] : undefined;
            if (r) reveal(r.sink);
          }}
        />
      )}
    </div>
  );

  function labelOf(key: string) {
    if (key.startsWith('n:')) return key.slice(2).split('/').pop()!;
    return (folders.get(key.slice(2))?.name ?? key.slice(2)) + '/';
  }
}
