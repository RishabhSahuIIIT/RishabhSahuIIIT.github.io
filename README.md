# Portfolio site — Rishabh Sahu

A single-page personal portfolio that parses `resume.tex` on load and renders
its content as an editorial-style site. Pure HTML, CSS, and vanilla JavaScript
— no build step, no frameworks. Deployable directly to GitHub Pages.

Live: <https://rishabhsahuiiit.github.io/>


## Quick start

```bash
# preview locally — pick one:
python3 -m http.server 8000          # plain server
python3 dev-server.py 8000           # dev server with interactive style swap

# then open http://localhost:8000/
```

The site fetches `resume.tex` over HTTP, so opening `index.html` via `file://`
won't work — you need a local server (or GitHub Pages).


## What's in the folder

| File | Purpose |
|---|---|
| `index.html` | Page shell with mount points the renderer fills in |
| `style.css` | Default palette (rust-on-cream) |
| `style-*.css` | Alternate palettes — aegean-clay, forest-green, day-night, rust-cream |
| `script.js` | LaTeX parser + renderer + dynamic nav + console helpers |
| `theme-init.js` | Runs in `<head>` before paint — applies stored theme and `?style=` URL param |
| `projects.js` | User-edited config (which projects to feature, sections to hide, etc.) |
| `resume.tex` | Source of truth for all resume content |
| `dev-server.py` | Local HTTP server with interactive style-swap commands |
| `generate-palettes.js` | Regenerates `style-*.css` from base `style.css` after CSS edits |


## Editing the resume

The site reads everything from `resume.tex`. To change what appears on the
page, edit the LaTeX — the PDF stays in sync, the website stays in sync,
one source.

### Standard LaTeX conventions the parser understands

- `\section*{...}` — top-level sections (Education, Internships, Projects,
  Skills, Accomplishments, Interests…)
- `\subsection*{...}` — individual projects
- `\textbf{Keywords:} foo, bar, baz` — comma-separated skill chips
- `\href{url}{label}` — clickable repository links
- `\begin{itemize}...\end{itemize}` — bullet points (rendered as a list)

### Project categories — auto-extracted from the title

Append the category to each project subsection using `\hfill` and a small
italic formatting group. The category renders in the PDF as a right-aligned
italic tag and shows up on the site as the group heading.

```latex
\subsection*{JSON API server \hfill {\normalfont\itshape\small Backend Development}}
```

Categories drive:
- Group headings inside Selected Work and All Projects
- The hover dropdown next to "Work" / "Projects" in the nav

To control which order categories appear in, set
`sections.projectCategoryOrder` in `projects.js`. Names must match the
resume tag exactly.

### Project descriptions — multi-line LaTeX comments

For a paragraph-length description that should appear on the site but NOT
in the PDF, use a `\begin{comment}...\end{comment}` block with the
`description:` marker. Requires `\usepackage{verbatim}` in the preamble
(already added).

```latex
\begin{comment}
description:
A small backend service exposing teacher and course data from a Postgres
database as JSON. Built as a sandbox for Flask routing patterns, request
handling, and one-command containerised deployment with Docker.
\end{comment}
\subsection*{JSON API server \hfill {\normalfont\itshape\small Backend Development}}
```

- The first non-blank content must start with `description:` — that's the marker.
- Everything from after the marker to `\end{comment}` is the description body.
- Newlines collapse into spaces (one paragraph).
- The block is invisible in the rendered PDF.
- For short descriptions, a single-line `% description: ...` is also accepted.
- `\iffalse...\fi` works too, if you don't want the `verbatim` package.


## Configuring the site — `projects.js`

By default, *everything in `resume.tex` shows up on the site*. You only edit
`projects.js` to deviate from that — hide entries, promote projects, override
text, or add web-only items.

### Section-level toggles

```js
sections: {
  showEducation:       true,
  showInternships:     true,
  showProjects:        true,
  showSkills:          true,
  showAccomplishments: true,

  groupProjectsByCategory:     true,
  projectCategoryOrder:        ["Backend Development", "Machine Learning"],
  expandAllProjectsByDefault:  false,
  showProjectDescriptions:     true
}
```

### Featured vs All projects

The default is **inverted from what most portfolio tools do**:

- Every project lands in **All projects** by default.
- A project moves into the prominent **Selected work** section ONLY when
  `projects.js` explicitly marks it `featured: true`.
- A featured project still appears in All projects too — unless you also
  set `featuredOnly: true` to remove it from the mirror.

```js
projects: {
  "JSON API server":              { featured: true },                   // in BOTH sections
  "Wine Classifier ...":          { featured: true, featuredOnly: true }, // ONLY in Selected Work
  "Old course project":           { hideDescription: true },             // hide the paragraph
  "Throwaway prototype":          { show: false }                        // hide entirely
}
```

Per-project keys recognised:

