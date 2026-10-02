// Minimal Markdown → HTML for coach answers. Everything is escaped first, so the output is safe to inject.
export const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));

export function md(s: string): string {
  const inl = (x: string) => esc(x)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
    .replace(/(^|[^*\w])\*([^*\s][^*]*)\*/g, '$1<i>$2</i>');
  let o = '', list: 'ul' | 'ol' | null = null, code: string | null = null, tbl = false, m: RegExpMatchArray | null;
  const close = () => {
    if (list) { o += `</${list}>`; list = null }
    if (tbl) { o += '</table></div>'; tbl = false }
  };
  for (const ln of String(s).split('\n')) {
    if (code !== null) {
      if (/^\s*```/.test(ln)) { o += `<pre>${esc(code)}</pre>`; code = null } else code += (code ? '\n' : '') + ln;
      continue;
    }
    if (/^\s*```/.test(ln)) { close(); code = ''; continue }
    if (/^\s*\|.*\|\s*$/.test(ln)) {
      if (/^\s*\|[\s:|-]+\|\s*$/.test(ln)) continue;
      const cells = ln.trim().slice(1, -1).split('|').map(c => inl(c.trim()));
      if (!tbl) { close(); tbl = true; o += `<div class="tblwrap"><table><tr>${cells.map(c => `<th>${c}</th>`).join('')}</tr>` }
      else o += `<tr>${cells.map(c => `<td>${c}</td>`).join('')}</tr>`;
      continue;
    }
    if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(ln)) { close(); continue }
    if ((m = ln.match(/^#{1,6}\s+(.*)/))) { close(); o += `<h4>${inl(m[1])}</h4>`; continue }
    if ((m = ln.match(/^\s*[-*•]\s+(.*)/))) { if (list !== 'ul') { close(); list = 'ul'; o += '<ul>' } o += `<li>${inl(m[1])}</li>`; continue }
    if ((m = ln.match(/^\s*\d+[.)]\s+(.*)/))) { if (list !== 'ol') { close(); list = 'ol'; o += '<ol>' } o += `<li>${inl(m[1])}</li>`; continue }
    close();
    if (ln.trim()) o += `<p>${inl(ln)}</p>`;
  }
  if (code !== null) o += `<pre>${esc(code)}</pre>`;
  close();
  return o;
}
