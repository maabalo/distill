/* Distill — theme-init.js
   Runs in <head> before the page paints, so a saved light/dark theme never
   flashes the wrong colors. (A separate file because the page's security
   policy allows no inline scripts.) The key matches THEME_KEY in app.js. */
(function () {
  'use strict';
  try {
    const theme = localStorage.getItem('distill-theme');
    if (theme === 'light' || theme === 'dark') document.documentElement.setAttribute('data-theme', theme);
  } catch {
    // Storage is blocked (private mode / strict settings): the system theme is used instead.
  }
})();
