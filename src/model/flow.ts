import type { Project, Ticket } from './types';
import { TODAY, addDays, diff } from '../lib/dates';
import { byId, isDone, tickets } from './selectors';
import { cfg } from './constants';

export const mean = (a: number[]) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : 0);
export const pctl = (a: number[], p: number) => {
  if (!a.length) return 0;
  const s = [...a].sort((x, y) => x - y);
  return s[Math.max(0, Math.min(s.length - 1, Math.ceil(p / 100 * s.length) - 1))];
};
/** Individuals (XmR) chart: sigma estimated from the average moving range / d2 (1.128). */
export function xmr(v: number[]) {
  const m = mean(v), mr = v.slice(1).map((x, i) => Math.abs(x - v[i])), sig = mr.length ? mean(mr) / 1.128 : 0;
  return { m, sig, ucl: m + 3 * sig, lcl: Math.max(0, m - 3 * sig) };
}

export interface FlowStats {
  done: Ticket[]; ct: number[]; x: ReturnType<typeof xmr>; p50: number; p85: number; p95: number; daily: number[]; thrDay: number;
  wip: Ticket[]; aging: { t: Ticket; age: number }[]; ctAvg: number; leadAvg: number; usl: number; over: number;
  cpk: number | null; dpmo: number | null; out: number[]; shifts: number[]; little: number | null; window: number;
}
export function flowStats(p: Project): FlowStats {
  const st = cfg(p), win = st.flowWindow || 90, all = tickets(p);
  const done = all.filter(t => isDone(t) && t.startedAt && t.doneAt && t.doneAt >= addDays(TODAY, -win)).sort((a, b) => (a.doneAt! < b.doneAt! ? -1 : a.doneAt! > b.doneAt! ? 1 : 0));
  const ct = done.map(t => diff(t.startedAt!, t.doneAt!) + 1), x = xmr(ct);
  const daily = [...Array(42)].map((_, i) => { const d = addDays(TODAY, i - 41); return all.filter(t => isDone(t) && t.doneAt === d).length });
  const thrDay = mean(daily);
  const wip = all.filter(t => t.status === 'inprogress' || t.status === 'review');
  const aging = wip.filter(t => t.startedAt).map(t => ({ t, age: diff(t.startedAt!, TODAY) + 1 })).sort((a, b) => b.age - a.age);
  const lead = all.filter(t => isDone(t) && t.doneAt && t.createdAt && t.doneAt >= addDays(TODAY, -win)).map(t => diff(t.createdAt, t.doneAt!) + 1);
  const usl = +st.usl || 0, over = usl ? ct.filter(v => v > usl).length : 0;
  const out = x.sig ? ct.map((v, i) => (v > x.ucl ? i : -1)).filter(i => i >= 0) : [];
  const shifts: number[] = [];
  let run = 0, side = 0;
  ct.forEach((v, i) => { const s = v > x.m ? 1 : v < x.m ? -1 : 0; if (s && s === side) run++; else { side = s; run = s ? 1 : 0 } if (run === 8) shifts.push(i) });
  return {
    done, ct, x, p50: pctl(ct, 50), p85: pctl(ct, 85), p95: pctl(ct, 95), daily, thrDay, wip, aging, ctAvg: mean(ct), leadAvg: mean(lead), usl, over,
    cpk: usl && x.sig && ct.length >= 2 ? (usl - x.m) / (3 * x.sig) : null, dpmo: usl && ct.length ? Math.round(over / ct.length * 1e6) : null,
    out, shifts, little: thrDay ? wip.length / thrDay : null, window: win,
  };
}

export function cfdData(p: Project, n: number) {
  const ts = tickets(p).filter(t => t.status !== 'triage'), days = [...Array(n)].map((_, i) => addDays(TODAY, i - n + 1));
  const L = { todo: [] as number[], prog: [] as number[], done: [] as number[] };
  days.forEach(d => {
    let a = 0, b = 0, c = 0;
    ts.forEach(t => { if (t.doneAt && t.doneAt <= d) c++; else if (t.startedAt && t.startedAt <= d) b++; else if (t.createdAt && t.createdAt <= d) a++ });
    L.todo.push(a); L.prog.push(b); L.done.push(c);
  });
  return { days, L };
}

export function bugPareto(p: Project) {
  const bugs = tickets(p).filter(t => t.type === 'bug' && (t.createdAt || TODAY) >= addDays(TODAY, -180)), c: Record<string, number> = {};
  bugs.forEach(b => {
    const ls = String(b.labels || '').split(',').map(s => s.trim()).filter(Boolean);
    (ls.length ? ls : [byId(p.epics, b.epicId)?.title || 'Uncategorized']).forEach(k => (c[k] = (c[k] || 0) + 1));
  });
  let rows = Object.entries(c).sort((a, b) => b[1] - a[1]);
  if (rows.length > 10) rows = [...rows.slice(0, 9), ['Other', rows.slice(9).reduce((a, r) => a + r[1], 0)]];
  const tot = rows.reduce((a, r) => a + r[1], 0);
  let cum = 0;
  return { n: bugs.length, tot, rows: rows.map(([k, v]) => { cum += v; return { k, v, cum: tot ? cum / tot * 100 : 0 } }) };
}

function rng(seed: number) {
  return () => {
    seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
/** Replay random days of recent throughput until n items are done. Seeded so results are stable between renders. */
export function monteCarlo(n: number, samples: number[], runs = 2000) {
  if (!n || !samples.some(x => x > 0)) return null;
  const r = rng(n * 7919 + samples.length), days: number[] = [];
  for (let i = 0; i < runs; i++) {
    let left = n, d = 0;
    while (left > 0 && d < 1460) { left -= samples[Math.floor(r() * samples.length)]; d++ }
    days.push(d);
  }
  days.sort((a, b) => a - b);
  const at = (q: number) => days[Math.min(runs - 1, Math.floor(runs * q))];
  return { days, p50: at(.5), p85: at(.85), p95: at(.95) };
}

/** Critical path: backward pass over dependencies using scheduled dates. Slack = days a due date can move before the finish moves. */
export function cpm(dated: Ticket[]) {
  const by = Object.fromEntries(dated.map(t => [t.id, t])), succ: Record<string, string[]> = {};
  dated.forEach(t => (t.deps || []).forEach(pid => { if (by[pid] && pid !== t.id) (succ[pid] = succ[pid] || []).push(t.id) }));
  const end = dated.reduce((m, t) => (t.due! > m ? t.due! : m), dated[0].due!), lf: Record<string, string> = {}, seen: Record<string, boolean> = {};
  const LF = (id: string): string => {
    if (lf[id] != null) return lf[id];
    if (seen[id]) return end;
    seen[id] = true;
    let v = end;
    (succ[id] || []).forEach(s => { const st = by[s], c = addDays(LF(s), -diff(st.start!, st.due!) - 1); if (c < v) v = c });
    return (lf[id] = v);
  };
  const slack: Record<string, number> = {};
  dated.forEach(t => (slack[t.id] = diff(t.due!, LF(t.id))));
  return { slack, end };
}
