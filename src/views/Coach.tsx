import { useEffect, useRef, useState } from 'react';
import type { CoachKind, Finding } from '../model/coaches';
import { CHECKS, dmaicText, notReady, reviewText, standupText, wasteRows } from '../model/coaches';
import { AGENTS, AI_MODELS, useAI } from '../model/ai';
import { cfg } from '../model/constants';
import { byRank, isDone, sayDo, tickets, velocity, pts } from '../model/selectors';
import { pctl } from '../model/flow';
import { mutP } from '../model/store';
import type { Project } from '../model/types';
import { go, toast } from '../model/ui';
import { Brief, Btn, Chip, Dot, Head, Tile, clsColor } from '../components/ui';
import { openEpic, openMember, openSprint, openTicket } from '../components/forms';
import { md } from '../lib/md';
import { openAiSettings } from './Settings';

function act(f: Finding) {
  const a = f.a!;
  if (a.kind === 'go') go(a.view);
  else if (a.kind === 'ticket') openTicket(a.id);
  else if (a.kind === 'sprint') openSprint(a.id);
  else if (a.kind === 'epic') openEpic(a.id);
  else openMember();
}

function Findings({ p, kind }: { p: Project; kind: CoachKind }) {
  const A = AGENTS[kind], fs = A.find(p), nb = fs.filter(f => f.cls === 'bad').length, nw = fs.filter(f => f.cls === 'warn').length;
  const off = cfg(p).coach.disabled.filter(id => CHECKS.some(c => c.id === id && c.agent === kind)).length;
  const dismiss = (id: string) => {
    const label = CHECKS.find(c => c.id === id)?.label || id;
    mutP(p.id, `Turn off check: ${label}`, d => { const c = (d.settings.coach = { ...cfg(d as Project).coach }); c.disabled = [...new Set([...c.disabled, id])] });
    toast(`Turned off “${label}”. Turn it back on in Settings.`, { undo: true });
  };
  return <section className="panel">
    <div className="phead"><h2>Findings</h2><Chip cls={nb ? 'bad' : nw ? 'warn' : 'ok'}>{nb || nw ? [nb && nb + ' urgent', nw && nw + ' to look at'].filter(Boolean).join(', ') : 'All clear'}</Chip></div>
    <p className="small muted" style={{ margin: '-4px 0 4px' }}>{A.how} {off > 0 && <>{off} check{off === 1 ? '' : 's'} turned off. </>}<button className="link acc" onClick={() => go('settings')}>Adjust checks and thresholds</button></p>
    <ul className="list1 finds">{fs.map((f, i) => <li key={f.id + i}><Dot color={clsColor(f.cls)} /><div className="sp"><b>{f.t}</b>{f.d && <div className="small muted">{f.d}</div>}{f.fix && <div className="small fix">{f.fix}</div>}</div>
      <div className="factions">{f.a && <Btn sm variant="ghost" onClick={() => act(f)}>{f.a.label}</Btn>}{f.id !== 'all-clear' && <button className="rx" title="Turn off this check" aria-label={`Turn off the check: ${f.t}`} onClick={() => dismiss(f.id)}>×</button>}</div></li>)}</ul>
  </section>;
}

function Tools({ p, kind }: { p: Project; kind: CoachKind }) {
  if (kind === 'scrum') return <><Brief title="Standup brief" sub="Built from ticket activity since the last workday." text={standupText(p)} /><Brief title="Sprint review notes" text={reviewText(p)} /></>;
  if (kind === 'agile') {
    const open = tickets(p).filter(t => !isDone(t) && t.status !== 'triage'), bl = open.filter(t => !t.sprintId).sort(byRank), v = velocity(p), pc = (fn: (t: typeof open[number]) => boolean) => (open.length ? Math.round(open.filter(fn).length / open.length * 100) + '%' : '—');
    const ready = pts(bl.filter(t => !notReady(p, t).length)), sz = open.map(t => +t.points || 0).filter(Boolean), q = bl.slice(0, 15).map(t => ({ t, why: notReady(p, t) })).filter(x => x.why.length).slice(0, 8), sd = sayDo(p);
    return <>
      <section className="panel"><h2>Backlog health</h2><div className="tiles" style={{ margin: '12px 0 0' }}><Tile v={pc(t => +t.points > 0)} label="of open items estimated" /><Tile v={pc(t => !!String(t.desc || '').trim())} label="have a description" /><Tile v={v ? (ready / v).toFixed(1) : '—'} label="sprints of ready work" /><Tile v={sz.length ? pctl(sz, 50) : '—'} label="median item size, points" /><Tile v={sd == null ? '—' : sd + '%'} label="say/do, last 3 sprints" /></div></section>
      <section className="panel"><h2>Refinement queue</h2><p className="small muted">Top-ranked backlog items that aren’t ready for a sprint.</p>{q.length ? <ul className="list1">{q.map(x => <li key={x.t.id}><span className="key">{x.t.key}</span><div className="sp"><button className="link" onClick={() => openTicket(x.t.id)}>{x.t.title}</button><div className="small muted">{x.why.join(' · ')}</div></div><span className="pts">{+x.t.points || 0}</span></li>)}</ul> : <p className="muted">The top of the backlog is ready.</p>}</section>
    </>;
  }
  const lab: Record<string, string> = { ok: 'Low', warn: 'Look into', na: 'Not measured', '': 'Watch' };
  return <>
    <section className="panel"><div className="phead"><div><h2>The 8 wastes (DOWNTIME)</h2><p className="small muted">What the data can show for each Lean waste.</p></div><Btn sm variant="ghost" onClick={() => go('flow')}>Flow metrics</Btn></div>
      <div className="tblwrap"><table><thead><tr><th>Waste</th><th>Signal in this project</th><th /></tr></thead><tbody>{wasteRows(p).map(([w, s, c]) => <tr key={w}><td><b>{w[0]}</b>{w.slice(1)}</td><td className="small">{s}</td><td><Chip cls={c === 'na' ? '' : (c as any)}>{lab[c]}</Chip></td></tr>)}</tbody></table></div></section>
    <Brief title="DMAIC charter draft" sub="Pre-filled from your flow metrics. Edit it before you share it." text={dmaicText(p)} />
  </>;
}

