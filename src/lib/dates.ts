export const DAY = 864e5;

export const iso = (d: Date | number): string => {
  const x = new Date(d);
  return x.getFullYear() + '-' + String(x.getMonth() + 1).padStart(2, '0') + '-' + String(x.getDate()).padStart(2, '0');
};
export const parse = (s: string): Date => {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
};
export const addDays = (s: string, n: number): string => {
  const d = parse(s);
  d.setDate(d.getDate() + n);
  return iso(d);
};
export const diff = (a: string, b: string): number => Math.round((parse(b).getTime() - parse(a).getTime()) / DAY);
export const TODAY = iso(new Date());

export const fmtD = (s?: string | null) => (s ? parse(s).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : '—');
export const fmtDY = (s?: string | null) => (s ? parse(s).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : '—');

export function workdays(a: string, b: string): number {
  let n = 0;
  for (let d = a; d <= b; d = addDays(d, 1)) {
    const w = parse(d).getDay();
    if (w && w < 6) n++;
  }
  return n;
}
export function weekStart(d: string): string {
  const w = (parse(d).getDay() + 6) % 7;
  return addDays(d, -w);
}
export function nextMonday(from = TODAY): string {
  let x = from;
  while (parse(x).getDay() !== 1) x = addDays(x, 1);
  return x;
}
export function lastWorkday(): string {
  let d = addDays(TODAY, -1);
  while ([0, 6].includes(parse(d).getDay())) d = addDays(d, -1);
  return d;
}

export const plural = (n: number, w: string) => n + ' ' + w + (n === 1 ? '' : 's');
export const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-3);
export const cx = (...a: (string | false | null | undefined)[]) => a.filter(Boolean).join(' ');
