// ABI: Merchant Helper — Beep, own sounds, sound level, the library.
// Plain script (no modules): all files share one global scope; index.html loads them in order.
'use strict';

// ---------- Beep ----------
function beep(redChance) {
  chime(redChance >= 0.5 ? [1320, 1320, 1320] : redChance > 0 ? [990, 1320] : [520]);
}

function chime(pattern) {
  beepCtx = beepCtx || new AudioContext();
  let t = beepCtx.currentTime;
  for (const f of pattern) {
    const o = beepCtx.createOscillator(), g = beepCtx.createGain();
    o.frequency.value = f; o.type = 'sine';
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.3, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.12);
    o.connect(g).connect(beepCtx.destination);
    o.start(t); o.stop(t + 0.13);
    t += 0.16;
  }
  // system audio also captures our own beep, so it is ignored
  muteUntil = performance.now() + pattern.length * 160 + 300;
}

// ---------- Sound base ----------
function uid() { return Math.random().toString(36).slice(2, 10); }
function soundById(id) { return sounds.find(s => s.id === id); }
function order(q) { return QUALITIES.findIndex(x => x.id === q); }

function normalizeSounds(list) {
  return (Array.isArray(list) ? list : [])
    .filter(s => s && typeof s.name === 'string')
    .map(s => ({
      id: s.id || uid(),
      name: s.name,
      nameEn: typeof s.nameEn === 'string' ? s.nameEn : '',
      lib: !!s.lib,
      dur: +s.dur || 0,
      waves: (Array.isArray(s.waves) ? s.waves : []).filter(w => typeof w === 'string'), // own recordings
      items: (s.items || []).filter(it => it && qById[it.q]).map(it => ({
        id: +it.id || 0,
        name: String(it.name || '?'), nameEn: typeof it.nameEn === 'string' ? it.nameEn : '', q: it.q, w: Math.max(0, +it.w || 0) || (it.wp ? 0 : 1),
        size: SIZES.includes(it.size) ? it.size : '',
        price: +it.price || 0,
        contact: +it.contact || 0,
        category: typeof it.category === 'string' ? it.category : '',
        wp: it.wp && typeof it.wp === 'object' ? it.wp : null,
        wm: +it.wm || 0,
        wpm: it.wpm && typeof it.wpm === 'object' ? it.wpm : null,
        wl: it.wl && typeof it.wl === 'object' ? it.wl : null,
        wlp: it.wlp && typeof it.wlp === 'object' ? it.wlp : null,
        img: typeof it.img === 'string' && (it.img.startsWith('data:image/') || /^library\/images\/\d+\.png$/.test(it.img)) ? it.img : '',
      })),
    }));
}

function loadSounds() {
  try {
    const cur = localStorage.getItem(STORE_KEY);
    if (cur) return normalizeSounds(JSON.parse(cur));
    // old version: items are kept, the recorded samples had another format
    for (const key of OLD_STORE_KEYS) {
      const old = localStorage.getItem(key);
      if (old) return normalizeSounds(JSON.parse(old).filter(s => !s.lib));
    }
  } catch {}
  return [];
}

function loadJson(key, def) {
  try { const v = localStorage.getItem(key); return v === null ? def : JSON.parse(v); } catch { return def; }
}
function saveSounds() {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(sounds)); } catch (e) { report('error', tr('log.saveFail', { msg: e.message })); }
  renderSounds();
  drawMap();
}

