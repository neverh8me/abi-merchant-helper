// ABI: Merchant Helper — Matching a sound against the library.
// Plain script (no modules): all files share one global scope; index.html loads them in order.
'use strict';

// ---------- Recognition ----------
// Templates live only in memory: library ones are built from wav at start, own ones from recorded waves
function templatesOf(s) {
  let t = tplCache.get(s.id);
  if (!t) {
    t = { up: (s.waves || []).map(b64 => Ear.makeTemplate(Ear.decodeWave(b64))).filter(Boolean), down: [] };
    tplCache.set(s.id, t);
  }
  return t;
}

function allTemplates() {
  const out = [];
  for (const s of sounds) {
    const t = templatesOf(s);
    for (const tpl of t.up) out.push({ id: s.id, kind: 'up', tpl });
    for (const tpl of t.down) out.push({ id: s.id, kind: 'down', tpl });
  }
  return out;
}

function onWindow(win, msAgo) {
  if (recordingId) return; // recording goes through onRaw
  classify(win, performance.now() - msAgo);
}

function onRaw(wave, msAgo) {
  if (!recordingId) return;
  const s = soundById(recordingId);
  const tpl = s && Ear.makeTemplate(wave);
  if (tpl) {
    (s.waves ||= []).push(Ear.encodeWave(wave));
    templatesOf(s).up.push(tpl);
    saveSounds();
    log(tr('log.saved', { name: soundName(s), n: templatesOf(s).up.length }));
  }
  setRecording(null);
}

function classify(win, onset) {
  const tpls = allTemplates();
  if (!tpls.some(t => t.kind === 'up')) { log(tr('log.noSounds')); return; }
  const res = Ear.match(win, tpls);
  // the best "pick up" of every sound, best first
  const ranked = [], seenIds = new Set();
  for (const r of res) {
    if (r.kind !== 'up' || seenIds.has(r.id)) continue;
    seenIds.add(r.id);
    ranked.push({ s: soundById(r.id), score: r.score });
  }
  const { s: best, score } = ranked[0];
  const thr = +ui.thr.value / 100;

  // a "put down" sound (the cargo was released) is not a new cargo
  const down = res.find(r => r.kind === 'down');
  if (down && down.score >= thr && down.score > score + UP_BIAS) {
    log(tr('log.down', { name: soundName(soundById(down.id)), p: pct(down.score) }));
    return;
  }
  if (score < thr) {
    log(tr('log.unknown', { name: soundName(best), p: pct(score) }));
    return;
  }
  if (!best.items.length) {
    log(tr('log.noise', { name: soundName(best), p: pct(score) }));
    return;
  }
  // a long sound has several hits: do not recognize its tail as a new cargo
  if (best.dur) muteUntil = Math.max(muteUntil, onset + best.dur * 1000 + 150);

  lastHitId = best.id;
  renderSounds();
  lastResult = { soundId: best.id, score, t: Date.now() };
  // a cargo is searched only while the merchant is on screen: otherwise (stash, raid) the map is stale,
  // and the size of an unrelated cargo would spoil the odds
  const merchantOpen = cargo.size && performance.now() - gridSeenAt < MERCHANT_FRESH_MS;
  const hovered = hover && performance.now() - hover.t < HOVER_KEEP_MS && cargo.has(hover.key) ? hover.key : null;
  // the cargo: under the cursor when the sound started (exact, with the local server); else the one just hovered
  // (as the paid site does); else by the red trace
  const atCursor = merchantOpen ? cursorKeyAt(onset) : null;
  const key = merchantOpen ? atCursor || hovered || pickCargo(onset) : null;
  hover = null;
  const rec = key && cargo.get(key);
  const size = rec ? `${rec.w}x${rec.h}` : '';
  const label = cargoInfo(rec);
  // The cargo size rules items out: if the best sound has no item of this size, a nearly as good sound
  // that has one is taken instead (several groups sound alike)
  let sound = best, sScore = score, second = ranked[1];
  if (size) {
    const fits = s => s && s.items.some(it => normSize(it.size) === normSize(size));
    if (!fits(best)) {
      const alt = ranked.slice(1).find(r => r.score >= score - SIZE_ALT_MARGIN && r.score >= thr && fits(r.s));
      if (alt) { second = ranked[0]; sound = alt.s; sScore = alt.score; lastResult = { soundId: sound.id, score: sScore, t: lastResult.t }; }
    }
  }
  lastResult.key = key;
  showResult(sound, sScore, second, size, label);
  const red = qualityOdds(sound, size, label).red || 0;
  if (ui.beep.checked) beep(red);

  if (key) {
    results.set(key, lastResult);
    lastKey = key;
    log(tr('log.hitCargo', { name: soundName(sound), p: pct(sScore), size: normSize(size), cell: cargoName(key), red: pct(red) }));
  } else {
    lastKey = null;
    log(tr('log.hit', { name: soundName(sound), p: pct(sScore), red: pct(red) }) + (merchantOpen ? tr('log.noCargo') : ''));
  }
  drawMap();
}
