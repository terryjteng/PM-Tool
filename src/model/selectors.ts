import type { Cls, Epic, ImplTask, Member, Milestone, Project, Sprint, Status, Ticket } from './types';
import { TODAY, addDays, diff, fmtD, plural, weekStart, workdays } from '../lib/dates';
import { cfg } from './constants';

export const tickets = (p: Project) => Object.values(p.tickets);
export const byId = <T extends { id: string }>(arr: T[], id: string | null | undefined) => (id ? arr.find(x => x.id === id) : undefined);
export const member = (p: Project, id: string | null | undefined) => byId(p.members, id);
export const activeSprint = (p: Project) => p.sprints.find(s => s.status === 'active');
export const sortedSprints = (p: Project) => [...p.sprints].sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : 0));
export const sprintTickets = (p: Project, sid: string) => tickets(p).filter(t => t.sprintId === sid);
export const pts = (a: Ticket[]) => a.reduce((s, t) => s + (+t.points || 0), 0);
export const isDone = (t: Ticket) => t.status === 'done';
export const maxRank = (p: Project) => tickets(p).reduce((m, t) => Math.max(m, +t.rank || 0), 0);
export const byRank = (a: { rank: number }, b: { rank: number }) => (a.rank || 0) - (b.rank || 0);
export const keyNum = (t: Ticket) => +t.key.split('-').pop()! || 0;

export function memberAvail(m: Member, s: Sprint) {
  const wd = workdays(s.start, s.end) || 1;
  const off = (m.timeOff || {})[s.id] || 0;
  return Math.round((+m.capacity || 0) * Math.max(0, 1 - off / wd));
}
export const sprintCap = (p: Project, s: Sprint) => p.members.reduce((a, m) => a + memberAvail(m, s), 0);
export function velocity(p: Project) {
  const c = sortedSprints(p).filter(s => s.status === 'closed').slice(-3);
  return c.length ? Math.round(c.reduce((a, s) => a + (+s.completed! || 0), 0) / c.length) : 0;
}
export function sayDo(p: Project, n = 3) {
  const c = sortedSprints(p).filter(s => s.status === 'closed').slice(-n);
  const cm = c.reduce((a, s) => a + (+s.committed! || 0), 0);
  return cm ? Math.round(c.reduce((a, s) => a + (+s.completed! || 0), 0) / cm * 100) : null;
}
/** Remaining points for each day of the sprint so far. */
export function burn(p: Project, s: Sprint): number[] {
  if (s.status === 'closed' && s.burn) return s.burn;
  const ts = sprintTickets(p, s.id), total = pts(ts), len = diff(s.start, s.end), out: number[] = [];
  for (let i = 0; i <= len; i++) {
    const d = addDays(s.start, i);
    if (d > TODAY) break;
    const log = s.scopeLog && s.scopeLog[d];
    out.push(log ? log[0] - log[1] : total - pts(ts.filter(t => isDone(t) && !!t.doneAt && t.doneAt <= d)));
  }
  return out;
}

/* ticket state transitions (used on immer drafts) */
export function setStatus(t: Ticket, st: Status) {
  t.status = st;
  if (st === 'done') { if (!t.doneAt) t.doneAt = TODAY } else t.doneAt = null;
  if ((st === 'inprogress' || st === 'review' || st === 'done') && !t.startedAt) t.startedAt = TODAY;
}
export function moveToSprint(t: Ticket, sid: string | null) {
  t.sprintId = sid || null;
  if (sid && (t.status === 'backlog' || t.status === 'triage')) t.status = 'todo';
  if (!sid && !isDone(t) && t.status !== 'triage') t.status = 'backlog';
}

