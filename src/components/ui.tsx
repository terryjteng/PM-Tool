import { useEffect, useId, useRef, useState, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { cx } from '../lib/dates';
import type { Cls, Epic, Member, Priority, Project, Severity, Ticket } from '../model/types';
import { closeModal, toast, undo, useUI } from '../model/ui';
import { byId } from '../model/selectors';
import { cfg } from '../model/constants';

type BtnProps = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'pri' | 'ghost' | 'danger'; sm?: boolean; lg?: boolean };
export function Btn({ variant, sm, lg, className, type = 'button', ...rest }: BtnProps) {
  return <button type={type} className={cx('btn', variant, sm && 'sm', lg && 'lg', className)} {...rest} />;
}
export const Chip = ({ cls = '', children, title }: { cls?: Cls | 'acc' | 'feat'; children: ReactNode; title?: string }) => <span className={cx('chip', cls)} title={title}>{children}</span>;
export const Dot = ({ color }: { color: string }) => <span className="dot" style={{ background: color }} />;
export const clsColor = (c: Cls | string) => (c === 'bad' ? 'var(--bad)' : c === 'warn' ? 'var(--warn)' : c === 'ok' ? 'var(--ok)' : 'var(--muted)');

export function Meter({ val, max }: { val: number; max: number }) {
  const p = max ? Math.min(100, val / max * 100) : 0;
  return <div className={cx('meter', max > 0 && val > max && 'over', max > 0 && val <= max && val > max * .9 && 'hi')}><i style={{ width: p + '%' }} /></div>;
}
const initials = (n: string) => String(n).split(/\s+/).map(w => w[0]).slice(0, 2).join('').toUpperCase();
export function Avatar({ m, name, color }: { m?: Member | null; name?: string; color?: string }) {
  const n = m?.name ?? name;
  if (!n) return <span className="av none" title="Unassigned">–</span>;
  return <span className="av" style={{ background: m?.color ?? color }} title={n}>{initials(n)}</span>;
}
export const AvatarId = ({ p, id }: { p: Project; id: string | null }) => <Avatar m={byId(p.members, id)} />;

export function Legend({ items }: { items: [string, string, boolean?][] }) {
  return <div className="legend">{items.map(([c, l, d]) => <span key={l}><i className={d ? 'dash' : ''} style={{ background: c }} />{l}</span>)}</div>;
}
export function Head({ title, desc, children }: { title: string; desc?: ReactNode; children?: ReactNode }) {
  return <div className="viewhead"><div><h1>{title}</h1>{desc && <p>{desc}</p>}</div><span className="sp" />{children && <div className="actions">{children}</div>}</div>;
}
export const Tile = ({ v, label, color }: { v: ReactNode; label: ReactNode; color?: string }) => <div className="tile"><b style={color ? { color } : undefined}>{v}</b><span>{label}</span></div>;
export const Empty = ({ children }: { children: ReactNode }) => <div className="panel empty">{children}</div>;

export const TypeTag = ({ p, t }: { p: Project; t: Ticket }) => <span className={`tt tt-${t.type}`}>{cfg(p).typeLabels[t.type] || t.type}</span>;
export const PriBadge = ({ v }: { v: Priority }) => <span className={`pbadge pri-${v}`}>{v}</span>;
export const SevChip = ({ v }: { v: Severity | null }) => (v ? <Chip cls={v === 'critical' ? 'bad' : v === 'major' ? 'warn' : ''}>{v[0].toUpperCase() + v.slice(1)}</Chip> : null);
export const EpicChip = ({ e }: { e?: Epic }) => (e ? <span className="epicchip" style={{ ['--ec' as string]: e.color }}>{e.title}</span> : null);
export const Pts = ({ v }: { v: number }) => <span className="pts" title="Story points">{+v || 0}</span>;

