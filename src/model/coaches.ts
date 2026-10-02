import type { Cls, Project, Ticket } from './types';
import { TODAY, addDays, diff, fmtD, fmtDY, lastWorkday, plural } from '../lib/dates';
import { activeSprint, blockers, byId, epicProgress, isDone, memberAvail, msStatus, pts, sayDo, sortedSprints, sprintPulse, sprintTickets, tickets, velocity, byRank, implProgress } from './selectors';
import { cfg } from './constants';
import { bugPareto, flowStats, mean, pctl } from './flow';

export type CoachKind = 'scrum' | 'agile' | 'lss';
export type FAction = { label: string } & ({ kind: 'go'; view: string } | { kind: 'ticket' | 'sprint' | 'epic'; id: string } | { kind: 'new-member' });
export interface Finding { id: string; cls: Cls; t: string; d?: string; fix?: string; a?: FAction | null }

/** Every rule-based check, so users can switch individual ones off in Settings. */
export const CHECKS: { id: string; agent: CoachKind; label: string }[] = [
  { id: 'no-sprint', agent: 'scrum', label: 'No sprint running' },
  { id: 'no-goal', agent: 'scrum', label: 'Active sprint has no goal' },
  { id: 'burndown', agent: 'scrum', label: 'Burndown behind the ideal line' },
  { id: 'scope-creep', agent: 'scrum', label: 'Scope added mid-sprint' },
  { id: 'over-velocity', agent: 'scrum', label: 'Commitment above recent velocity' },
  { id: 'impediment', agent: 'scrum', label: 'Blocked sprint tickets' },
  { id: 'wip', agent: 'scrum', label: 'Too many tickets in progress' },
  { id: 'no-owner', agent: 'scrum', label: 'In-progress tickets with no owner' },
  { id: 'stale', agent: 'scrum', label: 'Tickets stuck in progress' },
  { id: 'overbooked', agent: 'scrum', label: 'Overbooked teammates' },
  { id: 'no-retro', agent: 'scrum', label: 'Last sprint has no retrospective' },
  { id: 'retro-actions', agent: 'scrum', label: 'Open retro action items' },
  { id: 'say-do', agent: 'scrum', label: 'Low say/do ratio' },
  { id: 'cadence', agent: 'scrum', label: 'Inconsistent sprint lengths' },
  { id: 'no-team', agent: 'agile', label: 'No teammates set up' },
  { id: 'unestimated', agent: 'agile', label: 'Items without estimates' },
  { id: 'oversized', agent: 'agile', label: 'Oversized items' },
  { id: 'no-desc', agent: 'agile', label: 'Top backlog items without descriptions' },
  { id: 'ready-depth', agent: 'agile', label: 'Not enough ready work' },
  { id: 'backlog-depth', agent: 'agile', label: 'Backlog too deep' },
  { id: 'volatile', agent: 'agile', label: 'Volatile velocity' },
  { id: 'say-do-agile', agent: 'agile', label: 'Low say/do ratio' },
  { id: 'old-triage', agent: 'agile', label: 'Items stuck in triage' },
  { id: 'votes', agent: 'agile', label: 'Popular requests ranked low' },
  { id: 'bug-share', agent: 'agile', label: 'Bugs crowding out new work' },
  { id: 'epic-late', agent: 'agile', label: 'Epics past their end date' },
  { id: 'epic-no-ms', agent: 'agile', label: 'Epics not linked to a milestone' },
  { id: 'impl-late', agent: 'agile', label: 'Implementation plan behind schedule' },
  { id: 'few-points', agent: 'lss', label: 'Not enough history for statistics' },
  { id: 'special-cause', agent: 'lss', label: 'Points above the control limit' },
  { id: 'shift', agent: 'lss', label: 'Process shift' },
  { id: 'capability', agent: 'lss', label: 'Process capability (Cpk)' },
  { id: 'aging', agent: 'lss', label: 'Aging work in progress' },
  { id: 'littles-law', agent: 'lss', label: 'Too much WIP (Little’s Law)' },
  { id: 'pareto', agent: 'lss', label: 'One category dominates bugs' },
  { id: 'defect-rate', agent: 'lss', label: 'High defect rate' },
  { id: 'waiting', agent: 'lss', label: 'Blocked work (waiting waste)' },
  { id: 'queue', agent: 'lss', label: 'Work waits long before starting' },
];

