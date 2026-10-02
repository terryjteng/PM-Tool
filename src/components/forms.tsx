import { TODAY, addDays, fmtD, fmtDY, uid } from '../lib/dates';
import { COLORS, PRIORITIES, RAID, SEVERITIES, STATUSES, TYPES, cfg } from '../model/constants';
import { blockers, burn, byId, byRank, isDone, maxRank, moveToSprint, pts, setStatus, sortedSprints, sprintCap, sprintTickets, tickets, velocity } from '../model/selectors';
import { blankProject, mutP, useData } from '../model/store';
import type { Project, Ticket, TicketType } from '../model/types';
import { go, toast, useUI } from '../model/ui';
import { confirmBox, openForm, undoable } from './ui';

const cur = (): Project | undefined => { const pid = useUI.getState().pid; return pid ? useData.getState().ws.projects[pid] : undefined };

export function cleanKey(k: string) { return (k || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 5) }
export function keyTaken(k: string, except?: string) { return Object.values(useData.getState().ws.projects).some(p => p.id !== except && p.key === k) }

export function openTicket(id?: string | null, preset: Partial<Ticket> = {}) {
  const p = cur(); if (!p) return;
  const st = cfg(p), isNew = !id || !p.tickets[id];
  const t: Partial<Ticket> = isNew ? { type: 'story', status: 'backlog', priority: 'P2', points: st.defaultPoints, ...preset } : p.tickets[id!];
  const sprints = sortedSprints(p).filter(s => s.status !== 'closed' || s.id === t.sprintId);
  const bl = !isNew ? blockers(p, t as Ticket) : [], bk = !isNew ? tickets(p).filter(x => (x.deps || []).includes(t.id!)) : [];
  openForm({
    title: isNew ? (t.type === 'bug' ? 'Report a bug' : t.type === 'feature' ? 'Request a feature' : 'New ticket') : `${t.key}: ${t.title}`,
    saveLabel: isNew ? 'Create ticket' : 'Save changes',
    values: { ...t, deps: (t.deps || []).map(d => p.tickets[d]?.key).filter(Boolean).join(', ') },
    fields: [
      { k: 'title', label: 'Title', wide: true },
      { k: 'type', label: 'Type', type: 'select', options: TYPES.map(x => [x, st.typeLabels[x]]) },
      { k: 'status', label: 'Status', type: 'select', options: STATUSES.map(x => [x, st.statusLabels[x]]) },
      { k: 'priority', label: 'Priority', type: 'select', options: PRIORITIES },
      { k: 'severity', label: 'Severity (bugs)', type: 'select', options: [['', '—'], ...SEVERITIES] },
      { k: 'points', label: 'Story points', type: 'number', min: 0 },
      { k: 'assignee', label: 'Assignee', type: 'select', options: [['', 'Unassigned'], ...p.members.map(m => [m.id, m.name] as [string, string])] },
      { k: 'sprintId', label: 'Sprint', type: 'select', options: [['', 'Backlog'], ...sprints.map(s => [s.id, s.name + (s.status === 'active' ? ' (active)' : '')] as [string, string])] },
      { k: 'epicId', label: 'Epic', type: 'select', options: [['', 'No epic'], ...p.epics.map(e => [e.id, e.title] as [string, string])] },
      { k: 'start', label: 'Start date', type: 'date' },
      { k: 'due', label: 'Due date', type: 'date' },
      { k: 'deps', label: 'Blocked by', hint: 'Ticket keys, comma-separated, e.g. ' + p.key + '-4' },
      { k: 'votes', label: 'Votes (requests)', type: 'number', min: 0 },
      { k: 'reporter', label: 'Reported by' },
      { k: 'labels', label: 'Labels', hint: 'Comma-separated; used by the defect Pareto' },
      { k: 'desc', label: 'Description and acceptance criteria', type: 'textarea', wide: true },
    ],
    note: !isNew && <>
      <p>Created {fmtDY(t.createdAt)}{t.startedAt && `, started ${fmtD(t.startedAt)}`}{t.doneAt && `, done ${fmtD(t.doneAt)}`}.</p>
      {bl.length > 0 && <p style={{ color: 'var(--bad)' }}>Blocked by {bl.map(b => b.key).join(', ')}.</p>}
      {bk.length > 0 && <p>Blocks {bk.map(b => b.key).join(', ')}.</p>}
    </>,
    onSave(v) {
      if (!v.title.trim()) return 'Add a title to save this ticket.';
      if (v.start && v.due && v.due < v.start) return 'The due date is before the start date.';
      const keys = String(v.deps || '').split(',').map(s => s.trim().toUpperCase()).filter(Boolean);
      const byKey = Object.fromEntries(tickets(p).map(x => [x.key.toUpperCase(), x.id]));
      const bad = keys.filter(k => !byKey[k]);
      if (bad.length) return 'No ticket with key ' + bad.join(', ') + '.';
      let key = t.key!;
      mutP(p.id, isNew ? 'Create ticket' : `Edit ${t.key}`, d => {
        let nt: Ticket;
        if (isNew) {
          key = d.key + '-' + d.nextNum++;
          nt = { id: uid(), key, createdAt: TODAY, rank: maxRank(d as Project) + 1, startedAt: null, doneAt: null } as Ticket;
          d.tickets[nt.id] = nt;
          nt = d.tickets[nt.id];
        } else nt = d.tickets[t.id!];
        Object.assign(nt, {
          title: v.title.trim(), type: v.type, priority: v.priority, severity: v.severity || null, points: Math.max(0, +v.points || 0), assignee: v.assignee || null, epicId: v.epicId || null,
          start: v.start || null, due: v.due || null, deps: keys.map(k => byKey[k]).filter(x => x !== nt.id), votes: +v.votes || 0, reporter: v.reporter || '', labels: v.labels || '', desc: v.desc || '',
        });
        nt.sprintId = v.sprintId || null;
        setStatus(nt, v.status);
        if (nt.sprintId && (nt.status === 'backlog' || nt.status === 'triage')) nt.status = 'todo';
      });
      toast(isNew ? `Created ${key}` : `Saved ${key}`);
    },
    onDelete: isNew ? null : () => { deleteTickets(p.id, [t.id!]) },
  });
}
export function deleteTickets(pid: string, ids: string[]) {
  const p = useData.getState().ws.projects[pid];
  const label = ids.length === 1 ? `Delete ${p.tickets[ids[0]]?.key}` : `Delete ${ids.length} tickets`;
  mutP(pid, label, d => {
    ids.forEach(id => { delete d.tickets[id] });
    Object.values(d.tickets).forEach(x => { if (x.deps?.some(dp => ids.includes(dp))) x.deps = x.deps.filter(dp => !ids.includes(dp)) });
  });
  undoable(ids.length === 1 ? `Deleted ${p.tickets[ids[0]]?.key}` : `Deleted ${ids.length} tickets`);
}
export const newTicket = (type?: TicketType, sprintId?: string) => {
  const p: Partial<Ticket> = {};
  if (type === 'bug' || type === 'feature') Object.assign(p, { type, status: 'triage', points: 0, priority: type === 'bug' ? 'P1' : 'P2', severity: type === 'bug' ? 'major' : null });
  if (sprintId) Object.assign(p, { sprintId, status: 'todo' });
  openTicket(null, p);
};

