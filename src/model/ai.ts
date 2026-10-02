import { create } from 'zustand';
import type { Project, Ticket } from './types';
import { TODAY, addDays } from '../lib/dates';
import { activeSprint, byId, byRank, epicProgress, isDone, member, msStatus, sayDo, sortedSprints, sprintCap, sprintPulse, tickets, velocity, implProgress } from './selectors';
import { bugPareto, flowStats, monteCarlo } from './flow';
import { agileFindings, lssFindings, scrumFindings, type CoachKind, type Finding } from './coaches';
import { cfg } from './constants';

export const AI_MODELS: [string, string][] = [
  ['claude-opus-5-5', 'Claude Opus 5.5 (most capable)'],
  ['claude-sonnet-5-5', 'Claude Sonnet 5.5 (faster, lower cost)'],
  ['claude-haiku-4-5', 'Claude Haiku 4.5 (fastest)'],
];
export const AI_EFFORT: [string, string][] = [['low', 'Low (quickest)'], ['medium', 'Medium (balanced)'], ['high', 'High (most thorough)']];

const AI_BASE = `You are a coach built into Throughline, a project planning tool with a roadmap, Gantt timeline, backlog, sprint planning, sprint board, burndown charts, an implementation plan, bug and request intake, team capacity, a RAID risk log, flow metrics, retrospectives, and reports.

The user's first message starts with a JSON snapshot of their current project, taken when the conversation began. Points are story points. Ticket statuses run triage → backlog → todo → inprogress → review → done. Descriptions are trimmed to 300 characters, and openTicketsOmitted / doneLast6WeeksOmitted say how many tickets were left out of those lists. findingsOnThisPage holds the rule-based checks the user is looking at next to this chat. implementationPlan holds the project manager's implementation tasks by phase.

Ground what you say in the snapshot: cite ticket keys, sprint names, dates, and numbers. When the data can't support a conclusion, say what's missing instead of guessing. You can't change the project yourself, so when you recommend a change, say where in Throughline to make it (for example, "split PRJ-14 in the Backlog" or "set a sprint goal in Sprint planning").

Answer like a senior practitioner talking to a colleague: lead with the answer, keep it practical, and prefer a short, prioritized list of actions to theory. Use Markdown with brief headings and bullets. Keep routine answers under about 350 words; go longer when the user asks for a document such as a charter, agenda, or plan.`;

export const AGENTS: Record<CoachKind, { name: string; blurb: string; how: string; find: (p: Project) => Finding[]; prompts: string[]; role: string }> = {
  scrum: {
    name: 'Scrum Master',
    blurb: 'Guards the sprint: the goal, the commitment, impediments, work in progress, and the Scrum events (planning, daily scrum, review, and retrospective).',
    how: 'Checked in your browser against the current sprint, the board, and your retro history.',
    find: scrumFindings,
    prompts: ['Run today’s standup: what should we talk about?', 'Is the sprint goal at risk, and what should we do about it?', 'Plan a 45-minute retrospective for the last sprint', 'Draft talking points for the sprint review'],
    role: 'Your role: an experienced Professional Scrum Master. You focus on the sprint goal, transparency, inspection and adaptation, removing impediments, and making the Scrum events useful. You coach the team toward self-management rather than directing it, and you follow the intent of the Scrum Guide without being dogmatic.',
  },
  agile: {
    name: 'Agile Coach',
    blurb: 'Looks after the backlog and the system around the team: refinement and readiness, estimation, prioritization by value, velocity and predictability, roadmap realism, and the implementation plan.',
    how: 'Checked in your browser against the backlog, sprint history, epics, milestones, and implementation plan.',
    find: agileFindings,
    prompts: ['Which backlog items should we refine or split next?', 'Rank the top of the backlog by WSJF and explain the order', 'Are our milestones realistic given our velocity?', 'Review our implementation plan: what’s missing or at risk?'],
    role: 'Your role: a pragmatic agile coach who draws on Scrum, Kanban, XP, and lightweight scaled-agile ideas such as WSJF. You focus on backlog health and refinement (INVEST, definition of ready and done, story splitting), estimation and probabilistic forecasting, prioritization by value and cost of delay, sustainable pace, implementation planning, and whether the roadmap is realistic.',
  },
  lss: {
    name: 'Lean Six Sigma',
    blurb: 'Treats delivery as a process to measure and improve: cycle-time variation, process capability, flow and work in progress, the 8 wastes, and root causes of defects.',
    how: 'Computed in your browser from cycle times, throughput, WIP, and bug history.',
    find: lssFindings,
    prompts: ['Draft a DMAIC charter to reduce our cycle time', 'Run a 5 Whys on our worst cycle-time outliers', 'Where is the waste in our process?', 'Build a SIPOC for how work moves through this team'],
    role: 'Your role: a Lean Six Sigma Black Belt applying Lean and Six Sigma to software delivery. You use DMAIC, SIPOC, value-stream thinking, the 8 wastes (DOWNTIME), 5 Whys and fishbone analysis, Pareto analysis, and statistical process control. flowMetrics in the snapshot holds cycle times (start to done, inclusive days) with XmR control limits, Cpk against the team\'s target, aging WIP, the bug Pareto, and a Monte Carlo forecast. Be precise with statistics, distinguish special-cause from common-cause variation, and say when a sample is too small to support a conclusion.',
  },
};

