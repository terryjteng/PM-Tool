import { useRef, useState } from 'react';
import { TODAY, uid } from '../lib/dates';
import { CHECKS, type CoachKind } from '../model/coaches';
import { AGENTS, AI_EFFORT, AI_MODELS, useAI } from '../model/ai';
import { DEFAULT_SETTINGS, STATUSES, TYPES, cfg } from '../model/constants';
import { byId, keyNum, tickets } from '../model/selectors';
import { mutP, normalize, useData } from '../model/store';
import type { Project, Settings as S } from '../model/types';
import { go, toast, useUI, type Theme } from '../model/ui';
import { Btn, FormDialog, Head, Seg, confirmBox } from '../components/ui';
import { cleanKey, deleteProject, keyTaken } from '../components/forms';

export const openSettings = () => go('settings');

export function openAiSettings() {
  const { conf, setConf } = useAI.getState();
  useUI.getState().openModal(<FormDialog cfg={{
    title: 'Connect Claude', saveLabel: 'Save', values: { key: conf.key, model: conf.model, effort: conf.effort },
    fields: [
      { k: 'key', label: 'Anthropic API key', type: 'password', wide: true, hint: 'Create one at console.anthropic.com. It’s stored only in this browser.' },
      { k: 'model', label: 'Model', type: 'select', options: AI_MODELS },
      { k: 'effort', label: 'Effort', type: 'select', options: AI_EFFORT, hint: 'Higher is more thorough but slower. Not used by Haiku.' },
    ],
    note: <p>When you ask a coach a question, this browser sends it straight to api.anthropic.com along with a snapshot of the current project: tickets, sprints, epics, milestones, risks, retros, the implementation plan, teammate names, and the findings on the page. Nothing goes anywhere else. Usage is billed to your API key.</p>,
    onSave(v) {
      const key = String(v.key || '').trim();
      if (!key) return 'Paste an API key, or cancel.';
      if (!setConf({ key, model: v.model, effort: v.effort })) toast('This browser is blocking storage, so the key won’t survive a reload.');
      else toast('Claude connected');
    },
    delLabel: 'Forget key',
    onDelete: conf.key ? () => { setConf({ key: '' }); toast('API key removed from this browser') } : null,
  }} />);
}

function download(name: string, body: string, type: string) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([body], { type }));
  a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
export function exportCsv(p: Project) {
  const cols = ['key', 'type', 'title', 'status', 'priority', 'severity', 'points', 'assignee', 'sprint', 'epic', 'start', 'due', 'votes', 'labels', 'createdAt', 'doneAt'];
  const q = (v: unknown) => { let s = String(v ?? ''); if (/^[=+\-@]/.test(s)) s = "'" + s; return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s };
  const rows = tickets(p).sort((a, b) => keyNum(a) - keyNum(b)).map(t => cols.map(c => q(c === 'assignee' ? byId(p.members, t.assignee)?.name : c === 'sprint' ? byId(p.sprints, t.sprintId)?.name : c === 'epic' ? byId(p.epics, t.epicId)?.title : (t as any)[c])).join(','));
  download(p.key.toLowerCase() + '-tickets-' + TODAY + '.csv', '﻿' + [cols.join(','), ...rows].join('\n'), 'text/csv;charset=utf-8');
  toast(`Exported ${rows.length} tickets`);
}
const exportJson = (name: string, data: unknown) => { download(name, JSON.stringify(data, null, 2), 'application/json'); toast('Backup downloaded') };

