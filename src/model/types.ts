export type Status = 'triage' | 'backlog' | 'todo' | 'inprogress' | 'review' | 'done';
export type TicketType = 'story' | 'task' | 'bug' | 'feature';
export type Priority = 'P0' | 'P1' | 'P2' | 'P3';
export type Severity = 'critical' | 'major' | 'minor' | 'trivial';
export type Cls = 'ok' | 'warn' | 'bad' | '';

export interface Ticket {
  id: string;
  key: string;
  title: string;
  type: TicketType;
  status: Status;
  priority: Priority;
  severity: Severity | null;
  points: number;
  assignee: string | null;
  sprintId: string | null;
  epicId: string | null;
  start: string | null;
  due: string | null;
  deps: string[];
  votes: number;
  reporter: string;
  labels: string;
  desc: string;
  createdAt: string;
  startedAt: string | null;
  doneAt: string | null;
  rank: number;
}

export interface Member {
  id: string;
  name: string;
  role: string;
  capacity: number;
  color: string;
  timeOff: Record<string, number>;
}

export interface Sprint {
  id: string;
  name: string;
  start: string;
  end: string;
  goal: string;
  status: 'planned' | 'active' | 'closed';
  committed?: number;
  completed?: number;
  /** remaining points per day, frozen when the sprint closes */
  burn?: number[];
  /** daily [total points, done points], recorded while the sprint is active */
  scopeLog?: Record<string, [number, number]>;
}

export interface Epic { id: string; title: string; start: string; end: string; color: string; milestoneId: string | null; desc?: string }
export interface Milestone { id: string; title: string; date: string; desc?: string }
export type RiskKind = 'risk' | 'assumption' | 'issue' | 'dependency';
export interface Risk { id: string; kind: RiskKind; title: string; status: 'open' | 'mitigating' | 'closed'; likelihood: number; impact: number; owner: string | null; mitigation?: string }

export interface RetroItem { id: string; text: string; ticketId?: string | null; done?: boolean }
export interface Retro { id: string; sprintId: string; well: RetroItem[]; improve: RetroItem[]; actions: RetroItem[] }
export type RetroCol = 'well' | 'improve' | 'actions';

export type ImplStatus = 'todo' | 'doing' | 'blocked' | 'done';
export interface ImplPhase { id: string; name: string }
export interface CheckItem { id: string; text: string; done: boolean }
export interface ImplTask {
  id: string;
  phaseId: string;
  title: string;
  owner: string | null;
  due: string | null;
  status: ImplStatus;
  notes: string;
  checklist: CheckItem[];
  rank: number;
  ticketId?: string | null;
}

export interface Settings {
  statusLabels: Record<Status, string>;
  typeLabels: Record<TicketType, string>;
  wipLimits: { inprogress: number; review: number };
  sprintDays: number;
  defaultPoints: number;
  flowWindow: number;
  usl: number;
  coach: { disabled: string[]; staleDays: number; bigPoints: number; sayDoMin: number; readySprints: number };
  aiNotes: Record<string, string>;
}

export interface Project {
  id: string;
  createdAt: string;
  name: string;
  key: string;
  desc: string;
  members: Member[];
  sprints: Sprint[];
  epics: Epic[];
  milestones: Milestone[];
  risks: Risk[];
  retros: Retro[];
  impl: { phases: ImplPhase[]; tasks: ImplTask[] };
  baseline: { at: string; items: Record<string, [string, string]> } | null;
  settings: Partial<Settings>;
  nextNum: number;
  tickets: Record<string, Ticket>;
}

export interface Workspace { projects: Record<string, Project> }
