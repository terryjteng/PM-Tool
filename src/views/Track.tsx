import { TODAY, addDays, diff, fmtD, plural, weekStart } from '../lib/dates';
import { PRIORITIES, RAID, STATUSES, cfg } from '../model/constants';
import { activeSprint, byId, isDone, keyNum, maxRank, member, memberAvail, pts, sortedSprints, sprintCap, sprintTickets, tickets, velocity, sayDo, byRank } from '../model/selectors';
import { bugPareto, cfdData, flowStats, monteCarlo } from '../model/flow';
import { scopeTickets } from '../model/selectors';
import { mutP } from '../model/store';
import type { Priority, Project, Risk } from '../model/types';
import { go, toast, useUI } from '../model/ui';
import { Avatar, AvatarId, Btn, Chip, Empty, Head, Legend, Meter, PriBadge, SevChip, Tile, TypeTag, undoable } from '../components/ui';
import { AreaChart, BarChart, ControlChart, LineChart, ParetoChart } from '../components/charts';
import { deleteTickets, newTicket, openMember, openRisk, openTicket } from '../components/forms';
import { exportCsv } from './Settings';

export function Tickets({ p }: { p: Project }) {
  const f = useUI(s => s.f.tf), setF = useUI(s => s.setF), st = cfg(p);
  let ts = tickets(p).filter(t => t.type === 'bug' || t.type === 'feature');
  const tri = ts.filter(t => t.status === 'triage'), bugs = ts.filter(t => t.type === 'bug' && !isDone(t)), feats = ts.filter(t => t.type === 'feature' && !isDone(t));
  const top = [...feats].sort((a, b) => (b.votes || 0) - (a.votes || 0))[0];
  if (f.type !== 'all') ts = ts.filter(t => t.type === f.type);
  if (f.status === 'open') ts = ts.filter(t => !isDone(t)); else if (f.status === 'triage') ts = ts.filter(t => t.status === 'triage'); else if (f.status === 'done') ts = ts.filter(isDone);
  if (f.q) ts = ts.filter(t => (t.title + ' ' + t.key + ' ' + t.labels).toLowerCase().includes(f.q.toLowerCase()));
  const so: Record<string, number> = { critical: 0, major: 1, minor: 2, trivial: 3 };
  ts.sort((a, b) => Number(a.status !== 'triage') - Number(b.status !== 'triage') || a.priority.localeCompare(b.priority) || (so[a.severity || ''] ?? 4) - (so[b.severity || ''] ?? 4) || (b.votes || 0) - (a.votes || 0));
  const setTf = (k: string, v: string) => setF({ tf: { ...f, [k]: v } });
  return <>
    <Head title="Bugs & requests" desc="Intake for bug reports and feature requests. Triage new items into the backlog or reject them; votes help rank requests."><Btn onClick={() => newTicket('feature')}>Request a feature</Btn><Btn variant="pri" onClick={() => newTicket('bug')}>Report a bug</Btn></Head>
    <div className="tiles"><Tile v={tri.length} label="waiting in triage" /><Tile v={bugs.filter(b => b.severity === 'critical').length} label="critical bugs open" /><Tile v={bugs.length} label="bugs open" /><Tile v={feats.length} label="open feature requests" />{top && <Tile v={top.votes || 0} label={`votes for the top request: ${top.title}`} />}</div>
    <div className="filters">
      <select value={f.type} onChange={e => setTf('type', e.target.value)} aria-label="Type"><option value="all">Bugs and requests</option><option value="bug">Bugs</option><option value="feature">Feature requests</option></select>
      <select value={f.status} onChange={e => setTf('status', e.target.value)} aria-label="Status"><option value="open">Open</option><option value="triage">In triage</option><option value="done">Done</option><option value="all">All statuses</option></select>
      <input type="search" placeholder="Search" value={f.q} onChange={e => setTf('q', e.target.value)} aria-label="Search bugs and requests" />
    </div>
    <div className="panel tblwrap" style={{ padding: '4px 8px' }}><table><thead><tr><th>Key</th><th>Type</th><th>Title</th><th>Severity or votes</th><th>Priority</th><th>Status</th><th>Reported by</th><th>Filed</th><th /></tr></thead><tbody>
      {ts.map(t => <tr key={t.id}><td className="key">{t.key}</td><td><TypeTag p={p} t={t} /></td><td><button className="link" onClick={() => openTicket(t.id)}>{t.title}</button></td>
        <td>{t.type === 'bug' ? <SevChip v={t.severity} /> : <Chip cls="feat">{plural(+t.votes || 0, 'vote')}</Chip>}</td>
        <td><select className="mini" value={t.priority} aria-label={`Priority of ${t.key}`} onChange={e => mutP(p.id, `Reprioritize ${t.key}`, d => { d.tickets[t.id].priority = e.target.value as Priority })}>{PRIORITIES.map(([k]) => <option key={k} value={k}>{k}</option>)}</select></td>
        <td><Chip cls={t.status === 'triage' ? 'warn' : isDone(t) ? 'ok' : ''}>{st.statusLabels[t.status]}</Chip></td><td className="small">{t.reporter || '—'}</td><td className="small muted">{fmtD(t.createdAt)}</td>
        <td className="nowrap">{t.status === 'triage' && <><Btn sm variant="pri" onClick={() => { mutP(p.id, `Accept ${t.key}`, d => { const x = d.tickets[t.id]; x.status = 'backlog'; x.rank = maxRank(d as Project) + 1; if (!x.points) x.points = st.defaultPoints }); toast(`${t.key} moved to the backlog`, { undo: true }) }}>Accept</Btn> <Btn sm variant="ghost" onClick={() => deleteTickets(p.id, [t.id])}>Reject</Btn></>}
          {t.type === 'feature' && !isDone(t) && <> <Btn sm onClick={() => mutP(p.id, `Vote for ${t.key}`, d => { d.tickets[t.id].votes = (+d.tickets[t.id].votes || 0) + 1 })} aria-label="Add a vote">+1</Btn></>}</td></tr>)}
      {!ts.length && <tr><td colSpan={9} className="empty">Nothing matches these filters.</td></tr>}
    </tbody></table></div>
  </>;
}

