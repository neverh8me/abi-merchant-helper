// ABI: Merchant Helper — The merchant grid on the screen: cells, scrolling, cargo, price tooltips, cursor.
// Plain script (no modules): all files share one global scope; index.html loads them in order.
'use strict';

// ---------- Screen: grid search, scrolling, cargo ----------
function resetScan() {
  P = 0; checkFrames = 0; offset = 0; viewport = null; prevSig = null; ring = []; listTopR = null; alerted = new Set();
  cargo = new Map(); results = new Map(); lastKey = null; lastSeen = null; gridSeenAt = 0;
  phase = 'scan'; sawTop = false; sawEnd = false; stableCount = 0;
  sbKnown = null; noBarCount = 0; frozenPlaced = null; loggedBar = false; frozenP = 0;
  updateStage();
  drawMap();
}

// "Scan again" (after a purchase): the merchant list keeps its place and cell size, only the cargo moved.
// So the grid geometry stays and only the cargo are collected anew: drawing starts on the next frame.
// The scrollbar is searched anew: with fewer cargo the list is shorter and the thumb longer, or the list now fits
// without scrolling (the thumb fills the track), and a thumb of the old length would never be found.
// The top of the list counts as seen if the list is scrolled to the top right now.
function rescan() {
  if (!P || !viewport) { resetScan(); return; }
  cargo = new Map(); results = new Map(); lastKey = null; frozenPlaced = null; hover = null; hoverSig = '';
  phase = 'scan'; sawTop = !sbKnown || lastSbTop; sawEnd = false; stableCount = 0; checkFrames = 0;
  sbKnown = null; noBarCount = 0; thumbOddCount = 0; frozenP = 0;
  updateStage();
  drawMap();
}

function startVideo(track) {
  if ('MediaStreamTrackProcessor' in window) {
    // works even when the tab is in the background, unlike <video> + timers
    videoReader = new MediaStreamTrackProcessor({ track }).readable.getReader();
    const reader = videoReader;
    (async () => {
      while (videoReader === reader) {
        const { value: frame, done } = await reader.read();
        if (done) break;
        try { onVideoFrame(frame, frame.displayWidth, frame.displayHeight); } finally { frame.close(); }
      }
    })().catch(e => log(tr('log.video', { msg: e.message })));
  } else {
    ui.video.srcObject = new MediaStream([track]);
    videoTimer = setInterval(() => {
      if (ui.video.videoWidth) onVideoFrame(ui.video, ui.video.videoWidth, ui.video.videoHeight);
    }, 66);
  }
}

// The merchant grid is searched in the right half of the game window: the merchant is always on the right, and on the
// left are the player's own pockets and backpack with the same kind of cells
let frameCropped = false; // the server already sends only the right part of the window (see helper.cs)
function regionPx(w, h) {
  if (frameCropped) return { x: 0, y: 0, w, h };
  return { x: Math.round(w * MERCHANT_SIDE), y: 0, w: w - Math.round(w * MERCHANT_SIDE), h };
}

function onVideoFrame(src, fw, fh) {
  const now = performance.now();
  const rp = regionPx(fw, fh);
  if (viewport) track(src, rp, now);
  if (now - lastScan >= (phase === 'scan' ? SCAN_FAST_MS : SCAN_MS)) { lastScan = now; analyze(src, rp); }
}

// A small frame of the visible part of the grid: for scroll tracking and for finding a dragged cargo
function track(src, rp, now) {
  const sw = Math.max(8, Math.round(viewport.w / TRACK_SX)), sh = Math.max(8, Math.round(viewport.h / TRACK_SY));
  if (smallCanvas.width !== sw || smallCanvas.height !== sh) { smallCanvas.width = sw; smallCanvas.height = sh; prevSig = null; ring = []; }
  smallCtx.drawImage(src, rp.x + viewport.x, rp.y + viewport.y, viewport.w, viewport.h, 0, 0, sw, sh);
  const data = smallCtx.getImageData(0, 0, sw, sh).data;
  const small = Vision.toGray(data, sw, sh).g;
  const red = Vision.redness(data, sw, sh);
  const sig = rowSignature(small, sw, sh);
  if (prevSig) {
    const { d } = Vision.estimateShift(prevSig, sig, ROW_BINS, sh, Math.round(sh / 3));
    offset += d * TRACK_SY;
  }
  prevSig = sig;
  ring.push({ t: now, small, red, offset });
  while (ring.length && ring[0].t < now - RING_MS) ring.shift();
}

// Every row of the small frame is squeezed to ROW_BINS means: the shift search gets many times faster
const ROW_BINS = 16;
function rowSignature(g, w, h) {
  const out = new Uint8Array(ROW_BINS * h);
  for (let y = 0; y < h; y++) {
    for (let b = 0; b < ROW_BINS; b++) {
      const x0 = Math.floor(b * w / ROW_BINS), x1 = Math.max(x0 + 1, Math.floor((b + 1) * w / ROW_BINS));
      let s = 0;
      for (let x = x0; x < x1; x++) s += g[y * w + x];
      out[y * ROW_BINS + b] = s / (x1 - x0);
    }
  }
  return out;
}

