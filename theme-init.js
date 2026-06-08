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
    var t = localStorage.getItem("rs-theme");
    if (t === "dark" || t === "light") {
      document.documentElement.classList.add("theme-" + t);
    }
  } catch (e) {
    /* localStorage unavailable */
  }

  // ---- 2. Stylesheet preview ----
  try {
    var styleName = null;
    try {
      var url = new URL(window.location.href);
      styleName = url.searchParams.get("style"); // URL wins
    } catch (e) {}
    if (!styleName) {
      try {
        styleName = localStorage.getItem("rs-style");
      } catch (e) {}
    }
    if (styleName && /^[a-z0-9-]+$/.test(styleName)) {
      var link =
        document.getElementById("main-style") ||
        document.querySelector('link[rel="stylesheet"]');
      if (link) {
        link.href =
          styleName === "default" ? "style.css" : "style-" + styleName + ".css";
      }
      // If user set via URL, also persist so a clean reload keeps it
      try {
        var fromUrl = new URL(window.location.href).searchParams.get("style");
        if (fromUrl) localStorage.setItem("rs-style", fromUrl);
      } catch (e) {}
    }
  } catch (e) {
    /* never break the page on preview-init issues */
  }
})();