/** Text that turns into an input on click. Enter or blur saves, Escape cancels. */
export function InlineEdit({ value, onSave, placeholder, className, multiline, label }: { value: string; onSave: (v: string) => void; placeholder?: string; className?: string; multiline?: boolean; label?: string }) {
  const [edit, setEdit] = useState(false);
  const [v, setV] = useState(value);
  useEffect(() => { if (!edit) setV(value) }, [value, edit]);
  const done = (save: boolean) => { setEdit(false); if (save && v.trim() !== value) onSave(v.trim()) };
  if (!edit) return <button type="button" className={cx('inline', className, !value && 'muted')} onClick={() => setEdit(true)} title="Click to edit" aria-label={label ? `Edit ${label}` : undefined}>{value || placeholder || 'Click to edit'}</button>;
  const props = {
    autoFocus: true, value: v, className: cx('inline-input', className), 'aria-label': label,
    onChange: (e: { target: { value: string } }) => setV(e.target.value),
    onBlur: () => done(true),
    onKeyDown: (e: React.KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); done(false) } else if (e.key === 'Enter' && (!multiline || e.ctrlKey || e.metaKey)) { e.preventDefault(); done(true) } },
  };
  return multiline ? <textarea rows={3} {...props} /> : <input {...props} />;
}

/* ---------- modal ---------- */
export function Modal({ title, children, footer, onSubmit, wide }: { title: ReactNode; children: ReactNode; footer?: ReactNode; onSubmit?: () => void; wide?: boolean }) {
  const ref = useRef<HTMLDivElement>(null), tid = useId();
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    const t = setTimeout(() => { const f = ref.current?.querySelector<HTMLElement>('[data-autofocus], .fgrid input, .fgrid select, .fgrid textarea, button[type=submit]'); f?.focus() }, 20);
    return () => { clearTimeout(t); prev?.focus?.() };
  }, []);
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { e.stopPropagation(); closeModal() }
    if (e.key === 'Tab' && ref.current) {
      const els = [...ref.current.querySelectorAll<HTMLElement>('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')].filter(x => !x.hasAttribute('disabled'));
      if (!els.length) return;
      const first = els[0], last = els[els.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus() }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus() }
    }
  };
  return (
    <div className="modalwrap" onKeyDown={onKey}>
      <div className="scrim" onClick={closeModal} />
      <div ref={ref} className={cx('dialog', wide && 'wide')} role="dialog" aria-modal="true" aria-labelledby={tid}>
        <form onSubmit={e => { e.preventDefault(); onSubmit?.() }} noValidate onKeyDown={e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && onSubmit) { e.preventDefault(); onSubmit() } }}>
          <header><h2 id={tid}>{title}</h2><button type="button" className="x" onClick={closeModal} aria-label="Close">×</button></header>
          {children}
          {footer && <footer>{footer}</footer>}
        </form>
      </div>
    </div>
  );
}

export interface Field { k: string; label: string; type?: 'text' | 'number' | 'date' | 'select' | 'textarea' | 'password' | 'color'; options?: [string | number, string][]; wide?: boolean; hint?: string; min?: number; max?: number; placeholder?: string }
export interface FormCfg { title: string; fields: Field[]; values?: Record<string, any>; note?: ReactNode; saveLabel?: string; delLabel?: string; onSave: (v: Record<string, any>) => string | void; onDelete?: (() => void) | null; extra?: ReactNode }

