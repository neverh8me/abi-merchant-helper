// ABI: Merchant Helper — Purchase recording from the feed line and the balance, the shared base.
// Plain script (no modules): all files share one global scope; index.html loads them in order.
'use strict';

// ---------- Purchases ----------
// After a purchase the game writes above the grid: "nick spent 200,000 Koen on a mystery cargo and obtained [item]".
// Such lines also appear for other players' purchases, and nicknames are not stored at all. Own purchase is recognized
// by the balance below the grid ("Owned: 624,605"): it dropped by exactly the line amount, so you bought it.
// Then the cargo whose sound was heard and whose tooltip price matches the amount is looked up.
function readFeed(G, grid, now) {
  if (feedBusy || now - feedAt < FEED_MS || typeof Ocr === 'undefined' || !viewport) return;
  feedAt = now;
  const x = Math.max(0, Math.round(grid.x0)), w = Math.round(Math.min(grid.cols * P, G.w - x));
  // without the button at the right end of the line: it is read as stray letters after the item name
  const bands = FEED_BANDS.map(([top, bottom]) => {
    const y = Math.max(0, Math.round(viewport.y - P * top));
    return { x, y, w: Math.round(w - P * FEED_RIGHT_CUT), h: Math.round(viewport.y - P * bottom) - y };
  });
  const y = bands[0].y, h = bands[bands.length - 1].y + bands[bands.length - 1].h - y; // both bands: to notice a change
  // the balance is in the right half below the list
  const bx = Math.round(grid.x0 + grid.cols * P * BALANCE_LEFT), bw = Math.round(Math.min(grid.x0 + grid.cols * P + P * 0.3, G.w) - bx);
  const by = Math.round(viewport.y + viewport.h), bh = Math.round(Math.min(G.h, by + P * BALANCE_BELOW) - by);
  const changed = (r, prev) => {
    if (r.w < P * 2 || r.h < P * 0.25) return null;
    const sig = Vision.crop(G, r.x, r.y, r.w, r.h);
    return prev && prev.length === sig.length && Vision.patchDiff(sig, prev) < 2 ? null : sig; // the same one: not read again
  };
  const feedR = { x, y, w, h }, balR = { x: bx, y: by, w: bw, h: bh };
  const fs = changed(feedR, feedSig), bs = changed(balR, balanceSig);
  if (!fs && !bs) { processFeed(); return; }
  if (fs) feedSig = fs;
  if (bs) balanceSig = bs;
  feedBusy = true;
  const read = r => Ocr.readData(Ocr.tipCanvas(fullCanvas, r.x, r.y, r.w, r.h, P), 'label').then(d => d.text);
  // the balance first: the purchase line and the balance drop usually appear together
  if (fs) diagFrame('feed');
  (bs ? read(balR).then(t => { const v = Ocr.parseBalance(t); diag(`balance area ${bx},${by} ${bw}x${bh}: "${t.trim()}" -> ${v}`); if (v) onBalance(v); }) : Promise.resolve())
    .then(async () => {
      if (!fs) return;
      for (const r of bands) {
        const t = await Ocr.read(Ocr.feedCanvas(fullCanvas, r.x, r.y, r.w, r.h, P), 'feed');
        let f = Ocr.parseFeed(t);
        diag(`feed area ${r.x},${r.y} ${r.w}x${r.h}: "${t.trim()}" -> ${JSON.stringify(f)}`);
        // the item was not recognized: the plain grayscale sometimes reads small white names better
        if (f && !feedItem(f.item)) {
          const t2 = await Ocr.read(Ocr.tipCanvas(fullCanvas, r.x, r.y, r.w, r.h, P), 'feed'), f2 = Ocr.parseFeed(t2);
          diag(`feed area again: "${t2.trim()}" -> ${JSON.stringify(f2)}`);
          if (f2 && f2.price === f.price && feedItem(f2.item)) f = f2;
        }
        if (f) { onFeed(f); break; }
      }
    })
    .catch(e => { feedSig = balanceSig = null; diag('feed/balance read failed: ' + (e && e.message || e)); })
    .finally(() => { feedBusy = false; processFeed(); });
}

