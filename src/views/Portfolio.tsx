import { TODAY, addDays, fmtD, plural } from '../lib/dates';
import { activeSprint, attentionItems, implProgress, isDone, memberAvail, msStatus, projectHealth, pts, sprintPulse, sprintTickets, tickets, velocity } from '../model/selectors';
import { useData } from '../model/store';
import type { Project } from '../model/types';
import { go } from '../model/ui';
import { Avatar, Btn, Chip, Head, Meter, Tile } from '../components/ui';
import { openNewProject } from '../components/forms';

function summary(p: Project) {
  const a = activeSprint(p), [hc, hl] = projectHealth(p), all = tickets(p).filter(t => t.status !== 'triage'), tot = pts(all), dn = pts(all.filter(isDone));
  const ms = [...p.milestones].sort((x, y) => (x.date < y.date ? -1 : 1)).map(m => ({ m, r: msStatus(p, m) }));
  return {
    p, hc, hl, pct: tot ? Math.round(dn / tot * 100) : 0, tot, a, pulse: a ? sprintPulse(p, a) : null, ms, next: ms.find(x => x.m.date >= TODAY && x.r.st !== 'Complete') || null,
    att: attentionItems(p), crit: tickets(p).filter(t => t.type === 'bug' && t.severity === 'critical' && !isDone(t)).length, open: tickets(p).filter(t => !isDone(t) && t.status !== 'triage').length,
    vel: velocity(p), impl: implProgress(p), team: p.members.map(m => ({ name: m.name, role: m.role, color: m.color, as: a ? pts(sprintTickets(p, a.id).filter(t => t.assignee === m.id)) : 0, c: a ? memberAvail(m, a) : 0 })),
  };
}

export function Portfolio() {
  const ws = useData(s => s.ws);
  const ps = Object.values(ws.projects).sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)) || a.name.localeCompare(b.name));
  if (!ps.length) return <Welcome />;
  const sums = ps.map(summary), cnt = (c: string) => sums.filter(s => s.hc === c).length;
  const up = sums.flatMap(s => s.ms.filter(x => x.r.st !== 'Complete' && x.m.date <= addDays(TODAY, 120)).map(x => ({ ...x, s }))).sort((a, b) => (a.m.date < b.m.date ? -1 : 1));
  const people: Record<string, { name: string; color: string; as: number; c: number; keys: string[] }> = {};
  sums.forEach(s => s.team.forEach(m => { const k = m.name.trim().toLowerCase(), e = (people[k] = people[k] || { name: m.name, color: m.color, as: 0, c: 0, keys: [] }); e.as += m.as; e.c += m.c; e.keys.push(s.p.key) }));
  const pl = Object.values(people).sort((a, b) => b.keys.length - a.keys.length || (b.c ? b.as / b.c : 0) - (a.c ? a.as / a.c : 0));
  return <>
    <Head title="All projects" desc="Every project you’re tracking, side by side. Health combines each project’s milestone forecasts with its current sprint’s pace."><Btn variant="pri" onClick={openNewProject}>New project</Btn></Head>
    <div className="tiles"><Tile v={ps.length} label="projects" /><Tile v={cnt('ok')} label="on track" color="var(--ok)" /><Tile v={cnt('warn')} label="at risk" color="var(--warn)" /><Tile v={cnt('bad')} label="off track" color="var(--bad)" /><Tile v={sums.reduce((a, s) => a + s.open, 0)} label="open tickets across projects" /><Tile v={sums.reduce((a, s) => a + s.crit, 0)} label="critical bugs open" /></div>
    <div className="pgrid">{sums.map(s => <section className="panel pcard" key={s.p.id}>
      <div className="phead"><div><span className="key">{s.p.key}</span><h2><button className="link" onClick={() => go('dashboard', s.p.id)}>{s.p.name}</button></h2></div><Chip cls={s.hc}>{s.hl}</Chip></div>
      {s.p.desc && <p className="small muted pdesc">{s.p.desc}</p>}
      <div className="small rowsplit" style={{ marginTop: 10 }}><span>{s.pct}% complete</span><span className="muted">{s.tot} pts total</span></div><Meter val={s.pct} max={100} />
      <dl className="pfacts">
        <dt>Sprint</dt><dd>{s.a && s.pulse ? <>{s.a.name}, day {s.pulse.day} of {s.pulse.len} <Chip cls={s.pulse.cls}>{s.pulse.cls === 'ok' ? 'On pace' : s.pulse.cls === 'warn' ? 'Slightly behind' : 'Behind'}</Chip></> : <span className="muted">None running</span>}</dd>
        <dt>Next milestone</dt><dd>{s.next ? <>{s.next.m.title}, {fmtD(s.next.m.date)} <Chip cls={s.next.r.cls}>{s.next.r.st}</Chip></> : <span className="muted">None upcoming</span>}</dd>
        <dt>Open work</dt><dd>{plural(s.open, 'ticket')}{s.crit > 0 && <>, <span className="badtext">{s.crit} critical</span></>}</dd>
        <dt>Implementation</dt><dd>{s.impl.total ? `${s.impl.pct}% of ${plural(s.impl.total, 'task')}` : <span className="muted">No plan</span>}</dd>
        <dt>Needs attention</dt><dd>{s.att.length ? plural(s.att.length, 'item') : <span className="muted">Nothing</span>}</dd>
        <dt>Team</dt><dd className="pteam">{s.team.length ? s.team.map(m => <Avatar key={m.name} name={m.name} color={m.color} />) : <span className="muted">No one yet</span>}</dd>
      </dl>
      <Btn sm onClick={() => go('dashboard', s.p.id)}>Open project</Btn>
    </section>)}</div>
    <div className="grid2" style={{ marginTop: 16 }}>
      <section className="panel"><h2>Upcoming milestones</h2>{up.length ? <ul className="list1">{up.map(x => <li key={x.s.p.id + x.m.id}><span className="small" style={{ width: 56, fontWeight: 600 }}>{fmtD(x.m.date)}</span><div className="sp"><b>{x.m.title}</b><div className="small muted">{x.s.p.name}{x.r.f.date ? `, forecast ${fmtD(x.r.f.date)}` : ''}</div></div><Chip cls={x.r.cls}>{x.r.st}</Chip></li>)}</ul> : <p className="muted">No milestones in the next four months.</p>}</section>
      <section className="panel"><h2>People across projects</h2><p className="small muted" style={{ marginTop: 4 }}>Teammates are matched by name. Load counts only sprints that are running now.</p>{pl.length ? <ul className="list1">{pl.map(m => <li key={m.name}><Avatar name={m.name} color={m.color} /><div className="sp"><div className="small rowsplit"><span><b>{m.name}</b> {m.keys.map(k => <Chip key={k}>{k}</Chip>)}</span><span className="muted">{m.c ? `${m.as} / ${m.c} pts` : 'No active sprint'}</span></div>{m.c > 0 && <Meter val={m.as} max={m.c} />}</div></li>)}</ul> : <p className="muted">No teammates added yet.</p>}</section>
    </div>
  </>;
}