export function Capacity({ p }: { p: Project }) {
  const sp = sortedSprints(p).filter(s => s.status !== 'closed');
  return <>
    <Head title="Team capacity" desc="Each teammate’s points per sprint, less time off, against what’s assigned to them. Green is healthy, amber is near full, red is overbooked. Click a name to edit."><Btn variant="pri" onClick={() => openMember()}>Add teammate</Btn></Head>
    {p.members.length ? <><div className="panel tblwrap"><table className="heat"><thead><tr><th>Teammate</th><th>Role</th><th className="num">Pts/sprint</th>{sp.map(s => <th key={s.id} style={{ textAlign: 'center' }}>{s.name}<div className="small muted" style={{ fontWeight: 400 }}>{fmtD(s.start)}</div></th>)}</tr></thead><tbody>
      {p.members.map(m => <tr key={m.id}><td><Avatar m={m} /> <button className="link" onClick={() => openMember(m.id)}>{m.name}</button></td><td>{m.role}</td>
        <td className="num"><input className="numin" type="number" min={0} value={m.capacity} aria-label={`Points per sprint for ${m.name}`} onChange={e => mutP(p.id, `Capacity for ${m.name}`, d => { byId(d.members, m.id)!.capacity = Math.max(0, +e.target.value || 0) }, { coalesce: 'cap' + m.id })} /></td>
        {sp.map(s => { const a = pts(sprintTickets(p, s.id).filter(t => t.assignee === m.id)), c = memberAvail(m, s), r = c ? a / c : a ? 2 : 0; return <td key={s.id} className={!a && !c ? 'h0' : r > 1 ? 'h3' : r > .85 ? 'h2' : a ? 'h1' : 'h0'} title={`${a} of ${c} points`}>{c ? Math.round(r * 100) + '%' : a ? '∞' : '—'}</td> })}</tr>)}
      <tr><td><b>Team</b></td><td /><td className="num"><b>{p.members.reduce((a, m) => a + (+m.capacity || 0), 0)}</b></td>{sp.map(s => <td key={s.id} title="Assigned of available points">{pts(sprintTickets(p, s.id))} / {sprintCap(p, s)}</td>)}</tr>
    </tbody></table></div><p className="small muted" style={{ marginTop: 10 }}>Set time off per sprint on the <button className="link acc" onClick={() => go('planning')}>Sprint planning</button> page. Percentages are assigned points divided by available points.</p></>
      : <Empty>No teammates yet. Add the people on this project and how many points each usually completes per sprint.</Empty>}
  </>;
}