function analyze(src, rp) {
  if (fullCanvas.width !== rp.w || fullCanvas.height !== rp.h) { fullCanvas.width = rp.w; fullCanvas.height = rp.h; }
  fullCtx.drawImage(src, rp.x, rp.y, rp.w, rp.h, 0, 0, rp.w, rp.h);
  const rgba = fullCtx.getImageData(0, 0, rp.w, rp.h).data;
  const G = Vision.toGray(rgba, rp.w, rp.h);
  // Lines are searched only around the list already found (with a margin for the scrollbar and labels):
  // this is the longest part of the parse. If no grid is found there, the whole right half is searched.
  const roi = viewport && P ? { x0: viewport.x - P, y0: viewport.y - P * 1.5, x1: viewport.x + viewport.w + P * 1.5, y1: viewport.y + viewport.h + P } : null;
  let maps = Vision.lineMaps(G, roi);
  if (!P) {
    P = Vision.detectPeriod(rp.w, rp.h, maps) || 0;
    if (!P) { lastSeen = null; updateStage(); return; }
  }
  const now = performance.now();
  let found = Vision.analyze(G, maps, P);
  if (!found && roi) { maps = Vision.lineMaps(G); found = Vision.analyze(G, maps, P); }
  // The cell size may have been taken from a frame without the merchant (inventory, raid) if catching started earlier:
  // with it the real grid is never found, while random "cargo" do show up. Until the map is ready (or while there is
  // no grid), the size is re-checked now and then, taking the one with which cargo cover a larger area.
  // With plenty of cargo found the grid is real: no re-check.
  if (phase !== 'frozen' && cargo.size < REDETECT_MAX_CARGO && ++checkFrames >= REDETECT_AFTER) {
    checkFrames = 0;
    const P2 = Vision.detectPeriod(rp.w, rp.h, maps);
    if (P2 && Math.abs(P2 - P) > P * 0.1) {
      const alt = Vision.analyze(G, maps, P2);
      if (alt && gridCoverage(alt) > gridCoverage(found) * 1.5) found = alt;
    }
  }
  if (!found) { skip('noGrid'); lostGrid(now); return; }
  // sub-pixel refinements are accepted quietly; a different scale (×2) is a different grid.
  // Nothing but the "Scan again" button touches a ready map: a frame with another cell size is simply skipped,
  // and so is one with a slightly different size (a tooltip or the cursor spoiled the lines), or the size would
  // creep away from the real one while the map is ready.
  if (phase === 'frozen' && frozenP && Math.abs(found.P - frozenP) > frozenP * 0.03) { skip('otherP'); lostGrid(now); return; }
  if (Math.abs(found.P - P) > P * 0.1) {
    viewport = null; prevSig = null; ring = []; cargo = new Map(); results = new Map(); listTopR = null;
    sbKnown = null; noBarCount = 0; phase = 'scan'; frozenPlaced = null; sawTop = sawEnd = false; stableCount = 0;
  }
  P = found.P;
  const grid = found.grid;
  // cargo in the game is always grey, an empty slot is black (sometimes with a dot).
  // 1×1 cargo are scanned too: no reds drop from them, but gold ones do (Gold Pen, Jade Bracelet, Gold Cube).
  // A grey empty slot (the right column, often with a dot) looks just like one, so a 1×1 must show its label.
  let items = found.items.filter(it => it.occ >= OCC_GREY && (it.w * it.h > 1 || it.detail >= ONE_LABEL_MIN));
  if (!items.length) { skip('noCargo'); lostGrid(now); return; }
  // the merchant was closed and reopened in the middle of a scan: this is a different list
  if (phase !== 'frozen' && gridSeenAt && now - gridSeenAt > REOPEN_MS && cargo.size) { log(tr('log.reopen')); resetScan(); }
  gridSeenAt = now;

  // The visible part of the list. The scrollbar on the right gives it most precisely: the track runs from the top to
  // the bottom of the list, the thumb shows where we are in it. Without a scrollbar (a short list) — the top at first detection:
  // the merchant opens with the list at the top. Above hangs the "Mysterious Supplies" header, through
  // which scrolled cargo shows; it is dropped, and scrolling is tracked only below it.
  // The whole scrollbar is searched once, later only the thumb on the track found. Once the scrollbar has been
  // seen, a frame without a thumb is skipped: another way of counting rows would shift the map.
  let sb = Vision.scrollbar(G, grid, sbKnown);
  if (sb) lastSbTop = sb.thumbTop - sb.trackTop < 2; // for rescan: is the list at its top now
  // (with thumbTop: a list that fits without scrolling gives back this very object every frame)
  if (sb && !sbKnown) { sbKnown = { x: sb.x, trackTop: sb.trackTop, trackLen: sb.trackLen, thumbTop: sb.thumbTop, thumbLen: sb.thumbLen }; if (!loggedBar) log(tr('log.bar')); loggedBar = true; }
  // The thumb length changes only together with the list (after a purchase). Suddenly different: the cursor or
  // a tooltip spoiled the scrollbar, the frame is skipped. A new length is accepted once it holds.
  if (sb && sbKnown && Math.abs(sb.thumbLen - sbKnown.thumbLen) > sbKnown.thumbLen * THUMB_TOLERANCE) {
    thumbOddCount = Math.abs(sb.thumbLen - thumbOddLen) <= 3 ? thumbOddCount + 1 : 1;
    thumbOddLen = sb.thumbLen;
    if (thumbOddCount >= THUMB_NEW_STREAK) sbKnown.thumbLen = sb.thumbLen;
    else sb = null;
  } else thumbOddCount = 0;
  if (!sb && sbKnown) {
    // The price tooltip covered the scrollbar (a cargo near the right edge). The map is left alone, but the tooltip is still
    // read: while the cursor is on a cargo the list does not scroll, so the position is the last known one.
    const last = ring[ring.length - 1];
    if (phase === 'frozen' && now - captureOnset > QUIET_MS && last) { last.offset = offset; detectHover(last); }
    skip('noThumb'); lastSeen = { grid, items }; updateStage(); return;
  }
  if (!sb && ++noBarCount < NO_BAR_LIMIT) { skip('waitBar'); lastSeen = { grid, items }; updateStage(); return; } // still waiting for the scrollbar
  const vpNew = sb
    ? { x: Math.round(grid.x0), y: sb.trackTop, w: Math.round(grid.cols * P), h: sb.trackLen }
    : { x: Math.round(grid.x0), y: Math.round(grid.y0), w: Math.round(grid.cols * P), h: Math.round(grid.rows * P) };
  if (!viewport || (sb && (Math.abs(viewport.y - vpNew.y) > 3 || Math.abs(viewport.h - vpNew.h) > 3))) {
    viewport = vpNew;
    phaseX = grid.x0 % P;
  } else if (!sb && grid.y0 + grid.rows * P > viewport.y + viewport.h + P / 2) {
    viewport.h = Math.round(grid.y0 + grid.rows * P - viewport.y);
  }
  // only cargo within the list: above is under the header, below is the merchant panel
  items = items.filter(it => grid.y0 + it.r * P >= viewport.y - P * 0.2 && grid.y0 + (it.r + it.h) * P <= viewport.y + viewport.h + P * 0.2);

  // row number: from the scrollbar (no error accumulation) or from frame tracking
  const colOf = c => Math.round((grid.x0 + c * P - phaseX) / P);
  let n;
  if (sb) {
    const scrollPx = (sb.thumbTop - sb.trackTop) * sb.trackLen / sb.thumbLen;
    n = Math.round((grid.y0 - sb.trackTop + scrollPx) / P);
    // the list has as many rows as its content length allows; anything else is a recognition error
    const listRows = Math.ceil(sb.trackLen * sb.trackLen / sb.thumbLen / P) + 2;
    if (n < -grid.rows || n > listRows) { skip('rowRange'); lastSeen = { grid, items }; updateStage(); return; }
    listTopR = 0;
    if (scrollPx < P / 2) sawTop = true;
    if (sb.thumbTop + sb.thumbLen >= sb.trackTop + sb.trackLen - 2) sawEnd = true;
  } else {
    n = relocate(items, colOf, Math.round((offset + grid.y0) / P));
    if (listTopR === null) listTopR = n;
    sawTop = sawEnd = true; // the whole list is visible at once
  }
  offset = n * P - grid.y0;
  if (ring.length) ring[ring.length - 1].offset = offset;
  // A cargo touching the top of the visible part may be cut off by the header: the bottom border of
  // the header then acts as its top border. Such a cargo is trusted only in the first row of the list.
  items = items.filter(it => Math.abs(grid.y0 + it.r * P - viewport.y) > P * 0.3 || n + it.r === listTopR);
  lastSeen = { grid, items };
  readFeed(G, grid, now);

  // while a cargo is dragged the picture is "dirty": the map and the references are left alone
  const quiet = now - captureOnset > QUIET_MS;
  const seen = new Set(), fresh = [];
  for (const it of items) {
    const C = colOf(it.c), R = n + it.r;
    const key = `${C},${R},${it.w},${it.h}`;
    const rec = cargo.get(key);
    if (rec) seen.add(key);
    else fresh.push({ key, C, R, it });
  }

  if (phase === 'scan' && quiet) {
    // Nothing is deleted during the scan: some cargo borders come and go, and the map would flicker.
    // Disputes between variants are settled by voting (placedCargo), and a reshuffle by a new scan.
    for (const f of fresh) {
      cargo.set(f.key, { C: f.C, R: f.R, w: f.it.w, h: f.it.h, votes: 0, base: null, thumb: null });
      seen.add(f.key);
    }
    // the map is built: both the top and the bottom of the list were seen, and nothing visible is new or unconfirmed
    const unsure = [...seen].some(k => cargo.get(k).votes + 1 < MIN_VOTES);
    stableCount = unsure ? 0 : stableCount + 1;
    if (sawTop && sawEnd && cargo.size && stableCount >= FREEZE_STABLE) freeze(tr('log.frozen', { n: placedCargo().length }));
  } else if (phase === 'frozen' && quiet) {
    // A frozen map ignores the mouse, price tooltips and purchases: after a purchase
    // the player presses "Scan again". Otherwise a tooltip hanging over cargo would break the map.
    const frozenKeys = new Set(frozenPlaced.map(([k]) => k));
    // Filling in: a missing cargo (say, the top row did not get confirmed before freezing)
    // is added once it has been seen confidently several times and overlaps nothing known.
    // Existing cargo of a ready map never change.
    for (const f of fresh) {
      cargo.set(f.key, { C: f.C, R: f.R, w: f.it.w, h: f.it.h, votes: 0, base: null, thumb: null });
      seen.add(f.key);
    }
    for (const key of seen) {
      const rec = cargo.get(key);
      if (frozenKeys.has(key) || rec.votes + 1 < MIN_VOTES + 2 || overlapsFrozen(rec)) continue;
      frozenPlaced.push([key, rec]);
      frozenKeys.add(key);
    }
  }

  for (const key of seen) {
    const rec = cargo.get(key);
    const it = items.find(i => `${colOf(i.c)},${n + i.r},${i.w},${i.h}` === key);
    rec.votes++;
    rec.seen = now;
    if (!quiet && rec.thumb) continue;
    const x = grid.x0 + it.c * P, y = grid.y0 + it.r * P;
    rec.thumb = makeThumb(x, y, it.w * P, it.h * P);
    updateReveal(rec, Vision.meanColor(rgba, rp.w, x + P * 0.1, y + P * 0.3, it.w * P - P * 0.2, it.h * P - P * 0.4));
    if (quiet) readLabel(rec, x, y, it.w * P, it.h * P);
  }
  // appearance reference of the visible cargo, for finding the dragged one
  const last = ring[ring.length - 1];
  if (quiet && last) for (const key of seen) {
    const rec = cargo.get(key);
    const patch = cargoPatch(rec, last);
    if (!patch) continue;
    const red = Vision.meanOf(cargoPatch(rec, last, 'red'));
    if (red >= RED_MIN) continue; // still red after dragging
    // a price tooltip inside a large cargo does not break its borders: such a frame is not taken as a reference
    if (phase === 'frozen' && rec.base && rec.base.length === patch.length && Vision.patchDiff(patch, rec.base) > BASE_UPDATE_MAX) continue;
    rec.base = patch;
    rec.baseRed = red;
  }
  if (phase === 'frozen' && quiet && last) detectHover(last);
  updateStage();
  if (document.visibilityState === 'visible') drawMap();
}