const SEVR: Record<string, number> = { bad: 0, warn: 1, '': 2, ok: 3 };
function finder(p: Project) {
  const off = new Set(cfg(p).coach.disabled), out: Finding[] = [];
  return {
    F: (id: string, cls: Cls, t: string, d?: string, fix?: string, a?: FAction | null) => { if (!off.has(id)) out.push({ id, cls, t, d, fix, a }) },
    done: (ok: string) => {
      if (!out.some(f => f.cls === 'bad' || f.cls === 'warn')) out.push({ id: 'all-clear', cls: 'ok', t: ok });
      return out.sort((x, y) => SEVR[x.cls] - SEVR[y.cls]);
    },
  };
}
export const notReady = (p: Project, t: Ticket) => [
  !(+t.points) && 'Needs an estimate',
  !String(t.desc || '').trim() && 'Needs acceptance criteria',
  +t.points >= cfg(p).coach.bigPoints && 'Too big: split it',
  blockers(p, t).length > 0 && 'Blocked',
].filter(Boolean) as string[];

export function scrumFindings(p: Project): Finding[] {
  const { F, done } = finder(p), a = activeSprint(p), v = velocity(p), f = flowStats(p), c = cfg(p).coach;
  if (!a) {
    const nx = sortedSprints(p).find(s => s.status === 'planned');
    F('no-sprint', 'warn', 'No sprint is running', nx ? `${nx.name} is planned with ${plural(pts(sprintTickets(p, nx.id)), 'point')}.` : 'There’s no planned sprint either.', 'Hold sprint planning: agree a sprint goal, pull work that serves it, then start the sprint.', { kind: 'go', view: 'planning', label: 'Sprint planning' });
  } else {
    const pl = sprintPulse(p, a), ts = sprintTickets(p, a.id);
    if (!String(a.goal || '').trim()) F('no-goal', 'warn', `${a.name} has no sprint goal`, 'Without a goal the team optimizes for tickets instead of an outcome.', 'Write a one-sentence goal that the whole sprint backlog serves.', { kind: 'sprint', id: a.id, label: 'Set goal' });
    if (pl.cls !== 'ok') F('burndown', pl.cls, 'The burndown is behind', pl.sig, 'Swarm on the highest-ranked unfinished work, and agree with the Product Owner what can drop if the goal is at risk.', { kind: 'go', view: 'burndown', label: 'Burndown' });
    if (pl.total > pl.committed) F('scope-creep', 'warn', `Scope grew by ${plural(pl.total - pl.committed, 'point')} mid-sprint`, `Committed ${pl.committed}, now ${pl.total}.`, 'New work mid-sprint should go through the Product Owner and swap out work of the same size.', { kind: 'go', view: 'backlog', label: 'Backlog' });
    if (v && pl.committed > v * 1.15) F('over-velocity', 'warn', 'The commitment is above recent velocity', `Committed ${pl.committed} points against an average of ${v}.`, 'Plan to velocity next sprint, or make the stretch explicit in the goal.', null);
    ts.filter(t => !isDone(t) && blockers(p, t).length).slice(0, 4).forEach(t => F('impediment', 'bad', `Impediment: ${t.key} is blocked`, `${t.title}. Waiting on ${blockers(p, t).map(b => b.key + ' (' + cfg(p).statusLabels[b.status] + ')').join(', ')}.`, 'Raise it at standup today and name someone to clear the blocker.', { kind: 'ticket', id: t.id, label: 'Open' }));
    const wip = ts.filter(t => t.status === 'inprogress').length, lim = cfg(p).wipLimits.inprogress || p.members.length;
    if (lim && wip > lim) F('wip', 'warn', `${plural(wip, 'ticket')} in progress against a limit of ${lim}`, 'More work has been started than the team can finish.', 'Stop starting, start finishing: pair or swarm before pulling new tickets.', { kind: 'go', view: 'board', label: 'Sprint board' });
    ts.filter(t => t.status === 'inprogress' && !t.assignee).slice(0, 3).forEach(t => F('no-owner', 'warn', `${t.key} is in progress with no owner`, t.title, 'Ask who is working on it and assign them, so standup and the board stay truthful.', { kind: 'ticket', id: t.id, label: 'Open' }));
    ts.filter(t => (t.status === 'inprogress' || t.status === 'review') && t.startedAt).map(t => ({ t, age: diff(t.startedAt!, TODAY) + 1 })).filter(x => x.age > Math.max(c.staleDays, f.p85 || 0)).slice(0, 3)
      .forEach(x => F('stale', 'warn', `${x.t.key} has been ${x.t.status === 'review' ? 'in review' : 'in progress'} for ${plural(x.age, 'day')}`, x.t.title, 'Ask what it needs to finish at the next standup; consider splitting it.', { kind: 'ticket', id: x.t.id, label: 'Open' }));
    p.members.forEach(m => { const as = pts(ts.filter(t => t.assignee === m.id)), cap = memberAvail(m, a); if (as > cap) F('overbooked', 'warn', `${m.name} is overbooked`, `${as} points assigned, ${cap} available this sprint.`, 'Rebalance at standup or move lower-ranked work out of the sprint.', { kind: 'go', view: 'planning', label: 'Sprint planning' }) });
  }
  const lc = sortedSprints(p).filter(s => s.status === 'closed').slice(-1)[0], lr = lc && p.retros.find(r => r.sprintId === lc.id);
  if (lc && !(lr && (lr.well.length || lr.improve.length || lr.actions.length))) F('no-retro', 'warn', `No retrospective recorded for ${lc.name}`, 'Skipping the retro removes the team’s main chance to improve how it works.', 'Run a short retro and capture one or two action items.', { kind: 'go', view: 'retro', label: 'Retrospectives' });
  const openA = p.retros.flatMap(r => r.actions).filter(x => !x.done && !(x.ticketId && p.tickets[x.ticketId] && isDone(p.tickets[x.ticketId])));
  if (openA.length) F('retro-actions', '', `${plural(openA.length, 'retro action item')} still open`, openA.slice(0, 3).map(x => x.text).join('; ') + (openA.length > 3 ? '…' : ''), 'Review these at the start of the next retro, and turn any without an owner into tickets.', { kind: 'go', view: 'retro', label: 'Retrospectives' });
  const sd = sayDo(p);
  if (sd != null && sd < c.sayDoMin) F('say-do', 'warn', `Say/do ratio is ${sd}% over the last 3 sprints`, 'The team regularly finishes well short of its commitment.', 'Commit to recent velocity and protect the sprint from unplanned work.', { kind: 'go', view: 'reports', label: 'Reports' });
  const lens = [...new Set(sortedSprints(p).filter(s => s.status === 'closed').slice(-5).map(s => diff(s.start, s.end) + 1))];
  if (lens.length > 1) F('cadence', '', `Sprint lengths vary (${lens.map(n => n + ' days').join(', ')})`, 'Velocity is only comparable between sprints of the same length.', 'Keep a fixed cadence.', null);
  return done('No Scrum issues found: the sprint has a goal, is on pace, and nothing is blocked.');
}

