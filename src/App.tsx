import { useEffect, useMemo, useRef, useState } from 'react';
import { TODAY, cx, diff } from './lib/dates';
import { activeSprint, implOverdue, isDone, pts, sprintTickets, tickets } from './model/selectors';
import { mutP, useData } from './model/store';
import type { Project } from './model/types';
import { go, redo, syncRoute, undo, useProject, useUI } from './model/ui';
import { Btn, Toasts } from './components/ui';
import { newTicket, openEpic, openMember, openMilestone, openNewProject, openRisk, openSprint, openTicket } from './components/forms';
import { Dashboard, Milestones, Roadmap } from './views/Overview';
import { Backlog, Board, Planning } from './views/Execute';
import { Portfolio } from './views/Portfolio';
import { openAiSettings } from './views/Settings';

import { Gantt } from './views/Gantt';
import { Burndown } from './views/Burndown';
import { Implementation } from './views/Implementation';
import { Retro } from './views/Retro';
import { Capacity, Flow, Reports, Risks, Tickets } from './views/Track';
import { Coach } from './views/Coach';
import { Settings as SettingsView } from './views/Settings';

export const NAV: [string, [string, string][]][] = [
  ['Overview', [['dashboard', 'Project overview']]],
  ['Plan', [['roadmap', 'Roadmap'], ['gantt', 'Timeline'], ['milestones', 'Milestones'], ['implementation', 'Implementation plan']]],
  ['Execute', [['backlog', 'Backlog'], ['planning', 'Sprint planning'], ['board', 'Sprint board'], ['burndown', 'Burndown'], ['retro', 'Retrospectives']]],
  ['Track', [['tickets', 'Bugs & requests'], ['capacity', 'Team capacity'], ['risks', 'Risks'], ['flow', 'Flow metrics'], ['reports', 'Reports']]],
  ['Coaches', [['scrum', 'Scrum Master'], ['agile', 'Agile Coach'], ['lss', 'Lean Six Sigma']]],
];
const ALL_VIEWS = Object.fromEntries([...NAV.flatMap(g => g[1]), ['settings', 'Settings']]);

function View({ p, view }: { p: Project; view: string }) {
  switch (view) {
    case 'roadmap': return <Roadmap p={p} />;
    case 'gantt': return <Gantt p={p} />;
    case 'milestones': return <Milestones p={p} />;
    case 'implementation': return <Implementation p={p} />;
    case 'backlog': return <Backlog p={p} />;
    case 'planning': return <Planning p={p} />;
    case 'board': return <Board p={p} />;
    case 'burndown': return <Burndown p={p} />;
    case 'retro': return <Retro p={p} />;
    case 'tickets': return <Tickets p={p} />;
    case 'capacity': return <Capacity p={p} />;
    case 'risks': return <Risks p={p} />;
    case 'flow': return <Flow p={p} />;
    case 'reports': return <Reports p={p} />;
    case 'scrum': case 'agile': case 'lss': return <Coach p={p} kind={view} />;
    case 'settings': return <SettingsView p={p} />;
    default: return <Dashboard p={p} />;
  }
}

function Nav({ p, view }: { p?: Project; view: string }) {
  const ws = useData(s => s.ws), ids = Object.keys(ws.projects), port = view === 'portfolio' || !p;
  const badge = (k: string) => {
    if (!p) return null;
    if (k === 'tickets') { const n = tickets(p).filter(t => t.status === 'triage').length; return n ? <span className="count" title={`${n} in triage`}>{n}</span> : null }
    if (k === 'implementation') { const n = p.impl.tasks.filter(implOverdue).length; return n ? <span className="count" title={`${n} overdue`}>{n}</span> : null }
    return null;
  };
  return <nav id="nav" aria-label="Views">
    <div className="brand"><svg width="22" height="22" viewBox="0 0 22 22" aria-hidden="true"><rect x="1" y="3" width="12" height="4" rx="2" fill="var(--accent)" /><rect x="6" y="9" width="14" height="4" rx="2" fill="var(--accent)" opacity=".6" /><rect x="3" y="15" width="9" height="4" rx="2" fill="var(--accent)" opacity=".35" /></svg><span>Throughline</span></div>
    <div className="navgroup">
      <button className="navbtn" onClick={() => go('portfolio')} aria-current={port ? 'page' : undefined}><span>All projects</span><span className="small muted">{ids.length}</span></button>
      {p && <label className="projsel"><span>Current project</span><select value={p.id} onChange={e => go(view === 'portfolio' ? 'dashboard' : view, e.target.value)} aria-label="Current project">{ids.map(id => <option key={id} value={id}>{ws.projects[id].name}</option>)}</select></label>}
    </div>
    {p && NAV.map(([g, items]) => <div className="navgroup" key={g}><span>{g}</span>{items.map(([k, l]) => <button key={k} className="navbtn" onClick={() => go(k)} aria-current={!port && view === k ? 'page' : undefined}><span>{l}</span>{badge(k)}</button>)}</div>)}
    {p && <div className="navgroup"><button className="navbtn" onClick={() => go('settings')} aria-current={!port && view === 'settings' ? 'page' : undefined}><span>Settings</span></button></div>}
  </nav>;
}