export function Risks({ p }: { p: Project }) {
  const open = p.risks.filter(r => r.status !== 'closed'), cnt = (l: number, i: number) => open.filter(r => +r.likelihood === l && +r.impact === i).length;
  const rs = [...p.risks].map(r => ({ ...r, score: r.likelihood * r.impact })).sort((a, b) => Number(a.status === 'closed') - Number(b.status === 'closed') || b.score - a.score);
  const cells = [];
  for (let l = 3; l >= 1; l--) { cells.push(<div key={'a' + l} className="raxis">{['', 'Low', 'Med', 'High'][l]}</div>); for (let i = 1; i <= 3; i++) { const s = l * i, n = cnt(l, i); cells.push(<div key={l + '-' + i} className={`rcell ${s >= 6 ? 's3' : s >= 3 ? 's2' : 's1'} ${n ? '' : 'zero'}`} title={`Likelihood ${l}, impact ${i}`}>{n}</div>) } }
  return <>
    <Head title="Risks" desc="A RAID log: risks, assumptions, issues, and dependencies. Score is likelihood times impact, each rated 1 to 3."><Btn variant="pri" onClick={() => openRisk()}>Log an item</Btn></Head>
    <div className="grid2" style={{ gridTemplateColumns: 'minmax(260px,380px) minmax(0,1fr)' }}>
      <section className="panel"><h2>Open items by likelihood and impact</h2><div style={{ display: 'flex', gap: 8, alignItems: 'center' }}><div className="raxis vert">Likelihood</div><div className="rgrid" style={{ flex: 1 }}>{cells}<div /><div className="raxis">Low</div><div className="raxis">Med</div><div className="raxis">High</div></div></div><p className="raxis" style={{ marginTop: 4 }}>Impact</p></section>
      <section className="panel tblwrap"><table><thead><tr><th>Score</th><th>Type</th><th>Item</th><th>Owner</th><th>Status</th></tr></thead><tbody>
        {rs.map(r => <tr key={r.id}><td><Chip cls={r.status === 'closed' ? '' : r.score >= 6 ? 'bad' : r.score >= 3 ? 'warn' : 'ok'}>{r.score}</Chip></td><td className="small">{RAID.find(x => x[0] === r.kind)?.[1]}</td><td><button className="link" onClick={() => openRisk(r.id)}>{r.title}</button>{r.mitigation && <div className="small muted">{r.mitigation}</div>}</td><td className="small">{member(p, r.owner)?.name || '—'}</td>
          <td><select className="mini" value={r.status} aria-label="Status" onChange={e => mutP(p.id, 'Change RAID status', d => { byId(d.risks, r.id)!.status = e.target.value as Risk['status'] })}><option value="open">Open</option><option value="mitigating">Mitigating</option><option value="closed">Closed</option></select></td></tr>)}
        {!rs.length && <tr><td colSpan={5} className="empty">Nothing logged yet.</td></tr>}
      </tbody></table></section>
    </div>
  </>;
}

