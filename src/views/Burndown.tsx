import { TODAY, addDays, diff, fmtD, plural, workdays } from '../lib/dates';
import { activeSprint, burn, burnup, byId, isDone, pts, sortedSprints, sprintTickets, tickets, velocity, scopeTickets } from '../model/selectors';
import type { Project, Sprint, Ticket } from '../model/types';
import { go, useUI } from '../model/ui';
import { Btn, Empty, Head, Legend, Seg, Tile } from '../components/ui';
import { BarChart, LineChart } from '../components/charts';

type Metric = 'points' | 'count';
const val = (a: Ticket[], m: Metric) => (m === 'points' ? pts(a) : a.length);

/** Day-by-day remaining, scope, ideal, and a straight-line projection for one sprint. */
export function sprintSeries(p: Project, s: Sprint, m: Metric) {
  const len = diff(s.start, s.end) + 1, ts = sprintTickets(p, s.id), total = val(ts, m);
  const committed = m === 'points' ? (+s.committed! || total) : total;
  const last = s.status === 'closed' ? s.end : TODAY < s.end ? TODAY : s.end;
  const shown = s.start > last ? 0 : diff(s.start, last) + 1;
  let remaining: (number | null)[], scope: (number | null)[];
  if (m === 'points') {
    const b = burn(p, s);
    remaining = [...Array(len)].map((_, i) => (i < Math.min(shown, b.length) ? b[i] : null));
    let lastScope = committed;
    scope = [...Array(len)].map((_, i) => { if (i >= shown) return null; const lg = s.scopeLog?.[addDays(s.start, i)]; if (lg) lastScope = lg[0]; else if (i === shown - 1 && s.status !== 'closed') lastScope = total; return lastScope });
  } else {
    remaining = [...Array(len)].map((_, i) => (i < shown ? total - ts.filter(t => isDone(t) && !!t.doneAt && t.doneAt <= addDays(s.start, i)).length : null));
    scope = [...Array(len)].map((_, i) => (i < shown ? total : null));
  }
  const ideal = [...Array(len)].map((_, i) => committed * (1 - i / Math.max(1, len - 1)));
  const actual = remaining.filter((v): v is number => v != null), k = actual.length;
  let projection: (number | null)[] = Array(len).fill(null), rate = 0, finish: string | null = null;
  if (s.status !== 'closed' && k >= 2) {
    rate = (actual[0] - actual[k - 1]) / (k - 1);
    const cur = actual[k - 1];
    projection = [...Array(len)].map((_, i) => (i < k - 1 ? null : Math.max(0, cur - rate * (i - (k - 1)))));
    if (cur <= 0) finish = addDays(s.start, k - 1);
    else if (rate > 0) finish = addDays(s.start, k - 1 + Math.ceil(cur / rate));
  }
  const cur = k ? actual[k - 1] : total, daysLeft = Math.max(0, diff(last, s.end)), wdLeft = s.status === 'closed' ? 0 : workdays(addDays(last, 1), s.end);
  return { len, labels: [...Array(len)].map((_, i) => fmtD(addDays(s.start, i))), remaining, scope, ideal, projection, rate, finish, cur, committed, total, daysLeft, wdLeft, done: total - cur };
}

