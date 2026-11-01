// The light/dark switch: a button with a sun and a moon. With nothing chosen the page follows the device; the first press
// chooses the other theme, and the choice is kept in this browser (app/theme-boot.js applies it before the first paint).
// The colours are in style.css, under :root[data-theme="light"|"dark"].

export const isDark = (attr, systemDark) => attr === 'dark' || (attr !== 'light' && !!systemDark);
export const nextTheme = (attr, systemDark) => (isDark(attr, systemDark) ? 'light' : 'dark');

export function initTheme(button) {
  const root = document.documentElement;
  const query = matchMedia('(prefers-color-scheme: dark)');
  const sync = () => button.setAttribute('aria-pressed', String(isDark(root.dataset.theme, query.matches)));
  button.addEventListener('click', () => {
    const next = nextTheme(root.dataset.theme, query.matches);
    root.dataset.theme = next;
    try { localStorage.setItem('ct-theme', next); } catch { /* not kept */ }
    sync();
  });
  if (query.addEventListener) query.addEventListener('change', sync);
  sync();
}
