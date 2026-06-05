# Rishabh Sahu — Portfolio

Live: <https://rishabhsahuiiit.github.io/>

A single-page editorial portfolio that **parses `resume.tex` at load** and
renders every data-driven section from it. Formatting lives in HTML/CSS;
the resume file is the single source of truth for content.

## Files

| File                  | What it does                                                              |
|-----------------------|---------------------------------------------------------------------------|
| `index.html`          | Page shell — section headers + empty mount points the script populates.   |
| `style.css`           | Active stylesheet.                                                        |
| `style-rust-cream.css`| Palette variant: **Rust on cream**, light −26 / dark +7.                  |
| `style-aegean-clay.css`| Palette variant: **Aegean clay**, light −7 / dark +11.                  |
| `style-forest-green.css`| Palette variant: **Forest green**, light −7 / dark +11.                |
| `style-day-night.css` | Palette variant: **Day & Night**, light −24 / dark +11.                   |
| `resume.tex`          | **Your resume.** Edit this to change real content.                        |
| `script.js`           | Parser + renderer. Fetches `resume.tex`, parses, fills mount points.      |
| `projects.js`         | Portfolio configuration — section toggles, per-entry overrides, grouping. |
| `generate-palettes.js`| Regenerates the four palette variants. Run `node generate-palettes.js`.   |

To switch palettes, copy/rename one of `style-*.css` to `style.css`
(or change the `<link>` in `index.html` to point at a specific variant).

## How content flows

```
  resume.tex  ────────► parser  ─┐
                                 ├──► merger ──► renderer ──► mount points in index.html
  projects.js ────────► config  ─┘                           
```

- `resume.tex` is the source of truth for: contact info, education,
  internships, projects, skills, accomplishments.
- `projects.js` decides what shows, what's featured, what's overridden,
  and how projects are grouped. **Every section can now be customised**
  (not just projects).
- `index.html` holds only the static scaffolding (hero copy, about
  paragraphs, section headings) and the mount points.

## projects.js — config is optional

**By default, every entry in `resume.tex` shows up on the page.** You only
add entries to `projects.js` when you want to deviate:

| You want to…                                  | Add this                                          |
|-----------------------------------------------|---------------------------------------------------|
| Hide an entry                                 | `{ show: false }`                                 |
| Move a project to the compact "All projects"  | `{ featured: false }`                             |
| Give a project a category for grouping        | `{ category: "Backend" }`                         |
| Rewrite the text with custom web copy         | `{ useAlt: true, altData: { … } }`                |
| Add an entry that isn't in the resume         | `{ useAlt: true, altData: { … } }`                |
| Rewrite an accomplishment line                | `{ altText: "…" }`                                |

Sections you don't touch render straight from `resume.tex`. Empty
sections in `projects.js` are fine.

### Full config shape

```js
window.PORTFOLIO_CONFIG = {

  sections: {
    // showEducation:       false,    // hide an entire section
    // showInternships:     false,
    // showProjects:        false,
    // showSkills:          false,
    // showAccomplishments: false,

    groupProjectsByCategory: true,    // default
    projectCategoryOrder: ["Web Development", "Backend", "Systems",
                          "AI / ML", "Cybersecurity"]
  },

  education:       { /* per-institution overrides */ },
  internships:     { /* per-title overrides */ },
  projects:        { /* per-title overrides + category */ },
  skills:          { /* per-cluster overrides */ },
  accomplishments: { /* substring-keyed overrides */ }

};
```

### How project sections work

- **Selected work** holds every project from your resume by default,
  rendered as full editorial cards.
- **All projects** is a compact list reserved for projects you've
  explicitly demoted (`featured: false`). When nothing is demoted, the
  whole section hides itself — no empty section, no placeholder copy.
- If `groupProjectsByCategory: true` and your projects have `category`
  fields, **both sections split into category groups**. The grouping
  preserves the `projectCategoryOrder` you set, with anything else
  appended at the end.

