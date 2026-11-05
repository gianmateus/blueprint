import fs from 'node:fs';
import path from 'node:path';
import type { Annotation, Note, TimelineFrame } from './types.js';

/**
 * Everything Blueprint persists lives in `<repo>/.blueprint/` as plain JSON,
 * so notes and AI annotations can be committed and reviewed like code.
 */
export const storeDir = (root: string) => path.join(root, '.blueprint');

function readJson<T>(file: string, fallback: T): T {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8')) as T;
  } catch {
    return fallback;
  }
}

function writeJson(file: string, data: unknown) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n');
}

export const loadAnnotations = (root: string) => readJson<Record<string, Annotation>>(path.join(storeDir(root), 'annotations.json'), {});
export const saveAnnotations = (root: string, a: Record<string, Annotation>) => writeJson(path.join(storeDir(root), 'annotations.json'), a);

export const loadOverview = (root: string) => readJson<{ text?: string }>(path.join(storeDir(root), 'overview.json'), {}).text;
export const saveOverview = (root: string, text: string) => writeJson(path.join(storeDir(root), 'overview.json'), { text });

export const loadNotes = (root: string) => readJson<Note[]>(path.join(storeDir(root), 'notes.json'), []);
export const saveNotes = (root: string, notes: Note[]) => writeJson(path.join(storeDir(root), 'notes.json'), notes);

export const loadTimeline = (root: string) => readJson<TimelineFrame[]>(path.join(storeDir(root), 'timeline.json'), []);
export const saveTimeline = (root: string, t: TimelineFrame[]) => writeJson(path.join(storeDir(root), 'timeline.json'), t);
