// ABI: Merchant Helper — Wiring the controls, settings, updates and the two views; runs last.
// Plain script (no modules): all files share one global scope; index.html loads them in order.
'use strict';

// ---------- Events ----------
ui.start.onclick = start;
ui.stop.onclick = stop;
ui.rescan.onclick = rescan;
ui.done.onclick = () => freeze(tr('log.manualFreeze', { n: placedCargo().length }));

$('btnLib').onclick = () => ui.libDir.click();
ui.libDir.onchange = e => {
  const files = [...e.target.files].map(f => ({ path: f.webkitRelativePath || f.name, blob: f }));
  e.target.value = '';
  if (files.length) importLibrary(files);
};
$('blue').checked = includeBlue;
$('blue').onchange = e => {
  includeBlue = e.target.checked;
  try { localStorage.setItem(BLUE_KEY, JSON.stringify(includeBlue)); } catch {}
  renderSounds();
  drawMap();
};
ui.profile.onchange = () => {
  profile = ui.profile.value;
  try { localStorage.setItem(PROFILE_KEY, JSON.stringify(profile)); } catch {}
  renderSounds();
  drawMap();
};

function addSound() {
  const name = ui.newName.value.trim();
  if (!name) { ui.newName.focus(); return; }
  sounds.unshift({ id: uid(), name, waves: [], items: [] });
  ui.newName.value = '';
  saveSounds();
}
$('btnAdd').onclick = addSound;
ui.newName.addEventListener('keydown', e => { if (e.key === 'Enter') addSound(); });

ui.imgFile.onchange = async e => {
  const f = e.target.files[0];
  e.target.value = '';
  if (!f || !imgTarget) return;
  try {
    imgTarget.sound.items[imgTarget.index].img = await resizeImage(f);
    saveSounds();
  } catch (err) { report('error', tr('log.imgFail', { msg: err.message })); }
  imgTarget = null;
};


// Manual assignment: a click puts the last sound on a cargo, a right click clears it
function mapCargoAt(e) {
  const { minC, minR } = mapBounds();
  const p = canvasPos(ui.map, e);
  const C = minC + Math.floor(p.x * ui.map.width / MAP_U), R = minR + Math.floor(p.y * ui.map.height / MAP_U);
  const hit = placedCargo().find(([, r]) => C >= r.C && C < r.C + r.w && R >= r.R && R < r.R + r.h);
  return hit ? hit[0] : null;
}
function assignSound(key) {
  if (!key || !lastResult) return;
  if (lastKey && results.get(lastKey) === lastResult) results.delete(lastKey);
  results.set(key, lastResult);
  lastKey = key;
  drawMap();
}
function clearSound(key) {
  if (!key) return;
  results.delete(key);
  if (key === lastKey) lastKey = null;
  drawMap();
}
ui.map.addEventListener('click', e => assignSound(mapCargoAt(e)));
ui.map.addEventListener('mousemove', showMapPop);
ui.map.addEventListener('mouseleave', () => { if (document.activeElement !== ui.map) $('mapPop').hidden = true; });
ui.map.addEventListener('contextmenu', e => { e.preventDefault(); clearSound(mapCargoAt(e)); });

// Keyboard: arrows choose a cargo (the nearest one that way), Enter gives it the last sound, Delete clears it

function moveMapFocus(dx, dy) {
  const placed = placedCargo();
  if (!placed.length) return;
  const at = mapFocus && cargo.get(mapFocus);
  const mid = r => [r.C + r.w / 2, r.R + r.h / 2];
  if (!at) { mapFocus = placed.slice().sort(([, a], [, b]) => a.R - b.R || a.C - b.C)[0][0]; return; }
  const [x0, y0] = mid(at);
  let best = null, bestD = Infinity;
  for (const [key, r] of placed) {
    const [x, y] = mid(r), ax = (x - x0) * dx, ay = (y - y0) * dy;
    if (key === mapFocus || (dx ? ax <= 0 : ay <= 0)) continue;
    const d = Math.hypot(x - x0, y - y0) + (dx ? Math.abs(y - y0) : Math.abs(x - x0)) * 2; // straight ahead first
    if (d < bestD) { bestD = d; best = key; }
  }
  if (best) mapFocus = best;
}
function showFocusPop() {
  const r = mapFocus && cargo.get(mapFocus);
  if (!r) { $('mapPop').hidden = true; return; }
  const { minC, minR } = mapBounds(), box = ui.map.getBoundingClientRect();
  const k = box.width / ui.map.width;
  showPopFor(mapFocus, box.left + (r.C - minC) * MAP_U * k, box.top + (r.R - minR + r.h / 2) * MAP_U * k);
}
ui.map.addEventListener('keydown', e => {
  const dir = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
  if (dir) moveMapFocus(...dir);
  else if (e.key === 'Enter' || e.key === ' ') assignSound(mapFocus);
  else if (e.key === 'Delete' || e.key === 'Backspace') clearSound(mapFocus);
  else if (e.key === 'Escape') { $('mapPop').hidden = true; return; }
  else return;
  e.preventDefault();
  drawMap();
  showFocusPop();
});
ui.map.addEventListener('focus', () => { if (!mapFocus) moveMapFocus(0, 0); drawMap(); showFocusPop(); });
ui.map.addEventListener('blur', () => { $('mapPop').hidden = true; drawMap(); });
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') drawMap(); });

