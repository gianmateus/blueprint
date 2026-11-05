// Posts the blueprint review on the pull request, or updates the previous one (sticky comment).
import fs from 'node:fs';

const MARKER = '<!-- blueprint-bot -->';
const body = fs.readFileSync(process.argv[2], 'utf8');
const event = JSON.parse(fs.readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'));
const number = event.pull_request?.number;
if (!number) {
  console.log('Not a pull request: skipping comment.');
  process.exit(0);
}
const api = process.env.GITHUB_API_URL ?? 'https://api.github.com';
const repo = process.env.GITHUB_REPOSITORY;
const headers = {
  authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
  accept: 'application/vnd.github+json',
  'content-type': 'application/json',
  'x-github-api-version': '2022-11-28',
};

async function call(method, url, data) {
  const res = await fetch(url, { method, headers, body: data ? JSON.stringify(data) : undefined });
  if (!res.ok) throw new Error(`${method} ${url} → ${res.status}: ${await res.text()}`);
  return res.status === 204 ? null : res.json();
}

let existing;
for (let page = 1; page <= 10 && !existing; page++) {
  const comments = await call('GET', `${api}/repos/${repo}/issues/${number}/comments?per_page=100&page=${page}`);
  existing = comments.find((c) => c.body?.includes(MARKER));
  if (comments.length < 100) break;
}
if (existing) {
  await call('PATCH', `${api}/repos/${repo}/issues/comments/${existing.id}`, { body });
  console.log(`Updated blueprint comment ${existing.html_url}`);
} else {
  const c = await call('POST', `${api}/repos/${repo}/issues/${number}/comments`, { body });
  console.log(`Posted blueprint comment ${c.html_url}`);
}