export const blockers = (p: Project, t: Ticket) => (t.deps || []).map(id => p.tickets[id]).filter(d => d && !isDone(d));
export function epicProgress(p: Project, e: Epic) {
  const ts = tickets(p).filter(t => t.epicId === e.id && t.status !== 'triage');
  const tot = pts(ts), done = pts(ts.filter(isDone));
  return { tot, done, pct: tot ? Math.round(done / tot * 100) : 0, count: ts.length };
}
export function forecast(p: Project, epicIds: string[]) {
  const ts = tickets(p).filter(t => t.epicId && epicIds.includes(t.epicId) && t.status !== 'triage');
  const rem = pts(ts.filter(t => !isDone(t)));
  if (!rem) return { rem: 0, date: null as string | null };
  const v = velocity(p);
  if (!v) return { rem, date: null };
  const a = activeSprint(p), anchor = a ? a.start : TODAY, days = cfg(p).sprintDays;
  return { rem, date: addDays(anchor, Math.ceil(rem / v) * days - 1) };
}
export function msStatus(p: Project, m: Milestone) {
  const own = p.epics.filter(e => e.milestoneId === m.id);
  const cum = p.epics.filter(e => { const mm = byId(p.milestones, e.milestoneId); return mm && mm.date <= m.date }).map(e => e.id);
  const f = forecast(p, cum);
  const prog = own.reduce((a, e) => { const x = epicProgress(p, e); a.tot += x.tot; a.done += x.done; return a }, { tot: 0, done: 0 });
  const v = velocity(p);
  let st: string, cls: Cls;
  if (prog.tot && prog.done === prog.tot) { st = 'Complete'; cls = 'ok' }
  else if (m.date < TODAY) { st = 'Missed'; cls = 'bad' }
  else if (!f.date) { st = v ? 'On track' : 'No velocity yet'; cls = v ? 'ok' : '' }
  else if (f.date <= m.date) { st = 'On track'; cls = 'ok' }
  else if (diff(m.date, f.date) <= 7) { st = 'At risk'; cls = 'warn' }
  else { st = 'Off track'; cls = 'bad' }
  return { st, cls, f, own, prog, pct: prog.tot ? Math.round(prog.done / prog.tot * 100) : 0 };
}

export function sprintPulse(p: Project, s: Sprint) {
  const ts = sprintTickets(p, s.id), total = pts(ts), done = pts(ts.filter(isDone)), len = diff(s.start, s.end) + 1;
  const day = Math.min(len, Math.max(0, diff(s.start, TODAY) + 1)), b = burn(p, s), committed = +s.committed! || total;
  const ideal = [...Array(len)].map((_, i) => committed * (1 - i / Math.max(1, len - 1)));
  const labels = [...Array(len)].map((_, i) => fmtD(addDays(s.start, i)));
  const cur = b.length ? b[b.length - 1] : total, exp = committed * (1 - Math.max(0, b.length - 1) / Math.max(1, len - 1)), gap = Math.round(cur - exp), added = total - committed;
  let sig: string, cls: Cls;
  if (!b.length) { sig = 'This sprint hasn’t reached its first day yet.'; cls = 'ok' }
  else if (gap > Math.max(3, committed * .12)) { sig = `${plural(gap, 'point')} behind the ideal line with ${plural(len - day, 'day')} left.`; cls = 'bad' }
  else if (gap > 0) { sig = `Slightly behind: ${plural(gap, 'point')} above the ideal line.`; cls = 'warn' }
  else { sig = 'On pace to finish the sprint commitment.'; cls = 'ok' }
  if (added > 0) sig += ` Scope grew by ${plural(added, 'point')} since it started.`;
  return { ts, total, done, len, day, b, committed, ideal, labels, sig, cls };
}

export const implOverdue = (t: ImplTask) => t.status !== 'done' && !!t.due && t.due < TODAY;
export function implProgress(p: Project, phaseId?: string) {
  const ts = p.impl.tasks.filter(t => !phaseId || t.phaseId === phaseId);
  const done = ts.filter(t => t.status === 'done').length;
  return { total: ts.length, done, pct: ts.length ? Math.round(done / ts.length * 100) : 0 };
}

