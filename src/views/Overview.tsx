import { TODAY, addDays, diff, fmtD, iso, parse, plural } from '../lib/dates';
import { activeSprint, attentionItems, byId, epicProgress, implProgress, isDone, member, memberAvail, msStatus, projectHealth, pts, sprintPulse, sprintTickets, tickets, velocity, type Action } from '../model/selectors';
import type { Project } from '../model/types';
import { go } from '../model/ui';
import { Avatar, Btn, Chip, Dot, Empty, Head, Legend, Meter, clsColor } from '../components/ui';
import { LineChart } from '../components/charts';
import { openEpic, openMilestone, openTicket, openMember } from '../components/forms';
import { openImplTask } from './Implementation';
import { RAID } from '../model/constants';
import { openSettings } from './Settings';

export function runAction(a: Action) {
  if (a.kind === 'go') go(a.view);
  else if (a.kind === 'ticket') openTicket(a.id);
  else if (a.kind === 'milestone') openMilestone(a.id);
  else if (a.kind === 'impl') openImplTask(a.id);
}

export function Dashboard({ p }: { p: Project }) {
  const a = activeSprint(p), v = velocity(p), [hcls, hl] = projectHealth(p);
  const all = tickets(p).filter(t => t.status !== 'triage'), totP = pts(all), doneP = pts(all.filter(isDone)), pct = totP ? Math.round(doneP / totP * 100) : 0;
  const ms = [...p.milestones].sort((x, y) => (x.date < y.date ? -1 : 1)), final = ms[ms.length - 1];
  const first = [...p.sprints.map(s => s.start), ...p.epics.map(e => e.start), TODAY].sort()[0];
  const openT = all.filter(t => !isDone(t)).length, att = attentionItems(p), impl = implProgress(p);
  let strip = null;
  if (ms.length) {
    const end = addDays(final.date, Math.max(3, Math.round(diff(first, final.date) * .04))), tot = Math.max(1, diff(first, end)), P = (d: string) => Math.max(0, Math.min(100, diff(first, d) / tot * 100));
    strip = <div className="mstrip"><div className="mtrack"><i style={{ width: P(TODAY) + '%' }} /></div><span className="mtoday" style={{ left: P(TODAY) + '%' }}><b>Today</b></span>
      {ms.map((m, i) => { const r = msStatus(p, m); return <div key={m.id}><button className={`mpt ${r.cls}`} style={{ left: P(m.date) + '%' }} onClick={() => openMilestone(m.id)} aria-label={m.title} /><div className={`mlab ${i % 2 ? 'dn' : 'up'}`} style={{ left: P(m.date) + '%', transform: `translateX(-${P(m.date) < 12 ? 8 : P(m.date) > 88 ? 92 : 50}%)` }}><b>{m.title}</b><span>{fmtD(m.date)}, {r.st}</span></div></div> })}</div>;
  }
  const pl = a ? sprintPulse(p, a) : null;
  const risks = p.risks.filter(r => r.status !== 'closed').map(r => ({ ...r, score: r.likelihood * r.impact })).sort((x, y) => y.score - x.score).slice(0, 4);
  return <>
    <section className="panel ovhero">
      <div className="ovtop">
        <div><p className="small muted">Project overview</p><h1 className="ovname">{p.name}</h1>{p.desc ? <p className="ovdesc">{p.desc}</p> : <p className="ovdesc muted"><button className="link" onClick={openSettings}>Add a one-line project objective</button></p>}</div>
        <div className={`ovhealth ${hcls}`}><span>Project health</span><b>{hl}</b></div>
      </div>
      <div className="ovstats">
        <div><b>{pct}%</b><span>of {totP} points complete</span></div>
        <div><b>{final ? fmtD(final.date) : '—'}</b><span>{final ? `${final.title}, ${diff(TODAY, final.date) >= 0 ? plural(diff(TODAY, final.date), 'day') + ' away' : 'passed'}` : 'No target date yet'}</span></div>
        <div><b>{v || '—'}</b><span>points per sprint, recent average</span></div>
        <div><b>{openT}</b><span>open tickets</span></div>
        <div><b>{impl.total ? impl.pct + '%' : '—'}</b><span>{impl.total ? `of ${plural(impl.total, 'implementation task')} done` : 'No implementation plan yet'}</span></div>
      </div>
      {strip || <p className="muted" style={{ marginTop: 18 }}><Btn sm onClick={() => openMilestone()}>Add a milestone</Btn> to see the path to launch.</p>}
    </section>
    <div className="ovgrid">
      <section className="panel"><div className="phead"><h2>Needs attention</h2><Chip cls={att.some(x => x.cls === 'bad') ? 'bad' : att.length ? 'warn' : 'ok'}>{att.length}</Chip></div>
        {att.length ? <ul className="list1">{att.slice(0, 8).map((x, i) => <li key={i}><Dot color={clsColor(x.cls)} /><div className="sp"><button className="link" onClick={() => runAction(x.act)}><b>{x.title}</b></button><div className="small muted">{x.sub}</div></div></li>)}</ul> : <p className="muted">Nothing needs attention right now.</p>}
        {att.length > 8 && <p className="small muted" style={{ marginTop: 8 }}>{plural(att.length - 8, 'more item')} not shown.</p>}
      </section>
      {a && pl ? <section className="panel"><div className="phead"><div><h2>{a.name}: day {pl.day} of {pl.len}</h2><p className="small muted">{a.goal || 'No sprint goal set'}</p></div><Btn sm variant="ghost" onClick={() => go('burndown')}>Burndown</Btn></div>
        <LineChart w={560} h={190} labels={pl.labels} series={[{ vals: pl.ideal, color: 'var(--muted)', dash: true, name: 'Ideal' }, { vals: pl.b, color: 'var(--accent)', dots: true, name: 'Remaining' }]} ymax={Math.max(pl.committed, ...pl.b, 1)} />
        <Legend items={[['var(--accent)', 'Points remaining'], ['var(--muted)', 'Ideal burndown', true]]} /><p className={`signal ${pl.cls}`}>{pl.sig} {pl.done} of {pl.total} points done.</p></section>
        : <section className="panel"><h2>No sprint is running</h2><p className="muted" style={{ margin: '6px 0 14px' }}>Plan the next sprint from the backlog, then start it to track burndown.</p><Btn variant="pri" onClick={() => go('planning')}>Plan a sprint</Btn></section>}
      <section className="panel"><div className="phead"><h2>Epics</h2><Btn sm variant="ghost" onClick={() => go('roadmap')}>Roadmap</Btn></div>
        {p.epics.length ? <ul className="list1">{[...p.epics].sort((x, y) => (x.start < y.start ? -1 : 1)).map(e => { const x = epicProgress(p, e); return <li key={e.id}><Dot color={e.color} /><div className="sp"><div className="small rowsplit"><button className="link" onClick={() => openEpic(e.id)}><b>{e.title}</b></button><span className="muted">{x.pct}%, ends {fmtD(e.end)}</span></div><Meter val={x.done} max={x.tot || 1} /></div></li> })}</ul>
          : <p className="muted">No epics yet. <button className="link acc" onClick={() => openEpic()}>Add one</button></p>}
      </section>
      <section className="panel"><div className="phead"><h2>Team</h2><Btn sm variant="ghost" onClick={() => go('capacity')}>Capacity</Btn></div>
        {p.members.length ? <ul className="list1">{p.members.map(m => { const as = a ? pts(sprintTickets(p, a.id).filter(t => t.assignee === m.id)) : 0, c = a ? memberAvail(m, a) : +m.capacity || 0; return <li key={m.id}><Avatar m={m} /><div className="sp"><div className="small rowsplit"><span>{m.name} <span className="muted">{m.role}</span></span>{a && <span className="muted">{as} / {c} pts</span>}</div>{a && <Meter val={as} max={c} />}</div></li> })}</ul>
          : <p className="muted">No teammates yet. <button className="link acc" onClick={() => openMember()}>Add one</button></p>}
      </section>
      <section className="panel"><div className="phead"><h2>Top risks</h2><Btn sm variant="ghost" onClick={() => go('risks')}>Risk log</Btn></div>
        {risks.length ? <ul className="list1">{risks.map(r => <li key={r.id}><Chip cls={r.score >= 6 ? 'bad' : r.score >= 3 ? 'warn' : 'ok'}>{r.score}</Chip><div className="sp"><button className="link" onClick={() => go('risks')}>{r.title}</button><div className="small muted">{RAID.find(x => x[0] === r.kind)?.[1]}{r.owner && member(p, r.owner) ? ', owned by ' + member(p, r.owner)!.name : ''}</div></div></li>)}</ul> : <p className="muted">No open risks logged.</p>}
      </section>
      <section className="panel"><div className="phead"><h2>Implementation plan</h2><Btn sm variant="ghost" onClick={() => go('implementation')}>Open plan</Btn></div>
        {p.impl.phases.length ? <ul className="list1">{p.impl.phases.map(ph => { const x = implProgress(p, ph.id); return <li key={ph.id}><div className="sp"><div className="small rowsplit"><b>{ph.name}</b><span className="muted">{x.done} / {x.total}</span></div><Meter val={x.done} max={x.total || 1} /></div></li> })}</ul>
          : <p className="muted">No implementation plan yet. <button className="link acc" onClick={() => go('implementation')}>Start one</button></p>}
      </section>
    </div>
  </>;
}

