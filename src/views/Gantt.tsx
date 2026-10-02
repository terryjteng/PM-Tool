import { useEffect, useRef, useState } from 'react';
import { TODAY, addDays, cx, diff, fmtD, parse, plural } from '../lib/dates';
import { byId, byRank, isDone, msStatus, tickets } from '../model/selectors';
import { cpm } from '../model/flow';
import { mutP } from '../model/store';
import type { Project, Ticket } from '../model/types';
import { toast, useUI } from '../model/ui';
import { AvatarId, Btn, Chip, Empty, Head, Seg, confirmBox } from '../components/ui';
import { newTicket, openEpic, openMilestone, openTicket } from '../components/forms';

interface Drag { id: string; mode: 'move' | 'resize'; x0: number; dx: number; moved: boolean }

export function Gantt({ p }: { p: Project }) {
  const f = useUI(s => s.f), setF = useUI(s => s.setF), z = f.gZoom;
  const [drag, setDrag] = useState<Drag | null>(null);
  const scroller = useRef<HTMLDivElement>(null), scrolled = useRef(false);
  const B = f.gBase && p.baseline ? p.baseline.items : null;
  const dated = tickets(p).filter(t => t.start && t.due && t.status !== 'triage');

  const saveBaseline = () => {
    const doIt = () => {
      const items: Record<string, [string, string]> = {};
      tickets(p).forEach(t => { if (t.start && t.due) items[t.id] = [t.start, t.due] });
      mutP(p.id, 'Save baseline', d => { d.baseline = { at: TODAY, items } });
      setF({ gBase: true });
      toast(`Baseline saved for ${plural(Object.keys(items).length, 'ticket')}`);
    };
    if (p.baseline) confirmBox('Replace the baseline?', `The baseline from ${fmtD(p.baseline.at)} will be replaced with every ticket’s current dates.`, 'Re-baseline', doIt); else doIt();
  };
  const actions = <>
    <Seg label="Zoom" value={z} onChange={v => setF({ gZoom: v })} options={[[12, 'Quarter'], [22, 'Month'], [36, 'Week']]} />
    <Btn sm variant={f.gCrit ? 'pri' : undefined} aria-pressed={f.gCrit} onClick={() => setF({ gCrit: !f.gCrit })} title="Outline tickets with no slack">Critical path</Btn>
    {p.baseline && <Btn sm variant={f.gBase ? 'pri' : undefined} aria-pressed={f.gBase} onClick={() => setF({ gBase: !f.gBase })}>Baseline</Btn>}
    <Btn sm onClick={saveBaseline} title="Snapshot every ticket’s current dates">{p.baseline ? 'Re-baseline' : 'Save baseline'}</Btn>
    {p.baseline && <Btn sm variant="ghost" onClick={() => { mutP(p.id, 'Clear baseline', d => { d.baseline = null }); toast('Baseline cleared', { undo: true }) }}>Clear baseline</Btn>}
    <Btn variant="pri" onClick={() => newTicket()}>New ticket</Btn>
  </>;

  useEffect(() => {
    if (scrolled.current || !scroller.current) return;
    const t = scroller.current.querySelector<HTMLElement>('span[data-today]');
    if (t) scroller.current.scrollLeft = Math.max(0, t.offsetLeft - 450);
    scrolled.current = true;
  });

  if (!dated.length) return <><Head title="Timeline" desc="A Gantt view of every ticket with a start and due date.">{actions}</Head><Empty>No tickets have dates yet. Give a ticket a start and due date to see it here.</Empty></>;

  const ms = [...p.milestones].filter(m => m.date).sort((a, b) => (a.date < b.date ? -1 : 1));
  let min = dated.reduce((m, t) => (t.start! < m ? t.start! : m), dated[0].start!), max = dated.reduce((m, t) => (t.due! > m ? t.due! : m), dated[0].due!);
  if (B) dated.forEach(t => { const b = B[t.id]; if (b) { if (b[0] < min) min = b[0]; if (b[1] > max) max = b[1] } });
  ms.forEach(m => { if (m.date < min) min = m.date; if (m.date > max) max = m.date });
  if (TODAY < min) min = TODAY;
  min = addDays(min, -3); max = addDays(max, 6);
  const days = diff(min, max) + 1, LW = 250, RH = 35, HH = (ms.length ? 3 : 2) * 27, W = days * z;
  const cp = cpm(dated), crit = (t: Ticket) => f.gCrit && !isDone(t) && cp.slack[t.id] <= 0;
  const groups = [...p.epics.map(e => ({ e, ts: dated.filter(t => t.epicId === e.id) })), { e: null, ts: dated.filter(t => !t.epicId || !byId(p.epics, t.epicId)) }].filter(g => g.ts.length);
  const rows: ({ kind: 'epic'; e: typeof p.epics[number] | null; ts: Ticket[] } | { kind: 't'; t: Ticket })[] = [];
  groups.forEach(g => { g.ts.sort((a, b) => (a.start! < b.start! ? -1 : a.start! > b.start! ? 1 : byRank(a, b))); rows.push({ kind: 'epic', e: g.e, ts: g.ts }); g.ts.forEach(t => rows.push({ kind: 't', t })) });
  const rowIdx: Record<string, number> = {};
  rows.forEach((r, i) => { if (r.kind === 't') rowIdx[r.t.id] = i });
  const X = (d: string) => LW + diff(min, d) * z;
  const snap = (dx: number) => Math.round(dx / z);

  // live position while dragging
  const pos = (t: Ticket) => {
    let s = t.start!, e = t.due!;
    if (drag && drag.id === t.id) { const n = snap(drag.dx); if (drag.mode === 'move') { s = addDays(s, n); e = addDays(e, n) } else { e = addDays(e, n); if (e < s) e = s } }
    return { s, e };
  };
  const down = (e: React.PointerEvent, t: Ticket) => {
    if (e.button > 0) return;
    e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    setDrag({ id: t.id, mode: (e.target as HTMLElement).classList.contains('grip') ? 'resize' : 'move', x0: e.clientX, dx: 0, moved: false });
  };
  const move = (e: React.PointerEvent) => { if (drag) setDrag({ ...drag, dx: e.clientX - drag.x0, moved: drag.moved || Math.abs(e.clientX - drag.x0) > 3 }) };
  const up = () => {
    if (!drag) return;
    const g = drag, n = snap(g.dx);
    setDrag(null);
    if (!g.moved) { openTicket(g.id); return }
    if (!n) return;
    const t = p.tickets[g.id];
    mutP(p.id, `Reschedule ${t.key}`, d => { const x = d.tickets[g.id]; if (g.mode === 'move') { x.start = addDays(x.start!, n); x.due = addDays(x.due!, n) } else { x.due = addDays(x.due!, n); if (x.due < x.start!) x.due = x.start } });
    toast(`${t.key} rescheduled`, { undo: true });
  };

  let conflicts = 0;
  const links: React.ReactNode[] = [];
  dated.forEach(t => (t.deps || []).forEach(pid => {
    const pr = p.tickets[pid];
    if (!pr || rowIdx[pid] == null || rowIdx[t.id] == null) return;
    const pp = pos(pr), tp = pos(t), bad = tp.s <= pp.e && !isDone(pr), cl = !bad && crit(pr) && crit(t);
    if (bad) conflicts++;
    const x1 = X(pp.e) + z - 2, y1 = HH + rowIdx[pid] * RH + 17, x2 = X(tp.s), y2 = HH + rowIdx[t.id] * RH + 17, mid = Math.max(x1 + 8, Math.min(x2 - 8, x1 + 8));
    links.push(<path key={pid + t.id} d={`M${x1} ${y1} H${mid} V${y2} H${x2 - 2}`} fill="none" stroke={bad ? 'var(--bad)' : cl ? 'var(--warn)' : 'var(--muted)'} strokeWidth={cl ? 2 : 1.6} markerEnd={`url(#${bad ? 'arB' : cl ? 'arC' : 'arA'})`} />);
  }));
  const nCrit = dated.filter(crit).length;
  let baseNote = null;
  if (B && p.baseline) {
    const sl = dated.filter(t => B[t.id] && diff(B[t.id][1], t.due!) > 0), bEnd = Object.values(B).reduce((m, b) => (b[1] > m ? b[1] : m), ''), mv = bEnd ? diff(bEnd, cp.end) : 0;
    baseNote = <p className={`signal ${sl.length || mv > 0 ? 'warn' : 'ok'}`} style={{ margin: '0 0 12px' }}>Baseline from {fmtD(p.baseline.at)}: {sl.length ? `${plural(sl.length, 'ticket')} slipped` : 'no tickets slipped'}, and the finish {mv > 0 ? `moved out ${plural(mv, 'day')}` : mv < 0 ? `moved in ${plural(-mv, 'day')}` : 'hasn’t moved'}. The gray line under each bar marks its baseline dates.</p>;
  }
  const mk = (id: string, c: string) => <marker id={id} viewBox="0 0 8 8" refX={7} refY={4} markerWidth={7} markerHeight={7} orient="auto"><path d="M0 0L8 4L0 8z" fill={c} /></marker>;
  const dayH = [...Array(days)].map((_, i) => { const d = addDays(min, i), dt = parse(d), we = dt.getDay() === 0 || dt.getDay() === 6, show = z >= 30 || dt.getDay() === 1; return <div key={d} className={cx('gday', we && 'we')} style={{ left: i * z, width: z }}>{show ? (z >= 30 ? dt.getDate() : fmtD(d)) : ''}</div> });

  return <>
    <Head title="Timeline" desc="Drag a bar to reschedule it, or drag its right edge to change the due date. Arrows show what blocks what; amber outlines mark the critical path.">{actions}</Head>
    {conflicts > 0 && <p className="signal bad" style={{ margin: '0 0 12px' }}>{plural(conflicts, 'dependency conflict')}: a ticket starts before the ticket blocking it is due. Conflicting links are drawn in red.</p>}
    {nCrit > 0 && <p className="small muted" style={{ margin: '0 0 10px' }}><b style={{ color: 'var(--warn)' }}>Critical path:</b> {plural(nCrit, 'open ticket')} with no slack {nCrit === 1 ? 'drives' : 'drive'} the {fmtD(cp.end)} finish, so any delay to {nCrit === 1 ? 'it' : 'them'} moves the end date. Each bar’s tooltip shows its slack.</p>}
    {baseNote}
    <div className="gscroll" ref={scroller}>
      <div className={cx('gantt', drag && 'dragging')} style={{ width: LW + W }}>
        <div className="grow ghdr"><div className="glabel">Sprints</div><div className="gtrack" style={{ width: W }}>{p.sprints.filter(s => !(s.end < min || s.start > max)).map(s => { const l = Math.max(0, diff(min, s.start)) * z, r = (Math.min(days - 1, diff(min, s.end)) + 1) * z; return <div key={s.id} className="gsprint" style={{ left: l, width: r - l }} title={s.name}>{s.name}</div> })}</div></div>
        {ms.length > 0 && <div className="grow ghdr gms"><div className="glabel">Milestones</div><div className="gtrack" style={{ width: W }}>{ms.map(m => { const r = msStatus(p, m), l = diff(min, m.date) * z + z / 2; return <span key={m.id}><button className={`diamond ${r.cls === 'bad' ? 'bad' : r.st === 'Complete' ? 'ok' : ''}`} style={{ left: l }} onClick={() => openMilestone(m.id)} title={`${m.title}: ${fmtD(m.date)}, ${r.st}`} aria-label={m.title} /><span className="dl" style={{ left: l }}>{m.title}</span></span> })}</div></div>}
        <div className="grow ghdr"><div className="glabel">Ticket</div><div className="gtrack" style={{ width: W }}>{dayH}</div></div>
        {rows.map((r, i) => {
          if (r.kind === 'epic') {
            const s = r.ts.reduce((m, t) => (t.start! < m ? t.start! : m), r.ts[0].start!), e = r.ts.reduce((m, t) => (t.due! > m ? t.due! : m), r.ts[0].due!);
            return <div className="grow epic" key={'e' + i}><div className="glabel">{r.e ? <><span className="dot" style={{ background: r.e.color }} /><button className="link ttl" onClick={() => openEpic(r.e!.id)}>{r.e.title}</button></> : <span className="ttl">No epic</span>}</div><div className="gtrack" style={{ width: W }}><div className="gsum" style={{ ['--ec' as string]: r.e ? r.e.color : 'var(--muted)', left: diff(min, s) * z, width: (diff(s, e) + 1) * z }} /></div></div>;
          }
          const t = r.t, { s, e } = pos(t), late = !isDone(t) && t.due! < TODAY, b = B && B[t.id], slip = b ? diff(b[1], t.due!) : 0, sl = cp.slack[t.id];
          const slTip = isDone(t) ? '' : sl > 0 ? `, ${plural(sl, 'day')} of slack` : sl < 0 ? `, ${plural(-sl, 'day')} behind what its successors need` : ', no slack (critical)';
          return <div className="grow" key={t.id}>
            <div className="glabel"><span className="key">{t.key}</span><button className="link ttl" onClick={() => openTicket(t.id)} title={t.title}>{t.title}</button><span style={{ flex: 1 }} />{slip !== 0 && <Chip cls={slip > 0 ? 'bad' : 'ok'} title={`Due date ${slip > 0 ? 'slipped' : 'pulled in'} ${plural(Math.abs(slip), 'day')} against the baseline`}>{slip > 0 ? '+' : ''}{slip}d</Chip>}<AvatarId p={p} id={t.assignee} /></div>
            <div className="gtrack" style={{ width: W }}>
              {b && <div className="gbase" style={{ left: diff(min, b[0]) * z, width: Math.max(4, (diff(b[0], b[1]) + 1) * z - 2) }} title={`Baseline: ${fmtD(b[0])} to ${fmtD(b[1])}`} />}
              <div className={cx('gbar', `s-${t.status}`, late && 'late', crit(t) && 'crit', drag?.id === t.id && 'active')} style={{ left: diff(min, s) * z, width: (diff(s, e) + 1) * z - 2 }}
                onPointerDown={ev => down(ev, t)} onPointerMove={move} onPointerUp={up} onPointerCancel={() => setDrag(null)}
                title={`${t.key} ${t.title}: ${fmtD(s)} to ${fmtD(e)}${late ? ' (overdue)' : ''}${slTip}`} role="button" tabIndex={0} onKeyDown={ev => { if (ev.key === 'Enter') openTicket(t.id) }}>
                {t.key}{drag?.id === t.id && drag.moved ? ` · ${fmtD(s)} to ${fmtD(e)}` : ''}<i className="grip" aria-hidden="true" />
              </div>
            </div>
          </div>;
        })}
        <svg className="gover" width={LW + W} height={HH + rows.length * RH}>
          <defs>{mk('arA', 'var(--muted)')}{mk('arB', 'var(--bad)')}{mk('arC', 'var(--warn)')}</defs>
          {p.sprints.filter(s => s.start >= min && s.start <= max).map(s => <line key={s.id} x1={X(s.start)} x2={X(s.start)} y1={0} y2={HH + rows.length * RH} stroke="var(--muted)" strokeOpacity={.35} />)}
          {ms.map(m => <line key={m.id} x1={X(m.date) + z / 2} x2={X(m.date) + z / 2} y1={27} y2={HH + rows.length * RH} stroke="var(--ink)" strokeOpacity={.45} strokeDasharray="3 4" />)}
          {TODAY >= min && TODAY <= max && <line x1={X(TODAY) + z / 2} x2={X(TODAY) + z / 2} y1={0} y2={HH + rows.length * RH} stroke="var(--bad)" strokeWidth={2} />}
          {links}
        </svg>
        {TODAY >= min && TODAY <= max && <span data-today style={{ position: 'absolute', left: X(TODAY), top: 0 }} />}
      </div>
    </div>
  </>;
}
