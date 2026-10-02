import { useState } from 'react';
import { TODAY, addDays, cx, fmtD, nextMonday, plural, uid } from '../lib/dates';
import { IMPL_STATUS, IMPL_TEMPLATES, cfg } from '../model/constants';
import { byId, byRank, implOverdue, implProgress, maxRank } from '../model/selectors';
import { mutP, useData } from '../model/store';
import type { ImplStatus, ImplTask, Project } from '../model/types';
import { closeModal, openModal, toast, useProject, useUI } from '../model/ui';
import { AvatarId, Brief, Btn, Chip, Head, InlineEdit, Meter, Modal, Tile, confirmBox, undoable } from '../components/ui';
import { DnD, rankBefore, useItem, useZone } from '../components/dnd';
import { implStatusText } from '../model/coaches';
import { openTicket } from '../components/forms';

const ST_CLS: Record<ImplStatus, string> = { todo: '', doing: 'acc', blocked: 'bad', done: 'ok' };

function addTask(pid: string, phaseId: string, title: string) {
  title = title.trim();
  if (!title) return;
  mutP(pid, 'Add implementation task', d => {
    const rank = d.impl.tasks.filter(t => t.phaseId === phaseId).reduce((m, t) => Math.max(m, t.rank), 0) + 1;
    d.impl.tasks.push({ id: uid(), phaseId, title, owner: null, due: null, status: 'todo', notes: '', checklist: [], rank });
  });
}
const upd = (pid: string, id: string, label: string, fn: (t: ImplTask) => void, coalesce?: string) =>
  mutP(pid, label, d => { const t = d.impl.tasks.find(x => x.id === id); if (t) fn(t) }, coalesce ? { coalesce } : undefined);

export function applyTemplate(pid: string, tplId: string, start: string, weeks: number) {
  const tpl = IMPL_TEMPLATES.find(t => t.id === tplId)!;
  mutP(pid, `Add ${tpl.name} plan`, d => {
    tpl.phases.forEach((ph, i) => {
      const id = uid(), due = weeks > 0 ? addDays(start, (i + 1) * weeks * 7 - 1) : null;
      d.impl.phases.push({ id, name: ph.name });
      ph.tasks.forEach((title, j) => d.impl.tasks.push({ id: uid(), phaseId: id, title, owner: null, due, status: 'todo', notes: '', checklist: [], rank: j + 1 }));
    });
  });
  toast(`${tpl.name} plan added. Rename, reorder, or delete anything.`, { undo: true });
}
function openTemplate(pid: string) {
  openModal(<TemplateDialog pid={pid} />);
}
function TemplateDialog({ pid }: { pid: string }) {
  const [tpl, setTpl] = useState(IMPL_TEMPLATES[0].id), [start, setStart] = useState(nextMonday()), [weeks, setWeeks] = useState(2);
  return <Modal title="Start from a template" onSubmit={() => { applyTemplate(pid, tpl, start, weeks); closeModal() }} footer={<><span className="sp" /><Btn variant="ghost" onClick={closeModal}>Cancel</Btn><Btn variant="pri" type="submit">Add plan</Btn></>}>
    <div className="fgrid">
      <div className="fld wide"><span>Template</span><div className="tplpick">{IMPL_TEMPLATES.map(t => <label key={t.id} className={cx('tplopt', tpl === t.id && 'on')}><input type="radio" name="tpl" checked={tpl === t.id} onChange={() => setTpl(t.id)} /><b>{t.name}</b><span>{t.desc}</span><small>{t.phases.length} phases, {t.phases.reduce((a, p) => a + p.tasks.length, 0)} tasks</small></label>)}</div></div>
      <label className="fld"><span>Start date</span><input type="date" value={start} onChange={e => setStart(e.target.value)} /></label>
      <label className="fld"><span>Weeks per phase</span><input type="number" min={0} value={weeks} onChange={e => setWeeks(Math.max(0, +e.target.value || 0))} /><small>Sets each phase’s due dates. Use 0 to leave dates blank.</small></label>
    </div>
  </Modal>;
}

