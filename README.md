# Portfolio site — Rishabh Sahu

A single-page personal portfolio that parses `resume.tex` on load and renders
its content as an editorial-style site. Pure HTML, CSS, and vanilla JavaScript
— no build step, no frameworks. Deployable directly to GitHub Pages.

Live: <https://rishabhsahuiiit.github.io/>


## Quick start

```bash
python3 dev_server.py 8000     # dev server: style swapping + device preview
# or
python3 -m http.server 8000    # plain server
```

Then open <http://localhost:8000/>. For mobile layout checks, open
<http://localhost:8000/preview> (see "Device preview" below).

The site fetches `assets/resume.tex` over HTTP, so opening `index.html` via `file://`
won't work — you need a local server (or GitHub Pages).


## What's in the folder

| File | Purpose |
|---|---|
| `index.html` | Page shell with mount points the renderer fills in |
| `style.css` | Default palette (rust-on-cream) |
| `style-*.css` | Alternate palettes — aegean-clay, forest-green, day-night, rust-cream |
| `script.js` | LaTeX parser, renderer, project explorer, console helpers |
| `editor.js` | **Dev only.** Visual editor + the full icon catalogue. Loaded only on localhost — visitors never fetch it |
| `theme-init.js` | Runs in `<head>` before paint — applies stored theme and `?style=` |
| `projects.js` | User-edited config (featured projects, section toggles) |
| `assets/resume.tex` | Source of truth for all resume content |
| `dev_server.py` | **Dev only.** Local server: style swapping, device preview, config save/revert |


## Editing the resume

Everything on the site comes from `resume.tex`. Edit the LaTeX and both the
PDF and the website stay in sync.

### Standard conventions the parser understands

- `\section*{...}` — top-level sections (Education, Internships, Projects, Skills…)
- `\subsection*{...}` — individual projects
- `\textbf{Keywords:} foo, bar` — comma-separated terms
- `\href{url}{label}` — links; the label decides how it's treated (see below)
- `\begin{itemize}...\end{itemize}` — bullet points

### Topics: the three-part scheme

Topics are split across three places, each serving a different reader.

**1. Title line — leaf topics only.** The most specific topic names,
comma-separated, right-aligned. Short enough never to wrap:

```latex
\subsection*{Network Intrusion Detection and Prevention System
  \hfill {\normalfont\itshape\small Network Security, Concurrency}}
```

**2. Comment block — the full hierarchy.** Invisible in the PDF, and
authoritative for the website's domain structure:

```latex
\begin{comment}
topics: Security > Network Security; Systems Programming > Concurrency
description:
Real-time TCP packet capture with signature-based detection, automatically
blocking attacker IPs through the host firewall.
\end{comment}
```

- `;` separates independent topic paths
- `>` denotes nesting (parent > child)
- `topics:` must come before `description:` — the description runs to the
  end of the block
- Requires `\usepackage{verbatim}` (already in the preamble)
- Single-line `% topics:` / `% description:` also work

Icons and alt text are **not** in `resume.tex` — they live in
`site-config.json` under `media.icons` / `media.alts`, keyed by section or
project name, and are edited from the style editor. Only `featured`,
`topics` and `description` stay in the LaTeX.

**3. Keywords — parent domains not already on the title line.** So a
recruiter (and any ATS) sees the parent term in the PDF text:

```latex
\textbf{Keywords:} Security, Systems Programming, Python, Scapy, iptables
```

The parser reads domains from `topics:`, then **strips any keyword matching a
known domain or leaf name** before building the Tech filter. That's why
"Security" and "Systems Programming" can sit in Keywords for the PDF without
creating duplicate chips on the site — they become Domain filters instead,
and Tech keeps only Python, Scapy, iptables.

### Live demos

Any `\href` whose label contains "Live demo", "Live site", or "demo" marks
that project as deployed. It gets a green LIVE pill on the site and appears
under the Status filter. Labels matching "repository", "source", "github" or
"gitlab" are treated as repo links.

```latex
\href{https://citestat.vercel.app}{\faIcon{globe}\textbf{Live demo}}
\quad
\href{https://github.com/you/citestat}{\faIcon{link}\textbf{Project repository}}
```