export function Reports({ p }: { p: Project }) {
  const closed = sortedSprints(p).filter(s => s.status === 'closed').slice(-8), v = velocity(p), sd = sayDo(p, 8);
  const wk0 = weekStart(addDays(TODAY, -49)), weeks = [...Array(8)].map((_, i) => addDays(wk0, i * 7)), bugs = tickets(p).filter(t => t.type === 'bug');
  const opened = weeks.map(w => bugs.filter(b => b.createdAt >= w && b.createdAt < addDays(w, 7)).length), fixed = weeks.map(w => bugs.filter(b => b.doneAt && b.doneAt >= w && b.doneAt < addDays(w, 7)).length);
  const recent = tickets(p).filter(t => isDone(t) && !!t.doneAt && t.doneAt >= addDays(TODAY, -42) && t.startedAt);
  const cycle = recent.length ? (recent.reduce((a, t) => a + diff(t.startedAt!, t.doneAt!) + 1, 0) / recent.length).toFixed(1) : '—';
  const thr = Math.round(pts(tickets(p).filter(t => isDone(t) && !!t.doneAt && t.doneAt >= addDays(TODAY, -28))) / 4);
  const remAll = pts(tickets(p).filter(t => !isDone(t) && t.status !== 'triage')), a = activeSprint(p), eta = v ? addDays(a ? a.start : TODAY, Math.ceil(remAll / v) * cfg(p).sprintDays - 1) : null;
  const light = 'color-mix(in srgb,var(--accent) 30%,var(--panel))', mx = Math.max(1, pts(tickets(p).filter(t => !isDone(t))));
  return <>
    <Head title="Reports" desc="Delivery health across sprints. Burndown and burnup charts have their own page."><Btn onClick={() => go('burndown')}>Burndown charts</Btn>{tickets(p).length > 0 && <Btn onClick={() => exportCsv(p)}>Export tickets as CSV</Btn>}</Head>
    <div className="tiles"><Tile v={v || '—'} label="average velocity, last 3 sprints" /><Tile v={sd == null ? '—' : sd + '%'} label="say/do ratio: completed vs committed" /><Tile v={cycle} label="average cycle time in days, last 6 weeks" /><Tile v={thr} label="points finished per week, last 4 weeks" /><Tile v={eta ? fmtD(eta) : '—'} label={`forecast to clear all ${remAll} open points`} /></div>
    <div className="grid2">
      <section className="panel"><h2>Velocity</h2>{closed.length ? <><BarChart groups={closed.map(s => ({ label: s.name.replace(/^Sprint\s*/i, 'S'), vals: [{ v: +s.committed! || 0, color: light, name: 'committed' }, { v: +s.completed! || 0, color: 'var(--accent)', name: 'completed' }] }))} avg={v} ymax={Math.max(...closed.map(s => Math.max(+s.committed! || 0, +s.completed! || 0)), 1)} /><Legend items={[[light, 'Committed'], ['var(--accent)', 'Completed']]} /></> : <p className="muted">Complete a sprint to start building velocity history.</p>}</section>
      <section className="panel"><h2>Bugs opened and fixed per week</h2><LineChart labels={weeks.map(fmtD)} series={[{ vals: opened, color: 'var(--bad)', dots: true, name: 'Opened' }, { vals: fixed, color: 'var(--ok)', dots: true, name: 'Fixed' }]} ymax={Math.max(...opened, ...fixed, 2)} /><Legend items={[['var(--bad)', 'Opened'], ['var(--ok)', 'Fixed']]} /></section>
      <section className="panel"><h2>Open work by status</h2><ul className="list1">{STATUSES.filter(k => k !== 'done').map(k => { const ts = tickets(p).filter(t => t.status === k); return <li key={k}><span style={{ width: 90 }} className="small">{cfg(p).statusLabels[k]}</span><div className="sp"><Meter val={pts(ts)} max={mx} /></div><span className="small muted" style={{ width: 80, textAlign: 'right' }}>{plural(ts.length, 'ticket')}</span></li> })}</ul></section>
      <section className="panel"><h2>Open work by assignee</h2><ul className="list1">{[...p.members.map(m => [m.id, m.name] as [string | null, string]), [null, 'Unassigned'] as [string | null, string]].map(([id, nm]) => { const ts = tickets(p).filter(t => !isDone(t) && t.status !== 'triage' && (t.assignee || null) === id); return ts.length ? <li key={id || 'none'}><AvatarId p={p} id={id} /><span className="small" style={{ width: 110 }}>{nm}</span><div className="sp"><Meter val={pts(ts)} max={mx} /></div><span className="small muted" style={{ width: 80, textAlign: 'right' }}>{pts(ts)} pts</span></li> : null })}</ul></section>
    </div>
  </>;
}