export function agileFindings(p: Project): Finding[] {
  const { F, done } = finder(p), c = cfg(p).coach, open = tickets(p).filter(t => !isDone(t) && t.status !== 'triage'), bl = open.filter(t => !t.sprintId).sort(byRank), v = velocity(p);
  if (!p.members.length) F('no-team', 'warn', 'No teammates set up', 'Capacity, planning, and forecasts all depend on the team.', 'Add teammates and the points each typically finishes per sprint.', { kind: 'new-member', label: 'Add teammate' });
  const une = open.filter(t => !(+t.points) && t.type !== 'bug');
  if (une.length) F('unestimated', 'warn', `${plural(une.length, 'item')} without an estimate`, une.slice(0, 6).map(t => t.key).join(', ') + (une.length > 6 ? '…' : ''), 'Estimate them in refinement so forecasts and sprint planning reflect all the work.', { kind: 'go', view: 'backlog', label: 'Backlog' });
  open.filter(t => +t.points >= c.bigPoints).slice(0, 3).forEach(t => F('oversized', 'warn', `${t.key} is ${t.points} points`, t.title, 'Split it by workflow step, data variation, or acceptance criterion so each piece fits in a few days (INVEST: Small).', { kind: 'ticket', id: t.id, label: 'Open' }));
  const nod = bl.slice(0, 10).filter(t => !String(t.desc || '').trim());
  if (nod.length) F('no-desc', 'warn', `${plural(nod.length, 'top backlog item')} with no description`, nod.map(t => t.key).join(', '), 'Add acceptance criteria before planning; without them an item fails the INVEST “Testable” check.', { kind: 'ticket', id: nod[0].id, label: 'Open the first' });
  if (v) {
    const ready = pts(bl.filter(t => !notReady(p, t).length));
    if (ready < v * c.readySprints) F('ready-depth', 'warn', `Less than ${plural(c.readySprints, 'sprint')} of ready work`, `${ready} ready points in the backlog against a velocity of ${v}.`, 'Hold a refinement session to get enough work estimated, described, and small enough.', { kind: 'go', view: 'backlog', label: 'Backlog' });
    const depth = pts(bl) / v;
    if (depth > 8) F('backlog-depth', '', `The backlog holds about ${Math.round(depth)} sprints of work`, `${pts(bl)} points against a velocity of ${v}.`, 'Prune items you won’t reach this quarter; a long backlog hides priorities.', { kind: 'go', view: 'backlog', label: 'Backlog' });
  }
  const cl = sortedSprints(p).filter(s => s.status === 'closed').slice(-6).map(s => +s.completed! || 0);
  if (cl.length >= 3) { const m = mean(cl), cv = m ? Math.sqrt(mean(cl.map(x => (x - m) ** 2))) / m : 0; if (cv > .3) F('volatile', 'warn', 'Velocity is volatile', `Last ${cl.length} sprints: ${cl.join(', ')} points (${Math.round(cv * 100)}% variation).`, 'Forecasts built on an average will be unreliable. Look for unplanned work, changes in team size, or inconsistent estimates.', { kind: 'go', view: 'reports', label: 'Reports' }) }
  const sd = sayDo(p);
  if (sd != null && sd < c.sayDoMin) F('say-do-agile', 'warn', `Say/do ratio is ${sd}%`, 'Recent sprints finished well short of their commitment.', 'Commit to recent velocity and keep a buffer for unplanned work.', { kind: 'go', view: 'planning', label: 'Sprint planning' });
  const oldTri = tickets(p).filter(t => t.status === 'triage' && t.createdAt && diff(t.createdAt, TODAY) > 7);
  if (oldTri.length) F('old-triage', 'warn', `${plural(oldTri.length, 'item')} in triage for over a week`, oldTri.slice(0, 6).map(t => t.key).join(', '), 'Triage at least weekly: accept, reject, or merge each item.', { kind: 'go', view: 'tickets', label: 'Bugs & requests' });
  const top = bl.slice(0, 10).map(t => t.id);
  tickets(p).filter(t => t.type === 'feature' && !isDone(t) && (+t.votes || 0) >= 5 && !top.includes(t.id)).sort((a, b) => b.votes - a.votes).slice(0, 3)
    .forEach(t => F('votes', '', `${t.key} has ${t.votes} votes but isn’t near the top of the backlog`, t.title, 'Check whether its value justifies moving it up. WSJF (cost of delay ÷ job size) helps compare it fairly.', { kind: 'ticket', id: t.id, label: 'Open' }));
  const bugP = pts(open.filter(t => t.type === 'bug')), allP = pts(open);
  if (allP && bugP / allP > .3) F('bug-share', 'warn', `Bugs are ${Math.round(bugP / allP * 100)}% of open work`, `${bugP} of ${allP} open points.`, 'Quality debt is crowding out new value. Reserve capacity for defects and tighten the definition of done.', { kind: 'go', view: 'tickets', label: 'Bugs & requests' });
  p.epics.forEach(e => { const x = epicProgress(p, e); if (e.end < TODAY && x.tot && x.done < x.tot) F('epic-late', 'bad', `Epic “${e.title}” is past its end date`, `${x.pct}% done; it was due to end ${fmtD(e.end)}.`, 'Re-plan it: cut scope or move the date, and tell stakeholders.', { kind: 'epic', id: e.id, label: 'Edit epic' }) });
  if (p.milestones.length) { const nm = p.epics.filter(e => !e.milestoneId && epicProgress(p, e).pct < 100); if (nm.length) F('epic-no-ms', '', `${plural(nm.length, 'epic')} not linked to a milestone`, nm.map(e => e.title).join(', '), 'Link each epic to the milestone it serves so forecasts include it.', { kind: 'epic', id: nm[0].id, label: 'Edit epic' }) }
  const late = p.impl.tasks.filter(t => t.status !== 'done' && t.due && t.due < TODAY);
  if (late.length) F('impl-late', 'warn', `${plural(late.length, 'implementation task')} overdue`, late.slice(0, 4).map(t => t.title).join('; '), 'Re-plan the implementation timeline with the owners, or escalate the blockers.', { kind: 'go', view: 'implementation', label: 'Implementation' });
  return done('The backlog is healthy: estimated, described, and deep enough for the next sprints.');
}

