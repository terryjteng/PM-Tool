import { useState, type ReactNode } from 'react';
import { plural } from '../lib/dates';

export function niceMax(v: number) {
  if (v <= 0) return { max: 4, step: 1 };
  const raw = v / 4, p = Math.pow(10, Math.floor(Math.log10(raw))), n = raw / p;
  const s = (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * p;
  return { max: Math.ceil(v / s) * s, step: s };
}
function YGrid({ w, pl, pr, y, max, step }: { w: number; pl: number; pr: number; y: (v: number) => number; max: number; step: number }) {
  const out: ReactNode[] = [];
  for (let v = 0; v <= max + 1e-9; v += step) out.push(<g key={v}><line x1={pl} x2={w - pr} y1={y(v)} y2={y(v)} stroke="var(--line)" /><text x={pl - 7} y={y(v) + 4} textAnchor="end" fontSize={11} fill="var(--muted)">{Math.round(v)}</text></g>);
  return <>{out}</>;
}
function XTicks({ labels, x, h }: { labels: string[]; x: (i: number) => number; h: number }) {
  const n = labels.length, k = Math.ceil(n / 7);
  return <>{labels.map((l, i) => (i % k === 0 || i === n - 1) && (n - 1 - i >= k / 2 || i === n - 1) ? <text key={i} x={x(i)} y={h - 8} textAnchor="middle" fontSize={11} fill="var(--muted)">{l}</text> : null)}</>;
}

export interface Series { name: string; vals: (number | null)[]; color: string; dash?: boolean; dots?: boolean; width?: number }
/** Line chart with a hover readout. null values break the line (used for projections). */
export function LineChart({ w = 640, h = 230, labels, series, ymax, label, markers = [] }: { w?: number; h?: number; labels: string[]; series: Series[]; ymax?: number; label?: string; markers?: { i: number; text: string; color: string }[] }) {
  const [hov, setHov] = useState<number | null>(null);
  const pl = 36, pr = 12, pt = 12, pb = 28, n = labels.length;
  const { max, step } = niceMax(ymax || Math.max(1, ...series.flatMap(s => s.vals.filter((v): v is number => v != null))));
  const x = (i: number) => pl + i * (w - pl - pr) / Math.max(1, n - 1), y = (v: number) => pt + (h - pt - pb) * (1 - v / max);
  const path = (vals: (number | null)[]) => { let d = '', pen = false; vals.forEach((v, i) => { if (v == null) { pen = false; return } d += (pen ? 'L' : 'M') + x(i).toFixed(1) + ' ' + y(v).toFixed(1) + ' '; pen = true }); return d };
  const onMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect(), px = (e.clientX - r.left) / r.width * w;
    setHov(Math.max(0, Math.min(n - 1, Math.round((px - pl) / Math.max(1e-9, (w - pl - pr) / Math.max(1, n - 1))))));
  };
  return (
    <div className="chartwrap">
      <svg className="chart" viewBox={`0 0 ${w} ${h}`} role="img" aria-label={label || series.map(s => s.name).join(' vs ')} onPointerMove={onMove} onPointerLeave={() => setHov(null)}>
        <YGrid w={w} pl={pl} pr={pr} y={y} max={max} step={step} />
        <XTicks labels={labels} x={x} h={h} />
        {markers.map(m => <g key={m.text}><line x1={x(m.i)} x2={x(m.i)} y1={pt} y2={h - pb} stroke={m.color} strokeDasharray="3 4" /><text x={x(m.i) + 4} y={pt + 10} fontSize={10.5} fill={m.color}>{m.text}</text></g>)}
        {series.map(s => <path key={s.name} d={path(s.vals)} fill="none" stroke={s.color} strokeWidth={s.width ?? (s.dash ? 1.5 : 2.5)} strokeDasharray={s.dash ? '5 4' : undefined} strokeLinejoin="round" strokeLinecap="round" />)}
        {series.filter(s => s.dots).map(s => s.vals.map((v, i) => v == null ? null : <circle key={s.name + i} cx={x(i)} cy={y(v)} r={3} fill="var(--panel)" stroke={s.color} strokeWidth={2} />))}
        {hov != null && <line x1={x(hov)} x2={x(hov)} y1={pt} y2={h - pb} stroke="var(--muted)" strokeOpacity={.5} />}
        {hov != null && series.map(s => s.vals[hov] == null ? null : <circle key={'h' + s.name} cx={x(hov)} cy={y(s.vals[hov]!)} r={4.5} fill={s.color} stroke="var(--panel)" strokeWidth={2} />)}
      </svg>
      {hov != null && <div className="charttip" style={{ left: `${x(hov) / w * 100}%` }}><b>{labels[hov]}</b>{series.map(s => s.vals[hov] == null ? null : <span key={s.name}><i style={{ background: s.color }} />{s.name}: {Math.round(s.vals[hov]! * 10) / 10}</span>)}</div>}
    </div>
  );
}