export function Welcome() {
  const feats: [string, string][] = [
    ['Roadmap and milestones', 'Epics over time, with each milestone forecast from real velocity.'],
    ['Backlog and sprint planning', 'Rank by dragging, bulk-edit, and size the sprint against capacity net of time off.'],
    ['Sprint board', 'Kanban columns with configurable WIP limits and blocked-ticket flags.'],
    ['Burndown', 'Sprint burndown with scope and projection, release burnup, and burndown by sprint.'],
    ['Timeline', 'A draggable Gantt with critical path, baselines, and dependency conflict detection.'],
    ['Implementation plan', 'PM tasks by phase with owners, due dates, and checklists, from templates or scratch.'],
    ['Retrospectives', 'Went well, to improve, and action items that become backlog tickets.'],
    ['Flow metrics', 'Cumulative flow, a control chart with Cpk, defect Pareto, and Monte Carlo forecasts.'],
    ['Coaches', 'Scrum Master, Agile Coach, and Lean Six Sigma checks, with optional Claude chat.'],
  ];
  return <section className="panel welcome">
    <p className="small muted">Welcome to Throughline</p>
    <h1>Plan the work. See the path to launch.</h1>
    <p className="lead">Throughline keeps the roadmap, the sprint, the rollout plan, and delivery health in one place, so you can tell early whether a milestone is still reachable.</p>
    <div className="row"><Btn variant="pri" lg onClick={openNewProject}>Create your first project</Btn></div>
    <ul className="wfeat">{feats.map(([b, s]) => <li key={b}><b>{b}</b><span>{s}</span></li>)}</ul>
    <p className="small muted fine">Projects are stored in this browser. If configured, sprint dates and the selected Finance project are sent to your Burnrate Finance endpoint to retrieve spending. Coach chats send project context to Anthropic when connected with your own key.</p>
  </section>;
}
