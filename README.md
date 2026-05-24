# RishabhSahuIIIT.github.io
Github pages site

# Rishabh Sahu — Portfolio

A single-page personal portfolio. No build step, no framework — drop the files onto GitHub Pages and you're live.

## Files

```
portfolio/
├── index.html   ← markup & content
├── style.css   ← all styling (edit me freely)
└── README.md
```

Fonts load from Google Fonts (Fraunces + Manrope + JetBrains Mono). Everything else is self-contained.

## Where to edit what

| If you want to change…              | Open                                   |
| ----------------------------------- | -------------------------------------- |
| Text, project copy, links, sections | `index.html`                           |
| Colours, fonts, spacing             | `style.css` → `:root` block at the top |
| Section layout, animations, hover   | `style.css` → numbered sections 4–13   |

`style.css` is split into 13 commented sections (tokens, reset, top bar, hero, etc.) so you can jump straight to what you need.

### Quick retheme

Open `style.css` and change the variables in `:root`:

```css
:root {
  --bg:      #f3ede1;   /* page background */
  --ink:     #18130d;   /* main text */
  --accent:  #b54520;   /* highlights, links, italics */
  --rule:    #c9bda4;   /* hairlines & borders */
  /* …fonts live here too */
}
```

Every colour, font and spacing token is derived from these, so one edit re-skins the whole site.

## Deploy to GitHub Pages

### Option A — User site (`username.github.io`)

1. Create a public repo named exactly `RishabhSahuIIIT.github.io`.
2. Push `index.html` and `styles.css` to the repo root on `main`.
3. Repo → **Settings → Pages** → Source: **Deploy from a branch**, Branch: `main` / `/ (root)`.
4. Open `https://RishabhSahuIIIT.github.io` in a minute or two.

### Option B — Project site (any repo)

1. Push the files to any public repo (e.g. `portfolio`) on `main`.
2. Repo → **Settings → Pages** → Source: **Deploy from a branch**, Branch: `main` / `/ (root)`.
3. Open `https://RishabhSahuIIIT.github.io/portfolio/`.

If the page 404s for a minute after enabling Pages, that's normal — give the deploy a moment.

## Local preview

Both files need to sit in the same folder. Then:

```bash
python3 -m http.server 8000
# open http://localhost:8000
```

(Opening `index.html` directly with `file://` also works — `style.css` is loaded with a relative path.)

## Notes

- Respects `prefers-reduced-motion` — animations are disabled for users who ask for it.
- Fully responsive down to mobile widths.
- No tracking, no analytics, no external JS beyond the fonts.