function Chat({ p, kind }: { p: Project; kind: CoachKind }) {
  const A = AGENTS[kind], conf = useAI(s => s.conf), k = p.id + ':' + kind;
  const hist = useAI(s => s.chats[k]) || [], pending = useAI(s => s.pending), ask = useAI(s => s.ask), reset = useAI(s => s.reset), stop = useAI(s => s.stop);
  const [draft, setDraft] = useState(''), box = useRef<HTMLDivElement>(null);
  const mine = pending && pending.k === k ? pending : null, busy = !!pending;
  useEffect(() => { if (box.current) box.current.scrollTop = box.current.scrollHeight }, [hist.length, mine?.text]);
  const send = async (text: string) => {
    if (!text.trim() || busy) return;
    setDraft('');
    const err = await ask(p, kind, text);
    if (err) { toast(err); setDraft(text) }
  };
  if (!conf.key) return <section className="panel chat"><h2>Ask the {A.name} coach</h2><p className="muted" style={{ margin: '8px 0 14px' }}>Connect Claude to talk this project through: why something is off track, what to do next, or a draft agenda, charter, or plan grounded in your data.</p><div><Btn variant="pri" onClick={openAiSettings}>Connect Claude</Btn></div><p className="small muted" style={{ marginTop: 12 }}>Uses your own Anthropic API key, stored only in this browser. The findings and playbook on this page work without it.</p></section>;
  return <section className="panel chat">
    <div className="phead"><h2>Ask the {A.name} coach</h2><div className="rowflex">{hist.length > 0 && !busy && <Btn sm variant="ghost" onClick={() => reset(k)} title="Start over with a fresh project snapshot">New conversation</Btn>}<Btn sm variant="ghost" onClick={openAiSettings}>Claude settings</Btn></div></div>
    <div className="msgs" ref={box} aria-live="polite">
      {!hist.length && !mine && <p className="small muted">Ask anything about this project, or start with one of these:</p>}
      {hist.map((m, i) => m.role === 'user' ? <div key={i} className="msg user">{m.shown || m.content}</div> : <div key={i} className="msg assistant" dangerouslySetInnerHTML={{ __html: md(m.content) }} />)}
      {mine && (mine.text ? <div className="msg assistant" dangerouslySetInnerHTML={{ __html: md(mine.text) }} /> : <div className="msg assistant"><span className="typing" aria-label="Thinking"><i /><i /><i /></span></div>)}
    </div>
    {!hist.length && !mine && <div className="sugs">{A.prompts.map(q => <Btn sm key={q} disabled={busy} onClick={() => send(q)}>{q}</Btn>)}</div>}
    <div className="ain">
      <textarea rows={2} value={draft} disabled={busy} aria-label="Message" placeholder={`Ask the ${A.name} coach. Enter to send, Shift+Enter for a new line.`} onChange={e => setDraft(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); send(draft) } }} />
      {mine ? <Btn onClick={stop}>Stop</Btn> : <Btn variant="pri" disabled={busy || !draft.trim()} onClick={() => send(draft)}>Send</Btn>}
    </div>
    <p className="small muted" style={{ marginTop: 8 }}>{AI_MODELS.find(x => x[0] === conf.model)?.[1] || conf.model}. Each new conversation sends a fresh project snapshot.{cfg(p).aiNotes[kind] ? ' Using your custom instructions.' : ''}</p>
  </section>;
}

export function Coach({ p, kind }: { p: Project; kind: CoachKind }) {
  const A = AGENTS[kind];
  return <>
    <Head title={A.name} desc={A.blurb} />
    <div className="agentgrid"><div className="stack"><Findings p={p} kind={kind} /><Tools p={p} kind={kind} /></div><Chat p={p} kind={kind} /></div>
  </>;
}
