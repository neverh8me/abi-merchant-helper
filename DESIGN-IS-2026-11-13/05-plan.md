# Redesign plan: ABI: Merchant Helper 3.1

Source: the design audit in this folder (16/30, REDESIGN). Line numbers are for `main` at v3.0.0.

## Primary goal

A player at the Field Merchant sees one calm screen: the cargo map, the result and the start button, in words they understand without a manual. Everything else the app can do (settings, sounds, log, help) is still there, one click away.

## Phase 0: Documentation discovery (done during planning)

> **How this serves the primary goal:** the later phases only use components, helpers and ids that exist, so the redesign changes the screen, not the behaviour.

Gathered by reading, not by subagents.

**Allowed daisyUI 5.7.0 components** (guides in `~/.claude/plugins/cache/daisyui/daisyui/5.7.0/skills/daisyui/components/`):
- `tabs` + `tab` + `tab-active` with `role="tablist"` / `role="tab"` buttons (`tab.md`). Switching content by buttons needs our own 3-line handler; the radio form switches by CSS but puts inputs in the tab order.
- `fieldset` + `fieldset-legend` + `label` for groups of settings (`fieldset.md`).
- `alert` with `alert-error` / `alert-warning` / `alert-info` / `alert-success`, `role="alert"` (`alert.md`).
- `toast` with `toast-end toast-bottom` as the container of alerts (`toast.md`).
- `tooltip` with `data-tip` (`tooltip.md`), `kbd` (`kbd.md`), and the components already in use: `btn`, `select`, `input`, `checkbox`, `range`, `card`, `badge`, `steps`, `progress`.
- Theme tokens: `--color-*`, `--radius-selector|field|box` in `lib/daisyui/abi-theme.css:1-31`.
- Not available: Tailwind utilities (no build step). Classes such as `flex`, `gap-2`, `text-sm`, `justify-end` do nothing; layout stays in the page's own CSS.

**Existing page APIs to reuse, not rewrite:**
- `const ui = {...}` (`index.html:354-360`): every id the script reads. Ids keep their names; elements may move.
- `I18n.apply(root)` (`i18n.js:259-265`): fills `data-i18n`, `data-i18n-html`, `data-i18n-ph`, `data-i18n-title`. Add `data-i18n-aria` only if a new attribute is truly needed.
- `log(s)` (`index.html:2490-2495`): 31 calls with `tr('log.*')`; errors among them: `log.noPip`, `log.saveFail`, `log.ocrFail`, `log.mapFail`, `log.libFail`, `log.importFail`, `log.imgFail`, `log.screenClosed`, `log.black`, `log.nogame`, `log.minimized`.
- `updateStage()` (`index.html`, the function after `// ---------- Stage`): already the step-by-step guide on the map card (`stage.start`, `stage.open`, `stage.scan`, `stage.ready`).
- `openOverlay()` moves `ui.result` and `#mapWrap` into the overlay window; nothing else may be required there.
- Map input: `mapCargoAt(e)`, click / mousemove / contextmenu handlers (`index.html:2545-2569`), `showMapPop(e)` (`index.html:2200`).
- Icons to copy: `icon(name)` and the `STROKE` set from yt-music `ui/icons.js:1-70` (Lucide shapes, ISC; yt-music is GPL-3.0 like this repo). Copy as a plain script (no `export`), because the page loads classic scripts.

**Anti-patterns found:** no `export`/`import` in the page scripts; no new dependency; no Tailwind class names; ids in `ui` must not be renamed without updating `ui`.

## Phase 1: Honest words

> **How this serves the primary goal:** "in words they understand" starts with words that are true for the app as it is now.