function overlapsFrozen(rec) {
  return frozenPlaced.some(([, r]) => rec.C < r.C + r.w && r.C < rec.C + rec.w && rec.R < r.R + r.h && r.R < rec.R + rec.h);
}

function freeze(message) {
  if (phase === 'frozen') return;
  frozenPlaced = placedCargo();
  frozenP = P;
  phase = 'frozen';
  log(message);
  updateStage();
}

// Intel: the game paints a revealed cargo in the color of the item quality. The color must hold for several
// parses in a row: the red trace from dragging lasts only briefly.
function updateReveal(rec, [r, g, b]) {
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), sat = mx ? (mx - mn) / mx : 0;
  let q = null;
  if (sat > 0.35 && mx > 70) {
    let hue;
    if (mx === r) hue = (60 * (g - b) / (mx - mn) + 360) % 360;
    else if (mx === g) hue = 60 * (b - r) / (mx - mn) + 120;
    else hue = 60 * (r - g) / (mx - mn) + 240;
    q = hue < 12 || hue >= 340 ? 'red' : hue < 70 ? 'gold' : hue < 170 ? 'green' : hue < 255 ? 'blue' : 'purple';
  }
  if (q === rec.revealCand) rec.revealStreak = (rec.revealStreak || 0) + 1;
  else { rec.revealCand = q; rec.revealStreak = 1; }
  if (rec.revealStreak >= REVEAL_STREAK) rec.revealed = q;
}