export function openEpic(id?: string) {
  const p = cur(); if (!p) return;
  const isNew = !id, e = isNew ? { color: COLORS[p.epics.length % COLORS.length][0], start: TODAY, end: addDays(TODAY, 27) } : byId(p.epics, id)!;
  openForm({
    title: isNew ? 'New epic' : (e as any).title, values: e, saveLabel: isNew ? 'Create epic' : 'Save changes',
    fields: [{ k: 'title', label: 'Title', wide: true }, { k: 'start', label: 'Start', type: 'date' }, { k: 'end', label: 'End', type: 'date' }, { k: 'milestoneId', label: 'Milestone', type: 'select', options: [['', 'None'], ...p.milestones.map(m => [m.id, m.title] as [string, string])] }, { k: 'color', label: 'Color', type: 'color', options: COLORS, wide: true }, { k: 'desc', label: 'Description', type: 'textarea', wide: true }],
    onSave(v) {
      if (!v.title.trim() || !v.start || !v.end) return 'An epic needs a title, start, and end.';
      if (v.end < v.start) return 'The end date is before the start date.';
      mutP(p.id, isNew ? 'Create epic' : 'Edit epic', d => {
        const data = { title: v.title.trim(), start: v.start, end: v.end, color: v.color, milestoneId: v.milestoneId || null, desc: v.desc || '' };
        if (isNew) d.epics.push({ id: uid(), ...data }); else Object.assign(byId(d.epics, id)!, data);
      });
      toast(isNew ? 'Epic created' : 'Epic saved');
    },
    onDelete: isNew ? null : () => { mutP(p.id, 'Delete epic', d => { d.epics = d.epics.filter(x => x.id !== id); Object.values(d.tickets).forEach(t => { if (t.epicId === id) t.epicId = null }) }); undoable('Epic deleted') },
  });
}
export function openMilestone(id?: string) {
  const p = cur(); if (!p) return;
  const isNew = !id, m = isNew ? { date: addDays(TODAY, 30) } : byId(p.milestones, id)!;
  openForm({
    title: isNew ? 'New milestone' : (m as any).title, values: m, saveLabel: isNew ? 'Create milestone' : 'Save changes',
    fields: [{ k: 'title', label: 'Title' }, { k: 'date', label: 'Date', type: 'date' }, { k: 'desc', label: 'What done looks like', type: 'textarea', wide: true }],
    onSave(v) {
      if (!v.title.trim() || !v.date) return 'A milestone needs a title and date.';
      mutP(p.id, isNew ? 'Create milestone' : 'Edit milestone', d => { const data = { title: v.title.trim(), date: v.date, desc: v.desc || '' }; if (isNew) d.milestones.push({ id: uid(), ...data }); else Object.assign(byId(d.milestones, id)!, data) });
      toast(isNew ? 'Milestone created' : 'Milestone saved');
    },
    onDelete: isNew ? null : () => { mutP(p.id, 'Delete milestone', d => { d.milestones = d.milestones.filter(x => x.id !== id); d.epics.forEach(e => { if (e.milestoneId === id) e.milestoneId = null }) }); undoable('Milestone deleted') },
  });
}
export function openRisk(id?: string) {
  const p = cur(); if (!p) return;
  const isNew = !id, r = isNew ? { kind: 'risk', likelihood: 2, impact: 2, status: 'open' } : byId(p.risks, id)!;
  const scale: [number, string][] = [[1, '1 Low'], [2, '2 Medium'], [3, '3 High']];
  openForm({
    title: isNew ? 'Log an item' : (r as any).title, values: r, saveLabel: isNew ? 'Log item' : 'Save changes',
    fields: [{ k: 'title', label: 'Description', wide: true }, { k: 'kind', label: 'Type', type: 'select', options: RAID }, { k: 'status', label: 'Status', type: 'select', options: [['open', 'Open'], ['mitigating', 'Mitigating'], ['closed', 'Closed']] }, { k: 'likelihood', label: 'Likelihood', type: 'select', options: scale }, { k: 'impact', label: 'Impact', type: 'select', options: scale }, { k: 'owner', label: 'Owner', type: 'select', options: [['', 'Unassigned'], ...p.members.map(m => [m.id, m.name] as [string, string])] }, { k: 'mitigation', label: 'Mitigation or next step', type: 'textarea', wide: true }],
    onSave(v) {
      if (!v.title.trim()) return 'Describe the item to save it.';
      mutP(p.id, isNew ? 'Log RAID item' : 'Edit RAID item', d => { const data = { title: v.title.trim(), kind: v.kind, status: v.status, likelihood: +v.likelihood, impact: +v.impact, owner: v.owner || null, mitigation: v.mitigation || '' }; if (isNew) d.risks.push({ id: uid(), ...data }); else Object.assign(byId(d.risks, id)!, data) });
      toast(isNew ? 'Item logged' : 'Item saved');
    },
    onDelete: isNew ? null : () => { mutP(p.id, 'Delete RAID item', d => { d.risks = d.risks.filter(x => x.id !== id) }); undoable('Item deleted') },
  });
}
export function openMember(id?: string) {
  const p = cur(); if (!p) return;
  const isNew = !id, m = isNew ? { capacity: 10, color: COLORS[p.members.length % COLORS.length][0] } : byId(p.members, id)!;
  openForm({
    title: isNew ? 'Add teammate' : (m as any).name, values: m, saveLabel: isNew ? 'Add teammate' : 'Save changes', delLabel: 'Remove',
    fields: [{ k: 'name', label: 'Name' }, { k: 'role', label: 'Role' }, { k: 'capacity', label: 'Points per sprint', type: 'number', min: 0, hint: 'What they typically finish in a full sprint' }, { k: 'color', label: 'Color', type: 'color', options: COLORS, wide: true }],
    onSave(v) {
      if (!v.name.trim()) return 'Add a name.';
      mutP(p.id, isNew ? 'Add teammate' : 'Edit teammate', d => { const data = { name: v.name.trim(), role: v.role || '', capacity: Math.max(0, +v.capacity || 0), color: v.color }; if (isNew) d.members.push({ id: uid(), timeOff: {}, ...data }); else Object.assign(byId(d.members, id)!, data) });
      toast(isNew ? 'Teammate added' : 'Saved');
    },
    onDelete: isNew ? null : () => {
      mutP(p.id, 'Remove teammate', d => {
        d.members = d.members.filter(x => x.id !== id);
        Object.values(d.tickets).forEach(t => { if (t.assignee === id) t.assignee = null });
        d.risks.forEach(r => { if (r.owner === id) r.owner = null });
        d.impl.tasks.forEach(t => { if (t.owner === id) t.owner = null });
      });
      undoable('Teammate removed');
    },
  });
}
export function openSprint(id?: string) {
  const p = cur(); if (!p) return;
  const days = cfg(p).sprintDays, last = sortedSprints(p).slice(-1)[0], isNew = !id;
  const s = isNew ? { name: 'Sprint ' + (p.sprints.length + 1), start: last ? addDays(last.end, 1) : TODAY, end: last ? addDays(last.end, days) : addDays(TODAY, days - 1), goal: '' } : byId(p.sprints, id)!;
  const closed = !isNew && (s as any).status === 'closed';
  openForm({
    title: isNew ? 'New sprint' : (s as any).name, values: s, saveLabel: isNew ? 'Create sprint' : 'Save changes',
    fields: [{ k: 'name', label: 'Name' }, { k: 'start', label: 'Start', type: 'date' }, { k: 'end', label: 'End', type: 'date' }, ...(closed || (!isNew && (s as any).status === 'active') ? [{ k: 'committed', label: 'Points committed', type: 'number' as const, min: 0 }] : []), ...(closed ? [{ k: 'completed', label: 'Points completed', type: 'number' as const, min: 0, hint: 'Correct this if the history is wrong; it feeds velocity.' }] : []), { k: 'goal', label: 'Sprint goal', type: 'textarea', wide: true }],
    onSave(v) {
      if (!v.name.trim() || !v.start || !v.end) return 'A sprint needs a name and dates.';
      if (v.end < v.start) return 'The end date is before the start date.';
      let nid = id;
      mutP(p.id, isNew ? 'Create sprint' : 'Edit sprint', d => {
        if (isNew) { nid = uid(); d.sprints.push({ id: nid, name: v.name.trim(), start: v.start, end: v.end, goal: v.goal || '', status: 'planned' }) }
        else { const x = byId(d.sprints, id)!; Object.assign(x, { name: v.name.trim(), start: v.start, end: v.end, goal: v.goal || '' }); if ('committed' in v) x.committed = +v.committed || 0; if ('completed' in v) x.completed = +v.completed || 0 }
      });
      if (isNew) useUI.getState().setF({ planSprint: nid! });
      toast(isNew ? 'Sprint created' : 'Sprint saved');
    },
    onDelete: isNew ? null : () => {
      mutP(p.id, 'Delete sprint', d => { Object.values(d.tickets).forEach(t => { if (t.sprintId === id) moveToSprint(t, null) }); d.sprints = d.sprints.filter(x => x.id !== id); d.retros = d.retros.filter(r => r.sprintId !== id) });
      undoable('Sprint deleted; its tickets went back to the backlog');
    },
  });
}