export function Burndown({ p }: { p: Project }) {
  const f = useUI(s => s.f), setF = useUI(s => s.setF), m = f.bdMetric, unit = m === 'points' ? 'points' : 'tickets';
  const opts = sortedSprints(p).filter(s => s.status !== 'planned').reverse();
  const s = byId(opts, f.bdSprint) || activeSprint(p) || opts[0];
  const scopeOpts: [string, string][] = [['all', 'All work'], ...p.epics.map(e => ['e:' + e.id, 'Epic: ' + e.title] as [string, string]), ...p.milestones.map(x => ['m:' + x.id, 'Milestone: ' + x.title] as [string, string])];
  const bu = burnup(p, f.bdScope, m);
  const ss = s ? sprintSeries(p, s, m) : null;

  // release burndown by sprint: remaining scope at each sprint end, then projected sprints at the current pace
  const { ts: scopeTs } = scopeTickets(p, f.bdScope);
  const closed = sortedSprints(p).filter(x => x.status === 'closed').slice(-8);
  const remAt = (d: string) => val(scopeTs.filter(t => (t.createdAt || TODAY) <= d), m) - val(scopeTs.filter(t => isDone(t) && !!t.doneAt && t.doneAt <= d), m);
  const perSprint = m === 'points' ? velocity(p) : closed.length ? Math.round(closed.slice(-3).reduce((a, x) => a + sprintTickets(p, x.id).filter(isDone).length, 0) / Math.min(3, closed.length)) : 0;
  const nowRem = remAt(TODAY), future: number[] = [];
  if (perSprint > 0) { let r = nowRem; while (r > 0 && future.length < 10) { r = Math.max(0, r - perSprint); future.push(r) } }
  const bars = [
    ...closed.map(x => ({ label: x.name.replace(/^Sprint\s*/i, 'S'), vals: [{ v: remAt(x.end), color: 'var(--accent)', name: 'remaining' }] })),
    { label: 'Now', vals: [{ v: nowRem, color: 'var(--ink)', name: 'remaining' }] },
    ...future.map((v, i) => ({ label: '+' + (i + 1), vals: [{ v, color: 'color-mix(in srgb,var(--accent) 30%,var(--panel))', name: 'projected' }] })),
  ];

  const ctrl = <>
    <Seg label="Measure" value={m} onChange={v => setF({ bdMetric: v })} options={[['points', 'Points'], ['count', 'Tickets']]} />
  </>;
  if (!opts.length && !tickets(p).length) return <><Head title="Burndown" desc="Sprint burndown, release burnup, and release burndown by sprint.">{ctrl}</Head><Empty>Start a sprint and finish some tickets to see burndown charts. <Btn sm variant="pri" onClick={() => go('planning')}>Plan a sprint</Btn></Empty></>;

  const targetIdx = bu.target ? bu.weeks.findIndex(w => w >= bu.target!) : -1;
  const projVals = bu.weeks.map((_, i) => (i === bu.weeks.length - 1 ? bu.done[i] : null));
  const etaWeeks: string[] = [], etaScope: (number | null)[] = [], etaDone: (number | null)[] = [], etaProj: (number | null)[] = [];
  if (bu.eta && bu.eta > TODAY && bu.ratePerWeek > 0) {
    for (let d = addDays(TODAY, 7); d < addDays(bu.eta, 7) && etaWeeks.length < 26; d = addDays(d, 7)) {
      etaWeeks.push(d); etaScope.push(bu.total); etaDone.push(null);
      etaProj.push(Math.min(bu.total, bu.done[bu.done.length - 1] + bu.ratePerWeek * (etaWeeks.length)));
    }
  }
  const labels = [...bu.weeks, ...etaWeeks].map(fmtD);
  const hit = bu.target && bu.eta ? bu.eta <= bu.target : null;

  return <>
    <Head title="Burndown" desc="How fast work is getting done against the plan: the sprint burndown, the release burnup with a forecast, and the remaining scope sprint by sprint.">{ctrl}</Head>
    {s && ss ? <section className="panel">
      <div className="phead"><div><h2>Sprint burndown: {s.name}</h2><p className="small muted">{fmtD(s.start)} to {fmtD(s.end)}{s.goal ? `. Goal: ${s.goal}` : ''}</p></div>
        <select className="selectlike" value={s.id} onChange={e => setF({ bdSprint: e.target.value })} aria-label="Sprint">{opts.map(o => <option key={o.id} value={o.id}>{o.name}{o.status === 'active' ? ' (active)' : ''}</option>)}</select></div>
      <div className="tiles">
        <Tile v={ss.committed} label={`${unit} committed`} />
        <Tile v={ss.done} label={`${unit} done`} />
        <Tile v={ss.cur} label={`${unit} remaining`} />
        <Tile v={s.status === 'closed' ? 'Closed' : plural(ss.wdLeft, 'workday')} label={s.status === 'closed' ? `${s.completed ?? 0} points completed` : 'left in the sprint'} />
        <Tile v={s.status === 'closed' ? '—' : ss.wdLeft ? (ss.cur / ss.wdLeft).toFixed(1) : '—'} label={`${unit} per workday needed to finish`} />
        <Tile v={ss.finish ? fmtD(ss.finish) : '—'} label={ss.finish ? (ss.finish <= s.end ? 'projected finish, inside the sprint' : 'projected finish, after the sprint ends') : 'projected finish (needs 2+ days of data)'} color={ss.finish ? (ss.finish <= s.end ? 'var(--ok)' : 'var(--bad)') : undefined} />
      </div>
      <LineChart w={1100} h={320} labels={ss.labels} ymax={Math.max(ss.committed, ss.total, ...ss.scope.filter((v): v is number => v != null), 1)} label="Sprint burndown"
        series={[{ name: 'Ideal', vals: ss.ideal, color: 'var(--muted)', dash: true }, { name: 'Scope', vals: ss.scope, color: 'var(--warn)', width: 1.8 }, { name: 'Projection', vals: ss.projection, color: 'var(--accent)', dash: true, width: 1.8 }, { name: 'Remaining', vals: ss.remaining, color: 'var(--accent)', dots: true }]}
        markers={s.status !== 'closed' && TODAY >= s.start && TODAY <= s.end ? [{ i: diff(s.start, TODAY), text: 'Today', color: 'var(--bad)' }] : []} />
      <Legend items={[['var(--accent)', `${m === 'points' ? 'Points' : 'Tickets'} remaining`], ['var(--accent)', 'Projection at the current pace', true], ['var(--muted)', 'Ideal', true], ['var(--warn)', 'Total scope']]} />
      {m === 'points' && <p className="small muted" style={{ marginTop: 8 }}>Scope is recorded daily while a sprint is active, so mid-sprint additions show as a step in the amber line. Hover the chart for exact values.</p>}
    </section> : <Empty>No sprint has started yet. <Btn sm variant="pri" onClick={() => go('planning')}>Plan a sprint</Btn></Empty>}

    <div className="grid2" style={{ marginTop: 16 }}>
      <section className="panel">
        <div className="phead"><div><h2>Release burnup</h2><p className="small muted">{bu.label}: total scope vs. completed, by week</p></div>
          <select className="selectlike" value={f.bdScope} onChange={e => setF({ bdScope: e.target.value })} aria-label="Scope">{scopeOpts.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></div>
        <div className="tiles">
          <Tile v={bu.total} label={`${unit} in scope`} />
          <Tile v={bu.total ? Math.round(bu.done[bu.done.length - 1] / bu.total * 100) + '%' : '—'} label="complete" />
          <Tile v={bu.ratePerWeek.toFixed(1)} label={`${unit} per week, last 6 weeks`} />
          <Tile v={bu.remaining <= 0 ? 'Done' : bu.eta ? fmtD(bu.eta) : '—'} label={bu.remaining <= 0 ? 'everything in scope is finished' : bu.eta ? 'forecast completion at the current pace' : 'forecast needs recent progress'} color={hit == null ? undefined : hit ? 'var(--ok)' : 'var(--bad)'} />
        </div>
        <LineChart labels={labels} label="Release burnup" ymax={Math.max(bu.total, 1)}
          series={[{ name: 'Scope', vals: [...bu.scope, ...etaScope], color: 'var(--warn)', width: 2 }, { name: 'Done', vals: [...bu.done, ...etaDone], color: 'var(--ok)', dots: bu.weeks.length < 20 }, { name: 'Forecast', vals: [...projVals, ...etaProj], color: 'var(--ok)', dash: true, width: 1.8 }]}
          markers={targetIdx >= 0 ? [{ i: targetIdx, text: 'Target', color: 'var(--bad)' }] : []} />
        <Legend items={[['var(--warn)', 'Scope'], ['var(--ok)', 'Done'], ['var(--ok)', 'Forecast', true]]} />
        {bu.target && <p className={`signal ${hit ? 'ok' : hit === false ? 'bad' : 'warn'}`}>{hit ? `On pace to finish by ${fmtD(bu.target)}.` : hit === false ? `At the current pace this finishes ${fmtD(bu.eta)}, after the ${fmtD(bu.target)} target.` : `Target ${fmtD(bu.target)}; not enough recent progress to forecast.`}</p>}
        {!bu.target && f.bdScope !== 'all' && <p className="small muted">No target date for this scope.</p>}
      </section>
      <section className="panel">
        <h2>Release burndown by sprint</h2>
        <p className="small muted" style={{ marginTop: 2 }}>{bu.label}: {unit} left at the end of each sprint, then projected sprints at {perSprint ? `${perSprint} ${unit} per sprint` : 'the recent pace (needs a closed sprint)'}.</p>
        <BarChart groups={bars} ymax={Math.max(...bars.map(b => b.vals[0].v), 1)} />
        <Legend items={[['var(--accent)', 'Remaining at sprint end'], ['var(--ink)', 'Remaining now'], ['color-mix(in srgb,var(--accent) 30%,var(--panel))', 'Projected']]} />
        {future.length > 0 && <p className="small muted" style={{ marginTop: 8 }}>{future[future.length - 1] === 0 ? `About ${plural(future.length, 'more sprint')} to finish at this pace.` : 'More than 10 sprints of work remain at this pace.'}</p>}
      </section>
    </div>
  </>;
}