// Local diagnostics (diag/ in the app folder, never sent anywhere): what the purchase reading saw and decided.
// Off by default; turned on by opening the page once with ?diag=1 (?diag=0 turns it off) or by a diag.on file
// in the app folder.
let DIAG = location.protocol.startsWith('http') && (() => {
  const q = new URLSearchParams(location.search).get('diag');
  try { if (q !== null) localStorage.setItem('abi-mh-diag-v1', q === '1' ? '1' : ''); return localStorage.getItem('abi-mh-diag-v1') === '1'; } catch { return q === '1'; }
})();
if (!DIAG && location.protocol.startsWith('http')) fetch('diag.on', { cache: 'no-store' }).then(r => { if (r.ok) DIAG = true; }).catch(() => {});
function diag(msg) {
  if (DIAG) fetch('api/diag', { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: String(msg) }).catch(() => {});
}
// The drawn map as an image next to the frames (diag only): what the app thought the list looks like
function diagMap() {
  if (DIAG && ui.map.width > 1) ui.map.toBlob(b => { if (b) fetch('api/diagframe', { method: 'POST', body: b }).catch(() => {}); }, 'image/jpeg', 0.9);
}
setInterval(() => { if (stream && phase === 'frozen') diagMap(); }, 60000);
function diagFrame() {
  if (DIAG && fullCanvas.width) fullCanvas.toBlob(b => { if (b) fetch('api/diagframe', { method: 'POST', body: b }).catch(() => {}); }, 'image/jpeg', 0.85);
}
setInterval(() => {
  if (stream) diag(`state: phase=${phase} P=${P && P.toFixed(1)} viewport=${JSON.stringify(viewport)} scrollbar=${!!sbKnown} cargo=${cargo.size} balance=${balance} spent=${spent} queue=${feedQueue.map(f => f.price + ' ' + f.item).join('; ')} skips=${JSON.stringify(skips)} lastParse=${Math.round((performance.now() - lastScan) / 1000)}s ago`);
  skips = {};
}, 15000);

function onBalance(v) {
  if (balance !== null && v !== balance) diag(`balance ${balance} -> ${v}`);
  if (balance !== null && v < balance) { spent += balance - v; spentAt = performance.now(); }
  balance = v;
}

// A feed line waits in the queue until the balance confirms (or refutes) the purchase.
// The same line read slightly differently ("Rebrut"/"Rebcut") is the same purchase: not added twice.
function onFeed(feed) {
  const now = performance.now(), it = feedItem(feed.item);
  const dup = feedQueue.some(f => f.price === feed.price && (it ? f.it === it : Ocr.matchName(f.item, [{ name: feed.item }])))
    // a late reading of a line already counted: the same amount and the same item, or an item not read at all
    || feedDone.some(f => f.price === feed.price && now - f.at < FEED_SAME_MS && (it ? f.it === it : true));
  if (!dup) feedQueue.push({ ...feed, it, at: now });
}

// The item named in a feed line, or null when the line was misread
// Items as { name, it } for matching a read name: the English name and the Russian one (the game may be in either)
function itemNames(list) {
  return list.flatMap(x => [x.nameEn, x.name].filter((n, i, a) => n && a.indexOf(n) === i).map(name => ({ name, it: x })));
}

function feedItem(text) {
  const m = Ocr.matchName(text, itemNames([...itemById.values()]));
  return m ? m.it : null;
}