/* ---------- sprint lifecycle ---------- */
export function startSprint(pid: string, id: string) {
  const p = useData.getState().ws.projects[pid], s = byId(p.sprints, id)!;
  if (p.sprints.some(x => x.status === 'active')) { toast('Complete the active sprint before starting another.'); return }
  const ts = sprintTickets(p, id);
  if (!ts.length) { toast('Add tickets to this sprint before starting it.'); return }
  mutP(pid, `Start ${s.name}`, d => {
    const x = byId(d.sprints, id)!;
    x.status = 'active';
    x.committed = ts.reduce((a, t) => a + (+t.points || 0), 0);
    if (x.start > TODAY) { const len = Math.round((new Date(x.end).getTime() - new Date(x.start).getTime()) / 864e5); x.start = TODAY; x.end = addDays(TODAY, len) }
  });
  go('board');
  toast(`${s.name} started`);
}
export function completeSprint(pid: string, id: string) {
  const p = useData.getState().ws.projects[pid], s = byId(p.sprints, id)!, ts = sprintTickets(p, id), open = ts.filter(t => !isDone(t));
  const next = sortedSprints(p).find(x => x.status === 'planned' && x.start >= s.start && x.id !== id);
  const donePts = ts.filter(isDone).reduce((a, t) => a + (+t.points || 0), 0), allPts = ts.reduce((a, t) => a + (+t.points || 0), 0);
  confirmBox(`Complete ${s.name}?`, <>{donePts} of {allPts} points are done. {open.length ? `${open.length} unfinished ticket${open.length === 1 ? '' : 's'} will move to ${next ? next.name : 'the backlog'}.` : 'Everything is finished.'}</>, 'Complete sprint', () => {
    mutP(pid, `Complete ${s.name}`, d => {
      const x = byId(d.sprints, id)!;
      x.burn = burn(p, s);
      x.completed = donePts;
      x.committed = +x.committed! || allPts;
      x.status = 'closed';
      open.forEach(t => { const c = d.tickets[t.id]; moveToSprint(c, next ? next.id : null); if (next && c.status === 'backlog') c.status = 'todo' });
    });
    toast(`${s.name} completed: ${donePts} points. Time for a retro.`);
    useUI.getState().setF({ retroSprint: id });
  });
}
export function autofill(pid: string, id: string) {
  {
    const p = useData.getState().ws.projects[pid], s = byId(p.sprints, id)!, cap = sprintCap(p, s), v = velocity(p), target = v ? Math.min(v, cap || v) : cap;
    if (!target) { toast('Add teammates or finish a sprint so there’s a capacity to fill to.'); return }
    let cur = pts(sprintTickets(p, id));
    const add: string[] = [];
    tickets(p).filter(t => !t.sprintId && t.status === 'backlog').sort(byRank).forEach(t => { const x = +t.points || 0; if (cur + x <= target) { add.push(t.id); cur += x } });
    if (!add.length) { toast(`Nothing else fits under the target of ${target} points`); return }
    mutP(pid, 'Fill sprint from backlog', d => add.forEach(tid => moveToSprint(d.tickets[tid], id)));
    undoable(`Added ${add.length} ticket${add.length === 1 ? '' : 's'} up to a target of ${target} points`);
  }
}

