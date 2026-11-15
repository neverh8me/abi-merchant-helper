// ABI: Merchant Helper — The step line and the cargo map.
// Plain script (no modules): all files share one global scope; index.html loads them in order.
'use strict';

// ---------- Stages ----------
function updateStage() {
  const count = placedCargo().length;
  ui.rescan.hidden = !(stream && count);
  $('btnHow').hidden = !!stream;
  ui.done.hidden = !(stream && count && phase === 'scan');
  let title, hint;
  if (!stream) { title = tr('stage.start'); hint = tr('stage.startHint'); }
  else if (!count) { title = tr('stage.open'); hint = tr('stage.openHint'); }
  else if (phase === 'scan') {
    title = tr('stage.scan', { n: count });
    hint = tr(sawEnd ? 'stage.scanHintEnd' : 'stage.scanHint');
  } else { title = tr('stage.ready', { n: count }); hint = tr('stage.readyHint'); }
  ui.stageTitle.textContent = title;
  ui.stageHint.textContent = hint;
}

// ---------- Map drawing ----------
function drawMap() {
  try { drawMapInner(); }
  catch (e) {
    if (!drawMap.failed) report('error', tr('log.mapFail', { msg: e.message }));
    drawMap.failed = true;
  }
}

function drawMapInner() {
  const { minC, minR, maxC, maxR, placed } = mapBounds();
  const W = placed.length ? Math.min(20, Math.max(1, maxC - minC)) * MAP_U : 360;
  const H = placed.length ? Math.min(MAP_MAX_ROWS, Math.max(1, maxR - minR)) * MAP_U : 120;
  if (ui.map.width !== W || ui.map.height !== H) { ui.map.width = W; ui.map.height = H; }
  const c = mapCtx;
  c.fillStyle = THEME.bg;
  c.fillRect(0, 0, W, H);
  if (!placed.length) {
    c.fillStyle = THEME.muted; c.font = '13px system-ui, sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillText(tr('map.empty'), W / 2, H / 2);
    renderBestBuys([]);
    return;
  }
  const keyOf = new Map(placed.map(r => [r, null]));
  for (const [key, rec] of placedCargo()) keyOf.set(rec, key);

  for (const rec of placed) {
    const key = keyOf.get(rec);
    const x = (rec.C - minC) * MAP_U, y = (rec.R - minR) * MAP_U, w = rec.w * MAP_U, h = rec.h * MAP_U;
    c.fillStyle = THEME.panel;
    c.fillRect(x + 2, y + 2, w - 4, h - 4);
    if (rec.thumb) { c.globalAlpha = 0.35; c.drawImage(rec.thumb, x + 2, y + 2, w - 4, h - 4); c.globalAlpha = 1; }

    if (rec.bought) {
      // already bought: dimmed, with what dropped
      c.fillStyle = 'rgba(11,12,15,.7)';
      c.fillRect(x + 2, y + 2, w - 4, h - 4);
      if (rec.bought.img) { c.globalAlpha = 0.6; drawItemIcon(c, rec.bought, x + 8, y + 8, w - 16, h - 16); c.globalAlpha = 1; }
      c.strokeStyle = THEME.neutral; c.lineWidth = 1;
      c.strokeRect(x + 2.5, y + 2.5, w - 5, h - 5);
      c.fillStyle = '#22c55e'; c.font = 'bold 14px system-ui, sans-serif'; c.textAlign = 'left'; c.textBaseline = 'top';
      c.fillText('✓', x + 6, y + 4);
      continue;
    }

    const r = results.get(key);
    const sound = r && soundById(r.soundId);
    const revealed = rec.revealed && qById[rec.revealed];
    const label = rec.label;
    if (!sound) {
      if (label && label.category && !revealed && !labelCanRed(label)) {
        // a category cargo whose pools hold no reds (Tools, Paper…): dimmed
        c.fillStyle = 'rgba(11,12,15,.6)';
        c.fillRect(x + 2, y + 2, w - 4, h - 4);
        c.strokeStyle = THEME.line; c.lineWidth = 1;
        c.strokeRect(x + 2.5, y + 2.5, w - 5, h - 5);
        continue;
      }
      if (label && label.mystery && !revealed) {
        // Mystery Cargo: may hold a red; border and caption by tier
        const tier = MYSTERY_TIERS[label.mystery];
        c.strokeStyle = tier.color; c.lineWidth = 2;
        c.strokeRect(x + 3, y + 3, w - 6, h - 6);
        c.font = 'bold 11px system-ui, sans-serif'; c.textAlign = 'center'; c.textBaseline = 'bottom';
        const text = rec.w > 1 ? tier.short : tier.tiny;
        c.lineWidth = 3; c.strokeStyle = THEME.bg;
        c.strokeText(text, x + w / 2, y + h - 4);
        c.fillStyle = tier.color;
        c.fillText(text, x + w / 2, y + h - 4);
      } else if (revealed) {
        // intel: the game itself showed the quality
        c.fillStyle = revealed.color + '55';
        c.fillRect(x + 2, y + 2, w - 4, h - 4);
        c.strokeStyle = revealed.color; c.lineWidth = 3;
        c.strokeRect(x + 3, y + 3, w - 6, h - 6);
        c.font = 'bold 11px system-ui, sans-serif'; c.textAlign = 'center'; c.textBaseline = 'bottom';
        c.fillStyle = revealed.color;
        c.fillText(qName(revealed), x + w / 2, y + h - 4);
      } else {
        c.strokeStyle = THEME.neutral; c.lineWidth = 1;
        c.strokeRect(x + 2.5, y + 2.5, w - 5, h - 5);
      }
      c.fillStyle = THEME.muted; c.font = '12px system-ui, sans-serif'; c.textAlign = 'left'; c.textBaseline = 'top';
      c.fillText('?', x + 6, y + 5);
      if (rec.price) {
        // tooltip price and the red chance by it (before any sound)
        const odds = cargoRedOdds(rec);
        c.font = 'bold 11px system-ui, sans-serif'; c.textAlign = 'right';
        c.lineWidth = 3; c.strokeStyle = THEME.bg;
        const text = money(rec.price) + (odds && odds.red > 0 ? ` · ${pct(odds.red)}` : '');
        c.strokeText(text, x + w - 5, y + 5);
        c.fillStyle = odds && odds.red > 0 ? redColor(odds.red) : THEME.text;
        c.fillText(text, x + w - 5, y + 5);
      }
      continue;
    }
    const size = `${rec.w}x${rec.h}`;
    const info = cargoInfo(rec);
    const red = qualityOdds(sound, size, info).red || 0;
    // As in the game: the cell shows possible items with a picture, quality bar and chance; reds first.
    // If there is one item (or nearly certain), one big picture.
    const cands = itemOdds(sound, size, info).filter(x => x.p >= 0.02);
    const top = cands.slice().sort((a, b) => b.p - a.p)[0];
    c.fillStyle = red > 0 ? 'rgba(127,29,29,.55)' : THEME.panel;
    c.fillRect(x + 2, y + 2, w - 4, h - 4);
    if (top && (cands.length === 1 || top.p >= 0.995)) {
      drawItemIcon(c, top.it, x + 6, y + 4, w - 12, h - 16);
      c.fillStyle = qById[top.it.q].color;
      c.fillRect(x + w * 0.2, y + h - 10, w * 0.6, 3);
    } else {
      const s = Math.max(18, Math.min(MAP_U * 0.5, (w - 8) / 2));
      const cols = Math.max(1, Math.floor((w - 6) / (s + 4))), rows = Math.max(1, Math.floor((h - 6) / (s + 14)));
      const cw = (w - 6) / cols, ch = (h - 6) / rows;
      cands.slice(0, cols * rows).forEach(({ it, p }, i) => {
        const cx = x + 3 + (i % cols) * cw, cy = y + 3 + Math.floor(i / cols) * ch;
        drawItemIcon(c, it, cx + (cw - s) / 2, cy + 1, s, s);
        c.fillStyle = qById[it.q].color;
        c.fillRect(cx + cw * 0.2, cy + s + 2, cw * 0.6, 2);
        c.font = 'bold 9px system-ui, sans-serif'; c.textAlign = 'center'; c.textBaseline = 'top';
        c.fillStyle = THEME.text;
        c.fillText(pctFine(p), cx + cw / 2, cy + s + 4);
      });
    }
    const color = red > 0 ? '#ef4444' : THEME.neutral;
    c.strokeStyle = key === lastKey ? THEME.primary : color; c.lineWidth = key === lastKey || red > 0 ? 3 : 1;
    c.strokeRect(x + 3, y + 3, w - 6, h - 6);
  }

  // the best buys: a #1…#N badge in the bottom-left corner of the cargo and the ranked list under the map
  const best = bestBuys();
  best.forEach(({ rec }, i) => {
    const x = (rec.C - minC) * MAP_U, y = (rec.R - minR) * MAP_U + rec.h * MAP_U;
    c.fillStyle = THEME.primary;
    c.beginPath(); c.arc(x + 14, y - 14, 10, 0, Math.PI * 2); c.fill();
    c.fillStyle = THEME.onPrimary; c.font = 'bold 11px system-ui, sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillText('#' + (i + 1), x + 14, y - 13);
  });
  renderBestBuys(best);
  checkAlerts(best);

  // the part of the list on screen now: a dashed frame over those rows
  if (viewport && P && performance.now() - gridSeenAt < MERCHANT_FRESH_MS) {
    const r0 = (viewport.y + offset) / P - minR, r1 = (viewport.y + viewport.h + offset) / P - minR;
    const c0 = (viewport.x - phaseX) / P - minC, c1 = (viewport.x + viewport.w - phaseX) / P - minC;
    c.save();
    c.setLineDash([6, 4]); c.strokeStyle = 'rgba(230,232,235,.55)'; c.lineWidth = 1.5;
    c.strokeRect(c0 * MAP_U + 1, r0 * MAP_U + 1, (c1 - c0) * MAP_U - 2, (r1 - r0) * MAP_U - 2);
    c.restore();
  }
  // the cargo under the mouse and the cursor itself (with the local server)
  const cur = cursorHist[cursorHist.length - 1];
  if (cursorKey && cargo.has(cursorKey)) {
    const r = cargo.get(cursorKey);
    c.strokeStyle = THEME.info; c.lineWidth = 3;
    c.strokeRect((r.C - minC) * MAP_U + 1.5, (r.R - minR) * MAP_U + 1.5, r.w * MAP_U - 3, r.h * MAP_U - 3);
  }
  if (mapFocus && document.activeElement === ui.map && cargo.has(mapFocus)) {
    const r = cargo.get(mapFocus);
    c.save(); c.setLineDash([5, 3]); c.strokeStyle = THEME.text; c.lineWidth = 2;
    c.strokeRect((r.C - minC) * MAP_U + 3, (r.R - minR) * MAP_U + 3, r.w * MAP_U - 6, r.h * MAP_U - 6);
    c.restore();
  }
  if (cur && P && viewport && performance.now() - cur.t < CURSOR_KEEP_MS) {
    const mx = ((cur.x - phaseX) / P - minC) * MAP_U, my = ((cur.y + offset) / P - minR) * MAP_U;
    if (mx >= 0 && my >= 0 && mx <= W && my <= H) {
      c.fillStyle = THEME.info;
      c.beginPath(); c.arc(mx, my, 4, 0, Math.PI * 2); c.fill();
    }
  }
}