// Own purchases are the lines whose amounts add up to exactly what the balance dropped by: one line, or a few
// for a cart. Other players' lines (another amount) stay unmatched and expire. The same line is read many times,
// often garbled: readings with the same amount and item (or no item) are one purchase, and the reading that
// names an item is the one recorded; a garbled one is taken only if no better reading comes within a few seconds.
function processFeed() {
  const now = performance.now();
  for (const f of feedQueue) if (now - f.at >= FEED_WAIT_MS) { diag(`feed line not confirmed as own, the balance did not fall by ${f.price}: ${f.item} (spent=${spent})`); recordSeen(f); }
  feedQueue = feedQueue.filter(f => now - f.at < FEED_WAIT_MS);
  feedDone = feedDone.filter(f => now - f.at < FEED_SAME_MS);
  if (spent && now - spentAt >= FEED_WAIT_MS) { diag(`balance drop of ${spent} matches no purchase line`); spent = 0; }
  if (!spent || !feedQueue.length) return;
  const groups = [];
  for (const f of feedQueue) {
    const it = f.it !== undefined ? f.it : (f.it = feedItem(f.item));
    let g = groups.find(g => g.price === f.price && (!it || !g.it || g.it === it));
    if (!g) groups.push(g = { price: f.price, it: null, lines: [] });
    g.lines.push(f);
    if (it && !g.it) g.it = it;
  }
  groups.sort((a, b) => Math.max(...b.lines.map(f => f.at)) - Math.max(...a.lines.map(f => f.at))); // the newest line first
  const near = (sum, v) => Math.abs(sum - v) <= v * BUY_MATCH;
  let pick = null;
  for (let size = 1; size <= Math.min(4, groups.length) && !pick; size++) {
    const walk = (from, chosen, sum) => {
      if (chosen.length === size) { if (near(sum, spent)) pick = chosen; return; }
      for (let i = from; i < groups.length && !pick; i++) walk(i + 1, [...chosen, groups[i]], sum + groups[i].price);
    };
    walk(0, [], 0);
  }
  if (!pick) return;
  if (pick.some(g => !g.it) && now - spentAt < FEED_BEST_MS) return; // a better reading of the item may still come
  spent = 0;
  for (const g of pick) {
    const best = g.lines.filter(f => f.it === g.it).sort((a, b) => b.at - a.at)[0];
    feedQueue = feedQueue.filter(f => !g.lines.includes(f));
    feedDone.push(...g.lines);
    ownPurchase(best);
  }
}

function ownPurchase({ price, item }) {
  // What dropped is known from the line, so the bought cargo must fit it: its sound holds this item and its
  // size is the item's size. Many cargo share a price (200k, 250k…) and a cargo may be missing from the map,
  // so "the last sound heard" would often be another cargo's sound. Of several fitting cargo with this price
  // the one heard last is taken; if none fits, the hovered cargo of that label is taken without a sound (below).
  const named = itemNames([...itemById.values()]);
  const m = Ocr.matchName(item, named), it = m && m.it;
  const fits = (key, res) => {
    const rec = cargo.get(key), s = res && soundById(res.soundId);
    if (!rec || !s || !it) return false;
    return s.items.some(x => x.id === it.id) && normSize(`${rec.w}x${rec.h}`) === normSize(it.size);
  };
  const byPrice = [...results].filter(([key, res]) => {
    const rec = cargo.get(key);
    return rec && rec.price && !rec.bought && Math.abs(rec.price - price) <= price * BUY_MATCH && fits(key, res);
  }).sort((a, b) => (b[1].t || 0) - (a[1].t || 0))[0];
  let key = byPrice ? byPrice[0] : null, res = byPrice ? byPrice[1] : null;
  // the price was not read (no hover): the last sound heard within 3 min, but only if it fits the item
  if (!byPrice && lastResult && Date.now() - lastResult.t < 180e3 && lastResult.key && fits(lastResult.key, lastResult)) { key = lastResult.key; res = lastResult; }
  // bought without dragging: the hovered cargo with this price whose label pools hold the item and whose size
  // is the item's size (the one hovered last); it is recorded without a sound, with its label and price
  if (!key && it) {
    const byLabel = placedCargo().filter(([, r]) => r.price && !r.bought && r.label && Math.abs(r.price - price) <= price * BUY_MATCH
      && normSize(`${r.w}x${r.h}`) === normSize(it.size) && it.wl && it.wl[poolLabel(r.label)] > 0)
      .sort((a, b) => (b[1].hoverAt || 0) - (a[1].hoverAt || 0))[0];
    if (byLabel) key = byLabel[0];
  }
  const rec = key && cargo.get(key);
  diag(`purchase confirmed: ${price} "${item}" -> item ${it ? it.nameEn : "?"} (${it ? it.size : "-"}); cargo ${key || "none"} ${rec ? rec.w + "x" + rec.h + " " + (rec.label ? poolLabel(rec.label) : "no label") + " " + rec.price : ""}; sound ${res ? res.soundId : "none"}; priced cargo on map: ${placedCargo().filter(([, r]) => r.price).map(([k, r]) => k + "=" + r.price).join(" ")}`);
  recordPurchase({ soundId: res && res.soundId, size: rec ? normSize(`${rec.w}x${rec.h}`) : '', label: cargoInfo(rec), price, itemText: item, itemId: it ? it.id : null, key });
}

