// ABI: Merchant Helper — Constants and the page elements.
// Plain script (no modules): all files share one global scope; index.html loads them in order.
'use strict';

// ---------- Constants ----------
const TRACK_SX = 4, TRACK_SY = 2;  // frame downscale for scroll tracking
const RING_MS = 3000;        // how much frame history to keep
const OCC_GREY = 0.3;        // share of "grey" in a cell to count it as cargo (empty slots are black)
const ONE_LABEL_MIN = 0.02;  // share of label text (Vision detail) a 1×1 needs to count as cargo: empty slots have none
const PICK_MIN_DIFF = 4;     // minimal cargo change (0–255) to count it as dragged
const RED_MIN = 3;           // minimal "redness" of the trace where a cargo was dragged
const MAP_U = 56;            // map unit size
const SCAN_MS = 150;         // how often to parse the grid once the map is ready (price tooltips are noticed sooner)
const SCAN_FAST_MS = 45;     // and during the scan: every cargo must collect its votes while visible
const QUIET_MS = 1500;       // for this long after a sound the picture is "dirty" (a cargo is being dragged)
const REOPEN_MS = 5000;      // grid not seen for longer during a scan: the merchant was closed, scan again
const FREEZE_STABLE = 3;     // this many parses without new cargo, and the map is ready
const REVEAL_STREAK = 4;     // a revealed color has to hold for this many parses
const MERCHANT_FRESH_MS = 1500; // the merchant grid was seen this recently, so it is open
const NO_BAR_LIMIT = 8;      // this many parses without a scrollbar: the list is short, count without it
const THUMB_TOLERANCE = 0.12; // a thumb longer/shorter than remembered by more than this is suspicious
const THUMB_NEW_STREAK = 8;  // a new length for this many parses in a row: the list really changed
const MAP_MAX_ROWS = 80;     // the merchant never has more rows; more on the map is an error
const MIN_VOTES = 2;         // this many frames must confirm a cargo before it appears on the map
const SPLIT_SHARE = 0.35;    // smaller cargo beat a big one if each was seen at least this often relative to it
const UP_BIAS = 0.03;        // "put down" beats "pick up" only by this margin
const RECONNECT_MS = 2000;    // a dropped connection to the local server is retried this often
const SIZE_ALT_MARGIN = 0.05; // a sound this much below the best may replace it when only it has an item of the cargo size
const TAP_BLOCK = 512;       // how many audio samples to pass from the audio stream at once

