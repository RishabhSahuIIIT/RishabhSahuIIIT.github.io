# Session notes — Claude Code, 2026-08-10/11

For the chat that wrote HANDOFF.md. You cannot see this repo; this file and
`claude-code-changes.diff` are your only view of what changed. The diff was
reconstructed from the session record (before-state of each file vs now),
verified by applying it to the reconstructed before-files and byte-comparing
the result with the working tree: identical. The tree's other uncommitted
changes predate this session and are not covered here.

The build marker is now **v12**.

---

## Your central suspicion was wrong

`index.html` does NOT differ in the way you suspected. All four ids exist
exactly as you wired them: `hero`, `hero-meta`, `hero-lede`, `about-copy`.
Both meta variants you saw are present at once — `Hyderabad, IN` is in
`#hero-meta`, and "open to grad roles" is a separate hand-written
`<div class="corner">` in the same hero (verbatim block at the end of this
file). Your structural-fallback work in v11 was correct and survived; it
just wasn't the problem.

## Issue 1 — portrait: config, not code

Root cause: `media.portrait` was `""`. The user had picked their image by
right-clicking the **Title** and using the generic per-entry image field, so
it went to `media.images.Title` — a key nothing renders for the hero
(`applySectionConfig` only maps the five content sections). The whole
`renderPortrait()` → `loadDeferredImages()` chain, including your v11
ordering fix, was working.

Fix: set `media.portrait: "bluePortrait.png"`. Verified rendered
(`is-ready`, 148px). The dead `media.images.Title` key is still in the
config; harmless, left in place.

## Issue 2 — top-line right-click: the panel worked but lied

Root cause (two parts, neither the one you predicted):

1. `tagIntroRegions()` tagged `#hero-meta` fine — but the intro preview's
   final `else` rendered the **About paragraphs** for any intro region that
   wasn't Title/Tagline, and the source note said `about:` in resume.tex.
   So right-clicking the meta lines opened a panel showing the wrong
   content and the wrong source.
2. The `"Open to …"` corner (`<div class="corner">`) was never tagged at
   all, so right-clicking it offered nothing.

Fix: Meta lines got a faithful preview and live-updating textarea; the
corner is a new editable intro region named **Availability** (stored as
`text.corner`, first line small / rest bold, mirroring the markup). Both
report `Source: index.html` and suppress the "edit in resume.tex" button
(no counterpart there). `applyTextLive()` now handles `t.meta` and
`t.corner` — it previously handled neither, so meta edits never previewed
live. Self-check now reports intro regions 5/5.

## Issue 3 — filter grouping: your diagnosis was right

The v10 `filters` copy-list fix was already in the local v11 and the config
loaded fine. It was exactly the content-balance problem you flagged: nearly
everything sat in `frameworks`, and with `techFilterLimit: 14` all visible
buttons were one band. Fix (user-approved): rebalanced lists, limit 24.
Band order is now `frameworks, languages, databases, other` — `databases`
was added later at the user's request (Postgresql, MongoDB, SQL, IndexedDB,
Redis, SQLite, MySQL) and `bandOf` reads `order` dynamically, so no code
change was needed for the fourth band. Rail now shows all 15 occurring
frameworks | 5 languages | 2 databases | top tools, with dividers.

---

## Changes outside the original brief (all user-requested mid-session)

- **Filter hiding**: right-click any filter button → panel with a
  shown/hidden toggle. Stored in `filters.hidden` keyed `"type:value"`;
  `pfApplyHiddenFilters()` drops hidden terms in both `pfFilterGroups()`
  (dropdowns) and `pfBuildFilterButtons()` (rail). The panel lists hidden
  filters as chips for restore, since a hidden button can't be
  right-clicked back.
- **Day/night colour bleed** — same bug class as your `theme()` note, one
  layer up: the editor's `setTheme()` set `data-theme` but never the
  `theme-light/dark` class the stylesheets key off. It now drives the
  page's own sun/moon toggle; a new `syncEditorToTheme()` clears the other
  theme's unsaved inline vars and re-applies this theme's; the site toggle
  notifies the editor. Verified both directions with an unsaved-edit
  leak test.