// Area covered by the cargo found (px²): for the real merchant grid it is large
function gridCoverage(found) {
  if (!found) return 0;
  return found.items.filter(it => it.occ >= OCC_GREY).reduce((a, it) => a + it.w * it.h, 0) * found.P * found.P;
}

function skip(reason) { skips[reason] = (skips[reason] || 0) + 1; }

function lostGrid(now) {
  lastSeen = null;
  updateStage();
}

// Whether a map cargo is now fully inside the visible part of the list
function fullyVisible(rec, grid, colOf) {
  const top = rec.R * P - offset, bottom = (rec.R + rec.h) * P - offset;
  const c0 = colOf(0), c1 = colOf(grid.cols);
  // at the very top a cargo is not confirmed (see analyze), so it is not considered gone there either
  const clearOfHeader = top > viewport.y + P * 0.3 || rec.R === listTopR;
  return clearOfHeader && top >= viewport.y - 2 && bottom <= Math.min(viewport.y + viewport.h, grid.y0 + grid.rows * P) + 2
    && rec.C >= c0 && rec.C + rec.w <= c1;
}

// If scrolling was not tracked in time (a sharp scroll), look for where the visible cargo match
// the map already found. The layout of cargo sizes is almost always unique.
// The threshold is high: after a purchase cargo are reshuffled, and a weak match elsewhere would be accidental.
function relocate(items, colOf, n) {
  if (items.length < 3 || cargo.size < 3) return n;
  const score = m => items.reduce((s, it) => s + (cargo.has(`${colOf(it.c)},${m + it.r},${it.w},${it.h}`) ? 1 : 0), 0);
  const here = score(n);
  if (here >= items.length * 0.6) return n;
  const rows = [...cargo.values()].map(r => r.R);
  let best = n, bestS = here;
  for (let m = Math.min(...rows) - items.length; m <= Math.max(...rows); m++) {
    const s = score(m);
    if (s > bestS || (s === bestS && Math.abs(m - n) < Math.abs(best - n))) { bestS = s; best = m; }
  }
  return bestS >= Math.max(4, items.length * 0.75) ? best : n;
}