// Records from before this check may pair an item with another cargo's sound: such a sound is dropped
function dropMismatchedSounds() {
  let changed = false;
  purchases = purchases.map(b => {
    const s = b.soundId && soundById(b.soundId), it = b.itemId != null && itemById.get(b.itemId);
    const badSound = s && it && !s.items.some(x => x.id === b.itemId);
    const badSize = it && b.size && normSize(b.size) !== normSize(it.size); // a cargo of another size than the item
    if (!badSound && !badSize) return b;
    changed = true;
    return { ...b, soundId: null, label: '', size: '' }; // the whole cargo pairing was wrong, not only the sound
  });
  if (changed) { savePurchases(); syncBase(); }
}

// A purchase line that is not (or cannot be shown to be) own: someone else's, or a cart where only the last line
// shows. It still tells "a cargo of this label and price gave this item", so it is kept for the odds when the item is
// known and only one cargo label sells that item at that price. Own session totals leave these out (seen: true).
let seenRecent = []; // { price, itemId, at }: a line still on screen is read again, it counts once
function seenLabel(itemId, price) {
  const dist = p => Math.min(Math.abs(Math.log(price / p)), Math.abs(Math.log(price / (p * PRICE_MARKUP))));
  const labels = new Set(libPools.filter(pl => pl.label && pl.items.some(([id]) => id === itemId) && dist(pl.price) <= PRICE_MATCH_LOG).map(pl => pl.label));
  return labels.size === 1 ? [...labels][0] : '';
}
function recordSeen(f) {
  const it = f.it || feedItem(f.item), now = performance.now();
  seenRecent = seenRecent.filter(s => now - s.at < SEEN_SAME_MS);
  if (!it || seenRecent.some(s => s.price === f.price && s.itemId === it.id)) return;
  const label = seenLabel(it.id, f.price);
  if (!label) { diag(`seen purchase skipped, the cargo label is not certain: ${f.price} ${it.nameEn || it.name}`); return; }
  seenRecent.push({ price: f.price, itemId: it.id, at: now });
  purchases.push({ t: Date.now(), soundId: null, size: '', label, price: f.price, itemId: it.id, item: it.nameEn || it.name, q: it.q || '', seen: true });
  diag(`seen purchase kept: ${label} ${f.price} -> ${it.nameEn || it.name}`);
  savePurchases();
  syncBase();
}

// Records a purchase. itemId if the item is already known, otherwise it is looked up by name.
function recordPurchase({ soundId, size, label, price, itemText, itemId, key }) {
  const sound = soundId && soundById(soundId);
  let it = itemId != null ? itemById.get(itemId) || (sound && sound.items.find(x => String(x.id) === String(itemId))) : null;
  if (!it && itemText) {
    const named = itemNames;
    const m = (sound && Ocr.matchName(itemText, named(sound.items))) || Ocr.matchName(itemText, named([...itemById.values()]));
    it = m && m.it;
  }
  const rec = key && cargo.get(key);
  purchases.push({
    t: Date.now(), soundId: soundId || null, size: size || '',
    label: label && (label.mystery || label.category) ? labelName(label) : '',
    price: price || (rec && rec.price) || 0,
    itemId: it ? it.id : null, item: it ? it.nameEn || it.name : itemText || '', q: it ? it.q : '',
  });
  savePurchases();
  syncBase();
  if (rec) rec.bought = it || true;
  drawMap();
}

function savePurchases() {
  allCache = null;
  try { localStorage.setItem(PURCHASES_KEY, JSON.stringify(purchases)); } catch {}
}