/** Generic form dialog. onSave returns an error message to keep the dialog open. */
export function FormDialog({ cfg: c }: { cfg: FormCfg }) {
  const [vals, setVals] = useState<Record<string, any>>(() => Object.fromEntries(c.fields.map(f => [f.k, c.values?.[f.k] ?? ''])));
  const [err, setErr] = useState('');
  const set = (k: string, v: any) => setVals(s => ({ ...s, [k]: v }));
  const submit = () => {
    const out: Record<string, any> = {};
    c.fields.forEach(f => { let v = vals[f.k]; if (f.type === 'number') v = v === '' || v == null ? 0 : Number(v); out[f.k] = v ?? '' });
    const e = c.onSave(out);
    if (typeof e === 'string') { setErr(e); return }
    closeModal();
  };
  return (
    <Modal title={c.title} onSubmit={submit} footer={<>
      {c.onDelete && <Btn variant="danger" onClick={() => { closeModal(); c.onDelete!() }}>{c.delLabel || 'Delete'}</Btn>}
      <span className="sp" />
      <Btn variant="ghost" onClick={closeModal}>Cancel</Btn>
      <Btn variant="pri" type="submit" title="Ctrl+Enter">{c.saveLabel || 'Save'}</Btn>
    </>}>
      {c.fields.length > 0 && <div className="fgrid">{c.fields.map(f => <FieldInput key={f.k} f={f} v={vals[f.k]} set={v => set(f.k, v)} />)}</div>}
      {c.extra}
      {err && <p className="formerr" role="alert">{err}</p>}
      {c.note && <div className="dnote">{c.note}</div>}
    </Modal>
  );
}
export function FieldInput({ f, v, set }: { f: Field; v: any; set: (v: any) => void }) {
  const id = useId();
  let inp: ReactNode;
  if (f.type === 'select') inp = <select id={id} value={String(v ?? '')} onChange={e => set(e.target.value)}>{f.options!.map(([ov, ol]) => <option key={String(ov)} value={String(ov)}>{ol}</option>)}</select>;
  else if (f.type === 'textarea') inp = <textarea id={id} rows={4} value={v ?? ''} placeholder={f.placeholder} onChange={e => set(e.target.value)} />;
  else if (f.type === 'color') inp = <div className="swatches" role="radiogroup" aria-labelledby={id}>{f.options!.map(([c, l]) => <button key={String(c)} type="button" role="radio" aria-checked={v === c} title={l} className={cx('swatch', v === c && 'on')} style={{ background: String(c) }} onClick={() => set(c)} />)}</div>;
  else inp = <input id={id} type={f.type || 'text'} value={v ?? ''} placeholder={f.placeholder} min={f.min} max={f.max} step={f.type === 'number' ? 1 : undefined} autoComplete={f.type === 'password' ? 'off' : undefined} onChange={e => set(e.target.value)} />;
  return <label className={cx('fld', f.wide && 'wide')} htmlFor={f.type === 'color' ? undefined : id}><span id={f.type === 'color' ? id : undefined}>{f.label}</span>{inp}{f.hint && <small>{f.hint}</small>}</label>;
}
export const openForm = (c: FormCfg) => useUI.getState().openModal(<FormDialog cfg={c} />);

export function confirmBox(title: string, body: ReactNode, label: string, fn: () => void, danger = false) {
  useUI.getState().openModal(
    <Modal title={title} onSubmit={() => { closeModal(); fn() }} footer={<><span className="sp" /><Btn variant="ghost" onClick={closeModal}>Cancel</Btn><Btn variant={danger ? 'danger' : 'pri'} className={danger ? 'solid' : ''} type="submit" data-autofocus>{label}</Btn></>}>
      <div className="dnote" style={{ paddingTop: 16, color: 'var(--ink)' }}>{body}</div>
    </Modal>,
  );
}

/** Toast with an Undo button, for destructive changes that are cheap to reverse. */
export const undoable = (msg: string) => toast(msg, { undo: true });

export function Toasts() {
  const ts = useUI(s => s.toasts), dismiss = useUI(s => s.dismiss);
  return (
    <div className="toasts" role="status" aria-live="polite">
      {ts.map(t => <div key={t.id} className="toast"><span>{t.msg}</span>{t.undo && <button type="button" onClick={() => { dismiss(t.id); undo() }}>Undo</button>}</div>)}
    </div>
  );
}

export function CopyBtn({ text }: { text: string }) {
  return <Btn sm onClick={() => { if (navigator.clipboard) navigator.clipboard.writeText(text).then(() => toast('Copied to the clipboard'), () => toast('Couldn’t copy. Select the text and copy it instead.')); else toast('Couldn’t copy. Select the text and copy it instead.') }}>Copy</Btn>;
}
export function Brief({ title, sub, text }: { title: string; sub?: string; text: string }) {
  return <section className="panel"><div className="phead"><div><h2>{title}</h2>{sub && <p className="small muted">{sub}</p>}</div><CopyBtn text={text} /></div><pre className="brief">{text}</pre></section>;
}
export function Seg<T extends string | number>({ value, options, onChange, label }: { value: T; options: [T, string][]; onChange: (v: T) => void; label: string }) {
  return <div className="seg" role="group" aria-label={label}>{options.map(([v, l]) => <button key={String(v)} type="button" className={cx(v === value && 'on')} aria-pressed={v === value} onClick={() => onChange(v)}>{l}</button>)}</div>;
}