function importFile(file: File) {
  file.text().then(txt => {
    let j: any;
    try { j = JSON.parse(txt) } catch { toast('That file isn’t valid JSON.'); return }
    let list: any[] = [];
    if (j && j.projects) list = Object.values(j.projects);
    else if (j && j.PS) list = Object.entries<any>(j.PS).map(([id, s]) => ({ ...s, id, name: s.project?.name, key: s.project?.key, desc: s.project?.desc, tickets: (j.PT || {})[id] || {} }));
    else if (j && j.tickets && j.name) list = [j];
    if (!list.length) { toast('No Throughline projects found in that file.'); return }
    const ids: string[] = [];
    useData.getState().mutate(`Import ${list.length} project${list.length === 1 ? '' : 's'}`, d => {
      list.forEach(raw => {
        const p = normalize(raw);
        if (d.projects[p.id]) p.id = uid();
        let k = cleanKey(p.key) || 'PRJ', i = 1;
        while (Object.values(d.projects).some(x => x.key === k)) k = (cleanKey(p.key) || 'PRJ').slice(0, 4) + (++i);
        p.key = k;
        d.projects[p.id] = p;
        ids.push(p.id);
      });
    });
    toast(`Imported ${list.length} project${list.length === 1 ? '' : 's'}`, { undo: true });
    if (ids.length === 1) go('dashboard', ids[0]);
  });
}

const Section = ({ title, desc, children }: { title: string; desc?: string; children: React.ReactNode }) => <section className="panel setsec"><div className="setsec-h"><h2>{title}</h2>{desc && <p className="small muted">{desc}</p>}</div><div className="setsec-b">{children}</div></section>;

