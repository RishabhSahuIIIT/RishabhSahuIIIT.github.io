/* theme-init.js — runs synchronously in <head> before the page renders.

   Two early jobs:

   1. THEME (dark/light/system):
        Reads the stored theme preference and applies the matching
        class to <html> so the correct palette is in place before any
        pixels paint (avoids "flash of wrong colour").

   2. STYLESHEET PREVIEW (?style=<name> or localStorage 'rs-style'):
        Lets you preview a different style file without editing
        index.html. Supports a URL param for shareable links AND a
        localStorage value (so a console-set choice persists across
        reloads). Falls through to style.css when nothing is set.

   Kept as an external file (not inline) because some browsers /
   extensions inject a strict CSP that blocks inline <script>. */
(function () {
  // ---- 1. Theme ----
  try {
    var t = localStorage.getItem('rs-theme');
    if (t === 'dark' || t === 'light') {
      document.documentElement.classList.add('theme-' + t);
      /* Mirror to an attribute as well. The stylesheets key off the class,
         but JS needs to know the *effective* theme including the OS default
         when no explicit choice has been made — reading the class alone
         returned 'light' for everyone, which made the editor write night
         colours into the day set. */
      document.documentElement.setAttribute('data-theme', t);
    }
  } catch (e) { /* localStorage unavailable */ }

  // ---- 2. Stylesheet preview ----
  try {
    var styleName = null;
    try {
      var url = new URL(window.location.href);
      styleName = url.searchParams.get('style');   // URL wins
    } catch (e) {}
    if (!styleName) {
      try { styleName = localStorage.getItem('rs-style'); } catch (e) {}
    }
    if (styleName && /^[a-z0-9-]+$/.test(styleName)) {
      var link = document.getElementById('main-style') ||
                 document.querySelector('link[rel="stylesheet"]');
      if (link) {
        var href = styleName === 'default' ? 'style.css' : 'style-' + styleName + '.css';

        /* A stored name can outlive the file it points at — renamed,
           deleted, or a typo from ?style=. Without a fallback the link
           404s and the page renders with NO css at all, which looks like
           a broken build rather than a bad preference. Recover instead. */
        link.addEventListener('error', function () {
          console.warn('[Portfolio] stylesheet "' + href + '" failed to load; ' +
                       'falling back to style.css. Clearing the saved preference — ' +
                       'run clearStyle() if it comes back.');
          try { localStorage.removeItem('rs-style'); } catch (e) {}
          link.href = 'style.css';
        });

        link.href = href;
        if (styleName !== 'default') {
          console.log('[Portfolio] previewing stylesheet:', href,
                      '(clearStyle() to reset)');
        }
      }
      // If user set via URL, also persist so a clean reload keeps it
      try {
        var fromUrl = new URL(window.location.href).searchParams.get('style');
        if (fromUrl) localStorage.setItem('rs-style', fromUrl);
      } catch (e) {}
    }
    if (!document.documentElement.getAttribute('data-theme')) {
      var prefersDark = window.matchMedia &&
        window.matchMedia('(prefers-color-scheme: dark)').matches;
      document.documentElement.setAttribute('data-theme', prefersDark ? 'dark' : 'light');
    }
  } catch (e) { /* never break the page on preview-init issues */ }
})();