### Examples

**Hide an entry**
```js
education: {
  "Campion School Bhopal": { show: false }   // skip primary school on the web
}
```

**Move a project to the compact "All projects" list**
```js
projects: {
  "Some Old Project": { featured: false, category: "Misc" }
}
```

**Override a resume entry with richer web copy**
```js
projects: {
  "JSON API server": {
    category: "Backend",
    useAlt:   true,
    altData: {
      title:   "JSON API Server",
      role:    "Containerised Flask service",
      summary: "A small REST API over Postgres — one `docker compose up`.",
      stack:   ["Flask", "Python", "PostgreSQL", "Docker"]
    }
  }
}
```

**Add a project that isn't in the resume (web-only)**
```js
projects: {
  "Portfolio Site": {
    category: "Web Development",
    useAlt:   true,
    altData: {
      title:   "This portfolio",
      summary: "The site you're looking at — parses my LaTeX resume on load.",
      stack:   ["HTML", "CSS", "Vanilla JS"],
      links:   [{ label: "GitHub", url: "https://github.com/RishabhSahuIIIT/RishabhSahuIIIT.github.io" }]
    }
  }
}
```

**Rewrite an accomplishment**
```js
accomplishments: {
  "GATE":     { altText: "GATE CS/IT 2024 — 95.4 percentile (top ~5%)" },
  "N.T.S.E.": { show: false }   // substring must match the literal text
}
```

### Grouping projects by category

Default is on. Just tag each project:
```js
projects: {
  "JSON API server":            { category: "Backend" },
  "Wine Classifier …":          { category: "AI / ML" }
}
```

Both "Selected work" and "All projects" split into labelled groups
following `sections.projectCategoryOrder`. Categories not in that list
appear after the ordered ones, in encounter order. Uncategorized
projects land in "Other".

## Palette variants

Four CSS files are shipped, each a complete stylesheet with tuned tokens
baked in. Pick one as your `style.css`:

| File                     | Palette        | Light offset | Dark offset |
|--------------------------|----------------|--------------|-------------|
| `style-rust-cream.css`   | Rust on cream  | −26          | +7          |
| `style-aegean-clay.css`  | Aegean clay    | −7           | +11         |
| `style-forest-green.css` | Forest green   | −7           | +11         |
| `style-day-night.css`    | Day & Night    | −24          | +11         |

Offsets are HSL **lightness** percentage points applied to `--bg`,
`--bg-soft`, and `--rule`. Other tokens (`--ink`, `--accent`) stay
fixed so the palette's character is preserved while the surface
brightness tunes to taste.

To tweak further, edit `generate-palettes.js` and rerun:
```bash
node generate-palettes.js
```

## Legibility

Small metadata text (mono labels, section numbers, stack tags) is set at
**13.5–14 px with weight 500**, up from the earlier 10.5–12.5 px @ 400.
Significantly more readable, especially on the muted backgrounds.

## Local preview

`fetch()` won't work over the `file://` protocol — run a local server:

```bash
cd RishabhSahuIIIT.github.io
python3 -m http.server 8000
# visit http://localhost:8000
```

On GitHub Pages this is a non-issue.

## What the parser understands

The parser is tuned to *your* `resume.tex` patterns:

- `\section*{Name}` — top-level sections
- `\subsection*{Title}` — projects
- `\textbf{Keywords: …}` + `\hfill \href{URL}{…}` — project/intern metadata
- `\begin{itemize} … \end{itemize}` — bullets
- LaTeX comments (`%`) are stripped, so commented-out projects don't render.

If you change those patterns significantly, the parser may need
adjustments in `script.js` (`parseEducation`, `parseInternships`,
`parseProjects`, `parseSkills`).

## Deploy

```bash
git add .
git commit -m "Update content"
git push
```

Make sure `resume.tex` is committed and not in `.gitignore`.