export function Settings({ p }: { p: Project }) {
  const st = cfg(p), theme = useUI(s => s.theme), setTheme = useUI(s => s.setTheme), conf = useAI(s => s.conf);
  const [basics, setBasics] = useState({ name: p.name, key: p.key, desc: p.desc });
  const fileRef = useRef<HTMLInputElement>(null);
  const set = (label: string, fn: (s: S) => void, co?: string) => mutP(p.id, label, d => { const s = cfg(d as Project); fn(s); d.settings = s }, co ? { coalesce: co } : undefined);
  const num = (v: string, min = 0) => Math.max(min, Math.round(+v || 0));
  const saveBasics = () => {
    const name = basics.name.trim(), key = cleanKey(basics.key);
    if (!name) { toast('Add a project name.'); return }
    if (!key) { toast('Add a ticket key.'); return }
    if (keyTaken(key, p.id)) { toast(`Another project already uses the key ${key}.`); return }
    mutP(p.id, 'Edit project details', d => { d.name = name; d.key = key; d.desc = basics.desc.trim() });
    setBasics(b => ({ ...b, key }));
    toast('Project details saved');
  };
  const dirty = basics.name !== p.name || basics.key !== p.key || basics.desc !== p.desc;
  const allWs = () => useData.getState().ws;

  return <>
    <Head title="Settings" desc={`Everything adjustable for ${p.name}: names, workflow, limits, coach checks, and your data. Changes apply immediately and can be undone with Ctrl+Z.`} />
    <div className="stack">
      <Section title="Project" desc="Name, ticket key, and the one-line objective shown on the overview.">
        <div className="fgrid flat">
          <label className="fld"><span>Project name</span><input value={basics.name} onChange={e => setBasics({ ...basics, name: e.target.value })} /></label>
          <label className="fld"><span>Ticket key</span><input value={basics.key} onChange={e => setBasics({ ...basics, key: e.target.value })} /><small>Applies to new tickets. Up to 5 letters or numbers.</small></label>
          <label className="fld wide"><span>Project objective</span><textarea rows={2} value={basics.desc} onChange={e => setBasics({ ...basics, desc: e.target.value })} /></label>
        </div>
        <div className="rowflex"><Btn variant="pri" disabled={!dirty} onClick={saveBasics}>Save project details</Btn>{dirty && <Btn variant="ghost" onClick={() => setBasics({ name: p.name, key: p.key, desc: p.desc })}>Discard</Btn>}</div>
      </Section>

      <Section title="Workflow" desc="Rename statuses and ticket types to match how your team talks. The underlying workflow stays the same, so reports keep working.">
        <div className="fgrid flat three">
          {STATUSES.map(s => <label className="fld" key={s}><span>Status: {DEFAULT_SETTINGS.statusLabels[s]}</span><input value={st.statusLabels[s]} onChange={e => set('Rename status', x => { x.statusLabels[s] = e.target.value || DEFAULT_SETTINGS.statusLabels[s] }, 'status-' + s)} /></label>)}
          {TYPES.map(t => <label className="fld" key={t}><span>Type: {DEFAULT_SETTINGS.typeLabels[t]}</span><input value={st.typeLabels[t]} onChange={e => set('Rename type', x => { x.typeLabels[t] = e.target.value || DEFAULT_SETTINGS.typeLabels[t] }, 'type-' + t)} /></label>)}
        </div>
      </Section>

      <Section title="Limits and defaults" desc="WIP limits show on the sprint board and feed the coaches. Use 0 for no limit (In progress then defaults to one per teammate).">
        <div className="fgrid flat three">
          <label className="fld"><span>WIP limit: {st.statusLabels.inprogress}</span><input type="number" min={0} value={st.wipLimits.inprogress} onChange={e => set('Change WIP limit', x => { x.wipLimits.inprogress = num(e.target.value) }, 'wip1')} /></label>
          <label className="fld"><span>WIP limit: {st.statusLabels.review}</span><input type="number" min={0} value={st.wipLimits.review} onChange={e => set('Change WIP limit', x => { x.wipLimits.review = num(e.target.value) }, 'wip2')} /></label>
          <label className="fld"><span>Default sprint length (days)</span><input type="number" min={1} value={st.sprintDays} onChange={e => set('Change sprint length', x => { x.sprintDays = num(e.target.value, 1) }, 'sdays')} /><small>Used for new sprints and forecasts.</small></label>
          <label className="fld"><span>Default story points</span><input type="number" min={0} value={st.defaultPoints} onChange={e => set('Change default points', x => { x.defaultPoints = num(e.target.value) }, 'dpts')} /><small>For quick-added tickets.</small></label>
          <label className="fld"><span>Target cycle time (days)</span><input type="number" min={0} value={st.usl} onChange={e => set('Set target cycle time', x => { x.usl = num(e.target.value) }, 'usl')} /><small>Used for Cpk on Flow metrics. 0 means none.</small></label>
          <label className="fld"><span>Flow metrics history (days)</span><input type="number" min={7} value={st.flowWindow} onChange={e => set('Change flow window', x => { x.flowWindow = num(e.target.value, 7) }, 'fw')} /></label>
        </div>
      </Section>

      <Section title="Coach checks" desc="Tune the thresholds the coaches use, and switch off any check that doesn’t fit how your team works.">
        <div className="fgrid flat three">
          <label className="fld"><span>“Stuck in progress” after (days)</span><input type="number" min={1} value={st.coach.staleDays} onChange={e => set('Change coach threshold', x => { x.coach.staleDays = num(e.target.value, 1) }, 'c1')} /></label>
          <label className="fld"><span>“Too big” at (points)</span><input type="number" min={1} value={st.coach.bigPoints} onChange={e => set('Change coach threshold', x => { x.coach.bigPoints = num(e.target.value, 1) }, 'c2')} /></label>
          <label className="fld"><span>Minimum say/do ratio (%)</span><input type="number" min={0} max={100} value={st.coach.sayDoMin} onChange={e => set('Change coach threshold', x => { x.coach.sayDoMin = Math.min(100, num(e.target.value)) }, 'c3')} /></label>
          <label className="fld"><span>Ready work to keep (sprints)</span><input type="number" min={0} value={st.coach.readySprints} onChange={e => set('Change coach threshold', x => { x.coach.readySprints = num(e.target.value) }, 'c4')} /></label>
        </div>
        <div className="checkgrid">{(['scrum', 'agile', 'lss'] as CoachKind[]).map(k => <fieldset key={k}><legend>{AGENTS[k].name}</legend>
          {CHECKS.filter(c => c.agent === k).map(c => { const on = !st.coach.disabled.includes(c.id); return <label key={c.id} className="checklabel"><input type="checkbox" checked={on} onChange={e => set(`${e.target.checked ? 'Turn on' : 'Turn off'} check: ${c.label}`, x => { x.coach.disabled = e.target.checked ? x.coach.disabled.filter(i => i !== c.id) : [...x.coach.disabled, c.id] })} />{c.label}</label> })}
        </fieldset>)}</div>
        {st.coach.disabled.length > 0 && <Btn sm variant="ghost" onClick={() => set('Turn on all checks', x => { x.coach.disabled = [] })}>Turn all checks back on</Btn>}
      </Section>

      <Section title="Claude for the coaches" desc="Optional. The coach chats use your own Anthropic API key; the checks above work without it.">
        <p style={{ marginBottom: 10 }}>{conf.key ? <>Connected with {AI_MODELS.find(m => m[0] === conf.model)?.[1] || conf.model}, {conf.effort} effort.</> : 'Not connected.'} <Btn sm onClick={openAiSettings}>{conf.key ? 'Change' : 'Connect Claude'}</Btn></p>
        <div className="fgrid flat three">{(['scrum', 'agile', 'lss'] as CoachKind[]).map(k => <label className="fld" key={k}><span>Instructions for the {AGENTS[k].name} coach</span><textarea rows={3} value={st.aiNotes[k] || ''} placeholder="e.g. We run 1-week sprints and use Kanban for bugs" onChange={e => set('Edit coach instructions', x => { x.aiNotes[k] = e.target.value }, 'ai-' + k)} /></label>)}</div>
      </Section>

      <Section title="Appearance" desc="Applies to this browser.">
        <Seg<Theme> label="Theme" value={theme} onChange={setTheme} options={[['system', 'Match system'], ['light', 'Light'], ['dark', 'Dark']]} />
      </Section>

      <Section title="Your data" desc="Everything is saved in this browser. Download a backup to move it to another browser or share it with someone.">
        <div className="rowflex wrap">
          <Btn onClick={() => exportJson(`${p.key.toLowerCase()}-throughline-${TODAY}.json`, p)}>Download this project (JSON)</Btn>
          <Btn onClick={() => exportJson(`throughline-backup-${TODAY}.json`, allWs())}>Download all projects (JSON)</Btn>
          <Btn onClick={() => exportCsv(p)}>Export tickets (CSV)</Btn>
          <Btn onClick={() => fileRef.current?.click()}>Import from JSON…</Btn>
          <input ref={fileRef} type="file" accept="application/json,.json" hidden onChange={e => { const f = e.target.files?.[0]; if (f) importFile(f); e.target.value = '' }} />
        </div>
        <p className="small muted" style={{ marginTop: 8 }}>Imports are added as new projects; nothing is overwritten.</p>
        <hr className="sep" />
        <div className="rowflex wrap">
          <Btn variant="danger" onClick={() => confirmBox('Reset all settings?', 'Status names, type names, limits, defaults, coach thresholds, and turned-off checks go back to their defaults. Your tickets and plans aren’t affected.', 'Reset settings', () => { mutP(p.id, 'Reset settings', d => { d.settings = {} }); toast('Settings reset', { undo: true }) })}>Reset settings</Btn>
          <Btn variant="danger" onClick={() => deleteProject(p.id)}>Delete this project</Btn>
        </div>
      </Section>

      <Section title="Keyboard shortcuts">
        <dl className="statlist kbd">
          <dt><kbd>Ctrl</kbd> <kbd>K</kbd></dt><dd>Command palette: jump anywhere, find any ticket</dd>
          <dt><kbd>N</kbd></dt><dd>New ticket</dd>
          <dt><kbd>Ctrl</kbd> <kbd>Z</kbd></dt><dd>Undo</dd>
          <dt><kbd>Ctrl</kbd> <kbd>Shift</kbd> <kbd>Z</kbd></dt><dd>Redo</dd>
          <dt><kbd>Ctrl</kbd> <kbd>Enter</kbd></dt><dd>Save the open form</dd>
          <dt><kbd>Esc</kbd></dt><dd>Close a dialog or cancel an edit</dd>
        </dl>
      </Section>
    </div>
  </>;
}
