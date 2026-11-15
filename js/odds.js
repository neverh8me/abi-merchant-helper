// ABI: Merchant Helper — Item odds and payback of a cargo.
// Plain script (no modules): all files share one global scope; index.html loads them in order.
'use strict';

// ---------- Odds ----------
// Item weight for the selected map; own items (without merchant data) have one weight for all maps.
// Blue items do not actually drop from the merchant (although the abibuilder tables have them): not counted without the checkbox.
// label — what is known about the cargo (cargoInfo): the label and, if read, the price. By price — only pools of that
// price and label; by label alone — the pools of that label (every pool carries the merchant label of its cargo).
function weightOf(it, label) {
  if (it.q === 'blue' && !includeBlue) return 0;
  if (label && label.priceW) return label.priceW.get(it.id) || 0;
  const pl = label && poolLabel(label);
  if (pl && it.wl) return it.wl[pl] ? (profile ? (it.wlp[pl] || {})[profile] || 0 : it.wl[pl]) : 0;
  if (label && label.mystery && it.wpm) return profile ? it.wpm[profile] || 0 : it.wm;
  if (profile && it.wp) return it.wp[profile] || 0;
  return it.w;
}

// The merchant label of a cargo as the pools name it ("Rare Mystery Cargo", "Rare Collectibles"…), or ''
function poolLabel(label) {
  return label ? labelName(label) || '' : '';
}

// Whether any pool with this label holds a red item (Mystery Cargo, rare category cargo…)
function labelCanRed(label) {
  const pl = poolLabel(label);
  if (!pl || !libPools.some(p => p.label)) return !label.category; // no label data: the old rule
  return libPools.some(p => p.label === pl && p.items.some(([id]) => itemQ[id] === 'red'));
}

// Size without rotation: the merchant may place a cargo rotated (TI Module 2×1 lies as 1×2),
// so we compare "smaller side × larger side"
function normSize(size) {
  if (!size) return '';
  const [a, b] = size.split('x').map(Number);
  return `${Math.min(a, b)}x${Math.max(a, b)}`;
}

// Sound items that fit the cargo size and label (cargo size at the merchant = item size).
// A known label keeps only items its pools can hold: a category cargo ("Tools"…) holds that category,
// and reds only where the pools have them (Mystery Cargo, Rare Collectibles…).
function itemsFor(sound, size, label) {
  let items = sound.items.filter(it => it.q !== 'blue' || includeBlue);
  const pl = label && poolLabel(label);
  if (pl && items.some(it => it.wl)) {
    const inLabel = items.filter(it => it.wl && it.wl[pl] > 0);
    if (inLabel.length) items = inLabel;
  } else if (label && label.category) {
    // no label data (an old library): the former rule
    items = items.filter(it => it.q !== 'red');
    const same = items.filter(it => it.category === label.category);
    if (same.length) items = same;
  }
  if (!size) return items;
  const fit = items.filter(it => normSize(it.size) === normSize(size));
  return fit.length ? fit : items; // the size matched nothing: show all
}

// Probability of each item; if none of them occurs on the map, all are equal.
// Order: reds first, then golds and so on; within a quality, by chance.
function itemOdds(sound, size, label) {
  const list = itemsFor(sound, size, label);
  let total = list.reduce((a, it) => a + weightOf(it, label), 0);
  // no sound item fits the price, so the price or the sound was read wrong: go without the price
  if (!total && label && label.priceW) return itemOdds(sound, size, { ...label, priceW: null });
  const uniform = !total;
  if (uniform) total = list.length || 1;
  // Purchases with this sound refine the odds: the merchant data counts as PRIOR_N "imaginary" purchases,
  // the real ones are added to them (Dirichlet posterior mean). The more purchases, the more they are trusted.
  const seen = boughtCounts(sound.id);
  const n = list.reduce((a, it) => a + (seen.get(it.id) || 0), 0);
  return list.map(it => {
    const prior = (uniform ? 1 : weightOf(it, label)) / total;
    return { it, p: n ? (PRIOR_N * prior + (seen.get(it.id) || 0)) / (PRIOR_N + n) : prior };
  }).sort((a, b) => order(a.it.q) - order(b.it.q) || b.p - a.p);
}

// How many times each item dropped with the sound (shared base + own): id → count
function boughtCounts(soundId) {
  const out = new Map();
  for (const b of allPurchases()) if (b.soundId === soundId && b.itemId != null) out.set(b.itemId, (out.get(b.itemId) || 0) + 1);
  return out;
}

// Shared base and own purchases together, without duplicates (an own purchase already in the base counts once)
const purchaseKey = b => `${b.t}|${b.itemId}|${b.price}`;
function mergePurchases(...lists) {
  const out = new Map();
  for (const list of lists) for (const b of list) if (b && b.t) out.set(purchaseKey(b), b);
  return [...out.values()].sort((a, b) => a.t - b.t);
}
let allCache = null;
function allPurchases() {
  return allCache || (allCache = mergePurchases(basePurchases, purchases));
}