- **Save clobber fix** (`mergeEdits`): the editor's Save POSTed its whole
  in-memory snapshot, so a stale tab's save erased every out-of-band change
  since that tab loaded — this actually happened mid-session and wiped the
  portrait/limit/rebalance (recovered; see below). Save now snapshots a
  baseline at load, re-reads the file at save time, and applies only keys
  that differ from the baseline. Unit-tested in node, including a replay of
  the real clobber.

## Every file changed

- `script.js` — BUILD v12; `pfApplyHiddenFilters()` + wired into both
  filter builders; `tagIntroRegions()` tags `.corner` as Availability;
  `applyText` renders `text.corner`; self-check intro count 5/5.
- `editor.js` — filter-button right-click target + `openFilterPanel()` +
  `filtersStore()`; Availability in intro names/preview/textarea/notes;
  correct `Source:` + button suppression for the two index.html hero
  blocks; `applyTextLive` meta+corner; `setTheme` rewrite +
  `syncEditorToTheme()` + site-toggle listeners; `mergeEdits()` +
  merge-on-save + `state.baseline` snapshots.
- `site-config.json` — `media.portrait`, `techFilterLimit: 24`, rebalanced
  4-band `techGroups` (+MySQL), `filters.hidden` key. NOTE: the
  `"tech:iptables": true` entry inside `hidden` in the diff is the **user's
  own edit** (made via the editor mid-session); the key and mechanism are
  mine, that value is not.
- `HANDOFF.md` — status block prepended recording all of the above.
- `SESSION-NOTES.md`, `claude-code-changes.diff` — this handover, new files.

## Incident worth knowing about

Mid-session the user pressed Save in an editor tab that predated my config
edits; the old blind-overwrite save reverted `site-config.json` to that
tab's stale snapshot (kept only its own new `hidden` entry). No dev-server
backup held my version (my edits didn't go through the save endpoint). I
reconstructed and restored everything, then wrote the `mergeEdits` fix so
it cannot recur. Caveat passed to the user: tabs opened before the fix
still run the old save until refreshed.

## Still open / deliberately untouched

- The **live Save → reload cycle** through dev_server's `/__save-config`
  with the new merge path is verified by unit tests and code reading, not
  by an actual button press — my harness ran a static server without the
  save endpoints.
- **Narrow-screen dropdowns**: hidden filters are dropped there via
  `pfFilterGroups()`, and the editor live-hides `.pf-opt` rows, but only
  the desktop rail was exercised end-to-end.
- `media.images.Title` dead key: left in config.
- Pre-listed terms that occur in no project yet (MySQL, Redis, SQLite,
  MongoDB, SQL, Node.js, Express, Flutter, Vite…) — band placement
  unobservable until used.
- Your two "verification habits" bugs: the `section.block` padding fix
  survives in `style.css` and all four altStyles; the `theme()` fix
  survived too (the new day/night bug was a different layer, see above).

## Current self-check output

Captured headless (Firefox) against the working tree:

```
[Portfolio v12] self-check
   build                   v12
   skill cards clickable   42
   intro regions tagged    5/5
   filters config loaded   true
   hero element found      true
   portrait                rendered: bluePortrait.png
   section padding         4.5rem
   tech filters            24 shown, grouped=true
```

## index.html — the hero block, verbatim

Unchanged this session; both "meta variants" you saw coexist here.

```html
    <section class="hero" id="hero">
      <div class="meta" id="hero-meta">
        <span>Hyderabad, IN</span>
        <span>MTech Computer Science</span>
        <span>IIIT Hyderabad · 2024–present</span>
      </div>

      <h1>
        Rishabh<br>
        <span class="italic">Sahu.</span>
      </h1>

      <p class="lede" id="hero-lede">
        MTech Computer Science student at IIIT Hyderabad, after a BTech at
        LNMIIT. Comfortable picking up <em>new stacks and domains</em> as
        the work demands.
      </p>

      <div class="corner">
        Open to<br>
        <b>new-grad roles<br>&amp; 2026 internships</b>
      </div>
    </section>
```

One quirk your future edits should know: something in this environment
normalizes non-ASCII in `editor.js` to backslash-u escapes — an em-dash in
an inserted comment ends up in the file as the six characters
backslash-u-2-0-1-4, a multiplication sign as backslash-u-0-0-d-7.
`script.js` keeps literal UTF-8. Exact-match string edits against
`editor.js` must therefore use the escaped forms, and the same applies to
hunks in `claude-code-changes.diff`.