export function systemPrompt(p: Project, kind: CoachKind) {
  const notes = (cfg(p).aiNotes[kind] || '').trim();
  return AI_BASE + '\n\n' + AGENTS[kind].role + (notes ? `\n\nNotes from the team about how they want you to work:\n${notes}` : '');
}

export function aiSnapshot(p: Project, kind: CoachKind) {
  const nm = (id: string | null) => member(p, id)?.name || null, ep = (id: string | null) => byId(p.epics, id)?.title || null, sn = (id: string | null) => byId(p.sprints, id)?.name || null, r1 = (v: number) => Math.round(v * 10) / 10;
  const tk = (t: Ticket) => ({
    key: t.key, title: t.title, type: t.type, status: t.status, priority: t.priority, severity: t.severity || undefined, points: +t.points || 0, assignee: nm(t.assignee), sprint: sn(t.sprintId), epic: ep(t.epicId),
    blockedBy: (t.deps || []).map(id => p.tickets[id]?.key).filter(Boolean), start: t.start || undefined, due: t.due || undefined, created: t.createdAt || undefined, started: t.startedAt || undefined, done: t.doneAt || undefined,
    votes: +t.votes || undefined, labels: t.labels || undefined, description: t.desc ? String(t.desc).slice(0, 300) : undefined,
  });
  const open = tickets(p).filter(t => !isDone(t)).sort((a, b) => Number(a.status === 'triage') - Number(b.status === 'triage') || byRank(a, b));
  const rec = tickets(p).filter(t => isDone(t) && !!t.doneAt && t.doneAt >= addDays(TODAY, -42)).sort((a, b) => (a.doneAt! < b.doneAt! ? 1 : -1));
  const f = flowStats(p), pa = bugPareto(p), a = activeSprint(p), openW = open.filter(t => t.status !== 'triage'), mc = monteCarlo(openW.length, f.daily);
  return {
    today: TODAY, project: { name: p.name, key: p.key, objective: p.desc || '' },
    team: p.members.map(m => ({ name: m.name, role: m.role || '', pointsPerSprint: +m.capacity || 0 })), velocityLast3Sprints: velocity(p), sayDoLast3SprintsPct: sayDo(p),
    sprints: sortedSprints(p).map(s => ({ name: s.name, start: s.start, end: s.end, status: s.status, goal: s.goal || '', committed: s.committed, completed: s.status === 'closed' ? s.completed || 0 : undefined, capacity: sprintCap(p, s) })),
    activeSprint: a ? (pl => ({ name: a.name, day: pl.day, length: pl.len, committed: pl.committed, pointsNow: pl.total, pointsDone: pl.done, burndownSignal: pl.sig }))(sprintPulse(p, a)) : null,
    epics: p.epics.map(e => { const x = epicProgress(p, e); return { title: e.title, start: e.start, end: e.end, milestone: byId(p.milestones, e.milestoneId)?.title || null, points: x.tot, donePoints: x.done } }),
    milestones: p.milestones.map(m => { const r = msStatus(p, m); return { title: m.title, date: m.date, status: r.st, forecast: r.f.date, remainingPoints: r.f.rem } }),
    risks: p.risks.map(x => ({ type: x.kind, title: x.title, status: x.status, likelihood: x.likelihood, impact: x.impact, owner: nm(x.owner), mitigation: x.mitigation || '' })),
    retrospectives: p.retros.map(x => ({ sprint: sn(x.sprintId), wentWell: x.well.map(i => i.text), toImprove: x.improve.map(i => i.text), actions: x.actions.map(i => ({ text: i.text, ticket: i.ticketId ? p.tickets[i.ticketId]?.key || null : null, done: !!i.done })) })),
    implementationPlan: { progressPct: implProgress(p).pct, phases: p.impl.phases.map(ph => ({ phase: ph.name, tasks: p.impl.tasks.filter(t => t.phaseId === ph.id).sort(byRank).map(t => ({ title: t.title, status: t.status, owner: nm(t.owner), due: t.due, notes: t.notes ? t.notes.slice(0, 200) : undefined, checklist: t.checklist.length ? `${t.checklist.filter(c => c.done).length}/${t.checklist.length}` : undefined })) })) },
    flowMetrics: {
      windowDays: f.window, sampleSize: f.ct.length, meanCycleDays: r1(f.x.m), sigmaFromMovingRange: r1(f.x.sig), ucl: r1(f.x.ucl), lcl: r1(f.x.lcl), p50: f.p50, p85: f.p85, p95: f.p95, targetCycleDays: f.usl || null,
      cpk: f.cpk == null ? null : Math.round(f.cpk * 100) / 100, dpmo: f.dpmo, aboveUcl: f.out.map(i => ({ key: f.done[i].key, days: f.ct[i] })), processShiftDetected: f.shifts.length > 0, wipNow: f.wip.length,
      throughputPerWeek: r1(f.thrDay * 7), avgLeadDays: r1(f.leadAvg), agingWip: f.aging.slice(0, 10).map(x => ({ key: x.t.key, status: x.t.status, ageDays: x.age })),
      bugPareto: pa.rows.map(r => ({ category: r.k, bugs: r.v, cumulativePct: Math.round(r.cum) })),
      monteCarloAllOpenWork: mc ? { items: openW.length, p50: addDays(TODAY, mc.p50), p85: addDays(TODAY, mc.p85), p95: addDays(TODAY, mc.p95) } : null,
    },
    openTickets: open.slice(0, 150).map(tk), openTicketsOmitted: Math.max(0, open.length - 150),
    doneLast6Weeks: rec.slice(0, 60).map(tk), doneLast6WeeksOmitted: Math.max(0, rec.length - 60),
    findingsOnThisPage: AGENTS[kind].find(p).map(x => ({ severity: x.cls || 'info', title: x.t, detail: x.d || '', recommendation: x.fix || '' })),
  };
}

