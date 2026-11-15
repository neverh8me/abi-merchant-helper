// ABI: Merchant Helper — Small helpers.
// Plain script (no modules): all files share one global scope; index.html loads them in order.
'use strict';

// ---------- Utilities ----------
function pct(x) { return Math.round(x * 100) + '%'; }
// small chances with a decimal, as in the game: 7.4%, 66%
function pctFine(x) { const v = x * 100; return (v < 10 && v > 0 ? v.toFixed(1) : Math.round(v)) + '%'; }
function fmtPrice(x) { return x.toLocaleString(I18n.locale); }
// Names in the current language: English from the game data, Ukrainian and Russian use the Russian names
// (the data has no Ukrainian item translations)
function itemName(it) { return I18n.lang === 'en' && it.nameEn ? it.nameEn : it.name; }
function soundName(s) { return I18n.lang === 'en' && s.nameEn ? s.nameEn : s.name; }
function qName(q) { return tr('q.' + q.id); }
function money(x) { return x >= 1e6 ? (x / 1e6).toFixed(1) + 'M' : Math.round(x / 1000) + 'k'; }
function redColor(red) { return red >= 0.5 ? '#ef4444' : red > 0 ? '#f0b429' : THEME.muted; }
function esc(s) { return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function setStatus(s) { ui.status.textContent = s; }
// A problem the player must see: a short alert in the corner of the window (gone after 8 s), and the log as always
function report(level, msg) {
  log(msg);
  const box = $('toasts');
  const a = document.createElement('div');
  a.className = 'alert alert-soft alert-' + level;
  a.setAttribute('role', level === 'error' ? 'alert' : 'status');
  a.textContent = msg;
  box.append(a);
  while (box.children.length > 3) box.firstElementChild.remove();
  setTimeout(() => a.remove(), 8000);
}

function log(s) {
  const d = document.createElement('div');
  d.textContent = new Date().toLocaleTimeString('uk-UA') + '  ' + s;
  ui.log.prepend(d);
  while (ui.log.children.length > 100) ui.log.lastChild.remove();
}