/* ---------- projects ---------- */
export function openNewProject() {
  let k = 'PRJ', i = 1;
  while (keyTaken(k)) k = 'PRJ' + (++i);
  openForm({
    title: 'New project', saveLabel: 'Create project', values: { name: '', key: k, desc: '' },
    fields: [{ k: 'name', label: 'Project name' }, { k: 'key', label: 'Ticket key', hint: 'Up to 5 letters or numbers, like WEB' }, { k: 'desc', label: 'Project objective', type: 'textarea', wide: true }],
    onSave(v) {
      const nm = (v.name || '').trim(), key = cleanKey(v.key);
      if (!nm) return 'Add a project name.';
      if (!key) return 'Add a ticket key.';
      if (keyTaken(key)) return `Another project already uses the key ${key}.`;
      const p = blankProject(nm, key, (v.desc || '').trim());
      useData.getState().mutate('Create project', d => { d.projects[p.id] = p });
      go('dashboard', p.id);
      toast(`${nm} created`);
    },
  });
}
export function deleteProject(pid: string) {
  const p = useData.getState().ws.projects[pid];
  confirmBox(`Delete ${p.name}?`, <>This deletes {p.name} and all of its tickets, sprints, epics, milestones, risks, retros, and implementation tasks. You can undo it right afterwards; once you leave the page, it’s gone.</>, 'Delete project', () => {
    useData.getState().mutate('Delete project', d => { delete d.projects[pid] });
    go('portfolio', null);
    undoable(`${p.name} deleted`);
  }, true);
}

/** Create a ticket from just a title (inline quick-add). */
export function quickAdd(pid: string, title: string, at: { sprintId?: string | null; status?: Ticket['status']; type?: TicketType } = {}) {
  title = title.trim();
  if (!title) return;
  let key = '';
  mutP(pid, 'Add ticket', d => {
    key = d.key + '-' + d.nextNum++;
    const id = uid();
    d.tickets[id] = {
      id, key, title, type: at.type || 'story', status: at.status || (at.sprintId ? 'todo' : 'backlog'), priority: 'P2', severity: null, points: cfg(d as Project).defaultPoints,
      assignee: null, sprintId: at.sprintId || null, epicId: null, start: null, due: null, deps: [], votes: 0, reporter: '', labels: '', desc: '',
      createdAt: TODAY, startedAt: null, doneAt: null, rank: maxRank(d as Project) + 1,
    };
    setStatus(d.tickets[id], d.tickets[id].status);
  });
  toast(`Created ${key}`);
}