/* ---------- connection settings (per browser, not per project) ---------- */
const LS_AI = 'throughline:ai';
interface AIConf { key: string; model: string; effort: string }
function loadConf(): AIConf {
  const d = { key: '', model: 'claude-opus-5-5', effort: 'medium' };
  try { return { ...d, ...JSON.parse(localStorage.getItem(LS_AI) || '{}') } } catch { return d }
}

export interface ChatMsg { role: 'user' | 'assistant'; content: string; shown?: string }
interface AIState {
  conf: AIConf;
  chats: Record<string, ChatMsg[]>;
  pending: { k: string; text: string } | null;
  error: string | null;
  setConf: (c: Partial<AIConf>) => boolean;
  reset: (k: string) => void;
  ask: (p: Project, kind: CoachKind, text: string) => Promise<string | null>;
  stop: () => void;
}
let current: { abort: () => void } | null = null;

export const useAI = create<AIState>((set, get) => ({
  conf: loadConf(),
  chats: {},
  pending: null,
  error: null,
  setConf(c) {
    const conf = { ...get().conf, ...c };
    set({ conf });
    try { localStorage.setItem(LS_AI, JSON.stringify(conf)); return true } catch { return false }
  },
  reset(k) { const chats = { ...get().chats }; delete chats[k]; set({ chats }) },
  stop() { current?.abort() },
  /** Streams one answer. Returns an error message for the caller to show, or null on success. */
  async ask(p, kind, text) {
    text = text.trim();
    const { conf, pending } = get();
    if (!text || pending) return null;
    const k = p.id + ':' + kind, prior = get().chats[k] || [];
    const user: ChatMsg = { role: 'user', shown: text, content: prior.length ? text : `Project snapshot as JSON, taken ${TODAY}:\n\n${JSON.stringify(aiSnapshot(p, kind))}\n\n${text}` };
    const hist = [...prior, user];
    set({ chats: { ...get().chats, [k]: hist }, pending: { k, text: '' } });
    const fail = (m: string) => { set({ chats: { ...get().chats, [k]: prior }, pending: null }); current = null; return m };
    let Anthropic: typeof import('@anthropic-ai/sdk').default;
    try { Anthropic = (await import('@anthropic-ai/sdk')).default } catch { return fail('Couldn’t load the Anthropic SDK. Check your connection and try again.') }
    try {
      const client = new Anthropic({ apiKey: conf.key, dangerouslyAllowBrowser: true });
      const model = conf.model || 'claude-opus-5-5';
      const params: Record<string, unknown> = { model, max_tokens: 16000, system: systemPrompt(p, kind), messages: hist.map(m => ({ role: m.role, content: m.content })) };
      if (model !== 'claude-haiku-4-5') params.output_config = { effort: conf.effort || 'medium' };
      // On a safety-classifier refusal the API re-runs the request on Anthropic's recommended fallback model.
      if (model === 'claude-opus-5-5' || model === 'claude-sonnet-5-5') { params.fallbacks = 'default'; params.betas = ['server-side-fallback-2026-07-01'] }
      const stream = client.beta.messages.stream(params as any);
      current = stream;
      stream.on('text', (d: string) => { const pd = get().pending; if (pd && pd.k === k) set({ pending: { k, text: pd.text + d } }) });
      const msg: any = await stream.finalMessage();
      if (msg.stop_reason === 'refusal') return fail('Claude declined to answer that. Try rephrasing the question.');
      // After a mid-stream fallback, only the content after the last fallback marker is the answer.
      const bl: any[] = msg.content || [], fi = bl.map(b => b.type).lastIndexOf('fallback');
      let out = bl.slice(fi + 1).filter(b => b.type === 'text').map(b => b.text).join('').trim();
      if (!out) return fail('Claude returned an empty answer. Try again.');
      if (msg.stop_reason === 'max_tokens') out += '\n\n*(This answer hit the length limit and was cut off.)*';
      set({ chats: { ...get().chats, [k]: [...hist, { role: 'assistant', content: out }] }, pending: null });
      current = null;
      return null;
    } catch (e: any) {
      if (e instanceof Anthropic.APIUserAbortError) return fail('Stopped.');
      if (e instanceof Anthropic.AuthenticationError) return fail('Anthropic rejected the API key. Update it in Claude settings.');
      if (e instanceof Anthropic.PermissionDeniedError) return fail('This API key doesn’t have access to that model. Pick another in Claude settings.');
      if (e instanceof Anthropic.NotFoundError) return fail('That model wasn’t found. Pick another in Claude settings.');
      if (e instanceof Anthropic.RateLimitError) return fail('The Anthropic API is rate limiting this key. Wait a moment and try again.');
      if (e instanceof Anthropic.APIConnectionError) return fail('Couldn’t reach the Anthropic API. Check your connection.');
      if (e instanceof Anthropic.APIError) return fail(`Anthropic API error${e.status ? ' ' + e.status : ''}: ${e.message || 'unknown error'}`);
      return fail('Something went wrong: ' + (e?.message || e));
    }
  },
}));