function makeThumb(x, y, w, h) {
  const c = document.createElement('canvas');
  c.width = Math.round(w / P * MAP_U); c.height = Math.round(h / P * MAP_U);
  c.getContext('2d').drawImage(fullCanvas, x, y, w, h, 0, 0, c.width, c.height);
  return c;
}

// Cargo rectangle in the small frame (without borders), or null if it is not fully visible
function cargoRect(rec, frameOffset) {
  const x = (phaseX + rec.C * P - viewport.x) / TRACK_SX, y = (rec.R * P - frameOffset - viewport.y) / TRACK_SY;
  const inX = 3 / TRACK_SX, inY = 3 / TRACK_SY;
  const r = {
    x: Math.round(x + inX), y: Math.round(y + inY),
    w: Math.max(1, Math.round(rec.w * P / TRACK_SX - 2 * inX)), h: Math.max(1, Math.round(rec.h * P / TRACK_SY - 2 * inY)),
  };
  if (r.x < 0 || r.y < 0 || r.x + r.w > smallCanvas.width || r.y + r.h > smallCanvas.height) return null;
  return r;
}

function cargoPatch(rec, frame, channel = 'small') {
  const r = cargoRect(rec, frame.offset);
  return r ? Vision.crop({ w: smallCanvas.width, g: frame[channel] }, r.x, r.y, r.w, r.h) : null;
}

// The dragged cargo. When a cargo is dragged, a faint red trace stays in its place,
// and the cargo itself follows the cursor a bit down (onto a neighbour, but grey, so there is no red there).
// A cargo put in the cart keeps a red band all the time: only red that appeared at the sound counts, so the
// red already seen well before the sound is subtracted.
function pickCargo(onset) {
  const frames = ring.filter(f => f.t >= onset - 150 && f.t <= onset + 700);
  if (!frames.length) return null;
  const before = ring.filter(f => f.t >= onset - 2500 && f.t <= onset - 600);
  const red = [], gray = [];
  for (const [key, rec] of placedCargo()) {
    if (!rec.base) continue;
    let r = 0, g = 0, was = rec.baseRed || 0;
    for (const f of before) {
      const rp = cargoPatch(rec, f, 'red');
      if (rp) was = Math.max(was, Vision.meanOf(rp));
    }
    for (const f of frames) {
      const rp = cargoPatch(rec, f, 'red');
      if (rp) r = Math.max(r, Vision.meanOf(rp) - was);
      const gp = cargoPatch(rec, f);
      if (gp && gp.length === rec.base.length) g = Math.max(g, Vision.patchDiff(gp, rec.base));
    }
    red.push({ key, s: r });
    gray.push({ key, s: g });
  }
  // the main sign is the red trace; if it is not visible, the biggest change overall is taken
  return best(red, RED_MIN, 1.5) || best(gray, PICK_MIN_DIFF, 1.25);
}

function best(scored, min, ratio) {
  scored.sort((a, b) => b.s - a.s);
  if (!scored.length || scored[0].s < min) return null;
  if (scored[1] && scored[0].s < scored[1].s * ratio) return null; // two cargo changed equally: no guessing
  return scored[0].key;
}

// Cargo without overlaps. A cargo appears on the map once several frames confirmed it, and in a
// dispute (a border that comes and goes) the variant seen more often wins, so the map does not flicker.
function placedCargo() {
  if (phase === 'frozen' && frozenPlaced) return frozenPlaced; // a ready map does not change until a rescan
  const taken = new Set(), out = [];
  const list = [...cargo.entries()].filter(([, r]) => r.votes >= MIN_VOTES)
    .sort((a, b) => b[1].votes - a[1].votes || (b[1].seen || 0) - (a[1].seen || 0));
  for (const [key, rec] of list) {
    if (splitBetter(rec, list)) continue;
    const cells = [];
    for (let dx = 0; dx < rec.w; dx++) for (let dy = 0; dy < rec.h; dy++) cells.push(`${rec.C + dx},${rec.R + dy}`);
    if (cells.some(c => taken.has(c))) continue;
    cells.forEach(c => taken.add(c));
    out.push([key, rec]);
  }
  return out;
}