function Top({ p, view }: { p?: Project; view: string }) {
  const canUndo = useData(s => s.past.length > 0), canRedo = useData(s => s.future.length > 0), saveError = useData(s => s.saveError);
  const a = p ? activeSprint(p) : undefined;
  const palette = <button className="searchbtn" onClick={() => useUI.setState({ palette: true })}><span>Search or jump to…</span><kbd>Ctrl K</kbd></button>;
  const ur = <div className="rowflex nogap"><Btn sm variant="ghost" disabled={!canUndo} onClick={undo} title="Undo (Ctrl+Z)" aria-label="Undo">↶</Btn><Btn sm variant="ghost" disabled={!canRedo} onClick={redo} title="Redo (Ctrl+Shift+Z)" aria-label="Redo">↷</Btn></div>;
  return <header id="top">
    {!p || view === 'portfolio'
      ? <div className="proj"><h1>All projects</h1><small>{Object.keys(useData.getState().ws.projects).length} projects, saved in this browser</small></div>
      : <button className="proj" onClick={() => go('settings')} title="Project settings"><h1>{p.name}</h1><small>{a ? `${a.name}, day ${Math.max(0, diff(a.start, TODAY) + 1)} of ${diff(a.start, a.end) + 1}` : 'No active sprint'}{saveError ? '. Not saving: this browser is blocking storage' : ', saved in this browser'}</small></button>}
    <span className="sp" />
    {palette}{ur}
    {p && view !== 'portfolio' ? <><Btn onClick={() => newTicket('bug')}>Report bug</Btn><Btn variant="pri" onClick={() => newTicket()} title="Shortcut: N">New ticket</Btn></> : <Btn variant="pri" onClick={openNewProject}>New project</Btn>}
  </header>;
}

