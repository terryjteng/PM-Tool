import { useState } from 'react';
import { TODAY, plural, uid } from '../lib/dates';
import { byId, isDone, maxRank, sortedSprints } from '../model/selectors';
import { sprintFacts } from '../model/coaches';
import { cfg } from '../model/constants';
import { mutP } from '../model/store';
import type { Project, RetroCol, RetroItem, Sprint } from '../model/types';
import { go, toast, useUI } from '../model/ui';
import { Btn, Chip, Dot, Empty, Head, InlineEdit, Tile, undoable } from '../components/ui';
import { openTicket } from '../components/forms';

function talkingPoints(p: Project, s: Sprint, nPrev: number) {
  const f = sprintFacts(p, s.id), o: string[] = [];
  if (nPrev) o.push(`Start by checking ${plural(nPrev, 'open action item')} from earlier retros (listed below).`);
  if (f.sayDo != null) { if (f.sayDo < 80) o.push(`The team finished ${f.sayDo}% of what it committed. Was the commitment too big, or did unplanned work land?`); else if (f.sayDo >= 100) o.push(`The commitment was met (${f.sayDo}%). What made that work, and how do we keep it?`) }
  if (f.added > 0) o.push(`Scope grew by ${plural(f.added, 'point')} after the sprint started. Where did that work come from?`);
  if (f.bugs) o.push(`${plural(f.bugs, 'bug')} reported during the sprint. Is there a pattern in where they came from?`);
  if (f.blocked) o.push(`${plural(f.blocked, 'ticket')} ${f.blocked === 1 ? 'is' : 'are'} still blocked. What would have cleared ${f.blocked === 1 ? 'it' : 'them'} sooner?`);
  const pr = sortedSprints(p).filter(x => x.status === 'closed' && x.start < s.start).slice(-1)[0];
  if (pr && s.status === 'closed') { const d = (+s.completed! || 0) - (+pr.completed! || 0); if (d) o.push(`Velocity ${d > 0 ? 'rose' : 'fell'} by ${plural(Math.abs(d), 'point')} compared with ${pr.name}.`) }
  if (!s.goal) o.push('This sprint had no sprint goal. Would one have helped the team make trade-offs?');
  return o;
}

function ensureRetro(p: Project, sid: string, fn: (items: Record<RetroCol, RetroItem[]>) => void, label: string) {
  mutP(p.id, label, d => {
    let r = d.retros.find(x => x.sprintId === sid);
    if (!r) { d.retros.push({ id: uid(), sprintId: sid, well: [], improve: [], actions: [] }); r = d.retros[d.retros.length - 1] }
    fn(r);
  });
}
function TicketMeta({ p, a }: { p: Project; a: RetroItem }) {
  const t = a.ticketId ? p.tickets[a.ticketId] : undefined;
  return t ? <> <button className="link key" onClick={() => openTicket(t.id)}>{t.key}</button> <Chip cls={isDone(t) ? 'ok' : ''}>{cfg(p).statusLabels[t.status]}</Chip></> : null;
}
function Column({ p, s, k, title, hint, items }: { p: Project; s: Sprint; k: RetroCol; title: string; hint: string; items: RetroItem[] }) {
  const [v, setV] = useState('');
  const add = () => { if (!v.trim()) return; ensureRetro(p, s.id, r => { r[k].push({ id: uid(), text: v.trim() }) }, 'Add retro item'); setV('') };
  const makeTicket = (a: RetroItem) => {
    let key = '';
    mutP(p.id, 'Create ticket from retro action', d => {
      key = d.key + '-' + d.nextNum++;
      const id = uid();
      d.tickets[id] = { id, key, title: a.text, type: 'task', status: 'backlog', priority: 'P2', severity: null, points: 1, assignee: null, epicId: null, sprintId: null, start: null, due: null, deps: [], votes: 0, reporter: 'Retrospective', labels: 'retro', desc: `Action item from the ${s.name} retrospective.`, createdAt: TODAY, startedAt: null, doneAt: null, rank: maxRank(d as Project) + 1 };
      const r = d.retros.find(x => x.sprintId === s.id), it = r?.actions.find(x => x.id === a.id);
      if (it) it.ticketId = id;
    });
    toast(`Created ${key} in the backlog`, { undo: true });
  };
  return <section className="panel">
    <h2>{title}</h2><p className="small muted" style={{ marginTop: 2 }}>{hint}</p>
    {items.length > 0 && <ul className="list1">{items.map(it => <li key={it.id}>
      <div className="sp"><InlineEdit value={it.text} label={title + ' item'} onSave={nv => ensureRetro(p, s.id, r => { const x = r[k].find(y => y.id === it.id); if (x) x.text = nv }, 'Edit retro item')} />{k === 'actions' && <TicketMeta p={p} a={it} />}</div>
      {k === 'actions' && !(it.ticketId && p.tickets[it.ticketId]) && <Btn sm onClick={() => makeTicket(it)}>Make ticket</Btn>}
      <button className="rx" aria-label="Remove" onClick={() => { ensureRetro(p, s.id, r => { r[k] = r[k].filter(x => x.id !== it.id) }, 'Remove retro item'); undoable('Item removed') }}>×</button>
    </li>)}</ul>}
    <form className="radd" onSubmit={e => { e.preventDefault(); add() }}><input value={v} onChange={e => setV(e.target.value)} placeholder="Add an item, then press Enter" aria-label={`Add to ${title}`} /><Btn sm type="submit" disabled={!v.trim()}>Add</Btn></form>
  </section>;
}