$('btnExport').onclick = () => {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([JSON.stringify({ version: 2, sounds })], { type: 'application/json' }));
  a.download = 'abi-mh-sounds.json';
  a.click();
};
$('btnImport').onclick = () => $('file').click();
$('file').onchange = async e => {
  const f = e.target.files[0];
  if (!f) return;
  try {
    const data = JSON.parse(await f.text());
    const incoming = normalizeSounds(data.sounds || data);
    const ids = new Set(sounds.map(s => s.id));
    for (const s of incoming) { if (ids.has(s.id)) s.id = uid(); sounds.push(s); }
    saveSounds();
    log(tr('log.imported', { n: incoming.length }));
  } catch (err) { report('error', tr('log.importFail', { msg: err.message })); }
  e.target.value = '';
};
$('btnClear').onclick = () => {
  if (confirm(tr('confirm.clear'))) { sounds = []; results = new Map(); saveSounds(); }
};
const syncLabels = () => { ui.sensVal.textContent = ui.sens.value + ' ' + tr('unit.db'); ui.thrVal.textContent = ui.thr.value + '%'; };
ui.sens.oninput = ui.thr.oninput = syncLabels;

// Display mode. With one monitor the result card and the map go into an always-on-top window over the
// game (Document Picture-in-Picture, Chrome/Edge). The elements are moved there, not copied, so they keep
// updating; when the window closes they come back. It belongs on the left half of the screen: only the
// right half (the merchant) is captured, so the overlay never gets in the way of recognition.
async function openOverlay() {
  if (overlayWin) return;
  let w;
  if (APP) {
    w = window.open('about:blank', 'abi-overlay', 'width=380,height=600'); // the app makes it always on top
    if (!w) { report('error', tr('log.noPip')); return; }
  } else {
    if (!('documentPictureInPicture' in window)) { report('error', tr('log.noPip')); return; }
    try { w = await documentPictureInPicture.requestWindow({ width: 380, height: 600 }); }
    catch { report('error', tr('log.noPip')); return; }
  }
  overlayWin = w;
  for (const ss of document.styleSheets) {
    try {
      const st = w.document.createElement('style');
      st.textContent = [...ss.cssRules].map(r => r.cssText).join('\n');
      w.document.head.append(st);
    } catch {}
  }
  w.document.title = tr('app');
  const box = w.document.createElement('div');
  box.className = 'overlay';
  w.document.body.append(box);
  overlayParts = [ui.result, $('mapWrap')].map(el => {
    const ph = document.createComment('overlay');
    el.replaceWith(ph);
    box.append(el);
    return { el, ph };
  });
  w.addEventListener('pagehide', () => {
    for (const { el, ph } of overlayParts) ph.replaceWith(el);
    overlayParts = [];
    overlayWin = null;
    updateModeUi();
  });
  log(tr('log.overlay'));
  updateModeUi();
}

function updateModeUi() {
  $('btnOverlay').hidden = mode !== 'overlay' || !!overlayWin;
  $('overlayNote').hidden = !overlayWin;
}

const modeSelect = $('mode');
modeSelect.value = mode;
modeSelect.onchange = () => {
  mode = modeSelect.value;
  try { localStorage.setItem(MODE_KEY, JSON.stringify(mode)); } catch {}
  if (mode !== 'overlay' && overlayWin) overlayWin.close();
  if (mode === 'overlay' && stream) openOverlay(); // the change itself is a click, so the window may open
  updateModeUi();
};
$('btnOverlay').onclick = openOverlay;

