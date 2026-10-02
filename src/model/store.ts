import { create } from 'zustand';
import { produce, type Draft } from 'immer';
import type { Project, Ticket, Workspace } from './types';
import { TODAY, nextMonday, addDays, uid } from '../lib/dates';

const LS = 'throughline:v3';
const LS_LEGACY = 'throughline:v2';

/* ---------- loading and migration ---------- */
// Projects saved by the single-file version keep tickets in a separate map and project info in a nested object.
function migrateLegacy(j: any): Workspace {
  const projects: Record<string, Project> = {};
  Object.entries<any>(j.PS || {}).forEach(([id, s]) => {
    if (!s || !s.project) return;
    projects[id] = normalize({
      ...s,
      id,
      name: s.project.name,
      key: s.project.key,
      desc: s.project.desc || '',
      settings: s.flow && s.flow.usl ? { usl: s.flow.usl } : {},
      tickets: (j.PT || {})[id] || {},
    });
  });
  return { projects };
}
export function normalize(p: any): Project {
  return {
    id: p.id || uid(),
    createdAt: p.createdAt || new Date().toISOString(),
    name: p.name || 'Untitled project',
    key: p.key || 'PRJ',
    desc: p.desc || '',
    members: (p.members || []).map((m: any) => ({ role: '', timeOff: {}, ...m })),
    sprints: p.sprints || [],
    epics: p.epics || [],
    milestones: p.milestones || [],
    risks: p.risks || [],
    retros: p.retros || [],
    impl: { phases: p.impl?.phases || [], tasks: p.impl?.tasks || [] },
    baseline: p.baseline || null,
    settings: p.settings || {},
    nextNum: p.nextNum || 1,
    tickets: Object.fromEntries(Object.entries<any>(p.tickets || {}).map(([k, t]) => [k, { deps: [], votes: 0, labels: '', desc: '', reporter: '', ...t } as Ticket])),
  };
}
function load(): Workspace {
  try {
    const j = JSON.parse(localStorage.getItem(LS) || 'null');
    if (j && j.projects) return { projects: Object.fromEntries(Object.entries<any>(j.projects).map(([k, p]) => [k, normalize(p)])) };
  } catch {}
  try {
    const j = JSON.parse(localStorage.getItem(LS_LEGACY) || 'null');
    if (j && j.PS) return migrateLegacy(j);
  } catch {}
  return { projects: {} };
}

/* ---------- data store with undo ---------- */
interface Entry { ws: Workspace; label: string; at: number; key?: string }
interface DataState {
  ws: Workspace;
  past: Entry[];
  future: Entry[];
  saveError: boolean;
  /** Apply a change. `coalesce` merges rapid edits with the same key into one undo step; `silent` skips undo. */
  mutate: (label: string, fn: (d: Draft<Workspace>) => void, opts?: { coalesce?: string; silent?: boolean }) => void;
  undo: () => string | null;
  redo: () => string | null;
}

export const useData = create<DataState>((set, get) => ({
  ws: load(),
  past: [],
  future: [],
  saveError: false,
  mutate(label, fn, opts = {}) {
    const { ws, past } = get();
    const next = produce(ws, fn);
    if (next === ws) return;
    if (opts.silent) return set({ ws: next });
    const last = past[past.length - 1];
    const now = Date.now();
    if (opts.coalesce && last && last.key === opts.coalesce && now - last.at < 1500) {
      last.at = now;
      return set({ ws: next, future: [] });
    }
    set({ ws: next, past: [...past.slice(-99), { ws, label, at: now, key: opts.coalesce }], future: [] });
  },
  undo() {
    const { past, ws, future } = get();
    const e = past[past.length - 1];
    if (!e) return null;
    set({ ws: e.ws, past: past.slice(0, -1), future: [...future, { ws, label: e.label, at: Date.now() }] });
    return e.label;
  },
  redo() {
    const { past, ws, future } = get();
    const e = future[future.length - 1];
    if (!e) return null;
    set({ ws: e.ws, future: future.slice(0, -1), past: [...past, { ws, label: e.label, at: Date.now() }] });
    return e.label;
  },
}));

let saveT: ReturnType<typeof setTimeout> | undefined, pending = false;
function flush() {
  clearTimeout(saveT);
  if (!pending) return;
  pending = false;
  try {
    localStorage.setItem(LS, JSON.stringify(useData.getState().ws));
    if (useData.getState().saveError) useData.setState({ saveError: false });
  } catch {
    useData.setState({ saveError: true });
  }
}
useData.subscribe((s, prev) => {
  if (s.ws === prev.ws) return;
  pending = true;
  clearTimeout(saveT);
  saveT = setTimeout(flush, 250);
});
// Only writes when a change is still waiting to be saved, so it never clobbers storage written elsewhere.
window.addEventListener('beforeunload', flush);
window.addEventListener('pagehide', flush);

/** Mutate a single project by id. */
export function mutP(pid: string, label: string, fn: (p: Draft<Project>) => void, opts?: { coalesce?: string; silent?: boolean }) {
  useData.getState().mutate(label, d => {
    const p = d.projects[pid];
    if (p) fn(p);
  }, opts);
}

export function blankProject(name: string, key: string, desc = ''): Project {
  const mon = nextMonday();
  return normalize({
    id: uid(),
    name,
    key,
    desc,
    sprints: [{ id: uid(), name: 'Sprint 1', start: mon, end: addDays(mon, 13), goal: '', status: 'planned' }],
    createdAt: new Date().toISOString(),
  });
}
export const todayStamp = TODAY;