## The All Projects section

Every project is listed in full — name, domain and leaf topics, description,
tech chips, and links. Nothing is hidden behind a click. Filters change what's
*emphasised*, never what exists.

**Filters** are multi-select across three groups:

- **Status** — Live demo (only shown when at least one project qualifies)
- **Domain** — parent domains from `topics:`
- **Tech** — keywords used by 2+ projects, top 12 by frequency

**Combine logic** — a switch above the filters:

| Mode | Meaning |
|---|---|
| AND | must match *every* selected filter (narrows fast) |
| OR | matches *any* selected filter (broadens) |
| **Hybrid** (default) | OR within each group, AND across groups — e.g. *(Security or Robotics) and Python* |

**Wide screens (>860px)** — a filter rail sits left of the list with an SVG
gutter between them. Selecting filters draws connector lines from each filter
to the projects it matches. Three techniques keep the lines readable when
several filters are active:

1. **Lanes** — each active filter routes through its own vertical column
2. **Hover isolation** — hovering a filter dims every other filter's lines
3. **Staggered anchors** — lines arriving at one card attach at different heights

**Narrow screens (≤860px)** — no lines. Filters collapse into compact
dropdowns (Status / Domain / Tech) pinned directly beneath the topbar, each
showing a badge with the number of active selections in that group. The menus
stay open while you pick several options. The list then regroups:

1. **Matches multiple filters** first, ranked by how many, each with a
   split-colour left edge
2. **One group per active filter** with its remaining matches
3. **Other projects**, faded, below a divider

Domain colours derive from the active palette's accent with hue rotation, so
they follow the day/night toggle and any palette switch.


## Configuring — `projects.js`

By default everything in `resume.tex` appears. Edit `projects.js` only to
deviate.

```js
sections: {
  showEducation:       true,
  showInternships:     true,
  showProjects:        true,
  showSkills:          true,
  showAccomplishments: true
}
```

### Featured vs All projects

Projects land in **All projects** by default. Add `featured: true` to promote
one into the prominent **Selected work** section; it stays in All projects
too unless you also set `featuredOnly: true`.

```js
projects: {
  "Agentic AI Research Assistant": { featured: true },
  "Real-Time Collaborative Text Editor using CRDT": { featured: true, featuredOnly: true },
  "Some Old Project": { show: false }
}
```

| Key | Effect |
|---|---|
| `featured: true` | Promote to Selected work (still in All projects) |
| `featuredOnly: true` | With `featured`, removes it from All projects |
| `show: false` | Drop the entry entirely |
| `hideDescription: true` | Suppress this project's description |
| `useAlt: true` + `altData: {...}` | Override resume text, or add a web-only project |

Note: the All Projects section is filter-driven, so it has no category-order
setting. Domain order in the rail follows first appearance in `resume.tex`.


## Images (`assets/`)

Representative images for sections and projects live in `assets/`. Assign them
from the editor's **Icon / image** field, or by hand in `site-config.json`:

```json
"media": {
  "imageDir": "assets/",
  "images": { "Citestat – Academic Citation Analytics Dashboard": "citestat.png" },
  "alts":   { "Citestat – Academic Citation Analytics Dashboard": "Citation dashboard" }
}
```

The filename is resolved against `media.imageDir`. If both an image and an
emoji are set for the same item, the image wins. Keep them small — they render
at 1.2em beside a heading, or as a 150px-tall card thumbnail.

University and employer logos belong here too: they're copyrighted marks, so
they stay as image files rather than being bundled into `editor.js` with the
CC0 tech logos.


## Colour palettes

- `style.css` — rust on cream (default)
- `style-rust-cream.css` — same, named explicitly
- `style-aegean-clay.css` — muted blue on warm sand
- `style-forest-green.css` — deep green on stone
- `style-day-night.css` — high-contrast sun and midnight

To change the deployed default, edit the stylesheet link in `index.html`:

```html
<link id="main-style" rel="stylesheet" href="style-aegean-clay.css">
```

The `style-*.css` files are generated from `style.css` with HSL offsets. After
any edit to `style.css`, regenerate them:

