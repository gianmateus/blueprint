import type { TimelineFrame } from '../../src/types';
import type { Dict } from './i18n';

export function Timeline({ frames, index, playing, t, onPlay, onSeek, onClose }: { frames: TimelineFrame[]; index: number; playing: boolean; t: Dict; onPlay: () => void; onSeek: (i: number) => void; onClose: () => void }) {
  const f = frames[index];
  const prev = index > 0 ? frames[index - 1] : undefined;
  const grow = prev ? f.files - prev.files : f.files;
  const date = new Date(f.date);
  return (
    <div className="timeline" onClick={(e) => e.stopPropagation()}>
      <div className="tl-head">
        <div className="tl-date">
          {date.toLocaleDateString('en', { month: 'short' }).toUpperCase()} <b>{date.getFullYear()}</b>
        </div>
        <div className="tl-commit">
          <div className="tl-subject">{f.subject}</div>
          <div className="tl-meta">
            {f.sha.slice(0, 7)} · {f.author}
          </div>
        </div>
        <div className="tl-stats">
          <div>
            <b>{f.files}</b>
            <span>{t.files}{grow > 0 ? ` (+${grow})` : grow < 0 ? ` (${grow})` : ''}</span>
          </div>
          <div>
            <b>{f.loc.toLocaleString('en')}</b>
            <span>loc</span>
          </div>
          <div className={f.score >= 80 ? 'ok' : f.score >= 60 ? 'warn' : 'bad'}>
            <b>{f.score}</b>
            <span>{t.health}</span>
          </div>
        </div>
      </div>
      <div className="tl-controls">
        <button onClick={onPlay} aria-label={playing ? 'pause' : 'play'}>
          {playing ? '❚❚' : '▶'}
        </button>
        <input type="range" min={0} max={frames.length - 1} step={1} value={index} onChange={(e) => onSeek(Number(e.target.value))} />
        <span className="tl-count">
          {index + 1}/{frames.length}
        </span>
        <button onClick={onClose} aria-label="close">
          ×
        </button>
      </div>
    </div>
  );
}