export function lssFindings(p: Project): Finding[] {
  const { F, done } = finder(p), f = flowStats(p), pa = bugPareto(p);
  if (f.ct.length < 5) F('few-points', '', 'Not enough history for statistics yet', `${plural(f.ct.length, 'ticket')} finished in the last ${f.window} days with a start date.`, 'Control limits need about 5 points, and 20 or more makes them reliable. Keep moving tickets through In progress so start dates are captured.', { kind: 'go', view: 'flow', label: 'Flow metrics' });
  else {
    f.out.slice(-3).forEach(i => { const t = f.done[i]; F('special-cause', 'bad', `Special-cause variation: ${t.key} took ${plural(f.ct[i], 'day')}`, `Above the upper control limit of ${f.x.ucl.toFixed(1)} days. ${t.title}`, 'Investigate this item on its own (5 Whys): something unusual happened that the normal process doesn’t explain.', { kind: 'ticket', id: t.id, label: 'Open' }) });
    if (f.shifts.length) F('shift', 'warn', 'Process shift detected', '8 or more tickets in a row landed on the same side of the mean cycle time.', 'The process has changed. Find what changed (team, scope, tooling) and decide whether to lock it in or reverse it.', { kind: 'go', view: 'flow', label: 'Control chart' });
    if (!f.usl) F('capability', '', 'No target cycle time set', 'Capability (Cpk) needs a limit that matters to the customer.', 'Set a target cycle time on the Flow metrics page, such as the turnaround stakeholders expect.', { kind: 'go', view: 'flow', label: 'Set a target' });
    else if (f.cpk != null) F('capability', f.cpk < 1 ? 'bad' : f.cpk < 1.33 ? 'warn' : 'ok', `Process capability: Cpk ${f.cpk.toFixed(2)}`, `${f.over} of ${f.ct.length} tickets exceeded the ${f.usl}-day target (${(f.dpmo || 0).toLocaleString()} DPMO).`,
      f.cpk < 1 ? 'The process can’t reliably hit the target. Cut variation first (smaller tickets, WIP limits), then the average.' : f.cpk < 1.33 ? 'Marginal. Aim for 1.33 or better by reducing variation, not just speed.' : 'Capable against the target. Keep watching the control chart.', { kind: 'go', view: 'flow', label: 'Flow metrics' });
  }
  f.aging.filter(x => f.p85 && x.age > f.p85).slice(0, 3).forEach(x => F('aging', 'warn', `${x.t.key} has been ${x.t.status === 'review' ? 'in review' : 'in progress'} for ${plural(x.age, 'day')}`, `Longer than 85% of recent tickets took to finish (${f.p85} days).`, 'Swarm on it or split it; aging work is the earliest sign of a cycle-time outlier.', { kind: 'ticket', id: x.t.id, label: 'Open' }));
  if (f.little && f.p85 && f.little > f.p85) F('littles-law', 'warn', 'Too much work in progress', `${plural(f.wip.length, 'item')} in progress at ${(f.thrDay * 7).toFixed(1)} finished per week implies about ${Math.round(f.little)} days per item (Little’s Law).`, `Set a WIP limit of about ${plural(Math.max(1, Math.round(f.thrDay * (f.p50 || 1))), 'item')} to bring cycle time down.`, { kind: 'go', view: 'settings', label: 'Set WIP limits' });
  if (pa.rows.length >= 2 && pa.rows[0].v / pa.tot >= .4) F('pareto', 'warn', `Pareto: “${pa.rows[0].k}” accounts for ${Math.round(pa.rows[0].v / pa.tot * 100)}% of bugs`, `${plural(pa.rows[0].v, 'bug')} in the last 6 months.`, 'Focus root-cause work on this category first (fishbone, 5 Whys).', { kind: 'go', view: 'flow', label: 'Pareto' });
  const bugs6 = tickets(p).filter(t => t.type === 'bug' && t.createdAt >= addDays(TODAY, -42)).length, done6 = tickets(p).filter(t => isDone(t) && t.type !== 'bug' && !!t.doneAt && t.doneAt >= addDays(TODAY, -42)).length;
  if (done6 >= 3 && bugs6 / done6 > .3) F('defect-rate', 'warn', 'High defect rate', `${plural(bugs6, 'bug')} reported against ${plural(done6, 'item')} delivered in the last 6 weeks.`, 'Build quality in at the source: clearer acceptance criteria, pairing, and automated tests in the definition of done.', { kind: 'go', view: 'tickets', label: 'Bugs & requests' });
  const blk = tickets(p).filter(t => !isDone(t) && t.status !== 'triage' && blockers(p, t).length);
  if (blk.length) F('waiting', 'warn', `Waiting waste: ${plural(blk.length, 'ticket')} blocked`, blk.slice(0, 6).map(t => t.key).join(', '), 'Map these dependencies on the Timeline and sequence the blocking work first.', { kind: 'go', view: 'gantt', label: 'Timeline' });
  if (f.leadAvg && f.ctAvg && f.leadAvg / f.ctAvg > 3) F('queue', '', `Work waits about ${Math.round(f.leadAvg - f.ctAvg)} days before it starts`, `Lead time ${f.leadAvg.toFixed(1)} days vs. cycle time ${f.ctAvg.toFixed(1)} days.`, 'Most lead time is queue. Limit what enters the backlog, or pull smaller batches more often.', null);
  return done('The process looks stable and capable, with no waste signals in the data.');
}