export function Retro({ p }: { p: Project }) {
  const sel = useUI(s => s.f.retroSprint), setF = useUI(s => s.setF);
  const opts = sortedSprints(p).filter(s => s.status !== 'planned').reverse();
  const desc = 'Inspect each sprint and adapt: what went well, what to improve, and the action items the team commits to. Click any item to edit it; turn action items into backlog tickets so they don’t get lost.';
  if (!opts.length) return <><Head title="Retrospectives" desc={desc} /><Empty>Retrospectives open once a sprint has started.</Empty></>;
  const s = byId(opts, sel) || opts.find(x => x.status === 'closed') || opts[0];
  const r = p.retros.find(x => x.sprintId === s.id) || { well: [], improve: [], actions: [] }, f = sprintFacts(p, s.id);
  const prev = p.retros.filter(x => x.sprintId !== s.id).flatMap(x => x.actions.map(a => ({ a, rid: x.id, sp: byId(p.sprints, x.sprintId)?.name || 'An earlier sprint' }))).filter(({ a }) => !a.done && !(a.ticketId && p.tickets[a.ticketId] && isDone(p.tickets[a.ticketId])));
  const talk = talkingPoints(p, s, prev.length);
  return <>
    <Head title="Retrospectives" desc={desc}>
      <select className="selectlike" value={s.id} onChange={e => setF({ retroSprint: e.target.value })} aria-label="Sprint">{opts.map(o => <option key={o.id} value={o.id}>{o.name}{o.status === 'active' ? ' (active)' : ''}</option>)}</select>
      <Btn onClick={() => go('scrum')}>Ask the Scrum Master</Btn>
    </Head>
    <div className="tiles"><Tile v={f.committed} label="points committed" /><Tile v={f.completed} label={`points ${s.status === 'closed' ? 'completed' : 'done so far'}`} /><Tile v={f.sayDo == null ? '—' : f.sayDo + '%'} label="say/do ratio" /><Tile v={f.bugs} label="bugs reported during the sprint" /><Tile v={f.ct ?? '—'} label="average cycle time in days" /></div>
    <div className="stack">
      {talk.length > 0 && <section className="panel"><h2>Talking points from the data</h2><ul className="list1">{talk.map((x, i) => <li key={i}><Dot color="var(--accent)" /><div className="sp">{x}</div></li>)}</ul></section>}
      <div className="retrocols">
        <Column p={p} s={s} k="well" title="Went well" hint="Keep doing these." items={r.well} />
        <Column p={p} s={s} k="improve" title="To improve" hint="What slowed us down or hurt quality?" items={r.improve} />
        <Column p={p} s={s} k="actions" title="Action items" hint="One or two concrete changes for next sprint." items={r.actions} />
      </div>
      {prev.length > 0 && <section className="panel"><h2>Open action items from earlier retros</h2><ul className="list1">{prev.map(({ a, rid, sp }) => <li key={a.id}><div className="sp">{a.text}<div className="small muted">{sp}<TicketMeta p={p} a={a} /></div></div>
        {!(a.ticketId && p.tickets[a.ticketId]) && <Btn sm onClick={() => { mutP(p.id, 'Close retro action', d => { const x = d.retros.find(y => y.id === rid)?.actions.find(y => y.id === a.id); if (x) x.done = true }); toast('Action item closed', { undo: true }) }}>Mark done</Btn>}</li>)}</ul></section>}
    </div>
  </>;
}