function qualityOdds(sound, size, label) {
  const odds = {};
  for (const { it, p } of itemOdds(sound, size, label)) odds[it.q] = (odds[it.q] || 0) + p;
  return odds;
}

// The item for the picture: the most likely red one if any, otherwise the most likely item
function showcaseItem(sound, size, label) {
  const list = itemOdds(sound, size, label).filter(x => x.p > 0);
  const red = list.find(x => x.it.q === 'red');
  return (red || list.slice().sort((a, b) => b.p - a.p)[0] || {}).it;
}

function sizesOf(sound) {
  const have = new Set(itemsFor(sound, '').map(it => normSize(it.size)));
  return SIZE_KEYS.filter(sz => have.has(sz));
}

function showResult(sound, score, second, size, label) {
  const odds = qualityOdds(sound, size, label);
  const red = odds.red || 0;
  const color = redColor(red);
  ui.result.style.borderColor = color;
  ui.result.style.background = color + '1a';

  // red chance for every size: visible even if the cargo was not determined
  const sizes = sizesOf(sound).map(sz => {
    const r = qualityOdds(sound, sz, label).red || 0;
    return `<span class="size${sz === normSize(size) ? ' on' : ''}" style="border-color:${redColor(r)}">${sz} <b style="color:${redColor(r)}">${pct(r)}</b></span>`;
  }).join('');

  const alt = second && second.score > score - 0.05 && second.s.items.length
    ? `<div class="muted" style="margin-top:10px">${esc(tr('card.alt', { name: soundName(second.s), p: pct(second.score), red: pct(qualityOdds(second.s, size, label).red || 0) }))}</div>`
    : '';

  const parts = [tr('card.sub', { name: soundName(sound), p: pct(score) })];
  ui.result.innerHTML = `
    <div class="big" style="color:${color}">${red >= 0.995 ? tr('card.red') : red > 0 ? tr('card.redP', { p: pct(red) }) : tr('card.notRed')}</div>
    <div class="sub">${esc(parts[0] + (size ? tr('card.cargo', { size: normSize(size) }) : ''))}${label && (label.mystery || label.category) ? `, ${esc(labelName(label))}` : ''}${label && label.price ? `, ${fmtPrice(label.price)}` : ''}</div>
    ${sizes ? `<div class="sizes">${sizes}</div>` : ''}
    ${chanceRow(red)}
    ${label && label.price ? paybackRow(payback(itemOdds(sound, size, label), label.price)) : ''}
    ${itemTiles(itemOdds(sound, size, label))}
    ${alt}`;
  document.title = tr('doc.title', { p: pct(red), app: tr('app') });
}

// ---------- Payback ----------
// Value of an item: the market price or the trader hand-in price (selectable)
function itemValue(it) {
  return valueBasis === 'trader' ? it.contact || it.price || 0 : it.price || it.contact || 0;
}

// Whether a cargo pays off: the expected value of what drops against the price, the chance to get more than
// the price, the cheapest and the dearest likely item. list — [{ it, p }] as from itemOdds / cargoRedOdds.
function payback(list, price) {
  const known = list.filter(x => x.p > 0 && itemValue(x.it) > 0);
  const total = known.reduce((a, x) => a + x.p, 0);
  if (!price || !total) return null;
  let ev = 0, more = 0, min = Infinity, max = 0;
  for (const { it, p } of known) {
    const v = itemValue(it), q = p / total;
    ev += q * v;
    if (v > price) more += q;
    if (q >= 0.005) { min = Math.min(min, v); max = Math.max(max, v); }
  }
  const verdict = ev >= price * PAY_GOOD ? 'good' : ev >= price * PAY_GAMBLE ? 'gamble' : 'bad';
  return { ev, price, more, min: min === Infinity ? 0 : min, max, verdict };
}

const VERDICT_COLOR = { good: '#22c55e', gamble: '#f0b429', bad: '#ef4444' };
function paybackRow(pb) {
  if (!pb) return '';
  const c = VERDICT_COLOR[pb.verdict];
  const diff = Math.round((pb.ev / pb.price - 1) * 100);
  return `<div class="payback" style="border-color:${c}66;background:${c}10">
    <span class="verdict" style="background:${c}">${esc(tr('pb.' + pb.verdict))}</span>
    <span>${esc(tr('pb.ev', { ev: money(pb.ev), price: money(pb.price), diff: (diff > 0 ? '+' : '') + diff + '%' }))}</span>
    <span class="muted">${esc(tr('pb.more', { p: pct(pb.more) }))} · ${money(pb.min)}–${money(pb.max)}</span>
  </div>`;
}

// What may drop from a cargo now: by its sound if one was heard, otherwise by label and price
function cargoOdds(key, rec) {
  const r = results.get(key);
  const sound = r && soundById(r.soundId);
  if (sound) return itemOdds(sound, `${rec.w}x${rec.h}`, cargoInfo(rec));
  const o = cargoRedOdds(rec);
  return o ? o.items : [];
}

