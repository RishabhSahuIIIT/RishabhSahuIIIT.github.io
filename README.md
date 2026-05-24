# RishabhSahuIIIT.github.io
Github pages site
# Rishabh Sahu — Portfolio

A single-page personal portfolio. No build step, no framework, no external CDNs — just static files that GitHub Pages serves directly.

## Files

```
RishabhSahuIIIT.github.io/
├── index.html      ← page markup
├── style.css       ← all styling (light + dark themes)
├── projects.js     ← project data (edit this most often)
├── script.js       ← rendering + scroll reveal (engine; rarely touched)
└── README.md
```

## Where to edit what

| What you want to change                              | Open                                |
| ---------------------------------------------------- | ----------------------------------- |
| Add a project, promote/demote one, fix a typo in one | `projects.js`                       |
| Bio, internship, skills, education, contact          | `index.html`                        |
| Colours, fonts, spacing                              | `style.css` → `:root` at the top    |
| How a project card looks                             | `style.css` → sections 8 & 9        |
| Anything else                                        | `style.css` is sectioned & labelled |

## Adding or moving projects

Open `projects.js`. Each project is an object in the `window.PROJECTS` array:

```js
{
  id: "my-project",
  title: "My Project",
  featured: true,                     // true → Selected Work, false → All Projects
  category: "infra/backend",          // optional; great for GitLab group paths
  role: "Containerised Flask service",
  summary: "One or two sentences. Inline `code` works.",
  bullets: ["First highlight", "Second highlight"],
  stack: ["Python", "Flask", "Docker"],
  links: [
    { label: "GitHub", url: "https://github.com/..." },
    { label: "GitLab", url: "https://gitlab.com/group/subgroup/project" }
  ],
  meta: "API design\nDX · Tooling"     // small caption on featured cards
}
```

- **To add a project**: copy any existing block and edit it.
- **To promote one to Selected Work**: change `featured: false` → `featured: true`.
- **To demote one to All Projects**: the opposite.
- **To reorder**: move blocks up or down in the array.
- **GitLab group changes**: just edit the `url` and `category` fields — no schema changes needed.
- **Multiple links per project**: add as many `{ label, url }` entries as you want; each renders as a button.

Only `id` and `title` are required. Everything else is optional.

## Dark & light mode

The site reads your OS theme via `prefers-color-scheme` and switches automatically. No toggle, no JavaScript flicker — purely CSS. To tweak either palette, edit the relevant variables at the top of `style.css`:

```css
:root {
  /* Light mode palette */
  --bg:     #f3ede1;
  --ink:    #18130d;
  --accent: #b54520;
  /* ... */
}

@media (prefers-color-scheme: dark) {
  :root {
    /* Dark mode palette */
    --bg:     #14110b;
    --ink:    #ede5d3;
    --accent: #e07a45;
    /* ... */
  }
}
```

## Self-hosting fonts (optional)

The site uses system font stacks by default — no network requests, looks consistent enough across platforms. If you want the original Fraunces + Manrope typography back:

1. Download the `.woff2` files from [Google Fonts](https://fonts.google.com/?query=Fraunces) (Fraunces, Manrope, JetBrains Mono).
2. Place them in a `fonts/` folder at the repo root.
3. Open `style.css` and uncomment the `@font-face` block at the top.

Everything stays inside the repo — no CDN.

## Deploy to GitHub Pages

This repo is already a user site (`RishabhSahuIIIT.github.io`), so it deploys automatically on push to `main`. After committing:

1. Wait ~1 minute for Pages to rebuild.
2. Hard refresh the live site (`Ctrl/Cmd + Shift + R`) to bypass cache.

## Local preview

Open `index.html` in a browser — works directly via `file://` because all paths are relative.

Or run a tiny server (better, especially for cache testing):

```bash
python3 -m http.server 8000
# open http://localhost:8000
```

## Notes

- Filenames on GitHub Pages are **case-sensitive** (`Style.css` ≠ `style.css`). If styles disappear after a rename, check the `<link>` in `index.html`.
- Respects `prefers-reduced-motion` — animations are disabled for users who ask for it.
- No tracking, no analytics, no external JS at all.