export function Roadmap({ p }: { p: Project }) {
  const act = <><Btn onClick={() => openMilestone()}>Add milestone</Btn><Btn variant="pri" onClick={() => openEpic()}>Add epic</Btn></>;
  if (!p.epics.length) return <><Head title="Roadmap" desc="Epics laid out over time, with milestones on top.">{act}</Head><Empty>No epics yet. Add an epic to start shaping the roadmap.</Empty></>;
  const dates = [...p.epics.flatMap(e => [e.start, e.end]), ...p.milestones.map(m => m.date), TODAY].filter(Boolean).sort();
  const a = dates[0].slice(0, 8) + '01', bd = parse(dates[dates.length - 1]), b = iso(new Date(bd.getFullYear(), bd.getMonth() + 1, 0));
  const total = diff(a, b) + 1, pct = (d: string) => Math.max(0, Math.min(100, diff(a, d) / total * 100));
  const months: { d: string; l: string }[] = [];
  for (let d = a; d <= b;) { const dt = parse(d); months.push({ d, l: dt.toLocaleDateString(undefined, { month: 'short' }) + (dt.getMonth() === 0 || d === a ? ' ' + dt.getFullYear() : '') }); d = iso(new Date(dt.getFullYear(), dt.getMonth() + 1, 1)) }
  const lines = <>{months.map(m => <div key={m.d} className="mline" style={{ left: pct(m.d) + '%' }} />)}{TODAY >= a && TODAY <= b && <div className="today" style={{ left: pct(TODAY) + '%' }} title="Today" />}</>;
  return <>
    <Head title="Roadmap" desc="Epics laid out over time. The filled part of each bar is completed points; red diamonds are milestones forecast to slip.">{act}</Head>
    <div className="panel roadwrap"><div className="road">
      <div className="rrow rhead"><div /><div className="rtrack">{months.map(m => <div key={m.d}><div className="mline" style={{ left: pct(m.d) + '%' }} /><div className="mlabel" style={{ left: pct(m.d) + '%' }}>{m.l}</div></div>)}</div></div>
      <div className="rrow"><div className="rlabel"><b>Milestones</b></div><div className="rtrack" style={{ minHeight: 58 }}>{lines}{p.milestones.map(m => { const r = msStatus(p, m); return <div key={m.id}><button className={`diamond ${r.cls === 'bad' ? 'bad' : r.st === 'Complete' ? 'ok' : ''}`} style={{ left: pct(m.date) + '%' }} onClick={() => openMilestone(m.id)} title={`${m.title}: ${fmtD(m.date)}, ${r.st}`} aria-label={m.title} /><span className="dlabel" style={{ left: pct(m.date) + '%' }}>{m.title}</span></div> })}</div></div>
      {[...p.epics].sort((x, y) => (x.start < y.start ? -1 : 1)).map(e => {
        const x = epicProgress(p, e), ms = byId(p.milestones, e.milestoneId), late = ms && e.end > ms.date;
        return <div className="rrow" key={e.id}><div className="rlabel"><button className="link" onClick={() => openEpic(e.id)}><b>{e.title}</b></button><div className="small muted">{fmtD(e.start)} to {fmtD(e.end)}, {x.pct}% done {late && <Chip cls="bad">Ends after {ms!.title}</Chip>}</div></div>
          <div className="rtrack">{lines}<button className="rbar" style={{ ['--ec' as string]: e.color, left: pct(e.start) + '%', width: Math.max(1, (diff(e.start, e.end) + 1) / total * 100) + '%' }} onClick={() => openEpic(e.id)} title={`${e.title}: ${x.done} of ${x.tot} points done`}><i style={{ width: x.pct + '%' }} /><span>{e.title}</span></button></div></div>;
      })}
    </div></div>
  </>;
}