| Key | Effect |
|---|---|
| `featured: true` | Promote to Selected work (still shown in All projects) |
| `featuredOnly: true` | Combined with `featured: true`, removes the All-projects mirror |
| `show: false` | Drop the entry entirely |
| `hideDescription: true` | Suppress the paragraph description for this project |
| `useAlt: true` + `altData: {...}` | Override the resume text with custom copy (also how to add a web-only project not in `resume.tex`) |


## Color palettes

Four palettes ship by default:

- `style.css` — rust on cream (default)
- `style-rust-cream.css` — same as default, named explicitly
- `style-aegean-clay.css` — muted blue on warm sand
- `style-forest-green.css` — deep green on stone
- `style-day-night.css` — high-contrast sun-and-midnight

### Switching the default palette (deployed site)

Edit `index.html` and change the `href` on the stylesheet link:

```html
<link id="main-style" rel="stylesheet" href="style-aegean-clay.css">
```

### Regenerating the alternate palettes after editing `style.css`

The `style-*.css` files are auto-generated derivatives of `style.css` with
HSL offsets applied to the background tones. After any visual change to
`style.css`, regenerate them:

```bash
node generate-palettes.js
```


## Live style preview (local dev only)

Three independent ways to preview a different palette without editing files:

### 1. CLI command (server-wide)

Run `dev-server.py` instead of `python -m http.server`:

```bash
$ python3 dev-server.py 8000

dev server: http://localhost:8000/
serving:    /path/to/portfolio

dev> list
  aegean-clay         ->  style-aegean-clay.css
  day-night           ->  style-day-night.css
  forest-green        ->  style-forest-green.css
  rust-cream          ->  style-rust-cream.css

dev> style aegean-clay
  now serving 'style-aegean-clay.css' as /style.css. Refresh the page.

dev> style ../experiments/sunset.css
  now serving '../experiments/sunset.css' as /style.css. Refresh the page.

dev> style default
  reset - serving style.css unchanged. Refresh the page.

dev> quit
```

- The actual `style.css` on disk is never modified.
- HTTP caching is disabled, so a normal browser refresh picks up changes.
- Accepts both palette names (`aegean-clay`) and arbitrary file paths.
- Affects every browser tab that loads `/style.css` from this server.

### 2. URL parameter (per-tab, persists across reloads)

```
http://localhost:8000/?style=aegean-clay
http://localhost:8000/?style=forest-green
http://localhost:8000/?style=default
```

The chosen style is also stored in `localStorage`, so future visits (even
without the URL param) remember it. To clear, use `clearStyle()` below.

### 3. DevTools console (per-tab, live)

Open the browser's DevTools Console and type:

```js
setStyle('aegean-clay')   // swap immediately
setStyle('default')        // back to style.css
listStyles()               // print available palettes
clearStyle()               // reset and clear stored choice
```


## Theme toggle (Day / Night)

A pill switch in the top bar lets the user override the OS-level dark-mode
preference. The choice persists in `localStorage` and is applied before
first paint by `theme-init.js` (no flash of wrong colour).


## Nav behavior

The top-bar nav rebuilds itself after the page renders:

- Empty sections drop out — if no projects are featured, the "Work" link
  disappears; if no project is demoted to All projects only, the "Projects"
  link disappears.
- Sections with categorised content get a hover dropdown — for example,
  if Selected Work has projects in two categories, hovering "Work" reveals
  each category as a clickable sub-link.


## Deployment to GitHub Pages

The repo is a user site at `https://rishabhsahuiiit.github.io/`. Pushing
to the `main` branch is the deploy.

```bash
git add .
git commit -m "update resume"
git push origin main
```

GitHub Pages serves the files as-is — no build step. Wait ~30 seconds for
the rebuild.


## Troubleshooting

**Page loads but no content / sections are empty.** The browser couldn't
fetch `resume.tex`. Open DevTools → Console — if you see a red error
banner, follow the troubleshooting list it shows. The usual causes are
opening `index.html` via `file://` (you need an HTTP server), or running
the server from the wrong directory.

**Styles don't apply (only plain HTML shows).** A browser extension or
built-in tracker protection is blocking inline scripts or CSS. Try
incognito mode. Ulaa, Brave, and similar privacy-first browsers are the
common culprits — turn shields off for `localhost`.

**Console says `[Portfolio] resume.tex response: HTTP 404`.** The file
isn't where the server expects. Run `python3 -m http.server` from the
same folder that contains `index.html` AND `resume.tex`.

**Changes to `style.css` aren't showing up.** Hard-refresh
(Cmd/Ctrl+Shift+R) to bypass browser cache. If you're using `dev-server.py`,
a normal refresh is enough (caching is disabled).

**Categories show in the nav dropdown but in the wrong order.** Edit
`sections.projectCategoryOrder` in `projects.js`. Strings must match the
resume tag exactly (case-sensitive, full text).