/** Live task editor: changes apply immediately and can be undone. */
function TaskDialog({ id }: { id: string }) {
  const p = useProject(), [item, setItem] = useState('');
  const t = p?.impl.tasks.find(x => x.id === id);
  if (!p || !t) return <Modal title="Task not found" footer={<Btn onClick={closeModal}>Close</Btn>}><p className="dnote" style={{ paddingTop: 16 }}>This task was deleted.</p></Modal>;
  const u = (label: string, fn: (x: ImplTask) => void, co?: string) => upd(p.id, id, label, fn, co);
  const ticket = t.ticketId ? p.tickets[t.ticketId] : undefined;
  const done = t.checklist.filter(c => c.done).length;
  return <Modal wide title="Implementation task" footer={<>
    <Btn variant="danger" onClick={() => { closeModal(); deleteTask(p.id, id) }}>Delete task</Btn>
    <span className="sp" />
    {!ticket && <Btn onClick={() => taskToTicket(p, t)}>Create a ticket from this</Btn>}
    <Btn variant="pri" onClick={closeModal} data-autofocus>Done</Btn>
  </>}>
    <div className="fgrid">
      <label className="fld wide"><span>Title</span><input value={t.title} onChange={e => u('Rename task', x => { x.title = e.target.value }, 'title' + id)} /></label>
      <label className="fld"><span>Phase</span><select value={t.phaseId} onChange={e => u('Move task', x => { x.phaseId = e.target.value })}>{p.impl.phases.map(ph => <option key={ph.id} value={ph.id}>{ph.name}</option>)}</select></label>
      <label className="fld"><span>Status</span><select value={t.status} onChange={e => u('Change task status', x => { x.status = e.target.value as ImplStatus })}>{IMPL_STATUS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
      <label className="fld"><span>Owner</span><select value={t.owner || ''} onChange={e => u('Assign task', x => { x.owner = e.target.value || null })}><option value="">Unassigned</option>{p.members.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}</select></label>
      <label className="fld"><span>Due date</span><input type="date" value={t.due || ''} onChange={e => u('Change due date', x => { x.due = e.target.value || null })} /></label>
      <label className="fld wide"><span>Notes, decisions, or blockers</span><textarea rows={3} value={t.notes} onChange={e => u('Edit notes', x => { x.notes = e.target.value }, 'notes' + id)} /></label>
      <div className="fld wide"><span>Checklist {t.checklist.length > 0 && `(${done} of ${t.checklist.length})`}</span>
        <ul className="checklist">{t.checklist.map(c => <li key={c.id}>
          <input type="checkbox" checked={c.done} aria-label={c.text} onChange={e => u('Tick checklist item', x => { const y = x.checklist.find(k => k.id === c.id); if (y) y.done = e.target.checked })} />
          <InlineEdit value={c.text} className={c.done ? 'struck' : ''} label="checklist item" onSave={v => u('Edit checklist item', x => { const y = x.checklist.find(k => k.id === c.id); if (y) y.text = v })} />
          <button type="button" className="rx" aria-label="Remove item" onClick={() => u('Remove checklist item', x => { x.checklist = x.checklist.filter(k => k.id !== c.id) })}>×</button>
        </li>)}</ul>
        <div className="radd"><input value={item} placeholder="Add a checklist item, then press Enter" aria-label="New checklist item" onChange={e => setItem(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && item.trim()) { e.preventDefault(); u('Add checklist item', x => { x.checklist.push({ id: uid(), text: item.trim(), done: false }) }); setItem('') } }} /><Btn sm disabled={!item.trim()} onClick={() => { u('Add checklist item', x => { x.checklist.push({ id: uid(), text: item.trim(), done: false }) }); setItem('') }}>Add</Btn></div>
      </div>
      {ticket && <p className="fld wide">Linked ticket: <button type="button" className="link acc" onClick={() => openTicket(ticket.id)}>{ticket.key} {ticket.title}</button> <Chip cls={ticket.status === 'done' ? 'ok' : ''}>{cfg(p).statusLabels[ticket.status]}</Chip></p>}
    </div>
  </Modal>;
}
export function openImplTask(id: string) { openModal(<TaskDialog id={id} />) }
function deleteTask(pid: string, id: string) { mutP(pid, 'Delete implementation task', d => { d.impl.tasks = d.impl.tasks.filter(t => t.id !== id) }); undoable('Task deleted') }
function taskToTicket(p: Project, t: ImplTask) {
  let key = '';
  mutP(p.id, 'Create ticket from task', d => {
    key = d.key + '-' + d.nextNum++;
    const id = uid();
    d.tickets[id] = { id, key, title: t.title, type: 'task', status: 'backlog', priority: 'P2', severity: null, points: cfg(p).defaultPoints, assignee: t.owner, sprintId: null, epicId: null, start: null, due: t.due, deps: [], votes: 0, reporter: 'Implementation plan', labels: 'implementation', desc: t.notes, createdAt: TODAY, startedAt: null, doneAt: null, rank: maxRank(d as Project) + 1 };
    const x = d.impl.tasks.find(k => k.id === t.id); if (x) x.ticketId = id;
  });
  toast(`Created ${key} in the backlog`, { undo: true });
}

