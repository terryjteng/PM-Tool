import type { ImplStatus, Priority, Project, RiskKind, Settings, Severity, Status, TicketType } from './types';

export const STATUSES: Status[] = ['triage', 'backlog', 'todo', 'inprogress', 'review', 'done'];
export const TYPES: TicketType[] = ['story', 'task', 'bug', 'feature'];
export const PRIORITIES: [Priority, string][] = [['P0', 'P0 Urgent'], ['P1', 'P1 High'], ['P2', 'P2 Medium'], ['P3', 'P3 Low']];
export const SEVERITIES: [Severity, string][] = [['critical', 'Critical'], ['major', 'Major'], ['minor', 'Minor'], ['trivial', 'Trivial']];
export const COLORS: [string, string][] = [['#2F5BEA', 'Cobalt'], ['#7A5AF8', 'Violet'], ['#0E9384', 'Teal'], ['#C98A12', 'Amber'], ['#C8453B', 'Brick'], ['#3F7D20', 'Moss'], ['#B4467D', 'Plum'], ['#4B5B6E', 'Slate']];
export const RAID: [RiskKind, string][] = [['risk', 'Risk'], ['assumption', 'Assumption'], ['issue', 'Issue'], ['dependency', 'Dependency']];
export const IMPL_STATUS: [ImplStatus, string][] = [['todo', 'Not started'], ['doing', 'In progress'], ['blocked', 'Blocked'], ['done', 'Done']];

export const DEFAULT_SETTINGS: Settings = {
  statusLabels: { triage: 'Triage', backlog: 'Backlog', todo: 'To do', inprogress: 'In progress', review: 'In review', done: 'Done' },
  typeLabels: { story: 'Story', task: 'Task', bug: 'Bug', feature: 'Feature request' },
  wipLimits: { inprogress: 0, review: 0 },
  sprintDays: 14,
  defaultPoints: 3,
  flowWindow: 90,
  usl: 0,
  coach: { disabled: [], staleDays: 5, bigPoints: 13, sayDoMin: 80, readySprints: 2 },
  aiNotes: {},
  financeApiUrl: '',
  financeProject: '',
};

/** Project settings with defaults filled in, so older saved projects keep working. */
export function cfg(p: Project): Settings {
  const s = p.settings || {};
  const d = DEFAULT_SETTINGS;
  return {
    ...d,
    ...s,
    statusLabels: { ...d.statusLabels, ...(s.statusLabels || {}) },
    typeLabels: { ...d.typeLabels, ...(s.typeLabels || {}) },
    wipLimits: { ...d.wipLimits, ...(s.wipLimits || {}) },
    coach: { ...d.coach, ...(s.coach || {}) },
    aiNotes: { ...(s.aiNotes || {}) },
  };
}

export const IMPL_TEMPLATES: { id: string; name: string; desc: string; phases: { name: string; tasks: string[] }[] }[] = [
  {
    id: 'software',
    name: 'Software implementation',
    desc: 'Rolling out a system or platform to an organization, from kickoff through hypercare.',
    phases: [
      { name: 'Initiate', tasks: ['Hold the kickoff meeting', 'Map stakeholders and agree a RACI', 'Get the project charter signed off', 'Define success criteria and KPIs'] },
      { name: 'Plan', tasks: ['Sign off requirements', 'Baseline the implementation timeline', 'Provision environments', 'Write the data migration plan', 'Review the risk register', 'Publish the communication plan'] },
      { name: 'Build and test', tasks: ['Configure and build', 'Run integration testing', 'Do a data migration dry run', 'Run user acceptance testing', 'Prepare training materials', 'Send change-management communications'] },
      { name: 'Go-live', tasks: ['Hold the go / no-go meeting', 'Finalize the cutover runbook', 'Deploy to production', 'Smoke test production', 'Announce the launch'] },
      { name: 'Hypercare and close', tasks: ['Staff the hypercare support window', 'Triage issues daily', 'Hand over to support', 'Run a lessons-learned session', 'Write the closure report', 'Get stakeholder sign-off'] },
    ],
  },
  {
    id: 'launch',
    name: 'Product launch',
    desc: 'Getting a feature or product out the door with marketing, support, and sales ready.',
    phases: [
      { name: 'Readiness', tasks: ['Confirm the launch date and owner', 'Agree positioning and messaging', 'Define launch metrics'] },
      { name: 'Enablement', tasks: ['Write help-center articles', 'Train support', 'Brief sales', 'Prepare release notes'] },
      { name: 'Launch', tasks: ['Flip feature flags', 'Publish the announcement', 'Monitor errors and feedback'] },
      { name: 'Follow-through', tasks: ['Review launch metrics after two weeks', 'Collect and triage feedback', 'Share the launch retrospective'] },
    ],
  },
];
