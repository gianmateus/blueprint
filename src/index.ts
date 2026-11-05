export { analyze, DEFAULT_IGNORE, type AnalyzeOptions } from './analyzer/index.js';
export { computeMetrics, dependentsOf, adjacency, stronglyConnected } from './analyzer/metrics.js';
export { renderReport } from './report.js';
export { renderHtml } from './server.js';
export type * from './types.js';