**What to implement**
1. In `i18n.js`, for uk, en and ru: rewrite `status.noAudio` (lines 37, 114, 191) and `help.3` (30, 107, 184) so they talk about the app, not "the site", `start.bat` or screen sharing. Check the other 6 "browser/браузер" hits and fix each that describes the app.
2. Rename, in all three languages (keep the keys):
   - `btn.lib` "Import library" → "Load sounds from a folder" (the library loads by itself; this button is for a custom folder).
   - `lbl.blue` "Blue" → "Count blue items".
   - `lbl.sens` "Sensitivity" → "Quietest sound to catch".
   - `lbl.thr` "Match threshold" → "How sure before showing".
   - `opt.value` "Value by" → "Count item value by".
   - `btn.done` "Done" → "Map is complete".
3. Remove the credits footer from the main screen (`index.html:249`); its text goes to the help view in Phase 3.

**References:** current strings at the lines above; `I18n.apply` (`i18n.js:259-265`).

**Verification**
- `grep -n "start.bat\|сайт\|the site\|Entire screen\|Весь екран" i18n.js` → no hits.
- `node -e "new Function(require('fs').readFileSync('i18n.js','utf8'))"` passes.
- The same keys exist in all three blocks (count per block equal).

**Anti-pattern guards:** do not rename keys; do not change what any button does in this phase.

## Phase 2: One look

> **How this serves the primary goal:** a calm screen needs one size scale, one set of corners and colours, and icons that read as icons.

**What to implement**
1. `lib/icons.js`: copy `icon()` and the needed shapes from yt-music `ui/icons.js` (pencil, x, image, plus, play, square, rotate-ccw, settings, list, circle-help, win-min, win-max, x for close) as a classic script that sets `window.icon`. Keep the Lucide/ISC credit line.
2. Replace the glyph/emoji buttons (`index.html:2328, 2329, 2342, 2343, 2350`) and the title-bar SVGs (`index.html:153-155`) with `icon(...)`; give each an `aria-label` from `tr()`.
3. Type scale: 4 sizes only, as CSS variables at the top of the page CSS (12, 14, 18, 28 px); map the current 11/13/15 → 12/14, 40 → 28.
4. Radii: replace the 7 page values with `var(--radius-field)` (controls), `var(--radius-box)` (cards, panels, popups) and `var(--radius-selector)` (chips, dots).
5. Colours: replace the 12 hex values in the page CSS with theme colours (`--color-base-*`, `--color-base-content` with opacity via `color-mix`, `--color-error` for the close button). Keep item-quality colours (red/gold/purple/blue/green/white) in the script: they are game data, not chrome; the other script hex values move to theme variables read once with `getComputedStyle`.

**References:** yt-music `ui/icons.js:1-70`; theme tokens `lib/daisyui/abi-theme.css`.

**Verification**
- Script from the audit (`scratchpad/audit.js` pattern): font sizes ≤ 4 distinct, no `border-radius: <n>px` in page CSS, hard-coded hex in page CSS = 0, emoji/glyph buttons = 0, `aria-label` count ≥ 8.
- Headless screenshot of the page: no visual breakage.

**Anti-pattern guards:** no icon font or package; no Tailwind classes; do not touch the map drawing colours of item qualities.

## Phase 3: One job per screen

> **How this serves the primary goal:** this is the change itself: the screen shows map, result and start, and the rest moves one click away.

**What to implement**
1. In the header, a `tabs` group with two `tab` buttons: **Catch** and **Setup** (`role="tablist"`, `role="tab"`, `aria-selected`, keyboard arrows). The chosen tab is remembered in storage like the other settings (`loadJson`/`localStorage.setItem` pattern, `index.html:2609`).
2. **Catch** view: Start/Stop and status (header), the result card, the map card with the stage line, best buys and the session summary. Nothing else.
3. **Setup** view, as `fieldset` groups with a one-line `label` description under each:
   - *Screen*: mode (second screen / overlay), interface language.
   - *Merchant*: purchases per raid, count item value by, game language, alert on a good cargo.
   - *Sound*: quietest sound to catch, how sure before showing, beep, the sound-level canvas.
   - *Sounds and maps*: map profile, count blue items, the sound list with add/export/import/clear, load sounds from a folder.
   - *Log*: the log.
   - *Help*: the help list and credits.
