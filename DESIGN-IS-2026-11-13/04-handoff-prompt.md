# Handoff

````
/make-plan Redesign the interface of ABI: Merchant Helper v3.0.0 (Windows app, Tauri; the page is index.html + i18n.js served inside the app; daisyUI 5 component classes without a Tailwind build; theme in lib/daisyui/abi-theme.css). Current design failed audit at 16/30 with critical gaps in principles #3 aesthetic, #4 understandable, #6 honest, #10 as little design as possible (each scored 1).

Verdict paragraph (quoted from 03-verdict.md):
> The interface scores 16/30, below the threshold of 20: the main screen is one long page that shows everything the app can do, so the one thing the player came for (what is in this cargo, is it worth it) shares the screen with an editor, a log, a manual and eleven settings.

Why redesign and not refine: the total is below 20, and the failures come from the structure of the screen (everything on one page), which restyling cannot fix.

Primary user and task: a player of Arena Breakout: Infinite at the Field Merchant, game in focus, this app on a second monitor or as a small overlay; in a few seconds they decide whether a mystery cargo is worth buying.

Preserve from current design:
- The theme tokens in lib/daisyui/abi-theme.css (dark, one gold accent) and the daisyUI component classes already on the controls.
- The start screen src-tauri/shell/index.html (update, base sync, start as three steps with a progress bar).
- The result card and the map canvas with their drawing code (index.html:161-176 and the drawMap code), including the overlay window that the page moves them into.
- The title bar with the window buttons and the version button (index.html:139-156).
- Every feature of 2.x: nothing is removed from the product, things only move.
- The element ids the script uses, or a mapping for each id that changes.

Discard:
- One long page with six cards. Evidence: index.html:139-249. Caused failure on principle #10.
- Settings spread over four places (header, under the map, under the sound level, in Sounds). Evidence: index.html:143,148,177-180,195-199,214-215. Caused failure on principles #10 and #4.
- The permanent 8-step help list on the main screen. Evidence: index.html:235. Caused failure on principles #4 and #10.
- Copy written for the old browser version. Evidence: i18n.js:30,37,107,114,184,191. Caused failure on principle #6.
- Sizes, radii and colours set by hand beside the theme. Evidence: 8 type sizes, 7 radii, 12 hex values in the page CSS and 15 in the page script. Caused failure on principle #3.

Top 5 moves from the audit (verbatim):
1. #10 as little as possible / #2 useful: one job per screen. The main screen keeps only Start/Stop, the status, the result card and the map with its two actions. Settings (11 controls now in four places: index.html:143,148,177-180,195-199,214-215), the sound editor (index.html:210-228), the log (index.html:205) and the help (index.html:235) move to a second view.
2. #4 understandable: plain names, help where it is needed. Rename "Blue", "Match threshold", "Sensitivity", "Value by", "Done" and "Import library" (index.html:213), and replace the permanent 8-step list with a hint at each step of the first run.
3. #6 honest: the words describe the app, not the old site. Remove "site", "start.bat" and browser screen sharing from all three languages (i18n.js:30,37,107,114,184,191).
4. #3 aesthetic: one scale. Bring 8 type sizes down to 4, 7 radii to the theme's tokens, and the 12 + 15 hard-coded colours to theme colours; replace the glyph and emoji buttons (index.html:2328-2350) with one icon set.
5. #8 thorough: errors and names. Show errors where the user looks, not only in the log; give the 5 icon-only buttons names; make a cargo on the map choosable from the keyboard (index.html:2553-2563).

Redesign principles in priority order:
1. #10 As little design as possible — while the player is at the merchant, the screen shows the result and the map and nothing they do not need in that minute.
2. #4 Understandable — a first-time player starts catching and reads a result without opening a manual; every setting says what it changes in plain words in uk, en and ru.
3. #6 Honest — every string is true for the app as it is now.
4. #3 Aesthetic — sizes, radii and colours come from the theme only.

Deliverables for the plan:
- New information architecture (not derived from the old page): which views exist, what is on each, how the player moves between them, what the overlay window shows.
- New primary flow (low-fi, labeled, compared side-by-side to current): start, open the merchant, map ready, hover, drag, buy, scan again.
- States checklist (empty, loading, error, success, focus, disabled) for each view.
- A list of every string that changes, in three languages.
- Migration path for users on the current design: saved settings, sounds and profiles in the page's storage must keep working; say what a returning user sees first.
- Cutover criteria: the old layout is removed in the same release, no flag; every 2.x feature is reachable; Rust and Worker tests pass; the flow is checked in the game.
- How each step is verified without showing a window on the user's screen (the app runs with --hidden --port 8790 --data <dir>; headless Edge screenshots).

Anti-patterns to guard against (specific to REDESIGN):
- Porting old structure under new styling
- Keeping both designs behind a flag indefinitely
- Redesigning to follow a trend rather than the principles above
- Treating the Preserve list as optional — it must be filled before this handoff is valid
- Adding a frontend build step or a framework: the page stays plain HTML and JS with daisyUI classes
- Removing or hiding a feature to make the screen look simpler
````
