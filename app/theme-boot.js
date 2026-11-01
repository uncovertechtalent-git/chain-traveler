// Applies the saved light or dark choice before the page is drawn, so there is no flash of the other theme. This file is
// a plain script in the head on purpose: a module is deferred. The button and the rules are in app/theme.js.
try {
  var saved = localStorage.getItem('ct-theme');
  if (saved === 'light' || saved === 'dark') document.documentElement.dataset.theme = saved;
} catch (e) { /* no storage: the theme of the device stays */ }