// Payback settings: purchases per raid (the best-buys count) and the item value basis
const buysSelect = $('buysPerRaid'), valueSelect = $('valueBasis');
buysSelect.value = String(buysPerRaid);
valueSelect.value = valueBasis;
buysSelect.onchange = () => { buysPerRaid = +buysSelect.value || 2; try { localStorage.setItem(BUYS_KEY, JSON.stringify(buysPerRaid)); } catch {} drawMap(); };
valueSelect.onchange = () => { valueBasis = valueSelect.value; try { localStorage.setItem(VALUE_KEY, JSON.stringify(valueBasis)); } catch {} drawMap(); };
const alertBox = $('alertOn');
alertBox.checked = alertOn;
alertBox.onchange = () => { alertOn = alertBox.checked; try { localStorage.setItem(ALERT_KEY, JSON.stringify(alertOn)); } catch {} };
const gameLangBox = $('gameLang');
gameLangBox.value = ['auto', 'eng', 'rus'].includes(gameLang.choice) ? gameLang.choice : 'auto';
gameLangBox.onchange = () => { gameLang.choice = gameLangBox.value; langStats = {}; saveGameLang(); applyGameLang(); };
applyGameLang();
updateModeUi();

// UI language: on change, everything with text is redrawn
const langSelect = $('lang');
langSelect.value = I18n.lang;
langSelect.onchange = () => {
  I18n.setLang(langSelect.value);
  if (stream) showGameStatus(gameStatus);
  syncLabels(); renderProfiles(); renderSounds(); updateStage(); drawMap(); renderUpdate();
};

// A new release on GitHub: the files are replaced by update.ps1 when start.bat runs, here only a hint
const REPO = 'neverh8me/abi-merchant-helper';
const UPDATE_SCREEN = 'http://tauri.localhost/index.html?menu=1';
let latestRelease = null;
async function checkUpdate() {
  try {
    const local = (await (await fetch('version.json', { cache: 'no-cache' })).json()).version;
    const rel = await (await fetch(`https://api.github.com/repos/${REPO}/releases/latest`)).json();
    const v = String(rel.tag_name || '').replace(/^v/, '');
    const num = s => s.split('.').map(Number);
    const newer = (a, b) => { const x = num(a), y = num(b); for (let i = 0; i < 3; i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0); return false; };
    if (v && newer(v, local)) { latestRelease = { v, url: rel.html_url }; renderUpdate(); }
  } catch {} // offline or the site is not opened via start.bat: stay quiet
}
function renderUpdate() {
  const a = $('update');
  if (!latestRelease) return;
  a.textContent = tr('update.available', { v: latestRelease.v });
  a.href = latestRelease.url;
  a.hidden = false;
  if (APP) a.onclick = e => { e.preventDefault(); location.href = UPDATE_SCREEN; };
}

// The app window: the title bar buttons, and the version that opens the update screen
if (APP) {
  document.body.classList.add('app');
  const win = window.__TAURI__.window.getCurrentWindow();
  $('winMin').onclick = () => win.minimize();
  $('winMax').onclick = () => win.toggleMaximize();
  $('winClose').onclick = () => win.close();
  const b = $('btnUpdates');
  b.hidden = false;
  b.onclick = () => { location.href = UPDATE_SCREEN; };
  fetch('version.json', { cache: 'no-cache' }).then(r => r.json()).then(v => { b.textContent = 'v' + v.version; }).catch(() => {});
}
checkUpdate();
setInterval(checkUpdate, 6 * 3600e3);
// Two views: Catch (at the merchant) and Setup (everything else)
const VIEW_KEY = 'abi-mh-view-v1';
const VIEWS = [['tabCatch', 'viewCatch'], ['tabSetup', 'viewSetup']];
function showView(view) {
  for (const [tab, panel] of VIEWS) {
    const on = panel === view;
    $(tab).classList.toggle('tab-active', on);
    $(tab).setAttribute('aria-selected', String(on));
    $(tab).tabIndex = on ? 0 : -1;
    $(panel).hidden = !on;
  }
  try { localStorage.setItem(VIEW_KEY, JSON.stringify(view)); } catch {}
}
for (const [tab, panel] of VIEWS) $(tab).onclick = () => showView(panel);
$('views').addEventListener('keydown', e => {
  if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
  const i = VIEWS.findIndex(([tab]) => tab === document.activeElement.id);
  const [tab, panel] = VIEWS[(i + (e.key === 'ArrowRight' ? 1 : VIEWS.length - 1)) % VIEWS.length];
  showView(panel);
  $(tab).focus();
});
showView(VIEWS.some(([, v]) => v === loadJson(VIEW_KEY, '')) ? loadJson(VIEW_KEY, '') : 'viewCatch');

$('btnHow').onclick = () => { showView('viewSetup'); $('help').scrollIntoView({ block: 'start' }); };

hydrateIcons();
I18n.apply();
syncLabels();
renderProfiles();
renderSounds();
try { OLD_PURCHASE_KEYS.forEach(k => localStorage.removeItem(k)); } catch {}
loadBase();
autoLoadLibrary();
updateStage();
drawMap();
try { localStorage.removeItem(OLD_REGION_KEY); } catch {}
