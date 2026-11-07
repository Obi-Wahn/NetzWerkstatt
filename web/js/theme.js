/* NetzWerkstatt – heller und dunkler Modus.
   Standard: wie im Betriebssystem eingestellt. Die eigene Wahl merkt sich nur dieser Browser. */
(function () {
  'use strict';
  const KEY = 'nw-theme';
  const MODES = ['auto', 'light', 'dark'];
  const LABEL = { auto: 'Automatisch', light: 'Hell', dark: 'Dunkel' };
  const ICON = {
    auto: '<circle cx="12" cy="12" r="8"/><path d="M12 4a8 8 0 0 1 0 16z" fill="currentColor"/>',
    light: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
    dark: '<path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z"/>'
  };
  const media = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;

  function load() {
    try { const m = localStorage.getItem(KEY); return MODES.includes(m) ? m : 'auto'; } catch (e) { return 'auto'; }
  }
  function save(m) {
    try { if (m === 'auto') localStorage.removeItem(KEY); else localStorage.setItem(KEY, m); } catch (e) { /* privater Modus */ }
  }
  let mode = load();

  function apply() {
    const dark = mode === 'dark' || (mode === 'auto' && media && media.matches);
    document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
    document.querySelectorAll('.theme-btn').forEach(paint);
  }
  function paint(b) {
    b.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true">${ICON[mode]}</svg><span>${LABEL[mode]}</span>`;
    b.title = 'Darstellung: ' + LABEL[mode] + ' (klicken zum Wechseln)';
    b.setAttribute('aria-label', 'Darstellung wechseln, jetzt: ' + LABEL[mode]);
  }
  function makeButton() {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'btn ghost theme-btn';
    b.addEventListener('click', () => {
      mode = MODES[(MODES.indexOf(mode) + 1) % MODES.length];
      save(mode);
      apply();
    });
    paint(b);
    return b;
  }

  // Sofort anwenden (Skript steht im <head>), damit die Seite nicht kurz hell aufblitzt
  apply();
  if (media) {
    const onChange = () => { if (mode === 'auto') apply(); };
    if (media.addEventListener) media.addEventListener('change', onChange); else if (media.addListener) media.addListener(onChange);
  }
  window.addEventListener('storage', e => { if (e.key === KEY) { mode = load(); apply(); } });

  document.addEventListener('DOMContentLoaded', () => {
    // In jede Kopfzeile hinter den Platzhalter, auf der Anmeldeseite oben rechts
    document.querySelectorAll('.topbar').forEach(bar => {
      const spacer = bar.querySelector('.spacer');
      if (spacer) spacer.after(makeButton()); else bar.appendChild(makeButton());
    });
    document.querySelectorAll('.login-screen').forEach(s => s.appendChild(makeButton()));
  });
})();