```
dev> palettes
```

(or from a script: `python3 -c "import dev_server; dev_server.generate_palettes()"`)


## Device preview

`dev_server.py` serves a device-frame page at **`/preview`**:

```
http://localhost:8000/preview
```

It loads your real site in an iframe inside a resizable frame, so you can
check the mobile layout from your laptop. Presets:

| Device | Size |
|---|---|
| iPhone SE | 375 × 667 |
| iPhone 15 Pro | 393 × 852 |
| Pixel 8 | 412 × 915 |
| iPad mini | 768 × 1024 |
| iPad Pro 11" | 834 × 1194 |
| Laptop | 1280 × 800 |
| Desktop | 1600 × 900 |

**rotate** swaps width and height. **reload** picks up file changes. Since
it's your actual site in an iframe, the filter rail, connector lines, and
mobile grouping behave exactly as in production — useful for checking the
860px breakpoint.

### Sizing modes

**auto-fit** (default) scales the frame down so it always fits your window —
an iPad Pro frame won't overflow a laptop screen. The readout shows the
scale factor.

**1:1 size** renders the frame at true physical dimensions, so a 375 px iPhone
frame is genuinely ~2.3 inches wide and you can hold a real phone up to
compare. This needs a one-time **calibrate** step: drag a slider until the
on-screen box matches a real credit card (85.6 mm, identical worldwide). The
result is stored in `localStorage`.

The scaling accounts for the fact that phones pack far more CSS pixels per
inch than desktop monitors — an iPhone SE fits 375 css px into 2.31 inches
(~162 css-px/in) while a typical monitor shows ~96. Scaling by monitor DPI
alone would render phone frames roughly 1.7× too large. Run `devices` to see
each preset's physical width and density.

Calibration is unavoidable — no browser or OS API reports true screen size
reliably. `devicePixelRatio` describes pixel density relative to CSS pixels,
not physical inches, and the display's own EDID metadata is frequently a
96-DPI placeholder rather than the truth.

### Where the numbers come from

The readout above the frame labels the source of every measurement, because
they can disagree:

- **your browser** — viewport size and `devicePixelRatio`, measured live in
  the browser. Authoritative for layout.
- **server machine** — resolution read via `tkinter` by `dev_server.py` at
  startup. The Tk root is created withdrawn and destroyed immediately, so no
  window ever appears. If you browse from a different machine than the one
  running the server, these numbers describe the *server's* display, not
  yours — the readout says so explicitly.
- **monitor name** — best-effort, platform-specific: `system_profiler` on
  macOS, `WmiMonitorID` on Windows, `xrandr` (then EDID under
  `/sys/class/drm`) on Linux. Frequently generic (`eDP-1`) or unavailable;
  the log names the source it used and says when nothing was found.
- **dpi** — only present after calibration.

The same detail is printed to the terminal at startup, and `screen` re-probes
on demand. On a headless machine detection fails gracefully and says why.

From the CLI: `preview` prints the URL, `devices` lists the sizes, `screen`
reports display detection.



## How this site works — a technical tour

No framework, no build step, no dependencies. Everything below is a
platform feature the browser already ships. Links go to MDN.

### HTML