export type Action = { kind: 'ticket' | 'milestone' | 'impl'; id: string } | { kind: 'go'; view: string };
export interface Attn { cls: Cls; title: string; sub: string; act: Action }
export function attentionItems(p: Project): Attn[] {
  const out: Attn[] = [], a = activeSprint(p);
  tickets(p).filter(t => t.type === 'bug' && t.severity === 'critical' && !isDone(t)).forEach(t => out.push({ cls: 'bad', title: `Critical bug: ${t.title}`, sub: t.status === 'triage' ? 'Still in triage' : (t.assignee ? 'Assigned to ' + (member(p, t.assignee)?.name || 'someone') : 'Unassigned'), act: { kind: 'ticket', id: t.id } }));
  p.milestones.forEach(m => { const r = msStatus(p, m); if (r.cls === 'bad' || r.cls === 'warn') out.push({ cls: r.cls, title: `${m.title} is ${r.st.toLowerCase()}`, sub: r.f.date ? `Forecast ${fmtD(r.f.date)} vs. target ${fmtD(m.date)}` : `Target ${fmtD(m.date)}`, act: { kind: 'milestone', id: m.id } }) });
  if (a) {
    sprintTickets(p, a.id).filter(t => !isDone(t) && blockers(p, t).length).forEach(t => out.push({ cls: 'warn', title: `${t.key} is blocked`, sub: `Waiting on ${blockers(p, t).map(b => b.key).join(', ')}`, act: { kind: 'ticket', id: t.id } }));
    p.members.forEach(m => { const as = pts(sprintTickets(p, a.id).filter(t => t.assignee === m.id)), c = memberAvail(m, a); if (as > c) out.push({ cls: 'warn', title: `${m.name} is overbooked`, sub: `${as} points assigned, ${c} available this sprint`, act: { kind: 'go', view: 'planning' } }) });
    const un = sprintTickets(p, a.id).filter(t => !t.assignee && !isDone(t));
    if (un.length) out.push({ cls: 'warn', title: `${plural(un.length, 'sprint ticket')} unassigned`, sub: un.map(t => t.key).join(', '), act: { kind: 'go', view: 'board' } });
  }
  tickets(p).filter(t => !isDone(t) && t.due && t.due < TODAY && t.status !== 'triage').forEach(t => out.push({ cls: 'warn', title: `${t.key} is overdue`, sub: `Was due ${fmtD(t.due)}`, act: { kind: 'ticket', id: t.id } }));
  p.impl.tasks.filter(implOverdue).forEach(t => out.push({ cls: 'warn', title: `Implementation task overdue: ${t.title}`, sub: `Was due ${fmtD(t.due)}${t.owner ? ', ' + (member(p, t.owner)?.name || '') : ''}`, act: { kind: 'impl', id: t.id } }));
  p.impl.tasks.filter(t => t.status === 'blocked').forEach(t => out.push({ cls: 'warn', title: `Implementation task blocked: ${t.title}`, sub: t.notes ? t.notes.slice(0, 80) : 'No notes on the blocker', act: { kind: 'impl', id: t.id } }));
  const tri = tickets(p).filter(t => t.status === 'triage').length;
  if (tri) out.push({ cls: '', title: `${plural(tri, 'item')} waiting in triage`, sub: 'Review new bugs and feature requests', act: { kind: 'go', view: 'tickets' } });
  const rank: Record<string, number> = { bad: 0, warn: 1, '': 2, ok: 3 };
  return out.sort((x, y) => rank[x.cls] - rank[y.cls]);
}
export function projectHealth(p: Project): [Cls, string] {
  if (!tickets(p).length && !p.milestones.length) return ['', 'Not started'];
  const a = activeSprint(p), pl = a ? sprintPulse(p, a) : null, st = p.milestones.map(m => msStatus(p, m));
  if (st.some(r => r.cls === 'bad') || (pl && pl.cls === 'bad')) return ['bad', 'Off track'];
  if (st.some(r => r.cls === 'warn') || (pl && pl.cls === 'warn')) return ['warn', 'At risk'];
  return ['ok', 'On track'];
}

/* ---------- burndown / burnup ---------- */
export type BurnScope = { kind: 'all' } | { kind: 'epic'; id: string } | { kind: 'milestone'; id: string };
export function scopeTickets(p: Project, sc: string) {
  let ts = tickets(p).filter(t => t.status !== 'triage'), target: string | null = null, label = 'All work';
  if (sc.startsWith('e:')) { const e = byId(p.epics, sc.slice(2)); if (e) { ts = ts.filter(t => t.epicId === e.id); target = e.end; label = e.title } }
  else if (sc.startsWith('m:')) {
    const m = byId(p.milestones, sc.slice(2));
    if (m) { const ids = p.epics.filter(e => { const mm = byId(p.milestones, e.milestoneId); return mm && mm.date <= m.date }).map(e => e.id); ts = ts.filter(t => !!t.epicId && ids.includes(t.epicId)); target = m.date; label = m.title }
  }
  return { ts, target, label };
}
/** Weekly scope and completed points from ticket creation and completion dates. */
export function burnup(p: Project, sc: string, metric: 'points' | 'count') {
  const { ts, target, label } = scopeTickets(p, sc);
  const val = (a: Ticket[]) => metric === 'points' ? pts(a) : a.length;
  const first = ts.reduce((m, t) => (t.createdAt && t.createdAt < m ? t.createdAt : m), TODAY);
  const start = weekStart(first);
  const weeks: string[] = [];
  for (let d = start; d <= TODAY; d = addDays(d, 7)) weeks.push(d);
  if (weeks[weeks.length - 1] !== TODAY) weeks.push(TODAY);
  const scope = weeks.map(d => val(ts.filter(t => (t.createdAt || TODAY) <= d)));
  const done = weeks.map(d => val(ts.filter(t => isDone(t) && !!t.doneAt && t.doneAt <= d)));
  // projection: recent completion rate per day over the last 6 weeks
  const recent = val(ts.filter(t => isDone(t) && !!t.doneAt && t.doneAt > addDays(TODAY, -42))) / 42;
  const remaining = scope[scope.length - 1] - done[done.length - 1];
  const eta = remaining <= 0 ? TODAY : recent > 0 ? addDays(TODAY, Math.ceil(remaining / recent)) : null;
  return { weeks, scope, done, remaining, ratePerWeek: recent * 7, eta, target, label, total: scope[scope.length - 1] };
}
