import type { Blueprint } from './types.js';

type Lang = 'en' | 'pt';

const T = {
  en: {
    title: 'Structural inspection report',
    generated: 'Generated',
    score: 'Structural health',
    overview: 'Overview',
    stats: 'Survey',
    files: 'Files',
    loc: 'Lines of code',
    edges: 'Load paths (dependencies)',
    floors: 'Floors (longest dependency chain)',
    services: 'Services',
    pillars: 'Load-bearing pillars',
    pillarsHint: 'Removing any of these brings down a large share of the building. Change them with extra care and extra tests.',
    foundations: 'Foundations',
    foundationsHint: 'Depend on nothing internal, but much of the system stands on them.',
    cracks: 'Cracks (circular dependencies)',
    cracksHint: 'Modules that depend on each other in a loop. They cannot be changed, tested or deployed in isolation.',
    rubble: 'Rubble (possibly dead code)',
    rubbleHint: 'Nothing imports these and they do not look like entry points. Check before deleting.',
    materials: 'Materials (top external packages)',
    penalties: 'Score breakdown',
    none: 'None found. ',
    holds: 'holds up',
    of: 'of the building',
    module: 'Module',
    impact: 'Impact',
    role: 'Role',
    usedBy: 'Used by',
    labels: { cracks: 'Circular dependencies', rubble: 'Unreferenced files', load: 'Too many load-bearing modules', height: 'Very deep dependency chains', giants: 'Oversized files (>800 lines)', fire: 'Dangerous calls and hard-coded secrets' } as Record<string, string>,
    fire: 'Fire safety',
    fireHint: 'Module-level paths from code that receives untrusted input to code that performs a dangerous operation. A triage map, not proof of a vulnerability.',
    secrets: 'Secrets',
    history: 'Construction history',
    hotspots: 'Hotspots (changed often and load-bearing)',
    solo: 'Pillars only one person knows',
    builders: 'builders',
    commits: 'commits',
  },
  pt: {
    title: 'Laudo de vistoria estrutural',
    generated: 'Gerado em',
    score: 'Saúde estrutural',
    overview: 'Visão geral',
    stats: 'Levantamento',
    files: 'Arquivos',
    loc: 'Linhas de código',
    edges: 'Caminhos de carga (dependências)',
    floors: 'Andares (maior cadeia de dependência)',
    services: 'Serviços',
    pillars: 'Pilares estruturais',
    pillarsHint: 'Remover qualquer um destes derruba boa parte do prédio. Mexa com cuidado redobrado e mais testes.',
    foundations: 'Fundações',
    foundationsHint: 'Não dependem de nada interno, mas boa parte do sistema se apoia nelas.',
    cracks: 'Rachaduras (dependências circulares)',
    cracksHint: 'Módulos que dependem uns dos outros em ciclo. Não dá para mudar, testar ou publicar um sem o outro.',
    rubble: 'Entulho (possível código morto)',
    rubbleHint: 'Ninguém importa estes arquivos e eles não parecem pontos de entrada. Confira antes de apagar.',
    materials: 'Materiais (pacotes externos mais usados)',
    penalties: 'Composição da nota',
    none: 'Nenhum encontrado. ',
    holds: 'sustenta',
    of: 'do prédio',
    module: 'Módulo',
    impact: 'Impacto',
    role: 'Papel',
    usedBy: 'Usado por',
    labels: { cracks: 'Dependências circulares', rubble: 'Arquivos sem referência', load: 'Excesso de módulos estruturais', height: 'Cadeias de dependência muito profundas', giants: 'Arquivos gigantes (>800 linhas)', fire: 'Chamadas perigosas e segredos no código' } as Record<string, string>,
    fire: 'Segurança contra incêndio',
    fireHint: 'Caminhos entre módulos, do código que recebe entrada não confiável até o código que faz uma operação perigosa. É um mapa de triagem, não prova de vulnerabilidade.',
    secrets: 'Segredos',
    history: 'Histórico da obra',
    hotspots: 'Pontos quentes (mudam muito e são estruturais)',
    solo: 'Pilares que só uma pessoa conhece',
    builders: 'construtores',
    commits: 'commits',
  },
};

const pct = (x: number) => `${Math.round(x * 100)}%`;