| Feature | Where it's used | Reference |
|---|---|---|
| Semantic sectioning (`<section>`, `<article>`, `<nav>`) | Every block; screen readers and the nav builder both rely on it | [MDN](https://developer.mozilla.org/en-US/docs/Web/HTML/Element/section) |
| `data-*` attributes | `data-entry`, `data-title`, `data-section-title` let the editor find and target rendered items | [MDN](https://developer.mozilla.org/en-US/docs/Learn/HTML/Howto/Use_data_attributes) |
| `loading="lazy"` + `decoding="async"` | Images never block first paint | [MDN](https://developer.mozilla.org/en-US/docs/Web/Performance/Lazy_loading) |
| Inline SVG data-URI favicon | Avoids a separate request and a 404 | [MDN](https://developer.mozilla.org/en-US/docs/Web/URI/Schemes/data) |

### CSS

| Feature | Where it's used | Reference |
|---|---|---|
| Custom properties | The whole theming system — `--bg`, `--accent`, `--text-scale`, `--logo-shadow`. The editor writes these live | [MDN](https://developer.mozilla.org/en-US/docs/Web/CSS/Using_CSS_custom_properties) |
| `prefers-color-scheme` | Dark mode follows the OS until the toggle overrides it | [MDN](https://developer.mozilla.org/en-US/docs/Web/CSS/@media/prefers-color-scheme) |
| Grid with `auto-fit` / `minmax()` | Tools cards and AI cards reflow without breakpoints | [MDN](https://developer.mozilla.org/en-US/docs/Web/CSS/CSS_grid_layout) |
| `position: sticky` | Filter rail and mobile filter bar | [MDN](https://developer.mozilla.org/en-US/docs/Web/CSS/position#sticky) |
| `calc()` with variables | Sizes derive from `--text-scale` and `--density` rather than being hardcoded | [MDN](https://developer.mozilla.org/en-US/docs/Web/CSS/calc) |
| `aspect-ratio` | Square image tiles without padding hacks | [MDN](https://developer.mozilla.org/en-US/docs/Web/CSS/aspect-ratio) |
| `filter: drop-shadow()` | Shadows that follow an SVG's shape, not its bounding box | [MDN](https://developer.mozilla.org/en-US/docs/Web/CSS/filter-function/drop-shadow) |
| `:not()`, `:has()`-free selectors | Kept deliberately conservative for browser support | [MDN](https://developer.mozilla.org/en-US/docs/Web/CSS/:not) |

### JavaScript

| Feature | Where it's used | Reference |
|---|---|---|
| `fetch()` + promise chaining | Loads `site-config.json` *then* `assets/resume.tex`, in that order — they were parallel once, and the render sometimes won the race | [MDN](https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API) |
| `CustomEvent` | `portfolio:rendered` tells the editor the parse finished | [MDN](https://developer.mozilla.org/en-US/docs/Web/API/CustomEvent) |
| `IntersectionObserver` | Scroll reveal without scroll handlers | [MDN](https://developer.mozilla.org/en-US/docs/Web/API/Intersection_Observer_API) |
| `requestIdleCallback` | Defers image loading until the browser is idle | [MDN](https://developer.mozilla.org/en-US/docs/Web/API/Window/requestIdleCallback) |
| Navigation Timing API | Reports load timing to the dev server console | [MDN](https://developer.mozilla.org/en-US/docs/Web/API/Performance_API/Navigation_timing) |
| `matchMedia()` | The 860px breakpoint is read in JS, not just CSS, so the filter UI can switch behaviour | [MDN](https://developer.mozilla.org/en-US/docs/Web/API/Window/matchMedia) |
| SVG DOM via `createElementNS` | Connector lines between filters and projects are built as real SVG paths | [MDN](https://developer.mozilla.org/en-US/docs/Web/API/Document/createElementNS) |
| Cubic Bézier path maths | Each connector routes through its own lane to avoid overlap | [MDN](https://developer.mozilla.org/en-US/docs/Web/SVG/Attribute/d) |
| WCAG relative luminance | Logo colours are checked against the page background and given a backing plate when they'd be illegible | [W3C](https://www.w3.org/WAI/GL/wiki/Relative_luminance) |
| `localStorage` | Theme and palette choice, and the preview DPI calibration | [MDN](https://developer.mozilla.org/en-US/docs/Web/API/Window/localStorage) |

### The parser

`script.js` contains a small recursive-descent-ish LaTeX reader: balanced-brace
scanning (`findBalancedBraces`), control-sequence-aware tokenising (so
`\itemsize` isn't mistaken for `\item`), and comment-block extraction for
metadata that should never appear in the PDF. It's the reason one `resume.tex`
can drive both a PDF and a website without duplicating content.


## Dev-server commands

Type these at the `dev>` prompt. `help` prints the same list.

**Files** — all confined to the served folder; a path that escapes it is
rejected, since this is still a web server.

| Command | Does |
|---|---|
| `ls [path]` | List a directory, or show one file's size (alias `dir`) |
| `cat <file>` | Print a file with line numbers (first 400 lines) |
| `head <file> [n]` | First n lines (default 40) |
| `tail <file> [n]` | Last n lines (default 40) |
| `tree [depth]` | Folder tree, default depth 2 |
| `find <text>` | Files whose name contains `<text>` |
| *(tab)* | Completes commands, paths and style names |
| `pwd` | The folder being served |

**Styling**

| Command | Does |
|---|---|
| `style <name>` | Serve `style-<name>.css` as `/style.css` |
| `style <path>` | Serve any CSS file from any path |
| `style default` | Back to the real `style.css` |
| `list` | Available `style-*.css` files |
| `palettes` | Rebuild every `style-*.css` from `style.css` |

**Editor and config**

| Command | Does |
|---|---|
| `editor on\|off` | Enable/disable the style editor |
| `config` | Print the current `site-config.json` values |
| `revert` | Restore `site-config.json` from the newest backup |
| `revert-tex` | Restore `assets/resume.tex` from its newest backup |
| `revert-html` | Restore `index.html` from its newest backup |
| `live` | Print the visitor-view URL (no editor) |

**Preview and diagnostics**

| Command | Does |
|---|---|
| `preview` | Print the device-preview URL |
| `devices` | List the device sizes |
| `screen` | Re-probe the display and report what was found |
| `help` | Show all commands |
| `quit` | Stop the server (also `exit`, `q`, Ctrl+C, Ctrl+D) |


## Right-click style editor

With `dev_server.py` running, click the **style editor** button in the
bottom-right corner — or **right-click anywhere on the page** — to open a
panel for:

- **Palette** — switch between the `style-*.css` files
- **Colours** — every custom property declared on `:root` is discovered from
  the active stylesheet and given a picker, so adding a variable to
  `style.css` makes it editable with no change here. Font stacks and numeric
  variables are filtered out. Preset swatches plus a persistent recents row.
- **Domains + connector lines** — a picker per project domain. A domain's
  colour drives its filter button, its chips, the card edge, *and* the lines
  drawn to matching projects, so this is how you recolour the connectors.
  Unpinned domains keep a hue-rotated accent, so new domains still get a
  distinct colour automatically. Domain colours are shared across light and
  dark; only the surrounding page changes with the theme.
- **Line strength** — opacity of the connector lines
- **Icon / image** — pick any section or project, then set an emoji, an image
  filename, and alt text. **browse** opens an emoji picker that ranks
  suggestions against that item's own title, domains and tech keywords —
  so an intrusion-detection project surfaces 🛡 first — with free-text
  search over the whole catalogue in `emoji-data.js`. Three distinct
  actions, which are easy to confuse:
  **apply** stores what the fields show, **hide** stores an explicit blank so
  nothing renders *even when `resume.tex` declares an icon*, and **reset**
  drops the override so the `resume.tex` value applies again. Clearing an
  override is not the same as removing an icon. These are written to
  `site-config.json` as overrides rather than back into `resume.tex`, so a web
  UI can never corrupt the file that feeds your PDF. **copy for resume.tex**
  puts the matching comment block on your clipboard when you want to promote a
  choice into the source and delete the override.

Every colour row has its own **▾** button opening presets and recently-used
colours for *that* entry, rather than one shared swatch strip.

**Day and night are edited separately.** The `day` / `night` buttons at the
top of the colour section switch both the page theme and which override set
you're editing; the line beneath shows how many overrides each currently has.
Domain colours are the exception — they're shared across both themes, since a
domain's hue shouldn't change when the page does.
- **Size** — text scale and spacing sliders, globally
- **Per-section text** — an independent scale for each section

Changes preview live. **Save** writes `site-config.json` and snapshots the
previous version into `.site-config-backups/`; **Revert** restores the newest
snapshot and reloads. From the CLI, `config` prints the current values and
`revert` does the same restore.

The editor is injected by the dev server into the HTML it serves — the
`index.html` on disk never references it, so nothing reaches production.
Turn it off with `editor off`.

Colour edits apply to whichever theme is active (light or dark), and are
stored separately per theme in `site-config.json`.


## Compiling the PDF

`resume.tex` uses `fontspec`, which only works under **XeTeX or LuaTeX**.
Running `pdflatex` produces:

```
Fatal Package fontspec Error: The fontspec package requires either XeTeX or LuaTeX.
```

Two things make the right engine automatic:

- `% !TEX program = xelatex` on line 1 — read by VS Code (LaTeX Workshop),
  TeXShop and TeXworks.
- `assets/.latexmkrc` sets `$pdf_mode = 5`, so a bare `latexmk resume.tex`
  uses xelatex too.

If VS Code still runs pdflatex, its recipe is overriding the magic comment.
Set the default recipe to a XeLaTeX one in settings:

```json
"latex-workshop.latex.recipe.default": "latexmk (xelatex)"
```

Or compile directly: `xelatex resume.tex` (twice, for the page references).


## Live style preview

Three ways to try a palette without editing files.

### 1. CLI (server-wide)

```
dev> list
  aegean-clay         ->  style-aegean-clay.css
  day-night           ->  style-day-night.css
  forest-green        ->  style-forest-green.css
  rust-cream          ->  style-rust-cream.css

dev> style aegean-clay
  now serving 'style-aegean-clay.css' as /style.css. Refresh the page.

dev> style ../experiments/sunset.css
dev> style default
dev> quit
```

Your `style.css` on disk is never modified. Caching is disabled, so a normal
refresh picks up changes.

### 2. URL parameter (per-tab, persists)

```
http://localhost:8000/?style=aegean-clay
http://localhost:8000/?style=default
```

### 3. DevTools console (per-tab, live)

```js
setStyle('aegean-clay')
setStyle('default')
listStyles()
clearStyle()
```


## Theme toggle

A Day / Night pill in the top bar overrides the OS colour-scheme preference.
The choice persists in `localStorage` and is applied before first paint by
`theme-init.js`, so there's no flash of the wrong palette.


## Nav behavior

The top-bar nav rebuilds itself after render. Empty sections drop out — if no
projects are featured, "Work" disappears; if nothing is left for All projects,
"Projects" disappears.


## Deployment

The repo is a user site at `https://rishabhsahuiiit.github.io/`. Pushing to
`main` is the deploy — GitHub Pages serves the files as-is.

```bash
git add .
git commit -m "update resume"
git push origin main
```


## Troubleshooting

**Page loads but sections are empty.** The browser couldn't fetch
`assets/resume.tex`. The path is set by `RESUME_PATH` at the top of
`script.js` — change it there if you move the file again. Open DevTools → Console; an orange error banner will list the
attempted URL and a checklist. Usually it's `file://` instead of a server, or
the server started from the wrong folder.

**Styles missing, only plain HTML.** Two common causes.

First, a *stale saved palette*. `theme-init.js` restores the stylesheet named
in `localStorage['rs-style']` before paint. If that file no longer exists, the
`<link>` 404s and the page renders with no CSS. Open the console and run:

```js
clearStyle()
```

then reload. Since the fallback was added, this now self-corrects with a
console warning instead of rendering unstyled — but a browser that cached the
old `theme-init.js` can still hit it once. Check the Network tab for a red
`style-*.css` entry to confirm.

Second, a content blocker intercepting CSS or inline scripts. Try incognito,
or disable shields for `localhost` — Brave and Ulaa are the common culprits.

**`HTTP 404` for resume.tex.** Run the server from the folder containing both
`index.html` and `assets/resume.tex`.

**A domain appears as a Tech chip too.** The parser strips keywords matching
known domain or leaf names, so this means the term isn't in that project's
`topics:` line. Add it there, or correct the spelling — matching is
case-insensitive but otherwise exact.

**A project shows no domain chips.** Its comment block is missing `topics:`,
or `description:` comes before `topics:` (the description swallows everything
after it). Put `topics:` first.

**Connector lines look wrong after resizing.** They redraw on resize and
scroll; if they're stale, scroll once. Below 860px they're intentionally
replaced by grouped chips.

**`style.css` edits not showing.** Hard-refresh (Cmd/Ctrl+Shift+R). With
`dev_server.py` a normal refresh is enough.
