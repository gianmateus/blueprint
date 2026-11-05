import { useState } from 'react';
import type { Blueprint } from '../../src/types';
import type { Dict } from './i18n';

export function TitleBlock({ bp, t }: { bp: Blueprint; t: Dict }) {
  const s = bp.summary;
  const color = s.score >= 80 ? 'ok' : s.score >= 60 ? 'warn' : 'bad';
  return (
    <div className="title-block" onClick={(e) => e.stopPropagation()}>
      <div className="tb-row tb-main">
        <span className="tb-k">{t.project}</span>
        <span className="tb-v strong">{bp.name}</span>
      </div>
      <div className="tb-grid">
        <div>
          <span className="tb-k">{t.drawn}</span>
          <span className="tb-v">{bp.generatedAt.slice(0, 10)}</span>
        </div>
        <div>
          <span className="tb-k">{t.scale}</span>
          <span className="tb-v">{t.scaleValue}</span>
        </div>
        <div>
          <span className="tb-k">{t.health}</span>
          <span className={`tb-v strong ${color}`}>{s.score}/100</span>
        </div>
        <div>
          <span className="tb-k">{t.sheet}</span>
          <span className="tb-v">A-01</span>
        </div>
      </div>
      <div className="tb-row tb-foot">
        <span>
          {s.files} {t.files} · {s.edges} {t.loadPaths} · {s.cycles} ⚡
        </span>
        <span className="tb-tool">▦ blueprint v{bp.tool.version}</span>
      </div>
    </div>
  );
}

export function Legend({ t }: { t: Dict }) {
  const [open, setOpen] = useState(true);
  const Item = ({ children, label }: { children: React.ReactNode; label: string }) => (
    <div className="lg-item">
      <svg width="34" height="22" viewBox="0 0 34 22">
        {children}
      </svg>
      <span>{label}</span>
    </div>
  );
  return (
    <div className={`legend ${open ? '' : 'closed'}`} onClick={(e) => e.stopPropagation()}>
      <button className="lg-head" onClick={() => setOpen((v) => !v)}>
        {t.legend} {open ? '▾' : '▸'}
      </button>
      {open && (
        <div className="lg-body">
          <Item label={t.role.foundation}>
            <rect x="4" y="4" width="26" height="14" className="lg-body-rect" strokeWidth="1.8" />
            <rect x="4" y="4" width="26" height="14" fill="url(#lg-hatch)" />
            <rect x="2" y="2" width="5" height="5" className="lg-col" />
            <rect x="27" y="2" width="5" height="5" className="lg-col" />
            <rect x="2" y="15" width="5" height="5" className="lg-col" />
            <rect x="27" y="15" width="5" height="5" className="lg-col" />
          </Item>
          <Item label={t.role.pillar}>
            <rect x="4" y="4" width="26" height="14" className="lg-body-rect" strokeWidth="1.8" />
            <rect x="2" y="2" width="5" height="5" className="lg-col" />
            <rect x="27" y="2" width="5" height="5" className="lg-col" />
            <rect x="2" y="15" width="5" height="5" className="lg-col" />
            <rect x="27" y="15" width="5" height="5" className="lg-col" />
          </Item>
          <Item label={`${t.role.beam} / ${t.role.wall}`}>
            <rect x="4" y="4" width="26" height="14" className="lg-body-rect" strokeWidth="1.2" />
          </Item>
          <Item label={t.role.entry}>
            <rect x="4" y="4" width="26" height="14" className="lg-body-rect" strokeWidth="1" />
            <path d="M8 18v-8a8 8 0 0 1 8 8" fill="none" stroke="#a9c4ea" strokeWidth=".9" />
          </Item>
          <Item label={t.role.orphan}>
            <rect x="4" y="4" width="26" height="14" className="lg-body-rect" strokeDasharray="3 3" opacity=".6" />
          </Item>
          <Item label={t.crack}>
            <rect x="4" y="4" width="26" height="14" className="lg-body-rect" />
            <path d="M22 4l3 4l-4 3l4 4l-2 3" fill="none" stroke="#ff6b6b" strokeWidth="1.5" />
          </Item>
          <Item label="import">
            <line x1="3" y1="11" x2="31" y2="11" stroke="rgba(214,232,255,.7)" />
          </Item>
          <Item label={t.network_http}>
            <line x1="3" y1="11" x2="31" y2="11" stroke="#7ad7ff" strokeDasharray="3 4" strokeWidth="1.3" />
          </Item>
          <Item label={t.network_infra}>
            <line x1="3" y1="11" x2="31" y2="11" stroke="#ffc27a" strokeDasharray="1.5 3" strokeWidth="1.5" />
          </Item>
          <svg width="0" height="0" style={{ position: 'absolute' }}>
            <defs>
              <pattern id="lg-hatch" width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
                <line x1="0" y1="0" x2="0" y2="5" stroke="rgba(225,238,255,.45)" strokeWidth="1.2" />
              </pattern>
            </defs>
          </svg>
        </div>
      )}
    </div>
  );
}
