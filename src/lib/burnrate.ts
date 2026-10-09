export interface FinanceDailySpend {
  date: string;
  spend: number | null;
  plannedSpend: number;
}

export interface SprintCost {
  budget: number;
  actual: number;
  remaining: number;
  plannedToDate: number;
  status: string;
  daily: FinanceDailySpend[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isFinanceDaily(value: unknown): value is FinanceDailySpend {
  return isRecord(value) &&
    typeof value.date === 'string' &&
    isFiniteNumber(value.plannedSpend) &&
    (value.spend === null || isFiniteNumber(value.spend));
}

export async function fetchSprintCost(
  origin: string,
  start: string,
  end: string,
  project: string,
  signal: AbortSignal,
): Promise<SprintCost> {
  let url: URL;
  try {
    url = new URL('/api/finance', origin);
  } catch {
    throw new Error('Enter a valid Burnrate Finance site origin in project settings.');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('Burnrate Finance URL must use HTTP or HTTPS.');
  }
  url.searchParams.set('view', 'sprint-cost');
  url.searchParams.set('start', start);
  url.searchParams.set('end', end);
  if (project) url.searchParams.set('project', project);

  const response = await fetch(url, { signal });
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new Error(`Burnrate Finance returned an invalid response (HTTP ${response.status}).`);
  }
  if (!response.ok) {
    const message = isRecord(body) && typeof body.error === 'string' ? body.error : `HTTP ${response.status}`;
    throw new Error(`Burnrate Finance request failed: ${message}`);
  }
  if (!isRecord(body) || !Array.isArray(body.daily)) {
    throw new Error('Burnrate Finance returned an invalid sprint-cost data shape.');
  }
  const daily = body.daily.filter(isFinanceDaily);
  if (daily.length !== body.daily.length) {
    throw new Error('Burnrate Finance returned an invalid sprint-cost data shape.');
  }
  if (!isFiniteNumber(body.budget) || !isFiniteNumber(body.actual) || !isFiniteNumber(body.remaining) || !isFiniteNumber(body.plannedToDate) || typeof body.status !== 'string') {
    throw new Error('Burnrate Finance returned incomplete sprint-cost totals.');
  }

  return {
    budget: body.budget,
    actual: body.actual,
    remaining: body.remaining,
    plannedToDate: body.plannedToDate,
    status: body.status,
    daily,
  };
}
