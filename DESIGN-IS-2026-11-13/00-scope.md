# Scope

- **Audited:** the interface of ABI: Merchant Helper v3.0.0 as shipped on `main` (2026-11-13): the main page `index.html` with `i18n.js`, the start screen `src-tauri/shell/index.html`, the theme `lib/daisyui/abi-theme.css`.
- **Primary user:** an *Arena Breakout: Infinite* player standing at the Field Merchant, with the game in focus and this app on a second monitor or as a small overlay.
- **Primary task:** decide, in a few seconds, whether a mystery cargo is worth buying: see what it can contain and the red chance.
- **Constraints:** Windows app (Tauri, WebView2), page served inside the app; daisyUI 5 components without a Tailwind build; three languages (uk/en/ru); no network needed to run; every 2.x feature must stay.
- **References:** YT Music (github.com/neverh8me/yt-music) for the look.
- **Inputs:** source files at the lines cited in `01-evidence.md`; two headless screenshots taken this session (main page at 1280x900 in browser mode, start screen at 900x640 with stand-in data). The app window itself was not looked at on a screen, and nothing was checked in the game.
- **Method note:** evidence was gathered inline by the auditor with one counting script and by reading the source, not by subagents.
