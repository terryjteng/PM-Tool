import { useState } from 'react';
import { TODAY, cx, diff, fmtD, plural, workdays } from '../lib/dates';
import { activeSprint, blockers, byId, byRank, isDone, memberAvail, moveToSprint, pts, setStatus, sortedSprints, sprintCap, sprintTickets, tickets, velocity } from '../model/selectors';
import { PRIORITIES, cfg } from '../model/constants';
import { mutP } from '../model/store';
import type { Project, Status, Ticket } from '../model/types';
import { go, toast, useUI } from '../model/ui';
import { Avatar, AvatarId, Btn, Chip, Empty, EpicChip, Head, InlineEdit, Meter, PriBadge, Pts, TypeTag, undoable } from '../components/ui';
import { DnD, rankBefore, useItem, useZone, type DropTarget } from '../components/dnd';
import { autofill, completeSprint, deleteTickets, newTicket, openSprint, openTicket, quickAdd, startSprint } from '../components/forms';

const matchQ = (t: Ticket, q: string) => !q || (t.title + ' ' + t.key + ' ' + (t.labels || '')).toLowerCase().includes(q.toLowerCase());

/** Move a ticket into a sprint (or the backlog) and in front of another ticket. */
function dropInSprint(p: Project, id: string, to: DropTarget) {
  const sid = to.container === 'backlog' ? null : to.container.slice(7);
  const t = p.tickets[id];
  const list = tickets(p).filter(x => x.id !== id && (sid ? x.sprintId === sid : !x.sprintId && x.status !== 'triage' && !isDone(x))).sort(byRank);
  const rank = rankBefore(list, id, to.beforeId);
  mutP(p.id, (t.sprintId || null) === sid ? `Rerank ${t.key}` : `Move ${t.key}`, d => { const x = d.tickets[id]; moveToSprint(x, sid); x.rank = rank });
}

function QuickAdd({ onAdd, placeholder = 'Add a ticket: type a title, press Enter' }: { onAdd: (title: string) => void; placeholder?: string }) {
  const [v, setV] = useState('');
  return <form className="quickadd" onSubmit={e => { e.preventDefault(); if (v.trim()) { onAdd(v); setV('') } }}><input value={v} onChange={e => setV(e.target.value)} placeholder={placeholder} aria-label="New ticket title" /><Btn sm type="submit" disabled={!v.trim()}>Add</Btn></form>;
}