export function wasteRows(p: Project): [string, string, string][] {
  const f = flowStats(p), a = activeSprint(p), open = tickets(p).filter(t => !isDone(t) && t.status !== 'triage'), v = velocity(p);
  const bugs = tickets(p).filter(t => t.type === 'bug' && !isDone(t)).length, blk = open.filter(t => blockers(p, t).length).length;
  const idle = a ? p.members.filter(m => !sprintTickets(p, a.id).some(t => t.assignee === m.id && !isDone(t))) : [];
  const jug = p.members.filter(m => tickets(p).filter(t => t.assignee === m.id && (t.status === 'inprogress' || t.status === 'review')).length >= 3);
  const rev = tickets(p).filter(t => t.status === 'review' && t.startedAt && f.p50 && diff(t.startedAt, TODAY) + 1 > f.p50);
  const depth = v ? pts(open.filter(t => !t.sprintId)) / v : null;
  return [
    ['Defects', plural(bugs, 'open bug'), bugs > 5 ? 'warn' : bugs ? '' : 'ok'],
    ['Overproduction', `${plural(f.wip.length, 'item')} started for ${plural(p.members.length, 'person')}`, p.members.length && f.wip.length > p.members.length * 1.5 ? 'warn' : 'ok'],
    ['Waiting', plural(blk, 'blocked ticket'), blk ? 'warn' : 'ok'],
    ['Non-utilized talent', a ? (idle.length ? `${idle.map(m => m.name).join(', ')} with nothing open in the sprint` : 'Everyone has open sprint work') : 'No sprint running', idle.length ? 'warn' : a ? 'ok' : 'na'],
    ['Transportation', 'Handoffs aren’t tracked in Throughline', 'na'],
    ['Inventory', depth == null ? 'Needs velocity history' : `${depth.toFixed(1)} sprints of backlog`, depth == null ? 'na' : depth > 6 ? 'warn' : 'ok'],
    ['Motion', jug.length ? `${jug.map(m => m.name).join(', ')} juggling 3+ active tickets` : 'No one is juggling 3+ active tickets', jug.length ? 'warn' : 'ok'],
    ['Extra processing', `${plural(rev.length, 'ticket')} in review longer than the median cycle time`, rev.length ? 'warn' : 'ok'],
  ];
}