// A border between cargo is reliable evidence: it never appears on the grid by itself, but it can vanish under
// a long label. So if a large cargo consists entirely of smaller ones that were also seen often,
// the smaller ones are trusted.
function splitBetter(rec, list) {
  if (rec.w * rec.h < 2) return false;
  const inside = list.map(([, r]) => r).filter(r => r !== rec && r.w * r.h < rec.w * rec.h
    && r.C >= rec.C && r.R >= rec.R && r.C + r.w <= rec.C + rec.w && r.R + r.h <= rec.R + rec.h
    && r.votes >= rec.votes * SPLIT_SHARE);
  // whether they cover every cell of the large one exactly once (greedy, most frequent first)
  const cells = new Map();
  for (const r of inside.sort((a, b) => b.votes - a.votes)) {
    const own = [];
    for (let dx = 0; dx < r.w; dx++) for (let dy = 0; dy < r.h; dy++) own.push(`${r.C + dx},${r.R + dy}`);
    if (own.some(c => cells.has(c))) continue;
    own.forEach(c => cells.set(c, r));
  }
  return cells.size === rec.w * rec.h;
}

function labelName(label) {
  return label.mystery ? MYSTERY_TIERS[label.mystery].name : label.name;
}

// ---------- Price from the tooltip ----------
// Merchant pools matching the cargo price (and label). The merchant adds ~10%, so the tooltip price
// may match a pool price as is or with the markup; the closest is taken.
function poolsForPrice(price, label) {
  let pools = libPools.filter(pl => !profile || String(pl.profile) === String(profile));
  const pl0 = poolLabel(label);
  if (pl0 && pools.some(pl => pl.label)) pools = pools.filter(pl => pl.label === pl0); // the pools of exactly this label
  else if (label && label.mystery) pools = pools.filter(pl => pl.mixed);
  else if (label && label.category) pools = pools.filter(pl => !pl.mixed && pl.categories.includes(label.category));
  if (!pools.length) return [];
  const dist = p => Math.min(Math.abs(Math.log(price / p)), Math.abs(Math.log(price / (p * PRICE_MARKUP))));
  const best = Math.min(...pools.map(pl => dist(pl.price)));
  if (best > PRICE_MATCH_LOG) return [];
  return pools.filter(pl => dist(pl.price) <= best + 1e-9);
}

// Probability of each item among these pools: id → weight
function priceWeights(pools) {
  const out = new Map();
  const tw = pools.reduce((a, pl) => a + pl.weight, 0) || 1;
  for (const pl of pools) {
    const its = pl.items.filter(([id]) => includeBlue || itemQ[id] !== 'blue');
    const tiw = its.reduce((a, [, w]) => a + w, 0) || 1;
    for (const [id, w] of its) out.set(id, (out.get(id) || 0) + pl.weight / tw * w / tiw);
  }
  return out;
}

// Everything known about a cargo for the odds: label, price and item weights by price
function cargoInfo(rec) {
  if (!rec) return null;
  const info = { ...(rec.label || {}) };
  if (rec.price) {
    info.price = rec.price;
    const pools = poolsForPrice(rec.listPrice || rec.price, rec.label); // pools have base prices: the old one on a discount
    if (pools.length) info.priceW = priceWeights(pools);
  }
  return Object.keys(info).length ? info : null;
}

// Red chance of a cargo before any sound: by label, price and size. Without a price the label alone
// gives the pools (all prices of that label).
function cargoRedOdds(rec) {
  const info = cargoInfo(rec);
  if (!info) return null;
  let weights = info.priceW;
  if (!weights) {
    const pl = poolLabel(info);
    if (!pl || ![...itemById.values()].some(it => it.wl)) return info.category ? { red: 0, items: [] } : null;
    weights = new Map();
    for (const it of itemById.values()) { const w = weightOf(it, info); if (w > 0) weights.set(it.id, w); }
  }
  const size = normSize(`${rec.w}x${rec.h}`);
  let total = 0, red = 0;
  const items = [];
  for (const [id, w] of weights) {
    const it = itemById.get(id);
    if (it && normSize(it.size) !== size) continue;
    total += w;
    if (itemQ[id] === 'red') red += w;
    if (it) items.push({ it, p: w });
  }
  if (!total) return null;
  items.forEach(x => { x.p /= total; });
  // purchases of cargo with this label (and about this price) refine the odds, like purchases refine a sound
  const seen = labelCounts(poolLabel(info), rec.price);
  const n = items.reduce((a, x) => a + (seen.get(x.it.id) || 0), 0);
  if (n) items.forEach(x => { x.p = (PRIOR_N * x.p + (seen.get(x.it.id) || 0)) / (PRIOR_N + n); });
  red = items.reduce((a, x) => a + (x.it.q === 'red' ? x.p : 0), 0);
  items.sort((a, b) => order(a.it.q) - order(b.it.q) || b.p - a.p);
  return { red, items };
}

// How many times each item dropped from cargo with this label (and, if given, about this price: within the
// tooltip price tolerance), from the shared base and own purchases: id → count
function labelCounts(label, price) {
  const out = new Map();
  if (!label) return out;
  for (const b of allPurchases()) {
    if (b.label !== label || b.itemId == null) continue;
    if (price && !(b.price && Math.abs(Math.log(b.price / price)) <= PRICE_MATCH_LOG)) continue;
    out.set(b.itemId, (out.get(b.itemId) || 0) + 1);
  }
  return out;
}

