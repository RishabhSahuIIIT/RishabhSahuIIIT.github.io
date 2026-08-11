# Handoff — open issues for diagnosis

Context for a session that has access to the actual working tree. This was
built in a chat that could not read the local files, which is the root of
most of what follows.

> **Status (2026-08-10, diagnosed against the working tree):** all three
> issues resolved or explained. The central suspicion was wrong — the local
> `index.html` *does* carry all four ids (`hero`, `hero-meta`, `hero-lede`,
> `about-copy`), and `script.js` is v11 with the ordering and `filters`-copy
> fixes intact. Findings, verified in a headless browser against the live DOM:
>
> 1. **Portrait** — root cause was config, not code: `media.portrait` was
>    `""`. The image had been saved to `media.images.Title` (via right-click →
>    image on the title), which nothing renders for the hero —
>    `applySectionConfig` only maps the five content sections. Fixed by
>    setting `media.portrait: "bluePortrait.png"`; the portrait now renders
>    beside the name (`is-ready`, 148px). The stale `images.Title` key is
>    inert and left in place.
> 2. **Meta lines** — tagging worked, but the panel lied: the intro
>    preview's final `else` rendered the About paragraphs for any intro
>    region that wasn't Title/Tagline, and the source note claimed the
>    `about:` block in resume.tex. Fixed in v12: Meta lines and the new
>    Availability region (the "Open to …" corner, previously untagged and
>    uneditable) get faithful previews, an "index.html" source note (with
>    the resume.tex button suppressed — they have no counterpart there),
>    live preview while typing, and overrides stored as `text.meta` /
>    `text.corner`. Intro regions are now 5/5 in the self-check.
> 3. **Tech filter grouping** — the mechanism works (`filters.techGroups`
>    loads, band dividers render). The remaining problem was content balance:
>    nearly every term sat in `frameworks`, and with `techFilterLimit: 14`
>    the visible buttons all landed in one band. Resolved by rebalancing the
>    lists and raising `techFilterLimit` to 24. Band order is now
>    `frameworks, languages, databases, other`: `languages` trimmed to
>    actual languages, a new `databases` band holds Postgresql, MongoDB,
>    SQL, IndexedDB, Redis, SQLite, and build/infra tools (Docker, Vite,
>    SLURM, MPI, LLVM, GNU Flex/Lex, WebSocket, gRPC, Protocol Buffers,
>    iptables, Linux API) sit in `other`. The rail shows all four bands
>    with a divider at each boundary; the ~40 unlisted concept terms sit
>    behind "+ more". (`bandOf` reads `order` dynamically, so adding a band
>    needed no code change.) MySQL is pre-listed in `databases`.
>
> **Day/night colour edits bleeding together** (same class of bug as the
> `theme()` note below, one layer up): the editor's `setTheme()` switched
> `data-theme` but never the `theme-light`/`theme-dark` class the
> stylesheets key off — so the page stayed in the old palette while edits
> went into the other set, and inline variables from the previous set were
> never cleared. Fixed in v12: `setTheme()` now drives the page's own
> sun/moon toggle (class + attribute + saved-override swap together), a
> shared `syncEditorToTheme()` clears the other theme's unsaved inline
> variables and re-applies this theme's unsaved edits, and the site toggle
> buttons notify the editor so the panel always edits the visible set.
>
> **Editor Save clobbered out-of-band config edits** (found 2026-08-11):
> `saveConfig()` POSTed the tab's entire in-memory snapshot, so a tab
> opened before any outside change to `site-config.json` (another tab, a
> hand edit, a script) silently reverted that change on Save — this erased
> the tech-band rebalance, the portrait, and `techFilterLimit` while
> keeping only the tab's own `filters.hidden` edit. Fixed: the editor now
> snapshots a baseline at load (`state.baseline`), re-reads the file at
> save time, and `mergeEdits()` applies only the keys that differ from the
> baseline — everything the tab didn't touch keeps its on-disk value.
> Arrays replace atomically; deletions propagate. The lost config was
> reconstructed and restored. Tabs opened before this fix still run the
> old blind-overwrite save: refresh them before saving.
>
> Also new in v12: right-clicking any filter button opens a panel with a
> shown/hidden toggle. Hidden terms are stored in `filters.hidden`
> (site-config, keyed `"type:value"`) and dropped from the rail and the
> narrow-screen dropdowns by `pfApplyHiddenFilters()`; the panel lists all
> hidden filters as chips so they can be restored (their buttons are gone,
> so they can't be right-clicked back).

---

## The central suspicion

**The local `index.html` differs from the one these scripts were written
against.** The chat-side copy has hero meta lines reading `Hyderabad, IN`;
the user's copy reads something like `open to grad roles`. That means the
local file is either hand-edited or from an earlier revision.

This matters because several features were originally wired to ids that the
chat added to *its* `index.html`:

| id | used for |
|---|---|
| `hero` | portrait mount point |
| `hero-meta` | the small lines above the name |
| `hero-lede` | tagline paragraph |
| `about-copy` | About paragraphs |

`script.js` v11 was changed to resolve all of these **structurally** with the
ids as a first preference only (see `tagIntroRegions()` and
`renderPortrait()`). If the issues persist, that fallback chain is the first
thing to check against the real markup.

**First diagnostic step: diff the local `index.html` against the shipped one
and confirm which ids actually exist.**

---

## Open issue 1 — portrait never renders

**Expected:** a square image beside the name in the title block.

**Path:**
1. `site-config.json` → `media.portrait` holds a filename, e.g. `me.jpg`
2. `media.showPortrait` is not `false`
3. `renderPortrait()` in `script.js` builds
   `<div id="hero-portrait" class="hero-portrait is-pending">` with an
   `<img data-src="assets/me.jpg">` and inserts it as the hero's first child
4. `loadDeferredImages()` promotes `data-src` → `src`
5. the `load` handler swaps `is-pending` → `is-ready`, and CSS animates
   `width: 0` → `var(--tile-w)`

**Any of these breaks it silently:**
- `media.portrait` is `""` (the default) — nothing to load, by design
- the file isn't in `assets/`
- no hero element found → `host` is null and the function returns early
- `loadDeferredImages()` runs before `renderPortrait()` inserts the node, so
  the `data-src` is never promoted (ordering was corrected in v11 — verify
  it survived)
- `.hero-portrait.is-ready` never applied, so it stays at `width: 0`

**Fast check in the console:**
```js
document.getElementById('hero-portrait')            // exists?
document.getElementById('hero-portrait')?.className // is-pending or is-ready?
document.querySelector('#hero-portrait img')?.src   // promoted?
getComputedStyle(document.getElementById('hero-portrait')).width
```

---

## Open issue 2 — top lines show no source / edit option on right-click

**Expected:** right-clicking the small lines above the name opens the editor
panel scoped to `Meta lines`, with a source note and a text field.

**Path:**
1. `tagIntroRegions()` sets `data-entry="Meta lines"` on that element
2. `editor.js` → `targetNameFromEvent()` walks up from the click target
   looking for `data-entry` / `data-title`
3. names `Title`, `Tagline`, `About`, `Meta lines` map to `kind: 'intro'`
4. `openItemPanel(name, 'intro')` renders a textarea plus a `Source:` note

**Likely failure:** step 1 finds nothing, because the local markup doesn't
match any branch of the lookup. The fallback chain is:

```js
document.getElementById('hero-meta')
  || document.querySelector('#hero .meta, .hero .meta, .meta')
  || (element immediately before the <h1>, if it has 1–6 children)
```

**Fast check:**
```js
document.querySelectorAll('[data-entry="Meta lines"]').length  // expect 1
document.querySelector('h1').previousElementSibling            // what is it?
```

If it returns 0, widen the selector to match the real structure.

---

## Open issue 3 — tech filters not grouped as intended

**Expected order in the filter rail:** frameworks/tools first, then
programming languages, then everything else — with a thin divider between
bands.

**Path:**
1. `site-config.json` → `filters.techGroups` holds
   `{ order: ['frameworks','languages','other'], frameworks: [...], languages: [...] }`
2. `loadSiteConfig()` copies the `filters` key into `SITE_CONFIG`
   *(this was the v10 bug — `filters` was missing from the copy list, so the
   config never reached the runtime and every term fell into the same band)*
3. `pfFilterGroups()` builds `bandOf(term)` from that config
4. terms sort by `(band, frequency, alpha)`
5. `pfBuildFilterButtons()` inserts a `.pf-fam-gap` divider when the band
   changes

**Known limitation worth raising with the user:** the current lists put
almost everything in `frameworks`, so the first band is very long and the
grouping is hard to see. The lists in `site-config.json` probably need
rebalancing — that's a content decision, not a code fix.

**Fast check:**
```js
window.__siteConfig.filters?.techGroups      // present?
document.querySelectorAll('.pf-fam-gap').length  // dividers rendered?
```

---

## Architecture, briefly

Content flows one way:

```
assets/resume.tex ──parse──> script.js ──render──> DOM
                                  ^
site-config.json ─────────────────┘   (visual settings + text overrides)
projects.js ──────────────────────┘   (per-project display flags)
```

- `resume.tex` is the single source of content. Comment blocks carry
  site-only metadata (`topics:`, `description:`, `featured:`) that never
  appears in the PDF. A top-level comment block holds `tagline:` and
  `about:`.
- `site-config.json` holds everything visual, written by the editor.
  Overrides beat `resume.tex` wherever set.
- `index.html` is a static shell; `script.js` fills the mount points.
- `editor.js` and `dev_server.py` are dev-only. `index.html` has an inline
  guard that only loads `editor.js` on a local address.

**Build marker:** `script.js` logs `[Portfolio v11] self-check` on load with
a table of what wired up. Check this first — a stale cached file explains a
surprising share of "this doesn't work".

---

## Verification habits worth keeping

Several bugs in this project came from edits that silently didn't apply
(Python `str.replace` returns the original string on a miss). After any
scripted edit, grep for the new text rather than trusting the exit code.

Two bugs were also caused by the same class of mistake — code reading a
value nothing ever set:

- `theme()` read a `data-theme` attribute while `theme-init.js` only set a
  class, so every colour edit went into the light set
- `section.block` hardcoded `padding: clamp(...)` and outranked the `.block`
  rule on specificity, so the spacing slider wrote a variable nothing read

Worth checking for the same pattern if something appears inert.