export function Milestones({ p }: { p: Project }) {
  const ms = [...p.milestones].sort((a, b) => (a.date < b.date ? -1 : 1)), v = velocity(p);
  return <>
    <Head title="Milestones" desc="Forecasts use the average velocity of the last three sprints and all remaining work in epics due on or before each milestone."><Btn variant="pri" onClick={() => openMilestone()}>Add milestone</Btn></Head>
    {ms.length ? <div className="stack">{ms.map(m => {
      const r = msStatus(p, m), dl = diff(TODAY, m.date);
      return <section className="panel mscard" key={m.id}>
        <div className="msdate"><b>{fmtD(m.date)}</b><span className="small muted">{dl >= 0 ? plural(dl, 'day') + ' away' : plural(-dl, 'day') + ' ago'}</span></div>
        <div><div className="rowflex"><h2><button className="link" onClick={() => openMilestone(m.id)}>{m.title}</button></h2><Chip cls={r.cls}>{r.st}</Chip></div>
          {m.desc && <p className="muted" style={{ marginTop: 4 }}>{m.desc}</p>}
          <ul className="list1" style={{ marginTop: 8 }}>{r.own.length ? r.own.map(e => { const x = epicProgress(p, e); return <li key={e.id}><Dot color={e.color} /><div className="sp"><div className="small rowsplit"><button className="link" onClick={() => openEpic(e.id)}>{e.title}</button><span className="muted">{x.done} / {x.tot} pts</span></div><Meter val={x.done} max={x.tot || 1} /></div></li> }) : <li className="muted small">No epics linked. Link epics to this milestone from the epic editor.</li>}</ul></div>
        <div className="small" style={{ textAlign: 'right', minWidth: 150 }}><div className="muted">Work remaining</div><b style={{ fontSize: '1.2rem' }}>{r.f.rem} pts</b><div className="muted" style={{ marginTop: 6 }}>Forecast finish</div><b>{r.f.date ? fmtD(r.f.date) : r.f.rem ? (v ? '—' : 'Needs velocity') : 'Done'}</b></div>
      </section>;
    })}</div> : <Empty>No milestones yet. <Btn sm variant="pri" onClick={() => openMilestone()}>Add milestone</Btn></Empty>}
  </>;
}
