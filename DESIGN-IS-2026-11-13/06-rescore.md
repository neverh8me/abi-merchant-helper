# Re-score after the redesign (phases 1–5)

Same anchors as `02-scorecard.md`, same surface (the page and the start screen), evidence from the code on the branch and headless runs. Not checked in the game or in the real app window.

| # | Principle | Before | After | Evidence |
|---|---|---|---|---|
| 1 | Innovative | 2 | 2 | Unchanged: the sound-fed merchant map. |
| 2 | Useful | 2 | 3 | Catch view shows 6 controls: Start, Stop, two tabs, the map, session reset. Everything else is in Setup. |
| 3 | Aesthetic | 1 | 2 | 4 text sizes, radii and colours only from the theme, one icon set. Left: canvas labels keep their own small sizes (9–14 px), a few inline margins. |
| 4 | Understandable | 1 | 2 | Six labels renamed; first-run line and a "How it works" button. "Count blue items" still needs its tooltip to make sense. |
| 5 | Unobtrusive | 2 | 3 | Map and result are the screen; the log, meter and editor are off it. |
| 6 | Honest | 1 | 3 | No string mentions the site, `start.bat` or browser sharing (checked in all three languages). |
| 7 | Long-lasting | 2 | 2 | Fully round buttons remain the one dated marker. |
| 8 | Thorough | 2 | 3 | Errors now reach the player as alerts; icon buttons have names; the map works from the keyboard with a visible focus. |
| 9 | Environmentally friendly | 2 | 2 | 321 KB of initial HTML + JS, no idle animation; the 1.09 MB daisyUI file is still loaded whole; no reduced-motion rule. |
| 10 | As little as possible | 1 | 2 | Catch is lean; the map hint line and the session reset could still go. |
| | **Total** | **16** | **24** | |

**Verdict now: REFINE** (24/30, no principle at 0). The plan's target (≥22, no 1 on #4, #6, #10) is met.

Next refinements if wanted: trim daisyUI to the components in use (#9), a calmer button shape (#7), a plainer name for the blue-items setting (#4).