function renderSounds() {
  ui.sounds.innerHTML = '';
  if (!sounds.length) { ui.sounds.innerHTML = `<div class="muted">${esc(tr('sounds.empty'))}</div>`; return; }
  const qOptions = QUALITIES.map(q => `<option value="${q.id}">${esc(qName(q))}</option>`).join('');
  const sizeOptions = [`<option value="">${esc(tr('opt.size'))}</option>`, ...SIZES.map(sz => `<option>${sz}</option>`)].join('');

  for (const s of sounds) {
    const odds = qualityOdds(s, '');
    const redSizes = sizesOf(s).filter(sz => qualityOdds(s, sz).red);
    const el = document.createElement('div');
    el.className = 'sound' + (s.id === recordingId ? ' recording' : '') + (s.id === lastHitId ? ' hit' : '');
    el.innerHTML = `
      <div class="sound-head">
        <span class="grow" title="${esc(soundName(s))}">${esc(soundName(s))}</span>
        <button class="btn btn-xs btn-neutral small" data-act="rec">${esc(tr(s.id === recordingId ? 'btn.cancel' : 'btn.record'))}</button>
        <button class="btn btn-xs btn-neutral small" data-act="rename" aria-label="${esc(tr('act.rename'))}" title="${esc(tr('act.rename'))}">${icon('edit')}</button>
        <button class="btn btn-xs btn-error btn-outline small danger" data-act="del" aria-label="${esc(tr('act.delSound'))}" title="${esc(tr('act.delSound'))}">${icon('trash')}</button>
      </div>
      <div class="meta">${s.lib ? esc(tr('snd.lib')) : ''}${esc(tr('snd.samples', { n: templatesOf(s).up.length }))}${s.waves.length ? ` <a href="#" data-act="clearSamples" class="muted">${esc(tr('snd.reset'))}</a>` : ''}
        · ${s.items.length ? esc(tr('snd.red', { p: pct(odds.red || 0) })) + (redSizes.length ? ` (${redSizes.join(', ')})` : '') : esc(tr('snd.noise'))}
        ${s.id === recordingId ? `<br><b style="color:var(--bad)">${esc(tr('snd.recording'))}</b>` : ''}</div>
      <details${s.lib ? '' : ' open'}>
        <summary class="muted">${esc(tr('snd.items', { n: s.items.length }))}</summary>
        <div class="items-list">${s.items.map((it, i) => `
          <div class="item-row">
            <span class="dot" style="background:${qById[it.q].color}"></span>
            ${it.img ? `<img src="${it.img}" alt="">` : ''}
            <span class="grow" title="${esc(itemName(it))}">${esc(itemName(it))}</span>
            <span class="muted">${normSize(it.size)}${it.wp ? '' : ` ×${it.w}`}</span>
            <button class="btn btn-xs btn-neutral small" data-act="img" data-i="${i}" aria-label="${esc(tr('tip.img'))}" title="${esc(tr('tip.img'))}">${icon('image')}</button>
            <button class="btn btn-xs btn-neutral small" data-act="delItem" data-i="${i}" aria-label="${esc(tr('act.delItem'))}" title="${esc(tr('act.delItem'))}">${icon('close')}</button>
          </div>`).join('')}</div>
        <div class="add-item">
          <input class="input input-sm" type="text" placeholder="${esc(tr('ph.item'))}" data-f="name">
          <select class="select select-sm" data-f="q">${qOptions}</select>
          <select class="select select-sm" data-f="size">${sizeOptions}</select>
          <input class="input input-sm" type="number" value="1" min="0.1" step="0.1" title="${esc(tr('tip.weight'))}" data-f="w">
          <button class="btn btn-xs btn-neutral small" data-act="addItem" aria-label="${esc(tr('act.addItem'))}" title="${esc(tr('act.addItem'))}">${icon('plus')}</button>
        </div>
      </details>`;

    el.addEventListener('click', e => {
      const act = e.target.dataset.act;
      if (!act) return;
      e.preventDefault();
      if (act === 'rec') {
        if (recordingId === s.id) return setRecording(null);
        if (!stream) return setStatus(tr('status.startFirst'));
        setRecording(s.id);
      } else if (act === 'rename') {
        const n = prompt(tr('prompt.rename'), soundName(s));
        if (n && n.trim()) { s.name = n.trim(); s.nameEn = ''; saveSounds(); }
      } else if (act === 'del') {
        if (confirm(tr('confirm.delSound', { name: soundName(s) }))) { sounds = sounds.filter(x => x !== s); saveSounds(); }
      } else if (act === 'clearSamples') {
        if (confirm(tr('confirm.delSamples'))) { s.waves = []; tplCache.delete(s.id); saveSounds(); }
      } else if (act === 'delItem') {
        s.items.splice(+e.target.dataset.i, 1); saveSounds();
      } else if (act === 'img') {
        imgTarget = { sound: s, index: +e.target.dataset.i };
        ui.imgFile.click();
      } else if (act === 'addItem') {
        addItem(el, s);
      }
    });
    el.querySelector('[data-f=name]').addEventListener('keydown', e => { if (e.key === 'Enter') addItem(el, s); });
    ui.sounds.appendChild(el);
  }
}