export function BarChart({ w = 640, h = 230, groups, avg, ymax }: { w?: number; h?: number; groups: { label: string; vals: { v: number; color: string; name?: string }[] }[]; avg?: number; ymax?: number }) {
  const pl = 36, pr = 12, pt = 14, pb = 28, { max, step } = niceMax(ymax || 1), y = (v: number) => pt + (h - pt - pb) * (1 - v / max);
  const n = groups.length || 1, gw = (w - pl - pr) / n;
  return (
    <svg className="chart" viewBox={`0 0 ${w} ${h}`} role="img" aria-label="Bar chart">
      <YGrid w={w} pl={pl} pr={pr} y={y} max={max} step={step} />
      {groups.map((gr, i) => {
        const k = gr.vals.length, bw = Math.min(26, gw * .7 / k), x0 = pl + i * gw + (gw - bw * k - 4 * (k - 1)) / 2;
        return <g key={i}>{gr.vals.map((b, j) => { const bx = x0 + j * (bw + 4); return <g key={j}><rect x={bx} y={y(b.v)} width={bw} height={y(0) - y(b.v)} rx={3} fill={b.color}><title>{gr.label}{b.name ? ` ${b.name}` : ''}: {b.v}</title></rect><text x={bx + bw / 2} y={y(b.v) - 4} textAnchor="middle" fontSize={10} fill="var(--muted)">{b.v}</text></g> })}<text x={pl + i * gw + gw / 2} y={h - 8} textAnchor="middle" fontSize={11} fill="var(--muted)">{gr.label}</text></g>;
      })}
      {!!avg && <><line x1={pl} x2={w - pr} y1={y(avg)} y2={y(avg)} stroke="var(--ink)" strokeDasharray="5 4" /><text x={w - pr} y={y(avg) - 5} textAnchor="end" fontSize={11} fill="var(--ink)">avg {avg}</text></>}
    </svg>
  );
}

export function AreaChart({ w = 640, h = 230, labels, layers }: { w?: number; h?: number; labels: string[]; layers: { name: string; color: string; vals: number[] }[] }) {
  const pl = 36, pr = 12, pt = 12, pb = 28, n = labels.length, tot = labels.map((_, i) => layers.reduce((a, l) => a + l.vals[i], 0));
  const { max, step } = niceMax(Math.max(...tot, 1));
  const x = (i: number) => pl + i * (w - pl - pr) / Math.max(1, n - 1), y = (v: number) => pt + (h - pt - pb) * (1 - v / max), P = (i: number, v: number) => x(i).toFixed(1) + ' ' + y(v).toFixed(1);
  const base = labels.map(() => 0);
  const paths = layers.map(l => {
    const top = base.map((b, i) => b + l.vals[i]);
    const d = `M${top.map((v, i) => P(i, v)).join(' L')} L${base.map((v, i) => P(i, v)).reverse().join(' L')}Z`;
    top.forEach((v, i) => (base[i] = v));
    return <path key={l.name} d={d} fill={l.color} stroke="var(--panel)" strokeWidth={1}><title>{l.name}: {l.vals[n - 1]} now</title></path>;
  });
  return <svg className="chart" viewBox={`0 0 ${w} ${h}`} role="img" aria-label="Cumulative flow diagram"><YGrid w={w} pl={pl} pr={pr} y={y} max={max} step={step} /><XTicks labels={labels} x={x} h={h} />{paths}</svg>;
}

