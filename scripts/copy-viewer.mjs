import fs from 'node:fs';
fs.mkdirSync('dist/viewer', { recursive: true });
fs.copyFileSync('viewer/dist/index.html', 'dist/viewer/index.html');
fs.chmodSync('dist/cli.js', 0o755);
console.log('viewer copied to dist/viewer');