function TaskRow({ p, t }: { p: Project; t: ImplTask }) {
  const it = useItem(t.id, 'phase:' + t.phaseId), late = implOverdue(t), cl = t.checklist, ticket = t.ticketId ? p.tickets[t.ticketId] : undefined;
  const stop = { onPointerDown: (e: React.PointerEvent) => e.stopPropagation() };
  return (
    <div ref={it.ref} {...it.handle} className={cx('irow', it.dragging && 'dragging', it.over && 'drop-before', t.status === 'done' && 'isdone')}>
      <span className="handle" aria-hidden="true">⋮⋮</span>
      <input type="checkbox" {...stop} checked={t.status === 'done'} aria-label={`Mark “${t.title}” done`} onChange={e => upd(p.id, t.id, e.target.checked ? 'Complete task' : 'Reopen task', x => { x.status = e.target.checked ? 'done' : 'todo' })} />
      <span className="ititle" {...stop}><InlineEdit value={t.title} label="task title" onSave={v => upd(p.id, t.id, 'Rename task', x => { x.title = v })} />
        {cl.length > 0 && <span className="small muted" title="Checklist"> ☑ {cl.filter(c => c.done).length}/{cl.length}</span>}
        {t.notes && <span className="small muted" title={t.notes}> ✎</span>}
        {ticket && <button type="button" className="link key" style={{ marginLeft: 6 }} onClick={() => openTicket(ticket.id)}>{ticket.key}</button>}
      </span>
      <select {...stop} className={cx('istatus', ST_CLS[t.status])} value={t.status} aria-label="Status" onChange={e => upd(p.id, t.id, 'Change task status', x => { x.status = e.target.value as ImplStatus })}>{IMPL_STATUS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
      <select {...stop} value={t.owner || ''} aria-label="Owner" onChange={e => upd(p.id, t.id, 'Assign task', x => { x.owner = e.target.value || null })}><option value="">No owner</option>{p.members.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}</select>
      <span className="idue" {...stop}><input type="date" className={cx(late && 'late')} value={t.due || ''} aria-label="Due date" onChange={e => upd(p.id, t.id, 'Change due date', x => { x.due = e.target.value || null })} /></span>
      <span className="iacts" {...stop}><AvatarId p={p} id={t.owner} /><Btn sm variant="ghost" onClick={() => openImplTask(t.id)}>Details</Btn><button type="button" className="rx" aria-label={`Delete “${t.title}”`} onClick={() => deleteTask(p.id, t.id)}>×</button></span>
    </div>
  );
}

function Phase({ p, ph, i, tasks }: { p: Project; ph: { id: string; name: string }; i: number; tasks: ImplTask[] }) {
  const z = useZone('phase:' + ph.id), [open, setOpen] = useState(true), [v, setV] = useState('');
  const pr = implProgress(p, ph.id), n = p.impl.phases.length, late = tasks.filter(implOverdue).length;
  const move = (dir: number) => mutP(p.id, 'Reorder phases', d => { const a = d.impl.phases, j = i + dir; [a[i], a[j]] = [a[j], a[i]] });
  return (
    <section ref={z.ref} className={cx('panel bsec', z.over && 'over-drop')}>
      <div className="bhead">
        <button type="button" className="chev" aria-expanded={open} aria-label={open ? 'Collapse phase' : 'Expand phase'} onClick={() => setOpen(!open)}>{open ? '▾' : '▸'}</button>
        <h2><InlineEdit value={ph.name} label="phase name" onSave={nv => mutP(p.id, 'Rename phase', d => { const x = d.impl.phases.find(y => y.id === ph.id); if (x) x.name = nv })} /></h2>
        <span className="small muted">{pr.done} of {plural(pr.total, 'task')} done</span>{late > 0 && <Chip cls="bad">{late} overdue</Chip>}
        <span className="sp" /><Meter val={pr.done} max={pr.total || 1} />
        <Btn sm variant="ghost" disabled={i === 0} onClick={() => move(-1)} aria-label="Move phase up">↑</Btn>
        <Btn sm variant="ghost" disabled={i === n - 1} onClick={() => move(1)} aria-label="Move phase down">↓</Btn>
        <Btn sm variant="ghost" onClick={() => { mutP(p.id, 'Delete phase', d => { d.impl.phases = d.impl.phases.filter(x => x.id !== ph.id); d.impl.tasks = d.impl.tasks.filter(t => t.phaseId !== ph.id) }); undoable(`Deleted phase “${ph.name}”`) }}>Delete</Btn>
      </div>
      {open && <>
        {tasks.length ? tasks.map(t => <TaskRow key={t.id} p={p} t={t} />) : <div className="empty">No tasks{p.impl.tasks.some(t => t.phaseId === ph.id) ? ' match the filters' : ' yet. Add one below, or drag one here'}.</div>}
        <form className="quickadd" onSubmit={e => { e.preventDefault(); addTask(p.id, ph.id, v); setV('') }}><input value={v} onChange={e => setV(e.target.value)} placeholder={`Add a task to ${ph.name}`} aria-label={`New task in ${ph.name}`} /><Btn sm type="submit" disabled={!v.trim()}>Add</Btn></form>
      </>}
    </section>
  );
}

export function Implementation({ p }: { p: Project }) {
  const f = useUI(s => s.f), setF = useUI(s => s.setF);
  const all = p.impl.tasks, pr = implProgress(p);
  const week = addDays(TODAY, 7);
  const filt = (t: ImplTask) => (!f.implOwner || (f.implOwner === 'none' ? !t.owner : t.owner === f.implOwner)) && (!f.implStatus || (f.implStatus === 'overdue' ? implOverdue(t) : t.status === f.implStatus)) && !(f.implHideDone && t.status === 'done');
  const addPhase = () => mutP(p.id, 'Add phase', d => { d.impl.phases.push({ id: uid(), name: `Phase ${d.impl.phases.length + 1}` }) });
  const head = <Head title="Implementation plan" desc="The project manager’s task list, grouped by phase: owners, due dates, status, and checklists. Drag tasks between phases; click any name to rename it.">
    {all.length > 0 && <>
      <select className="selectlike" value={f.implOwner} onChange={e => setF({ implOwner: e.target.value })} aria-label="Filter by owner"><option value="">All owners</option>{p.members.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}<option value="none">No owner</option></select>
      <select className="selectlike" value={f.implStatus} onChange={e => setF({ implStatus: e.target.value })} aria-label="Filter by status"><option value="">All statuses</option>{IMPL_STATUS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}<option value="overdue">Overdue</option></select>
      <label className="small checklabel"><input type="checkbox" checked={f.implHideDone} onChange={e => setF({ implHideDone: e.target.checked })} /> Hide done</label>
    </>}
    <Btn onClick={() => openTemplate(p.id)}>Add from template</Btn>
    <Btn variant="pri" onClick={addPhase}>Add phase</Btn>
  </Head>;

  if (!p.impl.phases.length) return <>{head}
    <section className="panel welcome-inline">
      <h2>Plan the rollout, not just the build</h2>
      <p className="muted" style={{ maxWidth: '62ch', margin: '6px 0 16px' }}>An implementation plan tracks the project-management work around delivery: kickoff, sign-offs, environments, training, cutover, go-live, and hypercare. Start from a template and adjust it, or build your own phases.</p>
      <div className="tplgrid">{IMPL_TEMPLATES.map(t => <button key={t.id} type="button" className="tplcard" onClick={() => openTemplate(p.id)}><b>{t.name}</b><span>{t.desc}</span><small>{t.phases.map(x => x.name).join(' → ')}</small></button>)}
        <button type="button" className="tplcard" onClick={addPhase}><b>Start blank</b><span>Create your own phases and tasks.</span></button></div>
    </section></>;

  return <>
    {head}
    <div className="tiles">
      <Tile v={pr.pct + '%'} label={`complete (${pr.done} of ${plural(pr.total, 'task')})`} />
      <Tile v={all.filter(t => t.status === 'doing').length} label="in progress" />
      <Tile v={all.filter(t => t.status === 'blocked').length} label="blocked" color={all.some(t => t.status === 'blocked') ? 'var(--bad)' : undefined} />
      <Tile v={all.filter(implOverdue).length} label="overdue" color={all.some(implOverdue) ? 'var(--bad)' : undefined} />
      <Tile v={all.filter(t => t.status !== 'done' && t.due && t.due >= TODAY && t.due <= week).length} label="due in the next 7 days" />
      <Tile v={all.filter(t => t.status !== 'done' && !t.owner).length} label="open tasks with no owner" />
    </div>
    <DnD onDrop={(id, to) => {
      const phaseId = to.container.slice(6), list = all.filter(t => t.phaseId === phaseId).sort(byRank), rank = rankBefore(list, id, to.beforeId);
      upd(p.id, id, 'Move task', x => { x.phaseId = phaseId; x.rank = rank });
    }} overlay={id => { const t = all.find(x => x.id === id); return t ? <div className="irow ghostrow"><span className="ititle">{t.title}</span></div> : null }}>
      <div className="stack">{p.impl.phases.map((ph, i) => <Phase key={ph.id} p={p} ph={ph} i={i} tasks={all.filter(t => t.phaseId === ph.id && filt(t)).sort(byRank)} />)}</div>
    </DnD>
    <div style={{ marginTop: 16 }}><Brief title="Status report" sub="A plain-text summary of open work by phase, ready to paste into an update." text={implStatusText(p)} /></div>
  </>;
}
