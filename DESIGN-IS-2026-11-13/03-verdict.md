# Verdict: REDESIGN

The interface scores 16/30, below the threshold of 20: the main screen is one long page that shows everything the app can do, so the one thing the player came for (what is in this cargo, is it worth it) shares the screen with an editor, a log, a manual and eleven settings.

This is a redesign of the screen structure and the words. The capture, recognition, map drawing, theme and start screen stay.

## Highest-leverage moves

1. **#10 as little as possible / #2 useful: one job per screen.** The main screen keeps only Start/Stop, the status, the result card and the map with its two actions. Settings (11 controls now in four places: `index.html:143,148,177-180,195-199,214-215`), the sound editor (`index.html:210-228`), the log (`index.html:205`) and the help (`index.html:235`) move to a second view.
2. **#4 understandable: plain names, help where it is needed.** Rename "Blue", "Match threshold", "Sensitivity", "Value by", "Done" and "Import library" (`index.html:213`), and replace the permanent 8-step list with a hint at each step of the first run.
3. **#6 honest: the words describe the app, not the old site.** Remove "site", "start.bat" and browser screen sharing from all three languages (`i18n.js:30,37,107,114,184,191`).
4. **#3 aesthetic: one scale.** Bring 8 type sizes down to 4, 7 radii to the theme's tokens, and the 12 + 15 hard-coded colours to theme colours; replace the glyph and emoji buttons (`index.html:2328-2350`) with one icon set.
5. **#8 thorough: errors and names.** Show errors where the user looks, not only in the log; give the 5 icon-only buttons names; make a cargo on the map choosable from the keyboard (`index.html:2553-2563`).