4. All ids stay; only their parents change. `ui` (`index.html:354-360`) needs no change if ids are kept.
5. The overlay keeps working: it moves `ui.result` and `#mapWrap`, both on Catch.

**References:** `tab.md`, `fieldset.md`; current markup `index.html:139-249`.

**Verification**
- Headless screenshots of both views in uk/en/ru (the app with `--hidden --port 8790 --data <dir>`, Edge `--screenshot`).
- Interactive-element count on Catch ≤ 10 (audit script).
- Every id in `ui` resolves (`Object.entries(ui).filter(([,v]) => !v)` is empty in a headless run).
- Overlay: `openOverlay()` still finds `ui.result` and `#mapWrap`.

**Anti-pattern guards:** no feature removed or hidden behind a flag; no second copy of a control; no router or framework.

## Phase 4: Errors and first steps where the player looks

> **How this serves the primary goal:** with the log off the main screen, a problem must still reach the player, and the first run must explain itself without the 8-step list.

**What to implement**
1. `notify(msg, level)`: an `alert` inside a `toast toast-end toast-bottom` container on Catch, gone after 8 s, max 3 at once. `log()` stays and still records everything.
2. Route the error and warning `log(tr(...))` calls listed in Phase 0 through `notify` as well (error: noPip, saveFail, ocrFail, mapFail, libFail, importFail, imgFail, screenClosed; warning: black, nogame, minimized).
3. First run: the stage line (`updateStage`) is the guide. Add one line before Start, shown once: "Open the game in Borderless window mode, then press Start catching" (from `help.2`), and a link "How it works" that opens Setup → Help.

**References:** `alert.md`, `toast.md`; `log()` `index.html:2490`; `updateStage()`.

**Verification**
- Headless: force a `log.libFail` (bad library path) and see the alert in the screenshot.
- `grep -c "notify(" index.html` ≥ 11.

**Anti-pattern guards:** no modal for errors; no sound for errors; do not drop messages from the log.

## Phase 5: The map from the keyboard

> **How this serves the primary goal:** the map is the main surface, so it must work for a player who uses the keyboard.

**What to implement**
1. `#map` gets `tabindex="0"`, `role="application"` and an `aria-label` from `tr()`.
2. A `mapFocus` key: arrows move it between placed cargo (nearest in that direction), the focused cargo gets the hover outline and its popup (reuse the code behind `showMapPop` with a cargo key instead of a mouse event), Enter does what click does, Delete does what right-click does.
3. Split `mapCargoAt(e)` so the click and key paths share `assignSound(key)` and `clearSound(key)`.

**References:** `index.html:2200, 2545-2569`.

**Verification**
- Headless: focus the map, send arrow + Enter via `dispatchEvent`, check `results` changed.
- Mouse behaviour unchanged (click, right-click, hover popup).

**Anti-pattern guards:** do not redraw the map with a new library; do not change the scan logic.

## Phase 6: Verify and release

> **How this serves the primary goal:** the player only benefits once the new screen ships and nothing they relied on broke.

1. Re-run the audit counting script; compare with `01-evidence.md` (controls on Catch, sizes, radii, hex, aria labels).
2. `cargo test` in `src-tauri`, `node --test worker/worker.test.mjs`.
3. Hidden app run: page loads, start screen passes, both views render in uk/en/ru (screenshots kept in the scratchpad, not in the repo).
4. Ask the user to check in the game: catching, map, overlay, purchase recording.
5. Bump to 3.1.0 (`version.json`, `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml`), tag `v3.1.0`, publish the GitHub draft. The in-app updater delivers it.
6. Re-score with `/claude-mem:design-is`; target ≥ 22/30 with no 1 on #4, #6, #10.

## Not now

The start screen and its update flow · a light theme · moving `vision.js`/`audio.js` to Rust · new README screenshots (taken in the game after release) · Worker deploy (user task).
