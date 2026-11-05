// Bundles the extension (and Blueprint's analyzer) into one file, and copies the viewer.
import { build } from 'esbuild';
import fs from 'node:fs';

await build({
  entryPoints: ['src/extension.ts'],
  bundle: true,
  platform: 'node',
  target: 'node18',
  format: 'cjs',
  outfile: 'dist/extension.js',
  external: ['vscode'],
  minify: true,
  logLevel: 'info',
});
const viewer = '../dist/viewer/index.html';
if (!fs.existsSync(viewer)) throw new Error('Build the viewer first: (cd .. && npm run build)');
fs.copyFileSync(viewer, 'dist/viewer.html');
console.log('viewer copied');
