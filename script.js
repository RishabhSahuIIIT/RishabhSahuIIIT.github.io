/* ============================================================
   script.js — renderer & scroll-reveal
   --------------------------------------------------------------
   Reads window.PROJECTS (defined in projects.js), splits them
   into featured + the rest, and writes the HTML into the two
   project mount points in index.html.

   You generally don’t need to edit this file.
   ============================================================ */

(function () {
  'use strict';

  // ---------- Helpers ----------

  function escapeHTML(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;'
      })[c];
    });
  }

  // Lightweight inline-code support inside summaries: `like this`
  function formatInline(s) {
    return escapeHTML(s).replace(/`([^`]+)`/g, '<code>$1</code>');
  }

  function renderStack(stack, ClassName) {
    if (!Array.isArray(stack) || !stack.length) return '';
    return (
      '<div class="' + ClassName + '">' +
      stack.map(function (t) { return '<span>' + escapeHTML(t) + '</span>'; }).join('') +
      '</div>'
    );
  }

  function renderLinks(links) {
    if (!Array.isArray(links) || !links.length) return '';
    return (
      '<div class="repo-links">' +
      links.map(function (l) {
        return (
          '<a class="repo-link" href="' + escapeHTML(l.url) + '" target="_blank" rel="noopener">' +
          escapeHTML(l.label) + ' <span class="arrow" aria-hidden="true">↗</span>' +
          '</a>'
        );
      }).join('') +
      '</div>'
    );
  }

  function renderBullets(bullets) {
    if (!Array.isArray(bullets) || !bullets.length) return '';
    return (
      '<ul>' +
      bullets.map(function (b) { return '<li>' + formatInline(b) + '</li>'; }).join('') +
      '</ul>'
    );
  }

  function metaLines(meta) {
    if (!meta) return '';
    return escapeHTML(meta).replace(/\n/g, '<br/>');
  }

  // ---------- Renderers ----------

  function renderFeatured(project, index) {
    var idx = String(index + 1).padStart(2, '0');
    var titleEl = project.links && project.links[0]
      ? '<a href="' + escapeHTML(project.links[0].url) + '" target="_blank" rel="noopener">' +
          escapeHTML(project.title) + '</a>'
      : escapeHTML(project.title);

    var metaCol =
      (project.meta ? metaLines(project.meta) : '') +
      (project.links && project.links.length ? renderLinks(project.links) : '');

    return (
      '<article class="work-item">' +
        '<span class="idx">' + idx + ' / Project</span>' +
        '<div>' +
          '<h3>' + titleEl + '</h3>' +
          (project.role ? '<div class="role">' + escapeHTML(project.role) + '</div>' : '') +
          (project.summary ? '<p>' + formatInline(project.summary) + '</p>' : '') +
          renderBullets(project.bullets) +
          renderStack(project.stack, 'stack') +
        '</div>' +
        '<div class="meta-right">' +
          (metaCol || '') +
        '</div>' +
      '</article>'
    );
  }

  function renderCompact(project) {
    return (
      '<article class="project-compact">' +
        '<header class="pc-head">' +
          '<h4 class="pc-title">' + escapeHTML(project.title) + '</h4>' +
          (project.category ? '<span class="pc-cat">' + escapeHTML(project.category) + '</span>' : '') +
        '</header>' +
        (project.summary ? '<p class="pc-desc">' + formatInline(project.summary) + '</p>' : '') +
        '<div class="pc-foot">' +
          renderStack(project.stack, 'pc-stack') +
          renderLinks(project.links) +
        '</div>' +
      '</article>'
    );
  }

  // ---------- Mount ----------

  function mountProjects() {
    var data = Array.isArray(window.PROJECTS) ? window.PROJECTS : [];

    var featured = data.filter(function (p) { return p && p.featured === true; });
    var rest     = data.filter(function (p) { return p && p.featured !== true; });

    var featuredEl = document.getElementById('featured-projects');
    var allEl      = document.getElementById('all-projects');

    if (featuredEl) {
      featuredEl.innerHTML = featured.length
        ? featured.map(renderFeatured).join('')
        : '';
    }

    if (allEl) {
      allEl.innerHTML = rest.length
        ? rest.map(renderCompact).join('')
        : '<div class="all-projects-empty">No additional projects yet — check back soon.</div>';
    }
  }

  // ---------- Scroll reveal ----------

  function setupReveal() {
    var els = document.querySelectorAll('.reveal');
    if (!('IntersectionObserver' in window)) {
      els.forEach(function (el) { el.classList.add('in'); });
      return;
    }
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (e.isIntersecting) {
          e.target.classList.add('in');
          io.unobserve(e.target);
        }
      });
    }, { threshold: 0.12, rootMargin: '0px 0px -40px 0px' });

    els.forEach(function (el) { io.observe(el); });
  }

  // ---------- Boot ----------

  function boot() {
    mountProjects();
    setupReveal();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