export function renderReport(bp: Blueprint, lang: Lang = 'en'): string {
  const t = T[lang];
  const s = bp.summary;
  const m = bp.metrics;
  const byImpact = (role: string) =>
    bp.nodes
      .filter((n) => m[n.id].role === role)
      .sort((a, b) => m[b.id].impact - m[a.id].impact);
  const bar = '█'.repeat(Math.round(s.score / 5)) + '░'.repeat(20 - Math.round(s.score / 5));
  const lines: string[] = [];
  lines.push(`# ${t.title}: ${bp.name}`, '');
  lines.push(`> ${t.generated} ${bp.generatedAt.slice(0, 10)} · ${bp.tool.name} v${bp.tool.version}`, '');
  lines.push(`## ${t.score}: ${s.score}/100`, '', '`' + bar + '`', '');
  if (s.scoreBreakdown.length) {
    lines.push(`**${t.penalties}:** ` + s.scoreBreakdown.map((b) => `${t.labels[b.label] ?? b.label} −${b.penalty}`).join(' · '), '');
  }
  if (bp.overview) lines.push(`## ${t.overview}`, '', bp.overview, '');
  lines.push(`## ${t.stats}`, '', `| | |`, `|---|---|`);
  lines.push(`| ${t.files} | ${s.files} |`, `| ${t.loc} | ${s.loc.toLocaleString('en')} |`, `| ${t.edges} | ${s.edges} |`, `| ${t.floors} | ${s.floors} |`);
  if (s.services) lines.push(`| ${t.services} | ${s.services} |`);
  lines.push('');

  const table = (rows: typeof bp.nodes) => {
    const out = [`| ${t.module} | ${t.impact} | ${t.usedBy} |`, '|---|---|---|'];
    for (const n of rows.slice(0, 25)) {
      const mm = m[n.id];
      const note = bp.annotations?.[n.id]?.summary;
      out.push(`| \`${n.id}\`${note ? `<br><sub>${note.replace(/\|/g, '\\|')}</sub>` : ''} | ${t.holds} ${mm.impact} (${pct(mm.impactPct)} ${t.of}) | ${mm.fanIn} |`);
    }
    if (rows.length > 25) out.push(`| … +${rows.length - 25} | | |`);
    return out;
  };

  const pillars = byImpact('pillar');
  lines.push(`## ${t.pillars} (${pillars.length})`, '', `_${t.pillarsHint}_`, '');
  lines.push(...(pillars.length ? table(pillars) : [t.none]), '');
  const foundations = byImpact('foundation');
  lines.push(`## ${t.foundations} (${foundations.length})`, '', `_${t.foundationsHint}_`, '');
  lines.push(...(foundations.length ? table(foundations) : [t.none]), '');

  lines.push(`## ${t.cracks} (${bp.cycles.length})`, '', `_${t.cracksHint}_`, '');
  if (!bp.cycles.length) lines.push(t.none);
  bp.cycles.slice(0, 20).forEach((c, i) => {
    lines.push(`${i + 1}. ${c.map((x) => `\`${x}\``).join(' ⇄ ')}`);
  });
  lines.push('');

  const rubble = bp.nodes.filter((n) => m[n.id].role === 'orphan');
  lines.push(`## ${t.rubble} (${rubble.length})`, '', `_${t.rubbleHint}_`, '');
  if (!rubble.length) lines.push(t.none);
  for (const n of rubble.slice(0, 50)) lines.push(`- \`${n.id}\` (${n.loc} loc)`);
  lines.push('');

  if (bp.security) {
    const sec = bp.security;
    lines.push(`## ${t.fire}`, '', `_${t.fireHint}_`, '');
    if (!sec.routes.length) lines.push(t.none);
    for (const r of sec.routes.slice(0, 20)) lines.push(`- **${r.severity}** · ${r.kind}: ${r.path.map((x) => `\`${x}\``).join(' → ')}`);
    const secrets = bp.nodes.flatMap((n) => (n.security?.secrets ?? []).filter((f) => f.severity === 'high').map((f) => `- \`${n.id}:${f.line}\` ${f.detail}`));
    if (secrets.length) lines.push('', `### ${t.secrets}`, '', ...secrets.slice(0, 20));
    lines.push('');
  }
  if (bp.git) {
    lines.push(`## ${t.history}`, '', `${bp.git.authors} ${t.builders}`, '');
    if (bp.git.hotspots.length) {
      lines.push(`### ${t.hotspots}`, '');
      for (const id of bp.git.hotspots) {
        const n = bp.nodes.find((x) => x.id === id)!;
        lines.push(`- \`${id}\` · ${n.git?.commits ?? 0} ${t.commits} · ↑${m[id].impact}`);
      }
      lines.push('');
    }
    if (bp.git.soloPillars.length) {
      lines.push(`### ${t.solo}`, '');
      for (const id of bp.git.soloPillars.slice(0, 20)) lines.push(`- \`${id}\` · ${bp.nodes.find((x) => x.id === id)?.git?.authors[0]?.name ?? ''}`);
      lines.push('');
    }
  }

  if (s.topExternals.length) {
    lines.push(`## ${t.materials}`, '');
    for (const e of s.topExternals.slice(0, 10)) lines.push(`- \`${e.name}\` × ${e.count}`);
    lines.push('');
  }
  return lines.join('\n');
}