// Shared base: from the app folder and the freshest from GitHub (if online), both merged
async function loadBase() {
  const get = async url => {
    try {
      const r = await fetch(url, { cache: 'no-cache' });
      if (!r.ok) return [];
      const data = await r.json();
      return Array.isArray(data.purchases) ? data.purchases : [];
    } catch { return []; }
  };
  const [local, remote] = await Promise.all([get(BASE_URL), get(BASE_REMOTE)]);
  basePurchases = mergePurchases(local, remote);
  allCache = null;
  syncBase(); // own purchases not yet in the local file (say, recorded before this version)
  drawMap();
}

// Own purchases go to a local file (purchases.mine.json via the local server), and from there
// sync.ps1 sends them to the shared server on the next launch. Without the server (site not via start.bat) this is skipped quietly.
let syncBusy = false, syncAgain = false;
const SHARE_LABELS = new Set(['', ...Object.values(MYSTERY_TIERS).map(t => t.name), 'Military Items', 'Medical Supplies', 'Computer Parts',
  'Collectibles', 'Instruments', 'Energy Items', 'Household Items', 'Building Materials', 'Electronics', 'Flammables', 'Tools', 'Paper',
  'Rare Collectibles', 'Uncommon Collectibles', 'Rare Medical Supplies', 'Uncommon Military Items']);
// A purchase is worth sharing with its sound (sound → item) or, bought without dragging, with the cargo
// label and price (label + price → item)
function shareable(b) {
  const it = b.itemId != null && itemById.get(b.itemId);
  const label = SHARE_LABELS.has(b.label) ? b.label : '';
  if (!it || !(b.soundId || (label && b.price))) return null;
  return { t: b.t, soundId: b.soundId || null, size: b.size || '', label, price: b.price || 0, itemId: b.itemId, item: it.nameEn || '', q: it.q || '' };
}
async function syncBase() {
  // before the library is loaded no purchase can be checked (shareable needs the item catalog): writing now
  // would empty the file, so wait — importLibrary calls this again
  if (!location.protocol.startsWith('http') || !itemById.size) return;
  if (syncBusy) { syncAgain = true; return; } // a purchase during a write (a cart): written right after it
  syncBusy = true;
  // No free text into the shared base: item name from the catalog, label only a known one.
  // This way a nickname or any other piece of a screen line can never get in.
  const mine = purchases.map(shareable).filter(Boolean);
  try {
    await fetch('api/purchases', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Abi-Merchant-Helper': '1' },
      body: JSON.stringify({ updated: new Date().toISOString(), purchases: mine }, null, 1),
    });
  } catch {} finally { syncBusy = false; if (syncAgain) { syncAgain = false; syncBase(); } }
}

// Everything the page keeps in the browser (own sounds, profiles, purchases, settings) is mirrored to userdata.json
// in the app folder: browser storage belongs to this address, and the next app (its own window) reads the file instead.
let userDataSent = '';
function mirrorUserData() {
  if (!location.protocol.startsWith('http')) return;
  let body;
  try { body = JSON.stringify({ localStorage: Object.fromEntries(Object.entries(localStorage)) }); } catch { return; }
  if (body === userDataSent) return;
  fetch('api/userdata', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Abi-Merchant-Helper': '1' }, body })
    .then(r => { if (r.ok) userDataSent = body; }).catch(() => {});
}
setInterval(mirrorUserData, 30000);
document.addEventListener('visibilitychange', () => { if (document.hidden) mirrorUserData(); }); // switching to the game
setTimeout(mirrorUserData, 3000);

function cargoName(key) {
  const rec = cargo.get(key);
  return rec ? `${rec.R + 1 - mapBounds().minR}×${rec.C + 1 - mapBounds().minC}` : key;
}

function mapBounds() {
  const placed = placedCargo().map(([, r]) => r);
  if (!placed.length) return { minC: 0, minR: 0, maxC: 4, maxR: 3, placed };
  return {
    minC: Math.min(...placed.map(r => r.C)), minR: Math.min(...placed.map(r => r.R)),
    maxC: Math.max(...placed.map(r => r.C + r.w)), maxR: Math.max(...placed.map(r => r.R + r.h)), placed,
  };
}