export function ControlChart({ w = 640, h = 240, pts, st, usl, onPick }: { w?: number; h?: number; pts: { v: number; label: string; id: string; key: string; bad: boolean }[]; st: { m: number; sig: number; ucl: number; lcl: number }; usl: number; onPick: (id: string) => void }) {
  const pl = 36, pr = 62, pt = 12, pb = 28, n = pts.length, { max, step } = niceMax(Math.max(st.ucl, usl || 0, ...pts.map(p => p.v), 1));
  const x = (i: number) => pl + (n < 2 ? (w - pl - pr) / 2 : i * (w - pl - pr) / (n - 1)), y = (v: number) => pt + (h - pt - pb) * (1 - v / max);
  const HL = ({ v, c, l, dash }: { v: number; c: string; l: string; dash?: boolean }) => <g><line x1={pl} x2={w - pr} y1={y(v)} y2={y(v)} stroke={c} strokeDasharray={dash ? '5 4' : undefined} /><text x={w - pr + 5} y={y(v) + 4} fontSize={10.5} fill={c}>{l}</text></g>;
  return (
    <svg className="chart" viewBox={`0 0 ${w} ${h}`} role="img" aria-label="Cycle time control chart">
      <YGrid w={w} pl={pl} pr={pr} y={y} max={max} step={step} />
      <XTicks labels={pts.map(p => p.label)} x={x} h={h} />
      <HL v={st.m} c="var(--ink)" l={'mean ' + st.m.toFixed(1)} />
      {st.sig > 0 && <HL v={st.ucl} c="var(--bad)" l={'UCL ' + st.ucl.toFixed(1)} dash />}
      {st.sig > 0 && st.lcl > 0 && <HL v={st.lcl} c="var(--bad)" l={'LCL ' + st.lcl.toFixed(1)} dash />}
      {usl > 0 && <HL v={usl} c="var(--warn)" l={'target ' + usl} dash />}
      <path d={pts.map((p, i) => (i ? 'L' : 'M') + x(i).toFixed(1) + ' ' + y(p.v).toFixed(1)).join(' ')} fill="none" stroke="var(--muted)" strokeOpacity={.5} strokeWidth={1.2} />
      {pts.map((p, i) => <circle key={p.id} className="pick" cx={x(i)} cy={y(p.v)} r={p.bad ? 4.5 : 3.5} fill={p.bad ? 'var(--bad)' : 'var(--accent)'} stroke="var(--panel)" strokeWidth={1.5} onClick={() => onPick(p.id)}><title>{p.key}: {plural(p.v, 'day')}, done {p.label}</title></circle>)}
    </svg>
  );
}

export function ParetoChart({ w = 640, h = 240, rows }: { w?: number; h?: number; rows: { k: string; v: number; cum: number }[] }) {
  const pl = 36, pr = 40, pt = 14, pb = 34, n = rows.length || 1, gw = (w - pl - pr) / n, { max, step } = niceMax(Math.max(...rows.map(r => r.v), 1));
  const y = (v: number) => pt + (h - pt - pb) * (1 - v / max), yp = (p: number) => pt + (h - pt - pb) * (1 - p / 100), cx = (i: number) => pl + i * gw + gw / 2;
  return (
    <svg className="chart" viewBox={`0 0 ${w} ${h}`} role="img" aria-label="Pareto chart of bugs by category">
      <YGrid w={w} pl={pl} pr={pr} y={y} max={max} step={step} />
      <line x1={pl} x2={w - pr} y1={yp(80)} y2={yp(80)} stroke="var(--warn)" strokeDasharray="5 4" />
      <text x={w - pr + 5} y={yp(80) + 4} fontSize={10.5} fill="var(--warn)">80%</text>
      <text x={w - pr + 5} y={yp(100) + 4} fontSize={10.5} fill="var(--muted)">100%</text>
      {rows.map((r, i) => {
        const bw = Math.min(44, gw * .7), vital = (i ? rows[i - 1].cum : 0) < 80;
        return <g key={r.k}><rect x={cx(i) - bw / 2} y={y(r.v)} width={bw} height={y(0) - y(r.v)} rx={3} fill={vital ? 'var(--bad)' : 'color-mix(in srgb,var(--bad) 30%,var(--panel))'}><title>{r.k}: {plural(r.v, 'bug')}, {Math.round(r.cum)}% cumulative</title></rect><text x={cx(i)} y={h - 12} textAnchor="middle" fontSize={10.5} fill="var(--muted)">{r.k.length > 11 ? r.k.slice(0, 10) + '…' : r.k}</text></g>;
      })}
      <path d={rows.map((r, i) => (i ? 'L' : 'M') + cx(i).toFixed(1) + ' ' + yp(r.cum).toFixed(1)).join(' ')} fill="none" stroke="var(--ink)" strokeWidth={1.8} />
      {rows.map((r, i) => <circle key={'c' + r.k} cx={cx(i)} cy={yp(r.cum)} r={3} fill="var(--panel)" stroke="var(--ink)" strokeWidth={1.8} />)}
    </svg>
  );
}
