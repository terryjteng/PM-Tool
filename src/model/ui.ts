import { create } from 'zustand';
import type { ReactNode } from 'react';
import { useData } from './store';
import type { Project } from './types';

export type Theme = 'system' | 'light' | 'dark';
export interface Toast { id: number; msg: string; undo?: boolean }
export interface Filters {
  bq: string;
  tf: { type: string; status: string; q: string };
  boardWho: string;
  planSprint: string | null;
  reportSprint: string | null;
  retroSprint: string | null;
  mcScope: string;
  gZoom: number;
  gCrit: boolean;
  gBase: boolean;
  bdSprint: string | null;
  bdMetric: 'points' | 'count';
  bdScope: string;
  implOwner: string;
  implStatus: string;
  implHideDone: boolean;
}
const FILTERS: Filters = {
  bq: '', tf: { type: 'all', status: 'open', q: '' }, boardWho: '', planSprint: null, reportSprint: null, retroSprint: null, mcScope: 'all',
  gZoom: 22, gCrit: true, gBase: true, bdSprint: null, bdMetric: 'points', bdScope: 'all', implOwner: '', implStatus: '', implHideDone: false,
};

const LS_CUR = 'throughline:cur', LS_THEME = 'throughline:theme';
const read = (k: string) => { try { return localStorage.getItem(k) } catch { return null } };
const write = (k: string, v: string) => { try { localStorage.setItem(k, v) } catch {} };

interface UIState {
  pid: string | null;
  view: string;
  modal: ReactNode | null;
  toasts: Toast[];
  palette: boolean;
  theme: Theme;
  f: Filters;
  selected: string[];
  setF: (patch: Partial<Filters>) => void;
  openModal: (n: ReactNode) => void;
  closeModal: () => void;
  toast: (msg: string, opts?: { undo?: boolean }) => void;
  dismiss: (id: number) => void;
  setTheme: (t: Theme) => void;
  setSelected: (ids: string[]) => void;
}
let toastId = 0;
export const useUI = create<UIState>((set, get) => ({
  pid: null,
  view: 'dashboard',
  modal: null,
  toasts: [],
  palette: false,
  theme: (read(LS_THEME) as Theme) || 'system',
  f: FILTERS,
  selected: [],
  setF: patch => set({ f: { ...get().f, ...patch } }),
  openModal: n => set({ modal: n }),
  closeModal: () => set({ modal: null }),
  toast(msg, opts = {}) {
    const id = ++toastId;
    set({ toasts: [...get().toasts.slice(-2), { id, msg, undo: opts.undo }] });
    setTimeout(() => get().dismiss(id), opts.undo ? 6000 : 3200);
  },
  dismiss: id => set({ toasts: get().toasts.filter(t => t.id !== id) }),
  setTheme(t) { write(LS_THEME, t); set({ theme: t }) },
  setSelected: ids => set({ selected: ids }),
}));
export const toast = (msg: string, opts?: { undo?: boolean }) => useUI.getState().toast(msg, opts);
export const openModal = (n: ReactNode) => useUI.getState().openModal(n);
export const closeModal = () => useUI.getState().closeModal();

/* ---------- hash routing: #/ = all projects, #/<projectId>/<view> ---------- */
export function go(view: string, pid?: string | null) {
  const p = pid === undefined ? useUI.getState().pid : pid;
  const h = view === 'portfolio' || !p ? '#/' : `#/${p}/${view}`;
  if (location.hash !== h) location.hash = h;
  else syncRoute();
}
export function syncRoute() {
  const projects = useData.getState().ws.projects;
  const [a, b] = location.hash.replace(/^#\/?/, '').split('/');
  const st = useUI.getState();
  if (a && projects[a]) {
    if (st.pid !== a) set({ pid: a, selected: [], f: { ...st.f, planSprint: null, reportSprint: null, retroSprint: null, bdSprint: null, mcScope: 'all', bdScope: 'all', boardWho: '', bq: '', implOwner: '' } });
    write(LS_CUR, a);
    set({ view: b || 'dashboard' });
  } else if (!a && location.hash) {
    set({ view: 'portfolio' });
  } else {
    // no hash, or a project that no longer exists: go to the last project used, else All projects
    const last = read(LS_CUR), id = last && projects[last] ? last : Object.keys(projects)[0];
    history.replaceState(null, '', id ? `#/${id}/dashboard` : '#/');
    if (id) { set({ pid: id }); set({ view: 'dashboard' }) } else set({ pid: null, view: 'portfolio' });
  }
  function set(x: Partial<UIState>) { useUI.setState(x) }
}

export function useProject(): Project | undefined {
  const pid = useUI(s => s.pid);
  return useData(s => (pid ? s.ws.projects[pid] : undefined));
}

export function undo() {
  const l = useData.getState().undo();
  toast(l ? `Undid: ${l}` : 'Nothing to undo');
}
export function redo() {
  const l = useData.getState().redo();
  toast(l ? `Redid: ${l}` : 'Nothing to redo');
}