// Item picture fitted into a rectangle keeping the proportions
function drawItemIcon(c, it, x, y, w, h) {
  const img = it.img && cachedImage(it.img);
  if (!img || !img.complete || !img.naturalWidth) return;
  const k = Math.min(w / img.naturalWidth, h / img.naturalHeight);
  const iw = img.naturalWidth * k, ih = img.naturalHeight * k;
  c.drawImage(img, x + (w - iw) / 2, y + (h - ih) / 2, iw, ih);
}

// Popup over the map: what is known about the cargo under the mouse
function showMapPop(e) { showPopFor(mapCargoAt(e), e.clientX, e.clientY); }
function showPopFor(key, x, y) {
  const rec = key && cargo.get(key);
  const pop = $('mapPop');
  if (!rec) { pop.hidden = true; return; }
  const r = results.get(key);
  const sound = r && soundById(r.soundId);
  let body;
  if (sound) {
    const info = cargoInfo(rec), size = `${rec.w}x${rec.h}`;
    const red = qualityOdds(sound, size, info).red || 0;
    const list = itemOdds(sound, size, info);
    body = chanceRow(red) + (rec.price ? paybackRow(payback(list, rec.price)) : '') + itemTiles(list, 9);
  } else {
    const odds = cargoRedOdds(rec);
    body = odds ? chanceRow(odds.red) + (rec.price ? paybackRow(payback(odds.items, rec.price)) : '') + itemTiles(odds.items, 9)
      : `<div class="muted" style="margin-top:8px">${esc(tr('pop.unknown'))}</div>`;
  }
  pop.innerHTML = `<div class="head">${esc(cargoHead(rec))}</div>${body}`;
  pop.hidden = false;
  const pw = pop.offsetWidth, ph = pop.offsetHeight;
  pop.style.left = Math.max(8, Math.min(window.innerWidth - pw - 8, x - pw - 16)) + 'px';
  pop.style.top = Math.max(8, Math.min(window.innerHeight - ph - 8, y - ph / 3)) + 'px';
}

const imgCache = new Map();
function cachedImage(src) {
  let img = imgCache.get(src);
  if (!img) { img = new Image(); img.onload = drawMap; img.src = src; imgCache.set(src, img); }
  return img;
}

function canvasPos(canvas, e) {
  const r = canvas.getBoundingClientRect();
  return { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height };
}