export function Flow({ p }: { p: Project }) {
  const scope = useUI(s => s.f.mcScope), setF = useUI(s => s.setF);
  const f = flowStats(p), c = cfdData(p, 56), pa = bugPareto(p), n = f.ct.length, fx = (v: number) => (+v).toFixed(1);
  const sc = scopeTickets(p, scope), open = sc.ts.filter(t => !isDone(t)), mc = monteCarlo(open.length, f.daily);
  const todoC = 'color-mix(in srgb,var(--accent) 28%,var(--panel))';
  let read: string, rcls: string;
  if (n < 5) { read = 'Fewer than 5 data points: treat these limits as provisional.'; rcls = 'warn' }
  else if (f.out.length) { read = `${plural(f.out.length, 'ticket')} above the upper limit: special-cause variation worth a 5 Whys.`; rcls = 'bad' }
  else if (f.shifts.length) { read = '8 or more points in a row on one side of the mean: the process has shifted.'; rcls = 'warn' }
  else { read = 'Only common-cause variation: the process is stable. Improve it by changing the system, not by chasing single tickets.'; rcls = 'ok' }
  const opts: [string, string][] = [['all', 'All open work'], ...p.epics.map(e => ['e:' + e.id, 'Epic: ' + e.title] as [string, string]), ...p.milestones.map(m => ['m:' + m.id, 'Milestone: ' + m.title] as [string, string])];
  let mcBody;
  if (!open.length) mcBody = <p className="muted">Nothing is open in this scope.</p>;
  else if (!mc) mcBody = <p className="muted">Finish some tickets first. The simulation samples daily throughput from the last 6 weeks.</p>;
  else {
    const hit = sc.target ? Math.round(mc.days.filter(d => addDays(TODAY, d) <= sc.target!).length / mc.days.length * 100) : null;
    const lo = mc.days[0], hi = mc.days[mc.days.length - 1], bw = Math.max(1, Math.ceil((hi - lo + 1) / 12)), bk: { s: number; c: number }[] = [];
    for (let s = lo; s <= hi; s += bw) bk.push({ s, c: mc.days.filter(d => d >= s && d < s + bw).length });
    mcBody = <>
      <div className="tiles" style={{ margin: '0 0 8px' }}>{([[50, mc.p50], [85, mc.p85], [95, mc.p95]] as [number, number][]).map(([q, d]) => <Tile key={q} v={fmtD(addDays(TODAY, d))} label={`${q}% likely done by`} />)}{hit != null && <Tile v={hit + '%'} label={`chance of finishing by ${fmtD(sc.target)}`} color={hit >= 85 ? 'var(--ok)' : hit >= 50 ? 'var(--warn)' : 'var(--bad)'} />}</div>
      <BarChart h={190} groups={bk.map(b => ({ label: fmtD(addDays(TODAY, b.s)), vals: [{ v: b.c, color: 'var(--accent)', name: 'runs' }] }))} ymax={Math.max(...bk.map(b => b.c), 1)} />
      <p className="small muted">{plural(open.length, 'open item')} in {sc.label.toLowerCase() === 'all work' ? 'all open work' : sc.label}, 2,000 simulated futures. Each run replays random days from the last 6 weeks, when the team finished {plural(f.daily.reduce((a, b) => a + b, 0), 'item')}.</p>
    </>;
  }
  return <>
    <Head title="Flow metrics" desc="Lean and Six Sigma views of how work moves: cumulative flow, a cycle-time control chart with process capability, aging work, a defect Pareto, and a Monte Carlo forecast.">
      <label className="small muted checklabel">Target cycle time (days) <input className="numin" type="number" min={0} value={f.usl || ''} placeholder="none" aria-label="Target cycle time in days" onChange={e => mutP(p.id, 'Set target cycle time', d => { d.settings.usl = Math.max(0, Math.round(+e.target.value || 0)) }, { coalesce: 'usl' })} /></label>
      <label className="small muted checklabel">History <select className="selectlike" value={f.window} onChange={e => mutP(p.id, 'Change flow window', d => { d.settings.flowWindow = +e.target.value })} aria-label="History window">{[30, 60, 90, 180, 365].map(d => <option key={d} value={d}>{d} days</option>)}</select></label>
    </Head>
    <div className="tiles"><Tile v={f.wip.length} label="items in progress or review now" /><Tile v={fx(f.thrDay * 7)} label="items finished per week, last 6 weeks" /><Tile v={n ? f.p50 + ' / ' + f.p85 : '—'} label="cycle time in days, 50th / 85th percentile" /><Tile v={f.leadAvg ? fx(f.leadAvg) : '—'} label="average lead time in days, created to done" /><Tile v={f.leadAvg && f.ctAvg ? Math.round(f.ctAvg / f.leadAvg * 100) + '%' : '—'} label="of lead time spent in progress (the rest is queue)" /><Tile v={f.little ? fx(f.little) : '—'} label="days per item implied by current WIP (Little’s Law)" /></div>
    <div className="grid2 flowgrid">
      <section className="panel"><h2>Cumulative flow, last 8 weeks</h2><AreaChart labels={c.days.map(fmtD)} layers={[{ name: 'Done', color: 'var(--ok)', vals: c.L.done }, { name: 'In progress', color: 'var(--accent)', vals: c.L.prog }, { name: 'To do', color: todoC, vals: c.L.todo }]} /><Legend items={[[todoC, 'To do'], ['var(--accent)', 'In progress'], ['var(--ok)', 'Done']]} /><p className="small muted">A widening blue band means work is piling up in progress; a flat green band means nothing is finishing.</p></section>
      <section className="panel"><h2>Cycle time control chart (XmR)</h2>{n >= 2 ? <><ControlChart pts={f.done.map((t, i) => ({ v: f.ct[i], label: fmtD(t.doneAt), id: t.id, key: t.key, bad: f.out.includes(i) }))} st={f.x} usl={f.usl} onPick={openTicket} /><Legend items={[['var(--accent)', 'Cycle time per ticket (click to open)'], ['var(--bad)', 'Control limits (mean ± 3σ)', true], ...(f.usl ? [['var(--warn)', 'Target', true] as [string, string, boolean]] : [])]} /></> : <p className="muted">Finish at least two tickets that went through In progress to draw the control chart.</p>}</section>
      <section className="panel"><h2>Process capability</h2>
        <dl className="statlist"><dt>Sample</dt><dd>{plural(n, 'ticket')}, last {f.window} days</dd><dt>Mean cycle time</dt><dd>{n ? fx(f.x.m) + ' days' : '—'}</dd><dt>Sigma (moving range)</dt><dd>{n > 1 ? fx(f.x.sig) + ' days' : '—'}</dd><dt>Control limits</dt><dd>{n > 1 ? `${fx(f.x.lcl)} to ${fx(f.x.ucl)} days` : '—'}</dd><dt>Target (upper spec)</dt><dd>{f.usl ? f.usl + ' days' : 'Not set'}</dd><dt>Cpk</dt><dd>{f.cpk == null ? '—' : f.cpk.toFixed(2)}</dd><dt>Sigma level, short term</dt><dd>{f.cpk == null ? '—' : (3 * f.cpk).toFixed(1) + 'σ'}</dd><dt>Over target</dt><dd>{f.dpmo == null ? '—' : `${f.over} of ${n} (${f.dpmo.toLocaleString()} DPMO)`}</dd></dl>
        <p className={`signal ${rcls}`}>{read}</p>
        {f.cpk != null && <p className="small muted" style={{ marginTop: 8 }}>Cpk {f.cpk < 1 ? 'below 1 means the process can’t reliably meet the target.' : f.cpk < 1.33 ? 'between 1 and 1.33 is marginal.' : 'of 1.33 or more is capable.'} Cpk uses the upper limit only, because shorter is always fine.</p>}
      </section>
      <section className="panel"><h2>Aging work in progress</h2>{f.aging.length ? <><ul className="list1">{f.aging.slice(0, 8).map(x => { const old = f.p85 > 0 && x.age > f.p85; return <li key={x.t.id}><span className="key">{x.t.key}</span><div className="sp"><div className="small rowsplit"><button className="link" onClick={() => openTicket(x.t.id)}>{x.t.title}</button><span className={old ? 'badtext' : 'muted'}>{plural(x.age, 'day')}</span></div><Meter val={x.age} max={Math.max(f.p85 || x.age, 1)} /></div><AvatarId p={p} id={x.t.assignee} /></li> })}</ul><p className="small muted" style={{ marginTop: 8 }}>{f.p85 ? `Bars fill at ${f.p85} days, the 85th percentile cycle time. Red means older than 85% of recently finished tickets.` : 'Finish a few tickets to calibrate these bars.'}</p></> : <p className="muted">Nothing is in progress.</p>}</section>
      <section className="panel"><h2>Defect Pareto</h2>{pa.rows.length ? <><ParetoChart rows={pa.rows} /><p className="small muted">{plural(pa.n, 'bug')} reported in the last 6 months, grouped by label (or epic when unlabeled). Dark bars are the “vital few” that make up the first 80%.</p></> : <p className="muted">No bugs reported in the last 6 months.</p>}</section>
      <section className="panel"><div className="phead"><h2>Monte Carlo forecast</h2><select className="selectlike" value={scope} onChange={e => setF({ mcScope: e.target.value })} aria-label="Forecast scope">{opts.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></div>{mcBody}</section>
    </div>
  </>;
}
