// ABI: Merchant Helper — Runtime state. Loaded after the functions: its starting values call some of them.
// Plain script (no modules): all files share one global scope; index.html loads them in order.
'use strict';

// ---------- State ----------
let stream = null, audioCtx = null, workletNode = null, srcNode = null, beepCtx = null;
let detector = null;
let gameWs = null, gameStatus = null; // game-only sound from the local server
let screenWs = null;         // screen frames from the local server
const tplCache = new Map();  // sound id → { up: [template], down: [template] }
let captureOnset = -Infinity; // when the sound started (performance.now)
let recordingId = null;      // id of the sound a sample is being recorded for
let lastHitId = null;
let muteUntil = 0;
let sounds = loadSounds();
let profiles = loadJson(PROFILES_KEY, []);   // maps from the library: [{ id, name }]
let profile = loadJson(PROFILE_KEY, '');     // selected map ('' — average over all)
let includeBlue = loadJson(BLUE_KEY, false); // whether to count blue items
let mode = loadJson(MODE_KEY, 'second');     // display mode, see MODE_KEY
let buysPerRaid = loadJson(BUYS_KEY, 2);     // see BUYS_KEY
let valueBasis = loadJson(VALUE_KEY, 'market'); // see VALUE_KEY
let alertOn = loadJson(ALERT_KEY, true);      // see ALERT_KEY
let gameLang = loadJson(GAME_LANG_KEY, { choice: 'auto', found: 'eng' }); // see GAME_LANG_KEY
let langStats = {};          // label reads per game language this session: { eng: { reads, hits } }
let alerted = new Set();                      // cargo already alerted about (key + price + label), cleared with a new list
let sessionStart = (() => { try { return +sessionStorage.getItem(SESSION_KEY) || 0; } catch { return 0; } })();
if (!sessionStart) { sessionStart = Date.now(); try { sessionStorage.setItem(SESSION_KEY, String(sessionStart)); } catch {} }
let overlayWin = null, overlayParts = [];    // the overlay window and the elements moved into it
let purchases = loadJson(PURCHASES_KEY, []); // own purchases: [{ t, soundId, size, label, price, itemId, item, q }]
let basePurchases = [];      // shared base shipped with the app (library/purchases.json) and refreshed from GitHub
let balance = null, spent = 0, spentAt = 0;  // Koen balance below the grid, how much it dropped (not yet explained by purchases) and when
let balanceSig = null, feedQueue = [], feedDone = []; // feed lines: waiting for balance confirmation / already counted
let feedBusy = false, feedAt = 0, feedSig = null; // reading of the feed line and the balance
let libPools = [], itemQ = {}, itemById = new Map(); // merchant pools and items from the library
let hover = null;            // the cargo just hovered: { key, t }
let mapFocus = null;         // the cargo chosen on the map from the keyboard
let cursorHist = [];         // the mouse cursor from the local server, in frame px: [{ x, y, t }] for the last seconds
let cursorKey = null;        // the cargo under the cursor now
let hoverBusy = false, hoverSig = ''; // price tooltip reading: busy / which cargo it covers

// Merchant grid. "Region" coordinates are frame pixels relative to the region's top-left corner.
// Absolute row R has its top line at y = R*P - offset (offset grows when scrolling down).
let P = 0;                   // grid cell size, frame px
let checkFrames = 0;         // frames since the last cell size check
let phaseX = 0;              // line shift along x (0..P)
let offset = 0;              // scroll
let viewport = null;         // visible part of the grid { x, y, w, h } in region px
let prevSig = null;          // row signatures of the previous small frame
let ring = [];               // [{ t, small, red, offset }]
let cargo = new Map();       // key "C,R,w,h" → { C, R, w, h, votes, base, baseRed, thumb }
let results = new Map();     // cargo key → { soundId, score }
let lastKey = null;          // the cargo a sound was just assigned to
let lastResult = null;
let lastSeen = null;         // the latest recognition for the preview: { grid, items }
let gridSeenAt = 0;          // when the merchant grid was last seen
let listTopR = null;         // absolute row of the first list row (the top at first detection)
let phase = 'scan';          // 'scan' — building the map, 'frozen' — the map is ready and does not change
let frozenPlaced = null;     // the ready map: the fixed list of cargo
let sawTop = false, sawEnd = false; // whether the top and the bottom of the list were seen during the scan
let stableCount = 0;         // how many parses in a row had no new cargo
let sbKnown = null;          // the scrollbar track found { x, trackTop, trackLen }
let noBarCount = 0;          // how many parses the grid is visible but the scrollbar is not
let lastSbTop = true;        // the scrollbar thumb was at the very top on the latest frame
let thumbOddLen = 0, thumbOddCount = 0; // a thumb of a different length: which and for how many frames in a row
let loggedBar = false;       // "scrollbar found" is logged once, not on every rescan
let frozenP = 0;             // the cell size when the map froze: a ready map keeps to it
let scaleSamples = [], scrollK = 0; // learned scroll scale and the frames it is learned from (learnScale)
let parseNo = 0;             // parses that reached the cargo, for the ready-map correction
let skips = {};              // why parses stopped early since the last diagnostics line: { reason: count }
let videoReader = null, videoTimer = null;
let lastScan = 0;
let imgTarget = null;        // { sound, index } the item a picture is being chosen for

const fullCanvas = document.createElement('canvas');
const fullCtx = fullCanvas.getContext('2d', { willReadFrequently: true });
const smallCanvas = document.createElement('canvas');
const smallCtx = smallCanvas.getContext('2d', { willReadFrequently: true });