function TicketRow({ p, t, container, sel, onSel }: { p: Project; t: Ticket; container: string; sel: boolean; onSel: (on: boolean, shift: boolean) => void }) {
  const it = useItem(t.id, container), bl = blockers(p, t).length;
  const opts = sortedSprints(p).filter(s => s.status !== 'closed' || s.id === t.sprintId);
  return (
    <div ref={it.ref} {...it.handle} className={cx('trow', it.dragging && 'dragging', it.over && 'drop-before', sel && 'selected')}>
      <input type="checkbox" checked={sel} onChange={e => onSel(e.target.checked, (e.nativeEvent as MouseEvent).shiftKey)} aria-label={`Select ${t.key}`} onPointerDown={e => e.stopPropagation()} />
      <span className="handle" aria-hidden="true">⋮⋮</span>
      <span className="key">{t.key}</span>
      <span className="ttl"><TypeTag p={p} t={t} /> <button className="link" onClick={() => openTicket(t.id)}>{t.title}</button>{bl > 0 && <span className="blocked"> Blocked</span>}{isDone(t) && <> <Chip cls="ok">Done</Chip></>}</span>
      {byId(p.epics, t.epicId) ? <EpicChip e={byId(p.epics, t.epicId)} /> : <span />}
      <PriBadge v={t.priority} />
      <span onPointerDown={e => e.stopPropagation()}><InlineEdit className="pts" value={String(+t.points || 0)} label={`points for ${t.key}`} onSave={v => { const n = Math.max(0, Math.round(+v || 0)); mutP(p.id, `Estimate ${t.key}`, d => { d.tickets[t.id].points = n }) }} /></span>
      <AvatarId p={p} id={t.assignee} />
      <select value={t.sprintId || ''} aria-label={`Sprint for ${t.key}`} onPointerDown={e => e.stopPropagation()} onChange={e => { const v = e.target.value; mutP(p.id, `Move ${t.key}`, d => { moveToSprint(d.tickets[t.id], v || null); d.tickets[t.id].rank = Math.max(0, ...Object.values(d.tickets).map(x => x.rank)) + 1 }); toast(`${t.key} moved to ${v ? byId(p.sprints, v)!.name : 'the backlog'}`) }}>
        <option value="">Backlog</option>{opts.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
      </select>
    </div>
  );
}

function Section({ p, id, children, className }: { p: Project; id: string; children: React.ReactNode; className?: string }) {
  const z = useZone(id);
  return <section ref={z.ref} className={cx('panel bsec', z.over && 'over-drop', className)} data-zone={id}>{children}</section>;
}

function BulkBar({ p, ids, clear }: { p: Project; ids: string[]; clear: () => void }) {
  const sprints = sortedSprints(p).filter(s => s.status !== 'closed');
  const apply = (label: string, fn: (t: Ticket) => void) => { mutP(p.id, `${label} (${ids.length} tickets)`, d => ids.forEach(id => d.tickets[id] && fn(d.tickets[id]))); undoable(`${label}: ${plural(ids.length, 'ticket')}`) };
  const sel = (label: string, opts: [string, string][], fn: (v: string) => (t: Ticket) => void) => <select value="" aria-label={label} onChange={e => { if (e.target.value !== '') apply(label, fn(e.target.value === '_' ? '' : e.target.value)) }}><option value="">{label}…</option>{opts.map(([v, l]) => <option key={v} value={v || '_'}>{l}</option>)}</select>;
  return (
    <div className="bulkbar" role="toolbar" aria-label="Bulk actions">
      <b>{plural(ids.length, 'ticket')} selected</b>
      {sel('Move to', [['', 'Backlog'], ...sprints.map(s => [s.id, s.name] as [string, string])], v => t => moveToSprint(t, v || null))}
      {sel('Assign', [['', 'Unassigned'], ...p.members.map(m => [m.id, m.name] as [string, string])], v => t => { t.assignee = v || null })}
      {sel('Priority', PRIORITIES.map(([k, l]) => [k, l] as [string, string]), v => t => { t.priority = v as Ticket['priority'] })}
      {sel('Epic', [['', 'No epic'], ...p.epics.map(e => [e.id, e.title] as [string, string])], v => t => { t.epicId = v || null })}
      {sel('Status', (['backlog', 'todo', 'inprogress', 'review', 'done'] as Status[]).map(s => [s, cfg(p).statusLabels[s]] as [string, string]), v => t => setStatus(t, v as Status))}
      <span className="sp" />
      <Btn sm variant="danger" onClick={() => { deleteTickets(p.id, ids); clear() }}>Delete</Btn>
      <Btn sm variant="ghost" onClick={clear}>Clear</Btn>
    </div>
  );
}

export function Backlog({ p }: { p: Project }) {
  const q = useUI(s => s.f.bq), setF = useUI(s => s.setF), selected = useUI(s => s.selected), setSelected = useUI(s => s.setSelected);
  const [anchor, setAnchor] = useState<string | null>(null);
  const act = activeSprint(p), secs = sortedSprints(p).filter(s => s.status !== 'closed'), tri = tickets(p).filter(t => t.status === 'triage').length;
  const bl = tickets(p).filter(t => !t.sprintId && t.status !== 'triage' && !isDone(t)).sort(byRank);
  const visible: Ticket[] = [...secs.flatMap(s => sprintTickets(p, s.id).sort(byRank)), ...bl].filter(t => matchQ(t, q));
  const sel = selected.filter(id => p.tickets[id]);
  const onSel = (id: string) => (on: boolean, shift: boolean) => {
    if (shift && anchor) {
      const a = visible.findIndex(t => t.id === anchor), b = visible.findIndex(t => t.id === id);
      if (a >= 0 && b >= 0) { const range = visible.slice(Math.min(a, b), Math.max(a, b) + 1).map(t => t.id); setSelected([...new Set([...sel, ...range])]); return }
    }
    setAnchor(id);
    setSelected(on ? [...sel, id] : sel.filter(x => x !== id));
  };
  const rows = (ts: Ticket[], container: string) => ts.filter(t => matchQ(t, q)).map(t => <TicketRow key={t.id} p={p} t={t} container={container} sel={sel.includes(t.id)} onSel={onSel(t.id)} />);
  const blRows = rows(bl, 'backlog');
  return <>
    <Head title="Backlog" desc="Rank work by dragging rows. Drop a ticket on a sprint to plan it. Tick rows (Shift-click for a range) to edit many at once; click points to re-estimate."><Btn onClick={() => openSprint()}>New sprint</Btn><Btn variant="pri" onClick={() => newTicket()}>New ticket</Btn></Head>
    <div className="filters"><input type="search" placeholder="Filter by title, key, or label" value={q} onChange={e => setF({ bq: e.target.value })} aria-label="Filter backlog" />{tri > 0 && <Btn sm variant="ghost" onClick={() => go('tickets')}>{plural(tri, 'item')} waiting in triage</Btn>}</div>
    {sel.length > 0 && <BulkBar p={p} ids={sel} clear={() => setSelected([])} />}
    <DnD onDrop={(id, to) => dropInSprint(p, id, to)} overlay={id => { const t = p.tickets[id]; return t ? <div className="trow ghostrow"><span className="key">{t.key}</span><span className="ttl">{t.title}</span><Pts v={t.points} /></div> : null }}>
      <div className="stack">
        {secs.map(s => {
          const ts = sprintTickets(p, s.id).sort(byRank), c = sprintCap(p, s), pp = pts(ts);
          const btn = s.status === 'active' ? <Btn sm onClick={() => completeSprint(p.id, s.id)}>Complete sprint</Btn> : !act && s === secs.find(x => x.status === 'planned') ? <Btn sm variant="pri" onClick={() => startSprint(p.id, s.id)}>Start sprint</Btn> : null;
          const shown = rows(ts, 'sprint:' + s.id);
          return <Section key={s.id} p={p} id={'sprint:' + s.id}>
            <div className="bhead"><h2>{s.name}</h2>{s.status === 'active' && <Chip cls="acc">Active</Chip>}<span className="small muted">{fmtD(s.start)} to {fmtD(s.end)}</span><span className="sp" /><span className={cx('small', pp <= c && 'muted')} style={pp > c ? { color: 'var(--bad)', fontWeight: 600 } : undefined}>{pp} / {c} pts</span><Meter val={pp} max={c} /><Btn sm variant="ghost" onClick={() => openSprint(s.id)}>Edit</Btn>{btn}</div>
            {shown.length ? shown : <div className="empty">{ts.length ? 'No matches in this sprint.' : 'Drag tickets here to plan this sprint.'}</div>}
            <QuickAdd onAdd={title => quickAdd(p.id, title, { sprintId: s.id })} placeholder={`Add to ${s.name}: type a title, press Enter`} />
          </Section>;
        })}
        <Section p={p} id="backlog">
          <div className="bhead"><h2>Backlog</h2><span className="small muted">{plural(bl.length, 'ticket')}, {pts(bl)} pts</span><span className="sp" />{bl.length > 0 && <Btn sm variant="ghost" onClick={() => setSelected(bl.filter(t => matchQ(t, q)).map(t => t.id))}>Select all</Btn>}</div>
          {blRows.length ? blRows : <div className="empty">{bl.length ? 'No matches.' : 'The backlog is empty. Add a ticket below or accept items from triage.'}</div>}
          <QuickAdd onAdd={title => quickAdd(p.id, title)} />
        </Section>
      </div>
    </DnD>
  </>;
}

export function Planning({ p }: { p: Project }) {
  const planSprint = useUI(s => s.f.planSprint), setF = useUI(s => s.setF);
  const opts = sortedSprints(p).filter(s => s.status !== 'closed');
  if (!opts.length) return <><Head title="Sprint planning" desc="Size the next sprint against team capacity and recent velocity."><Btn variant="pri" onClick={() => openSprint()}>Create a sprint</Btn></Head><Empty>There are no open sprints. Create one to start planning.</Empty></>;
  const s = byId(opts, planSprint) || opts.find(x => x.status === 'planned') || opts[0];
  const cap = sprintCap(p, s), v = velocity(p), ts = sprintTickets(p, s.id).sort(byRank), pp = pts(ts), scale = Math.max(cap, v, pp, 1) * 1.15, wd = workdays(s.start, s.end), act = activeSprint(p);
  let rec: string, cls: string;
  if (pp > cap) { rec = `Over capacity by ${plural(pp - cap, 'point')}. Move lower-ranked tickets back to the backlog.`; cls = 'bad' }
  else if (v && pp > v * 1.1) { rec = `Above recent velocity (${v}). The team has capacity on paper, but history says this is a stretch.`; cls = 'warn' }
  else if (v && pp < v * .8) { rec = `Room for about ${plural(Math.min(v, cap) - pp, 'more point')} based on recent velocity.`; cls = 'warn' }
  else if (!v && !pp) { rec = 'Add tickets from the backlog, or fill to capacity automatically.'; cls = 'warn' }
  else { rec = 'This commitment looks realistic against capacity and velocity.'; cls = 'ok' }
  const un = pts(ts.filter(t => !t.assignee));
  return <>
    <Head title="Sprint planning" desc="Size the sprint against what the team can actually take on. Capacity accounts for time off; edit points per sprint and days off right in the table.">
      <select className="selectlike" value={s.id} onChange={e => setF({ planSprint: e.target.value })} aria-label="Sprint">{opts.map(o => <option key={o.id} value={o.id}>{o.name}{o.status === 'active' ? ' (active)' : ''}</option>)}</select>
      <Btn onClick={() => openSprint()}>New sprint</Btn>
    </Head>
    <div className="stack">
      <section className="panel">
        <div className="phead"><div><h2>{s.name}</h2><p className="small muted">{fmtD(s.start)} to {fmtD(s.end)}, {plural(wd, 'working day')}. {s.goal || 'No sprint goal yet.'}</p></div>
          <div className="rowflex"><Btn sm onClick={() => openSprint(s.id)}>Edit goal and dates</Btn><Btn sm onClick={() => autofill(p.id, s.id)}>Fill from backlog</Btn>{s.status === 'planned' && !act && <Btn sm variant="pri" onClick={() => startSprint(p.id, s.id)}>Start sprint</Btn>}</div></div>
        <div className="gauge"><i className={pp > cap ? 'over' : ''} style={{ width: pp / scale * 100 + '%' }} />{v > 0 && <div className="gmark top" style={{ left: v / scale * 100 + '%' }}><span>Velocity {v}</span></div>}<div className="gmark bot" style={{ left: cap / scale * 100 + '%' }}><span>Capacity {cap}</span></div></div>
        <p><b style={{ fontSize: '1.3rem' }}>{pp}</b> <span className="muted">points committed across {plural(ts.length, 'ticket')}</span></p><p className={`signal ${cls}`}>{rec}</p>
      </section>
      <div className="grid2">
        <section className="panel"><h2>Capacity by teammate</h2><div className="tblwrap"><table><thead><tr><th>Teammate</th><th className="num">Pts/sprint</th><th className="num">Days off</th><th className="num">Available</th><th className="num">Assigned</th><th>Load</th></tr></thead><tbody>
          {p.members.map(m => { const a = pts(ts.filter(t => t.assignee === m.id)), c = memberAvail(m, s), off = (m.timeOff || {})[s.id] || 0;
            return <tr key={m.id}><td><Avatar m={m} /> {m.name}<div className="small muted">{m.role}</div></td>
              <td className="num"><input className="numin" type="number" min={0} value={m.capacity} aria-label={`Points per sprint for ${m.name}`} onChange={e => mutP(p.id, `Capacity for ${m.name}`, d => { byId(d.members, m.id)!.capacity = Math.max(0, +e.target.value || 0) }, { coalesce: 'cap' + m.id })} /></td>
              <td className="num"><input className="numin" type="number" min={0} max={wd} value={off} aria-label={`Days off for ${m.name}`} onChange={e => mutP(p.id, `Time off for ${m.name}`, d => { const x = byId(d.members, m.id)!; x.timeOff = x.timeOff || {}; x.timeOff[s.id] = Math.max(0, Math.min(wd, +e.target.value || 0)) }, { coalesce: 'off' + m.id + s.id })} /></td>
              <td className="num">{c}</td><td className="num">{a}</td><td style={{ minWidth: 120 }}><Meter val={a} max={c} /></td></tr> })}
          {!p.members.length && <tr><td colSpan={6} className="muted">Add teammates on the Team capacity page.</td></tr>}
          {un > 0 && <tr><td className="muted">Unassigned</td><td /><td /><td /><td className="num">{un}</td><td /></tr>}
        </tbody></table></div></section>
        <DnD onDrop={(id, to) => dropInSprint(p, id, to)} overlay={id => <div className="trow ghostrow"><span className="key">{p.tickets[id]?.key}</span><span className="ttl">{p.tickets[id]?.title}</span></div>}>
          <Section p={p} id={'sprint:' + s.id} className="alignstart">
            <div className="bhead"><h2>In this sprint</h2><span className="sp" /><Btn sm variant="ghost" onClick={() => go('backlog')}>Open backlog</Btn></div>
            {ts.length ? ts.map(t => <TicketRow key={t.id} p={p} t={t} container={'sprint:' + s.id} sel={false} onSel={() => {}} />) : <div className="empty">No tickets yet.</div>}
            <QuickAdd onAdd={title => quickAdd(p.id, title, { sprintId: s.id })} />
          </Section>
        </DnD>
      </div>
    </div>
  </>;
}

function Card({ p, t, col }: { p: Project; t: Ticket; col: string }) {
  const it = useItem(t.id, col), bl = blockers(p, t).length;
  const c = t.type === 'bug' ? 'var(--bad)' : t.type === 'feature' ? 'var(--feat)' : t.type === 'task' ? 'var(--muted)' : 'var(--accent)';
  return (
    <div ref={it.ref} {...it.handle} className={cx('card', it.dragging && 'dragging', it.over && 'drop-before')} style={{ ['--c' as string]: c }}>
      <div className="ctop"><span className="key">{t.key}</span><PriBadge v={t.priority} /></div>
      <div className="ctitle"><button className="link" onClick={() => openTicket(t.id)}>{t.title}</button></div>
      <div className="cfoot"><EpicChip e={byId(p.epics, t.epicId)} />{bl > 0 && <span className="blocked">Blocked</span>}<span className="sp" /><Pts v={t.points} /><AvatarId p={p} id={t.assignee} /></div>
    </div>
  );
}
function Column({ p, k, label, cards, all, limit }: { p: Project; k: Status; label: string; cards: Ticket[]; all: Ticket[]; limit: number }) {
  const z = useZone('status:' + k), n = all.length, a = activeSprint(p)!;
  return (
    <div ref={z.ref} className={cx('col', z.over && 'over-drop')}>
      <div className="colhead"><span>{label}</span><span className={cx('wip', limit > 0 && n > limit && 'bad')}>{limit > 0 ? `${n} / ${limit} WIP` : `${plural(n, 'card')}, ${pts(all)} pts`}</span></div>
      {cards.map(t => <Card key={t.id} p={p} t={t} col={'status:' + k} />)}
      {!cards.length && <p className="muted small" style={{ padding: 4 }}>Nothing here.</p>}
      {k === 'todo' && <QuickAdd onAdd={title => quickAdd(p.id, title, { sprintId: a.id })} placeholder="Add a card" />}
    </div>
  );
}
export function Board({ p }: { p: Project }) {
  const who = useUI(s => s.f.boardWho), setF = useUI(s => s.setF), s = activeSprint(p);
  if (!s) return <><Head title="Sprint board" desc="Cards for the running sprint, by status." /><Empty>No sprint is running. <Btn variant="pri" onClick={() => go('planning')}>Plan a sprint</Btn></Empty></>;
  const st = cfg(p), all = sprintTickets(p, s.id), ts = all.filter(t => !who || (who === 'none' ? !t.assignee : t.assignee === who)).sort(byRank);
  const cols: Status[] = ['todo', 'inprogress', 'review', 'done'];
  const colOf = (t: Ticket): Status => (t.status === 'backlog' || t.status === 'triage' ? 'todo' : t.status);
  const limit = (k: Status) => k === 'inprogress' ? st.wipLimits.inprogress || p.members.length : k === 'review' ? st.wipLimits.review : 0;
  const len = diff(s.start, s.end) + 1, day = Math.min(len, Math.max(0, diff(s.start, TODAY) + 1));
  const drop = (id: string, to: DropTarget) => {
    const k = to.container.slice(7) as Status, t = p.tickets[id];
    const list = all.filter(x => colOf(x) === k).sort(byRank), rank = rankBefore(list, id, to.beforeId);
    mutP(p.id, colOf(t) === k ? `Rerank ${t.key}` : `${t.key} → ${st.statusLabels[k]}`, d => { const x = d.tickets[id]; if (colOf(x) !== k) setStatus(x, k); x.rank = rank });
  };
  return <>
    <Head title={s.name} desc={<>{s.goal || 'No sprint goal set.'} Day {day} of {len}; {pts(all.filter(isDone))} of {pts(all)} points done.</>}>
      <select className="selectlike" value={who} onChange={e => setF({ boardWho: e.target.value })} aria-label="Filter by assignee"><option value="">Everyone</option>{p.members.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}<option value="none">Unassigned</option></select>
      <Btn onClick={() => completeSprint(p.id, s.id)}>Complete sprint</Btn><Btn variant="pri" onClick={() => newTicket(undefined, s.id)}>New ticket</Btn>
    </Head>
    <DnD onDrop={drop} overlay={id => { const t = p.tickets[id]; return t ? <div className="card" style={{ ['--c' as string]: 'var(--accent)' }}><div className="ctop"><span className="key">{t.key}</span></div><div className="ctitle">{t.title}</div></div> : null }}>
      <div className="board">{cols.map(k => <Column key={k} p={p} k={k} label={st.statusLabels[k]} cards={ts.filter(t => colOf(t) === k)} all={all.filter(t => colOf(t) === k)} limit={limit(k)} />)}</div>
    </DnD>
    <p className="small muted" style={{ marginTop: 10 }}>WIP limits and column names are adjustable in <button className="link acc" onClick={() => go('settings')}>Project settings</button>.</p>
  </>;
}