// Hover: a price tooltip shows up as cargo that suddenly stopped looking like their reference. It is read,
// and the cargo under the tooltip's top-left corner (where the cursor is) becomes "hovered": the next sound is its.
function detectHover(frame) {
  if (hoverBusy || typeof Ocr === 'undefined' || !libPools.length) return;
  const changed = [];
  for (const [, rec] of placedCargo()) {
    if (!rec.base) continue;
    const p = cargoPatch(rec, frame);
    if (p && p.length === rec.base.length && Vision.patchDiff(p, rec.base) > HOVER_DIFF) changed.push(rec);
  }
  detectHover.changed = changed.length; // for diagnostics
  if (!changed.length || changed.length > HOVER_MAX_CARGO) { hoverSig = ''; return; }
  const sig = changed.map(r => `${r.C},${r.R}`).sort().join(';');
  if (sig === hoverSig) return; // this tooltip was already read
  hoverSig = sig;
  // rectangle of the changed cargo in the frame (with a margin)
  const off = offset, px0 = phaseX;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const r of changed) {
    x0 = Math.min(x0, px0 + r.C * P); y0 = Math.min(y0, r.R * P - off);
    x1 = Math.max(x1, px0 + (r.C + r.w) * P); y1 = Math.max(y1, (r.R + r.h) * P - off);
  }
  // The tooltip is below and to the right of the cursor, ~3 cells wide and ~1.5 tall. It may extend past
  // the changed cargo (past the grid edge, over empty slots), so at least such a rectangle is cropped;
  // up and left with a margin, as the cursor may be over a cargo that is not on the map.
  x1 = Math.max(x1, x0 + P * TIP_W); y1 = Math.max(y1, y0 + P * TIP_H);
  x0 = Math.max(0, Math.round(x0 - P * 0.4)); y0 = Math.max(0, Math.round(y0 - P * 0.7));
  x1 = Math.min(fullCanvas.width, Math.round(x1 + P * 0.3)); y1 = Math.min(fullCanvas.height, Math.round(y1 + P * 0.3));
  if (x1 - x0 < P / 2 || y1 - y0 < P / 2) return;
  hoverBusy = true;
  // first exactly the tooltip itself (without neighbouring labels), and if it is not visible, the whole patch
  const box = Ocr.findTipBox(fullCanvas, x0, y0, x1 - x0, y1 - y0, P);
  const whole = { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  const read = r => { const cv = Ocr.tipCanvas(fullCanvas, r.x, r.y, r.w, r.h, P); return Ocr.readData(cv).then(data => ({ r, data, tip: Ocr.parseTip(data, cv.ocrScale) })); };
  (box ? read(box).then(res => res.tip ? res : read(whole)) : read(whole)).then(({ r, data, tip }) => {
    detectHover.text = data.text; // for diagnostics
    if (!tip) { hoverSig = ''; return; }
    // the cursor is near the tooltip's top-left corner: slightly left of and above the label (or the price line)
    const cx = r.x + (tip.labelBox ? tip.labelBox.x0 - P * 0.25 : tip.priceBox.x0 - P * 0.55);
    const cy = r.y + (tip.labelBox ? tip.labelBox.y0 - P * 0.35 : tip.priceBox.y0 - P * 0.75);
    const C = Math.floor((cx - px0) / P), R = Math.floor((cy + off) / P);
    // with the cursor from the local server the cargo under the mouse is exact; else guessed from the tooltip
    const atCursor = cursorKeyAt(performance.now());
    const hit = atCursor ? [atCursor, cargo.get(atCursor)]
      : placedCargo().find(([, r]) => C >= r.C && C < r.C + r.w && R >= r.R && R < r.R + r.h);
    detectHover.last = { sig, text: data.text, C, R, hit: !!hit }; // for diagnostics
    if (!hit) return;
    const [key, rec] = hit;
    rec.price = tip.price;
    rec.listPrice = tip.listPrice; // a discount: the pool is picked by the old price, the current one is what you pay
    if (tip.label && !rec.label) rec.label = tip.label;
    hover = { key, t: performance.now() };
    rec.hoverAt = Date.now(); // for a purchase made without dragging (ownPurchase)
    showHover(rec);
    if (document.visibilityState === 'visible') drawMap();
  }).catch(() => { hoverSig = ''; }).finally(() => { hoverBusy = false; });
}

// ---------- Cursor ----------
// The local server sends the mouse position (frame px of the captured right part of the game window).
// The cargo under it is the hovered one at once, and at a sound the one under it was picked up.
function onCursor(x, y) {
  const t = performance.now();
  cursorHist.push({ x, y, t });
  while (cursorHist.length > 1 && t - cursorHist[0].t > CURSOR_KEEP_MS) cursorHist.shift();
  const key = cargoAtPoint(x, y);
  if (key === cursorKey) return;
  cursorKey = key;
  if (key) {
    const rec = cargo.get(key);
    hover = { key, t };
    rec.hoverAt = Date.now();
    // the card of the hovered cargo, unless a sound result was shown just now
    if (!lastResult || Date.now() - lastResult.t > CURSOR_CARD_QUIET_MS) showHover(rec);
  }
  if (document.visibilityState === 'visible') drawMap();
}