const QUALITIES = [
  // names: qName() in the current language
  { id: 'red', color: '#ef4444' },
  { id: 'gold', color: '#f0b429' },
  { id: 'purple', color: '#a855f7' },
  { id: 'blue', color: '#3b82f6' },
  { id: 'green', color: '#22c55e' },
  { id: 'white', color: '#d1d5db' },
];
const qById = Object.fromEntries(QUALITIES.map(q => [q.id, q]));
const SIZES = ['1x1', '1x2', '2x1', '2x2', '2x3', '3x2'];
const SIZE_KEYS = ['1x1', '1x2', '2x2', '1x3', '2x3', '3x3']; // sizes without rotation, for display
const MYSTERY_TIERS = {
  rare: { short: 'Rare', tiny: 'Rare', name: 'Rare Mystery Cargo', color: '#a855f7' },
  uncommon: { short: 'Uncommon', tiny: 'Unc', name: 'Uncommon Mystery Cargo', color: '#3b82f6' },
  common: { short: 'Mystery', tiny: 'Myst', name: 'Mystery Cargo', color: '#d1d5db' },
};
const LABEL_TRIES = 4;       // attempts to read a cargo label
const PRICE_MARKUP = 1.1;    // the merchant adds ~10% to the pool price (100,000 in the table — 110,000 in the game)
const PRICE_MATCH_LOG = 0.25; // the tooltip price must be close to the pool price (in log scale, ≈ ±28%)
const HOVER_DIFF = 12;       // a cargo changed more than this: the price tooltip covered it
const HOVER_KEEP_MS = 6000;  // for this long after hovering, a "pick up" sound belongs to the hovered cargo
const CURSOR_KEEP_MS = 5000; // cursor history kept, for the cargo under the mouse at a sound
const CURSOR_CARD_QUIET_MS = 4000; // a sound result stays this long before hovering shows another card
const HOVER_MAX_CARGO = 16;  // a tooltip covers at most this many cargo; more is not a tooltip
const TIP_W = 3.2, TIP_H = 1.8; // price tooltip size in cells (with a margin)
const BASE_UPDATE_MAX = 6;   // the appearance reference is updated only on small changes (not on a tooltip)
const STORE_KEY = 'abi-mh-sounds-v4';       // v4: own recordings are raw sound, not a fingerprint
const OLD_STORE_KEYS = ['abi-mh-sounds-v3', 'abi-mh-sounds-v2'];
const OLD_REGION_KEY = 'abi-mh-region-v1'; // manual frame from old versions, no longer needed
const MERCHANT_SIDE = 0.5;   // the merchant grid is searched to the right of this share of the game window width
const REDETECT_AFTER = 8;    // once per this many frames (until the map is ready) the cell size is re-checked
const REDETECT_MAX_CARGO = 6; // this many cargo found: the cell size is certainly right
const PROFILES_KEY = 'abi-mh-profiles-v1';
const PROFILE_KEY = 'abi-mh-profile-v1';
const BLUE_KEY = 'abi-mh-blue-v1';
const MODE_KEY = 'abi-mh-mode-v1'; // display mode: 'second' (second screen) or 'overlay' (one monitor)
const BUYS_KEY = 'abi-mh-buys-v1';  // purchases allowed per raid (2, or up to 4 with a levelled character)
const VALUE_KEY = 'abi-mh-value-v1'; // item value basis for payback: 'market' or 'trader'
const ALERT_KEY = 'abi-mh-alert-v1'; // whether a hovered good cargo plays a chime
const GAME_LANG_KEY = 'abi-mh-gamelang-v1'; // { choice: 'auto'|'eng'|'rus', found: language detected last time }
const LANG_PROBE = 8;        // label reads in one language without a single known label before auto mode tries the other
const SESSION_KEY = 'abi-mh-session-v1'; // start of the session summary (sessionStorage: survives a reload of the tab)
const ALERT_RED = 0.25;                   // a cargo with this red chance is worth an alert even if it does not pay off
const PAY_GOOD = 1.15, PAY_GAMBLE = 0.9; // expected value vs price: worth it from 115%, a gamble from 90%
const PURCHASES_KEY = 'abi-mh-purchases-v2'; // v1 had records from the nickname bug, not used
const OLD_PURCHASE_KEYS = ['abi-mh-purchases-v1', 'abi-mh-nick-v1'];
const PRIOR_N = 20;          // the merchant data weighs as much as this many own purchases (more: learns slower)
const FEED_MS = 1000;        // how often to look at the "… obtained [item]" line above the grid
// Where it is, in cells above the top of the list: one header row ("Mysterious Supplies …") above the list, or
// right above it when that header is part of the scrolled list. Both bands are read, one line each.
const FEED_BANDS = [[1.15, 0.6], [0.6, 0]];
const FEED_RIGHT_CUT = 0.5;  // the button at the right end of the purchase line, in cells
const BUY_MATCH = 0.01;      // the line amount and the tooltip price match with this precision
const BALANCE_LEFT = 0.4;    // the "Owned" balance is right of this share of the list width
const BALANCE_BELOW = 2.6;   // and no lower than this many cells below the list
const FEED_WAIT_MS = 30000;  // a feed line waits this long for the balance to confirm it
const FEED_SAME_MS = 60000;  // the same line (price and similar name) within this window is the same purchase
const SEEN_SAME_MS = 600000; // a seen line with the same price and item within 10 minutes is the same line still on screen
const FEED_BEST_MS = 4000;   // a purchase line read without a known item waits this long for a better reading
const BASE_URL = 'library/purchases.json'; // shared base in the app folder
const BASE_REMOTE = 'https://raw.githubusercontent.com/neverh8me/abi-merchant-helper/main/library/purchases.json'; // and the freshest one on GitHub

// ---------- DOM ----------
const $ = id => document.getElementById(id);
// Theme colours for the canvases (CSS variables do not reach a canvas)
const THEME = (() => {
  const cs = getComputedStyle(document.documentElement), v = n => cs.getPropertyValue(n).trim();
  return { bg: v('--color-base-100'), panel: v('--color-base-200'), line: v('--color-base-300'), neutral: v('--color-neutral'),
    text: v('--color-base-content'), muted: v('--abi-muted'), primary: v('--color-primary'), onPrimary: v('--color-primary-content'),
    info: v('--color-info'), error: v('--color-error') };
})();
const APP = !!window.__ABI_APP__; // inside the app window (not a browser tab)
const ui = {
  start: $('btnStart'), stop: $('btnStop'), status: $('status'), result: $('result'),
  spec: $('spec'), video: $('video'), log: $('log'), sounds: $('sounds'), newName: $('newName'),
  sens: $('sens'), sensVal: $('sensVal'), thr: $('thr'), thrVal: $('thrVal'), beep: $('beep'),
  map: $('map'), imgFile: $('imgFile'), profile: $('profile'), libDir: $('libDir'),
  stageTitle: $('stageTitle'), stageHint: $('stageHint'), rescan: $('btnRescan'), done: $('btnDone'),
};
const specCtx = ui.spec.getContext('2d');
const mapCtx = ui.map.getContext('2d');