// The best buys on the map: cargo with a known price ranked by the expected profit, as many as may be bought
function bestBuys() {
  const out = [];
  for (const [key, rec] of placedCargo()) {
    if (!rec.price || rec.bought) continue;
    const pb = payback(cargoOdds(key, rec), rec.price);
    if (pb && pb.ev > pb.price) out.push({ key, rec, pb, profit: pb.ev - pb.price });
  }
  return out.sort((a, b) => b.profit - a.profit).slice(0, buysPerRaid);
}

// Summary of this session's purchases: count, Koen spent, reds and what the items are worth. It also shows
// right away whether a purchase was recorded at all.
function renderSession() {
  const mine = purchases.filter(b => b.t >= sessionStart && !b.seen);
  const head = `<h3>${esc(tr('session.title'))}<button class="btn btn-sm btn-neutral" id="btnSessionReset">${esc(tr('session.reset'))}</button></h3>`;
  if (!mine.length) { $('session').innerHTML = head + `<div class="muted">${esc(tr('session.none'))}</div>`; return; }
  let spentK = 0, value = 0, reds = 0;
  for (const b of mine) {
    const it = b.itemId != null && itemById.get(b.itemId);
    spentK += b.price || 0;
    if (it) value += itemValue(it);
    if ((it ? it.q : b.q) === 'red') reds++;
  }
  const diff = spentK ? Math.round((value / spentK - 1) * 100) : 0;
  const c = diff >= 0 ? VERDICT_COLOR.good : VERDICT_COLOR.bad;
  const last = mine[mine.length - 1];
  $('session').innerHTML = head + `<div>${esc(tr('session.line', { n: mine.length, spent: money(spentK), red: reds, value: money(value) }))}
    <b style="color:${c}">(${diff > 0 ? '+' : ''}${diff}%)</b></div>
    <div class="muted">${esc(tr('session.last', { item: last.item || '?' }))}</div>`;
}
$('session').addEventListener('click', e => {
  if (e.target.id !== 'btnSessionReset') return;
  sessionStart = Date.now();
  try { sessionStorage.setItem(SESSION_KEY, String(sessionStart)); } catch {}
  renderSession();
});

// A chime when a hovered cargo turns out good: it pays off or has a high red chance. Once per cargo; cargo
// already dragged are skipped (their sound result beeps by itself).
function checkAlerts(best) {
  if (!alertOn || phase !== 'frozen') return;
  const good = new Set(best.filter(b => b.pb.verdict === 'good').map(b => b.key));
  for (const [key, rec] of placedCargo()) {
    if (!rec.price || rec.bought || results.has(key)) continue;
    const sig = `${key}|${rec.price}|${rec.label ? poolLabel(rec.label) : ''}`;
    if (alerted.has(sig)) continue;
    const list = cargoOdds(key, rec);
    const red = list.reduce((a, x) => a + (x.it.q === 'red' ? x.p : 0), 0);
    if (!good.has(key) && red < ALERT_RED) continue;
    alerted.add(sig);
    const pb = payback(list, rec.price);
    const diff = pb ? Math.round((pb.ev / pb.price - 1) * 100) : 0;
    log(tr('log.alert', { cargo: cargoHead(rec), red: pct(red), diff: (diff > 0 ? '+' : '') + diff + '%' }));
    if (performance.now() >= muteUntil) chime([784, 1047, 1568]);
  }
}

function renderBestBuys(list) {
  renderSession();
  const el = $('bestBuys');
  if (!list.length) { el.innerHTML = ''; return; }
  el.innerHTML = `<h3>${esc(tr('best.title', { n: buysPerRaid }))}</h3>` + list.map((b, i) => `
    <div class="best"><span class="rank">#${i + 1}</span>
      <span>${esc(cargoHead(b.rec))} → ~${money(b.pb.ev)} <b style="color:${VERDICT_COLOR[b.pb.verdict]}">(+${money(b.profit)})</b></span>
    </div>`).join('');
}

// The "Red chance NN%" row
function chanceRow(red) {
  const c = redColor(red);
  return `<div class="chance" style="border-color:${c}66;background:${c}14"><span><span class="dot" style="background:${c}"></span> ${tr('pop.red')}</span><b style="color:${c}">${pct(red)}</b></div>`;
}

// Tiles of possible items: picture, quality bar, chance. Reds first, zero ones are not shown.
function itemTiles(list, max = 12) {
  const shown = (list.some(x => x.p > 0) ? list.filter(x => x.p >= 0.005) : list).slice(0, max);
  return `<div class="tiles">${shown.map(({ it, p }) => `
    <div class="tile" title="${esc(itemName(it))} · ${normSize(it.size)}${it.price ? ' · ~' + money(it.price) : ''}">
      ${it.img ? `<img src="${it.img}" alt="">` : `<div class="noimg">${esc(itemName(it))}</div>`}
      <i style="background:${qById[it.q].color}"></i>
      <b>${pctFine(p)}</b>
    </div>`).join('')}</div>`;
}
