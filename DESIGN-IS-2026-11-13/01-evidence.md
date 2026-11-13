# Evidence

Facts only. Line numbers are for `main` at v3.0.0.

## Structural

- **Static controls on the one page:** 14 buttons, 6 selects, 3 checkboxes, 2 sliders, 1 text field, 1 link, 2 canvases, in 6 cards (`index.html:139-249`). The sound list adds 3 buttons per sound and 3 per item plus a 5-field add row (`index.html:2327-2350`).
- **Header** holds 10 things: title, Start, Stop, status text, mode select, overlay button, update link, language select, version button, window buttons (`index.html:139-152`).
- **Settings are in four places:** header (`mode`, `lang`, `index.html:143,148`), under the map (`buysPerRaid`, `valueBasis`, `alertOn`, `gameLang`, `index.html:177-180`), under the sound level (`sens`, `thr`, `beep`, `index.html:195-199`), in Sounds (`profile`, `blue`, `index.html:214-215`). 11 settings in total, all on the main screen.
- **Always on the main screen besides result and map:** sound-level canvas (`index.html:193`), log (`index.html:205`), sound editor with Export / Import / Clear all (`index.html:210-228`), an 8-step help list (`index.html:235`), credits footer (`index.html:249`).
- **Repeated affordance:** two ways to open the update screen, the banner link and the version button (`index.html:147,151`).

## Visual (from source; screenshot where noted)

- **Type sizes in the page CSS:** 11, 12, 13, 14, 15, 18, 28, 40 px (8 sizes).
- **Corner radii in the page CSS:** 2, 4, 5, 6, 8, 10, 12 px (7 values), next to the theme's own 1rem / 2rem (`lib/daisyui/abi-theme.css:25-27`).
- **Gaps:** 2, 6, 8, 12, 14, 16 px. **Padding first values:** 1, 2, 3, 4, 8, 10, 12, 14, 16 px.
- **Colours outside the theme:** 12 hard-coded hex values in the page CSS (among them `#9a9aa6`, `#0a0a0d`, `#0f0f13`, `#2c2c36`, `#e5173a`) and 15 in the page script, against 35 uses of theme variables.
- **Icon-only buttons are text glyphs and emoji:** `✎`, `✕`, `🖼`, `+` (`index.html:2328,2329,2342,2343,2350`).
- **States:** empty present (result, sounds, session; screenshot). Loading present (status text "Importing library: sound 3 of 76", screenshot; start-screen steps). Disabled present (Stop, screenshot). Focus: no rule in the page CSS, daisyUI components bring their own. Error: only as a line in the log (`index.html:205`) and the start screen's error step. Success: the result card and the session line.
- **Lowest text contrast (computed):** `#9a9aa6` on `#111116`, about 6.6:1. The start screen's detail text is at 65% opacity on the same card.

## Copy and honesty

- **Stale claims about what the product is.** `status.noAudio` still tells the user to "open the site via start.bat" and to share the screen (`i18n.js:37,114,191`). `help.3` says "The site finds the grid" (`i18n.js:30,107,184`). 3 mentions of `start.bat` and 6 of "browser" remain in `i18n.js`.
- **Labels that need explaining:** "Blue" (its tooltip: "abibuilder tables list blue items at the merchant, but they never show up in game"), "Match threshold", "Sensitivity", "Value by", "Done", "Import library".
- **Label and behaviour:** the button says "Import library" (`index.html:213`), while the library loads by itself on start (status "Importing library: sound 3 of 76", screenshot).
- **No inflation and no dark patterns found.** Odds are shown as percentages, the README says results are probabilities.
- **Help:** 8 steps are needed to explain the screen (`index.html:235`).

## Weight and friction

- **Initial HTML + JS:** 310,506 bytes (`index.html` 140,872; `tesseract.min.js` 66,697; `i18n.js` 34,967; `vision.js` 25,773; `ocr.js` 20,703; `audio.js` 15,028; `library.js` 6,466).
- **CSS:** `daisyui.css` is 1,094,397 bytes; the page uses 21 of its class names.
- **Loaded later:** OCR core 3.9 MB, language data 2.9 MB (eng) and 2.7 MB (rus).
- **Requests for the first view:** 10 files, then 4 JSON files, 76 sounds and up to 189 item images from the app itself.
- **Idle:** no CSS animation, 1 transition, no `requestAnimationFrame`; 4 timers (`index.html:1069,1787,1991,2718`). No `prefers-reduced-motion` rule. One theme, dark.
- **On first load:** no modal, no badge; one status line.

## Accessibility

- `aria-label`: 0. `role`: 0. The 5 icon-only buttons have no name; 2 of them have a `title`.
- The map is a canvas with mouse handlers only (`index.html:2553-2563`): a cargo cannot be chosen from the keyboard.
- Landmarks: `header`, `main`, 6 `section`, `footer`. No skip link.
- Sliders and checkboxes sit inside their `label`.

## Not inspected

- The app window on a real screen, the overlay window, and anything during play.
- Time to interactive was not measured.