interface Cmd { id: string; label: string; hint?: string; run: () => void }
function Palette() {
  const open = useUI(s => s.palette), p = useProject(), ws = useData(s => s.ws);
  const [q, setQ] = useState(''), [i, setI] = useState(0), list = useRef<HTMLUListElement>(null);
  const close = () => { useUI.setState({ palette: false }); setQ(''); setI(0) };
  const cmds = useMemo<Cmd[]>(() => {
    if (!open) return [];
    const out: Cmd[] = [];
    if (p) {
      out.push(...Object.entries(ALL_VIEWS).map(([k, l]) => ({ id: 'v' + k, label: l, hint: 'Go to', run: () => go(k) })));
      out.push(
        { id: 'a-ticket', label: 'New ticket', hint: 'Create', run: () => newTicket() },
        { id: 'a-bug', label: 'Report a bug', hint: 'Create', run: () => newTicket('bug') },
        { id: 'a-epic', label: 'New epic', hint: 'Create', run: () => openEpic() },
        { id: 'a-ms', label: 'New milestone', hint: 'Create', run: () => openMilestone() },
        { id: 'a-sprint', label: 'New sprint', hint: 'Create', run: () => openSprint() },
        { id: 'a-member', label: 'Add teammate', hint: 'Create', run: () => openMember() },
        { id: 'a-risk', label: 'Log a risk', hint: 'Create', run: () => openRisk() },
      );
      const ql = q.trim().toLowerCase();
      if (ql) out.push(...tickets(p).filter(t => (t.key + ' ' + t.title).toLowerCase().includes(ql)).slice(0, 8).map(t => ({ id: 't' + t.id, label: `${t.key} ${t.title}`, hint: isDone(t) ? 'Ticket, done' : 'Ticket', run: () => openTicket(t.id) })));
    }
    out.push(...Object.values(ws.projects).filter(x => x.id !== p?.id).map(x => ({ id: 'p' + x.id, label: x.name, hint: 'Switch project', run: () => go('dashboard', x.id) })));
    out.push(
      { id: 'a-proj', label: 'New project', hint: 'Create', run: openNewProject },
      { id: 'a-all', label: 'All projects', hint: 'Go to', run: () => go('portfolio') },
      { id: 'a-undo', label: 'Undo', hint: 'Ctrl+Z', run: undo },
      { id: 'a-redo', label: 'Redo', hint: 'Ctrl+Shift+Z', run: redo },
      { id: 'a-theme', label: 'Switch light / dark theme', hint: 'Appearance', run: () => { const t = useUI.getState().theme, dark = t === 'dark' || (t === 'system' && matchMedia('(prefers-color-scheme: dark)').matches); useUI.getState().setTheme(dark ? 'light' : 'dark') } },
      { id: 'a-ai', label: 'Connect Claude', hint: 'Coaches', run: openAiSettings },
    );
    const ql = q.trim().toLowerCase();
    return ql ? out.filter(c => c.id[0] === 't' || (c.label + ' ' + (c.hint || '')).toLowerCase().includes(ql)) : out;
  }, [open, q, p, ws]);
  useEffect(() => { list.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' }) }, [i]);
  if (!open) return null;
  const run = (c?: Cmd) => { if (!c) return; close(); c.run() };
  return <div className="modalwrap palettewrap" onKeyDown={e => { if (e.key === 'Escape') close() }}>
    <div className="scrim" onClick={close} />
    <div className="palette" role="dialog" aria-modal="true" aria-label="Command palette">
      <input autoFocus value={q} placeholder="Type a view, an action, or a ticket key or title" aria-label="Search" role="combobox" aria-expanded="true" aria-controls="pallist"
        onChange={e => { setQ(e.target.value); setI(0) }}
        onKeyDown={e => { if (e.key === 'ArrowDown') { e.preventDefault(); setI(Math.min(cmds.length - 1, i + 1)) } else if (e.key === 'ArrowUp') { e.preventDefault(); setI(Math.max(0, i - 1)) } else if (e.key === 'Enter') { e.preventDefault(); run(cmds[i]) } }} />
      <ul id="pallist" ref={list} role="listbox">{cmds.map((c, j) => <li key={c.id} role="option" aria-selected={j === i} className={cx(j === i && 'on')} onMouseMove={() => j !== i && setI(j)} onClick={() => run(c)}><span>{c.label}</span>{c.hint && <small>{c.hint}</small>}</li>)}{!cmds.length && <li className="muted">No matches</li>}</ul>
    </div>
  </div>;
}

/** Records the active sprint's scope and progress once per day, so the burndown can show mid-sprint scope changes. */
function useScopeLog(p?: Project) {
  useEffect(() => {
    if (!p) return;
    const a = activeSprint(p);
    if (!a || TODAY < a.start || TODAY > a.end) return;
    const ts = sprintTickets(p, a.id), v: [number, number] = [pts(ts), pts(ts.filter(isDone))], cur = a.scopeLog?.[TODAY];
    if (cur && cur[0] === v[0] && cur[1] === v[1]) return;
    mutP(p.id, 'Record sprint scope', d => { const s = d.sprints.find(x => x.id === a.id); if (s) { s.scopeLog = s.scopeLog || {}; s.scopeLog[TODAY] = v } }, { silent: true });
  }, [p]);
}

export default function App() {
  const view = useUI(s => s.view), modal = useUI(s => s.modal), theme = useUI(s => s.theme), p = useProject();
  const main = useRef<HTMLDivElement>(null);
  useEffect(() => { syncRoute(); const h = () => syncRoute(); addEventListener('hashchange', h); return () => removeEventListener('hashchange', h) }, []);
  useEffect(() => { if (theme === 'system') delete document.documentElement.dataset.theme; else document.documentElement.dataset.theme = theme }, [theme]);
  useEffect(() => { main.current?.scrollTo({ top: 0 }); document.title = `${p && view !== 'portfolio' ? (ALL_VIEWS[view] || 'Project overview') + ' · ' + p.name : 'All projects'} | Throughline` }, [view, p?.id]);
  useScopeLog(p);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = ((e.target as HTMLElement).tagName || '').toLowerCase(), typing = ['input', 'textarea', 'select'].includes(tag) || (e.target as HTMLElement).isContentEditable;
      const st = useUI.getState(), mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === 'k') { e.preventDefault(); useUI.setState({ palette: !st.palette }); return }
      if (st.modal || st.palette || typing) return;
      if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); return }
      if (mod && e.key.toLowerCase() === 'y') { e.preventDefault(); redo(); return }
      if (!mod && !e.altKey && (e.key === 'n' || e.key === 'N') && st.pid && st.view !== 'portfolio') { e.preventDefault(); newTicket() }
    };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }, []);
  const port = !p || view === 'portfolio';
  return <div id="app">
    <Nav p={p} view={view} />
    <div id="mainwrap" ref={main}>
      <Top p={p} view={view} />
      <main id="main">
        {port ? <Portfolio /> : <View key={p.id + view} p={p} view={view} />}
      </main>
    </div>
    {modal}
    <Palette />
    <Toasts />
  </div>;
}