function addItem(el, s) {
  const name = el.querySelector('[data-f=name]').value.trim();
  if (!name) return;
  const q = el.querySelector('[data-f=q]').value;
  const w = Math.max(0.1, +el.querySelector('[data-f=w]').value || 1);
  const size = el.querySelector('[data-f=size]').value;
  s.items.push({ name, q, w, size, price: 0, wp: null, img: '' });
  saveSounds();
}

// Shrinks a picture to 96×96 so the base does not bloat
async function resizeImage(file) {
  const bmp = await createImageBitmap(file);
  const size = 96, k = Math.min(size / bmp.width, size / bmp.height, 1);
  const c = document.createElement('canvas');
  c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
  c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
  return c.toDataURL('image/webp', 0.85);
}

function setRecording(id) {
  recordingId = id;
  renderSounds();
}

// ---------- Sound level ----------
// Every 10 ms a volume bar; a mark on top means a sound started here
function drawLevel(db, trig) {
  const { width: w, height: h } = ui.spec;
  specCtx.drawImage(ui.spec, -1, 0);
  specCtx.fillStyle = THEME.bg;
  specCtx.fillRect(w - 1, 0, 1, h);
  const v = Math.min(1, Math.max(0, (db + 90) / 80));
  specCtx.fillStyle = `hsl(${200 - v * 160}, 80%, 55%)`;
  specCtx.fillRect(w - 1, h - v * h, 1, v * h);
  if (trig) { specCtx.fillStyle = recordingId ? THEME.error : THEME.primary; specCtx.fillRect(w - 1, 0, 1, 8); }
}

// ---------- Library ----------
async function importLibrary(files) {
  const ctx = new OfflineAudioContext(1, 1, Ear.SAMPLE_RATE);
  setStatus(tr('status.importing'));
  try {
    const lib = await Library.load(files, ctx, (i, n) => setStatus(tr('status.importingN', { i, n })));
    // templates go to memory, only the description goes to the sound list (and storage)
    for (const s of lib.sounds) { tplCache.set(s.id, { up: s.up, down: s.down }); delete s.up; delete s.down; }
    sounds = sounds.filter(s => !s.lib).concat(normalizeSounds(lib.sounds));
    libPools = lib.pools;
    itemQ = lib.itemQ;
    itemById = new Map();
    for (const s of sounds) for (const it of s.items) if (it.id) itemById.set(it.id, it);
    dropMismatchedSounds();
    syncBase(); // now the catalog is known: write the own purchases file for the next launch
    profiles = lib.profiles;
    try { localStorage.setItem(PROFILES_KEY, JSON.stringify(profiles)); } catch {}
    renderProfiles();
    saveSounds();
    log(tr('log.libDone', { s: lib.sounds.length, i: lib.sounds.reduce((a, s) => a + s.items.length, 0) }));
    setStatus(tr(stream ? 'status.listening' : 'status.libDone'));
    return true;
  } catch (e) {
    report('error', tr('log.libFail', { msg: e.message }));
    setStatus(tr('status.importFail'));
    return false;
  }
}

// The library sits next to the app in the library folder: it is loaded on every start (templates live only
// in memory). Works via start.bat (localhost); with file:// the browser does not allow reading files, then the button is used.
async function autoLoadLibrary() {
  try {
    const res = await fetch('library/groups.json', { cache: 'no-cache' });
    if (!res.ok) return;
    const groupsBlob = await res.blob();
    const groups = JSON.parse(await groupsBlob.text());
    const paths = ['library/merchant.json', 'library/names_ru.json',
      ...groups.groups.flatMap(g => g.sounds.map(s => 'library/' + s.file))];
    const files = [{ path: 'library/groups.json', blob: groupsBlob }];
    await Promise.all(paths.map(async p => {
      const r = await fetch(p);
      if (r.ok) files.push({ path: p, blob: await r.blob() });
    }));
    await importLibrary(files);
  } catch {}
}

function renderProfiles() {
  ui.profile.innerHTML = `<option value="">${esc(tr('opt.allMaps'))}</option>` +
    profiles.map(p => `<option value="${p.id}">${esc(p.name)}</option>`).join('');
  ui.profile.value = profiles.some(p => String(p.id) === String(profile)) ? String(profile) : '';
  ui.profile.hidden = !profiles.length;
}
