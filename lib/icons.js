// One icon style for the whole app: 24×24, 2px rounded strokes, colour from the text (currentColor).
// Copied from YT Music (github.com/neverh8me/yt-music, ui/icons.js) as a plain script.
// Shapes based on Lucide (https://lucide.dev, ISC license).
(() => {
  const SHAPES = {
    'win-min': '<path d="M5 12h14"/>',
    'win-max': '<rect x="5" y="5" width="14" height="14" rx="2"/>',
    close: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
    plus: '<path d="M5 12h14"/><path d="M12 5v14"/>',
    edit: '<path d="M21.17 6.81a1 1 0 0 0-3.99-3.99L3.84 16.17a2 2 0 0 0-.5.83l-1.32 4.35a.5.5 0 0 0 .62.62l4.35-1.32a2 2 0 0 0 .83-.5z"/><path d="m15 5 4 4"/>',
    trash: '<path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/>',
    image: '<rect width="18" height="18" x="3" y="3" rx="2" ry="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/>',
  };

  // An inline SVG; the button around it carries the name (aria-label), the icon itself is hidden from screen readers.
  window.icon = name => `<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${SHAPES[name] || ''}</svg>`;

  // Static markup uses <i data-icon="name"></i>; this swaps each for its SVG.
  window.hydrateIcons = (root = document) => {
    root.querySelectorAll('i[data-icon]').forEach(el => { el.outerHTML = window.icon(el.dataset.icon); });
  };
})();