// The map cargo at a point of the frame (only while the merchant grid is on screen), or null
function cargoAtPoint(x, y) {
  if (!P || !viewport || performance.now() - gridSeenAt > MERCHANT_FRESH_MS) return null;
  if (x < viewport.x || x >= viewport.x + viewport.w || y < viewport.y || y >= viewport.y + viewport.h) return null;
  const C = Math.floor((x - phaseX) / P), R = Math.floor((y + offset) / P);
  const hit = placedCargo().find(([, r]) => C >= r.C && C < r.C + r.w && R >= r.R && R < r.R + r.h);
  return hit ? hit[0] : null;
}

// The cargo that was under the cursor at a moment (performance.now), from the cursor history, or null
function cursorKeyAt(t) {
  let best = null;
  for (const c of cursorHist) if (c.t <= t + 30) best = c; else break;
  return best && t - best.t < CURSOR_KEEP_MS ? cargoAtPoint(best.x, best.y) : null;
}

// Card of the hovered cargo: whether it can be red by label and price, before any sound
function showHover(rec) {
  const odds = cargoRedOdds(rec);
  const label = rec.label;
  const red = odds ? odds.red : null;
  const color = red === null ? THEME.muted : redColor(red);
  ui.result.style.borderColor = color;
  ui.result.style.background = color + '1a';
  const title = red === null ? tr('hover.title') : red >= 0.995 ? tr('card.red') : red > 0 ? tr('hover.maybe', { p: pct(red) }) : tr('hover.none');
  ui.result.innerHTML = `
    <div class="big" style="color:${color}">${title}</div>
    <div class="sub">${esc(cargoHead(rec))}. ${esc(tr('hover.drag'))}</div>
    ${red !== null ? chanceRow(red) : ''}
    ${odds && rec.price ? paybackRow(payback(odds.items, rec.price)) : ''}
    ${odds ? itemTiles(odds.items) : ''}`;
}

// "Rare Mystery Cargo · 2×2 · 470,000": what is known about the cargo
function cargoHead(rec) {
  return [rec.label && labelName(rec.label), normSize(`${rec.w}x${rec.h}`).replace('x', '×'), rec.price && fmtPrice(rec.price)]
    .filter(Boolean).join(' · ');
}

// Read the cargo label (asynchronously, with Tesseract). Crop now, as the frame will change.
function readLabel(rec, x, y, w, h) {
  if (rec.label || rec.labelBusy || (rec.labelTries || 0) >= LABEL_TRIES || typeof Ocr === 'undefined') return;
  rec.labelBusy = true;
  const crop = Ocr.labelCanvas(fullCanvas, x, y, w, h, P), lang = Ocr.lang();
  readLabel.n = (readLabel.n || 0) + 1;
  Ocr.read(crop, readLabel.n % 2 ? 'label' : 'label2') // two readers in turn: labels appear twice as fast
    .then(text => {
      rec.labelTries = (rec.labelTries || 0) + 1;
      const label = Ocr.parseLabel(text);
      if (label) { rec.label = label; if (document.visibilityState === 'visible') drawMap(); }
      probeGameLang(lang, !!label);
    })
    .catch(e => { rec.labelTries = LABEL_TRIES; if (!readLabel.failed) report('error', tr('log.ocrFail', { msg: e.message || e })); readLabel.failed = true; })
    .finally(() => { rec.labelBusy = false; });
}

// The game language. In auto mode the language found last time is used first; if LANG_PROBE labels in a row
// are read in it without a single known one, the other language is tried (once per session each way).
function applyGameLang() {
  const l = gameLang.choice === 'auto' ? gameLang.found : gameLang.choice;
  if (typeof Ocr === 'undefined' || Ocr.lang() === l) return;
  Ocr.setLang(l);
  for (const rec of cargo.values()) if (!rec.label) rec.labelTries = 0; // read again in the new language
  feedSig = balanceSig = null;
}

function probeGameLang(lang, hit) {
  const s = langStats[lang] || (langStats[lang] = { reads: 0, hits: 0 });
  s.reads++; if (hit) s.hits++;
  if (gameLang.choice !== 'auto' || lang !== Ocr.lang()) return;
  if (hit && gameLang.found !== lang) { gameLang.found = lang; saveGameLang(); }
  const other = lang === 'eng' ? 'rus' : 'eng', o = langStats[other];
  if (s.hits || s.reads < LANG_PROBE || (o && o.reads >= LANG_PROBE)) return;
  gameLang.found = other;
  saveGameLang();
  applyGameLang();
  log(tr('log.gameLang', { lang: other === 'rus' ? 'Русский' : 'English' }));
}

function saveGameLang() { try { localStorage.setItem(GAME_LANG_KEY, JSON.stringify(gameLang)); } catch {} }