export function sprintFacts(p: Project, sid: string) {
  const s = byId(p.sprints, sid)!, ts = sprintTickets(p, s.id), done = ts.filter(isDone), committed = +s.committed! || pts(ts), completed = s.status === 'closed' ? +s.completed! || 0 : pts(done);
  const cts = done.filter(t => t.startedAt && t.doneAt).map(t => diff(t.startedAt!, t.doneAt!) + 1);
  return {
    committed, completed, sayDo: committed ? Math.round(completed / committed * 100) : null, added: s.status === 'closed' ? 0 : pts(ts) - committed,
    bugs: tickets(p).filter(t => t.type === 'bug' && t.createdAt >= s.start && t.createdAt <= s.end).length, ct: cts.length ? mean(cts).toFixed(1) : null,
    blocked: ts.filter(t => !isDone(t) && blockers(p, t).length).length,
  };
}

export function standupText(p: Project) {
  const a = activeSprint(p), prev = lastWorkday(), L = [`Daily standup, ${fmtDY(TODAY)}`], li = (t: Ticket) => `${t.key} ${t.title}`;
  if (a) { const pl = sprintPulse(p, a); L.push(`${a.name}, day ${pl.day} of ${pl.len}: ${pl.done} of ${pl.total} points done. ${pl.sig}`); if (a.goal) L.push('Sprint goal: ' + a.goal) }
  [...p.members.map(m => [m.id, m.name] as [string | null, string]), [null, 'Unassigned'] as [string | null, string]].forEach(([id, name]) => {
    const mine = tickets(p).filter(t => (t.assignee || null) === id && t.status !== 'triage');
    const did = mine.filter(t => isDone(t) && !!t.doneAt && t.doneAt >= prev), doing = mine.filter(t => t.status === 'inprogress' || t.status === 'review'), blk = mine.filter(t => !isDone(t) && t.status !== 'backlog' && blockers(p, t).length);
    if (id === null && !did.length && !doing.length && !blk.length) return;
    L.push('', name + ':', '  Done since ' + fmtD(prev) + ': ' + (did.map(li).join('; ') || 'nothing recorded'), '  Working on: ' + (doing.map(t => li(t) + (t.status === 'review' ? ' (in review)' : '')).join('; ') || 'nothing in progress'));
    if (blk.length) L.push('  Blocked: ' + blk.map(t => `${t.key} waiting on ${blockers(p, t).map(b => b.key).join(', ')}`).join('; '));
  });
  if (!p.members.length) L.push('', 'Add teammates to get a per-person breakdown.');
  return L.join('\n');
}
export function reviewText(p: Project) {
  const s = activeSprint(p) || sortedSprints(p).filter(x => x.status === 'closed').slice(-1)[0];
  if (!s) return 'Start a sprint to prepare sprint review notes.';
  const f = sprintFacts(p, s.id), ts = sprintTickets(p, s.id), dn = ts.filter(isDone), op = ts.filter(t => !isDone(t)), lab = cfg(p).statusLabels;
  const L = [`Sprint review: ${s.name} (${fmtD(s.start)} to ${fmtD(s.end)})`, `Goal: ${s.goal || 'none set'}`, `Committed ${f.committed} points; ${s.status === 'closed' ? 'completed' : 'done so far'} ${f.completed}${f.sayDo != null ? ` (${f.sayDo}%)` : ''}.`, '', `Done (${dn.length}):`, ...dn.map(t => `  - ${t.key} ${t.title}`)];
  if (op.length) L.push('', `Not done yet (${op.length}):`, ...op.map(t => `  - ${t.key} ${t.title} [${lab[t.status]}]`));
  const ms = [...p.milestones].sort((a, b) => (a.date < b.date ? -1 : 1)).find(m => m.date >= TODAY);
  if (ms) { const r = msStatus(p, ms); L.push('', `Next milestone: ${ms.title}, ${fmtD(ms.date)}. ${r.st}${r.f.date ? `, forecast ${fmtD(r.f.date)}` : ''}.`) }
  L.push('', `Velocity, last 3 sprints: ${velocity(p) || 'not enough history'}.`, '', 'Questions for stakeholders:', '  - Does what we built move you toward the outcome you care about?', '  - What should change at the top of the backlog?');
  return L.join('\n');
}
export function dmaicText(p: Project) {
  const f = flowStats(p), pa = bugPareto(p), n = f.ct.length, fx = (v: number) => (n ? (+v).toFixed(1) : '—');
  const wip = plural(Math.max(1, Math.round(f.thrDay * (f.p50 || 1))), 'item');
  return [`DMAIC project charter: ${p.name} delivery cycle time`, `Drafted ${fmtDY(TODAY)} from Throughline data (last ${f.window} days)`, '',
    'DEFINE', `Problem: tickets take a mean of ${fx(f.x.m)} days from start to done (85th percentile ${n ? f.p85 : '—'} days)${f.usl ? `, against a target of ${f.usl} days; ${f.over} of ${n} exceeded it` : ''}.`,
    `Goal: ${f.usl ? `Cpk of 1.33 or better against the ${f.usl}-day target` : 'set a target cycle time, then reach a Cpk of 1.33 against it'} within three sprints, with no points above the upper control limit.`,
    `Scope: work in ${p.name} from In progress to Done. Out of scope: intake and triage time.`, 'CTQ: cycle time per ticket (days, start to done).', `Team: ${p.members.map(m => m.name + (m.role ? ' (' + m.role + ')' : '')).join(', ') || 'add teammates'}`, '',
    'MEASURE', `Sample: ${plural(n, 'ticket')} finished in the last ${f.window} days.`, `Mean ${fx(f.x.m)} days, sigma (moving range) ${fx(f.x.sig)}, UCL ${fx(f.x.ucl)}, LCL ${fx(f.x.lcl)}.`,
    `Capability: ${f.cpk == null ? 'not computed (no target set, or too little data)' : `Cpk ${f.cpk.toFixed(2)}, about ${(3 * f.cpk).toFixed(1)} sigma short term, ${(f.dpmo || 0).toLocaleString()} DPMO observed`}.`, `Throughput ${(f.thrDay * 7).toFixed(1)} items per week; ${f.wip.length} items in progress now.`, '',
    'ANALYZE', `Special causes: ${f.out.length ? f.out.map(i => f.done[i].key + ' (' + f.ct[i] + 'd)').join(', ') : 'none above the UCL'}.`, `Defect Pareto: ${pa.rows.length ? pa.rows.slice(0, 3).map(r => `${r.k} (${r.v})`).join(', ') : 'no bugs recorded'}.`,
    `Aging work: ${f.aging.filter(x => f.p85 && x.age > f.p85).map(x => x.t.key + ' (' + x.age + 'd)').join(', ') || 'none past the 85th percentile'}.`, `Waiting: ${plural(tickets(p).filter(t => !isDone(t) && blockers(p, t).length).length, 'blocked ticket')}.`, 'Next: 5 Whys on each special cause; fishbone on the top Pareto category.', '',
    'IMPROVE (candidate countermeasures)', `  - WIP limit of about ${wip} (Little’s Law at current throughput)`, '  - Split tickets over 8 points before they enter a sprint', '  - Swarm on any item older than the 85th percentile', '  - Add checks for the top defect category to the definition of done', '',
    'CONTROL', '  - Review the control chart at every sprint review', '  - Recalculate limits after 20 new points or a confirmed process change', '  - Owner: ______    Review date: ______'].join('\n');
}
export function implStatusText(p: Project) {
  const all = implProgress(p), L = [`Implementation status: ${p.name}`, `${fmtDY(TODAY)}. ${all.done} of ${all.total} tasks done (${all.pct}%).`];
  p.impl.phases.forEach(ph => {
    const ts = p.impl.tasks.filter(t => t.phaseId === ph.id).sort(byRank), pr = implProgress(p, ph.id);
    L.push('', `${ph.name}: ${pr.done}/${pr.total} done`);
    ts.filter(t => t.status !== 'done').forEach(t => L.push(`  - ${t.title}${t.status === 'blocked' ? ' [BLOCKED]' : t.status === 'doing' ? ' [in progress]' : ''}${t.due ? `, due ${fmtD(t.due)}${t.due < TODAY ? ' (overdue)' : ''}` : ''}${t.owner ? `, ${byId(p.members, t.owner)?.name || ''}` : ''}`));
  });
  return L.join('\n');
}
export { pctl };
