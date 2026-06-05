/* theme-init.js — runs synchronously in <head> before the page renders.
   Reads the stored theme preference and applies the matching class to
   <html> so the correct palette is in place before any pixels paint
   (avoids a "flash of wrong colour"). Kept as an external file (not
   inline) because some browsers/extensions inject a CSP that blocks
   inline scripts. */
(function () {
  try {
    var t = localStorage.getItem("rs-theme");
    if (t === "dark" || t === "light") {
      document.documentElement.classList.add("theme-" + t);
    }
  } catch (e) {
    /* localStorage unavailable */
  }
})();
