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
<http://localhost:8000/preview> (see "Device preview" below). To see exactly
what a visitor gets, with no editor loaded, open <http://localhost:8000/live>.

The site fetches `assets/resume.tex` over HTTP, so opening `index.html` via `file://`
won't work — you need a local server (or GitHub Pages).


## What's in the folder

| File | Purpose |
|---|---|
| `index.html` | Page shell with mount points the renderer fills in |
| `style.css` | Default palette (rust-on-cream by day, violet by night) |
| `style-*.css` | Nine alternate palettes, generated from `style.css` (see "Colour palettes") |
| `script.js` | LaTeX parser, renderer, project explorer, project diagrams, console helpers |
| `site-config.json` | Everything visual, written by the editor: colours, sizes, hidden items, course labels, media choices, and the skill symbols the page shows |
| `editor.js` | **Dev only.** Visual editor + the full icon catalogue (skill symbols, emoji, optional brand logos). Loaded only on localhost — visitors never fetch it |
| `theme-init.js` | Runs in `<head>` before paint — applies stored theme and `?style=` |
| `projects.js` | User-edited config (featured projects, section toggles) |
| `assets/resume.tex` | Source of truth for all resume content |
| `dev_server.py` | **Dev only.** Local server: style swapping, palette generator, device preview, visitor view, config save/revert |
| `HANDOFF.md` | Diagnosis notes from earlier debugging, plus a short architecture sketch |

The page runs top to bottom as: intro, About, Skills, Experience, Selected
work, All projects, Education, Courses, Recognition, Contact. The order is the
order of the `<section>` blocks in `index.html`; move a block to move a section.


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

### Courses

Two tiers, because 60 courses in the PDF would add roughly 1.4 pages and put
VALUE EDUCATION next to COMPILERS.

**Selected courses** are `\item` entries in `\section*{Courses}` — these
appear in the PDF *and* lead the site's Courses section:

```latex
\item \textbf{Compilers:} Lexing, parsing, semantic analysis and LLVM IR
      generation; dataflow-based optimisation passes [IIIT Hyderabad]
```

The bracketed tail is `[Source | Domain | featured]` — source and domain are
stripped out before display and used for grouping — degree coursework and online courses end up under separate headings,
in the order the sources first appear in the file.

One gotcha: the parser splits the name from the description at the first
colon, so a course name containing a colon needs an em-dash instead —
`\textbf{Robotics --- Planning and Navigation:}` rather than
`\textbf{Robotics: Planning and Navigation:}`. LaTeX renders `---` as an
em-dash and the site converts it to one too.

**Everything else** lives in a `courses:` comment block directly beneath —
invisible to LaTeX, parsed by `script.js`, one course per line in the same
`Name: description [Source]` shape:

```latex
\begin{comment}
courses:
Deep Learning: Neural architectures, backpropagation, training dynamics [LNMIIT Jaipur]
Theory of Computation: Automata, formal languages, decidability [LNMIIT Jaipur]
\end{comment}
```

Add `| featured` to promote a course into the Selected block, and `| minor`
to mark lighter-weight coursework. The domain is whichever pipe-separated
value is neither flag; it drives the grouping on the site and should match
one of the names in `courses.domainOrder` in `site-config.json` (anything
unrecognised sorts to the end).

```latex
Blockchain: Consensus, smart contracts, Solidity [IIIT Hyderabad | Distributed & Parallel | minor]
```

Note that `&` must be escaped as `\&` in the `\item` lines — LaTeX reads a
bare `&` as an alignment tab. The comment block needs no escaping, since
LaTeX never parses it.

**Order inside a description matters.** Before a course is expanded the
site shows only the lead of its description: the first clause (up to a
semicolon), capped at about nine words and trimmed back to a whole
comma-separated entry. So put what you most want read first, and a semicolon
where that headline part ends:

```latex
\item \textbf{Compilers:} LLVM IR generation, optimisation passes written in C++,
      dataflow analysis; lexing, parsing, semantic analysis [IIIT Hyderabad | Compilers | featured]
```

shows as "Compilers — LLVM IR generation, optimisation passes written in
C++…" until it is opened.

**How the section renders.** *Selected coursework* comes first, always
open, and it is the colourful part: each card is filled with a colour of its
own, the next hue round the colour wheel in the order the cards appear. By
default the colours are deep and the text on them is white, at about 6:1.
In dark mode the same hues are a step lighter and slightly less saturated
(white text about 5:1): a deep colour sits closer to a dark page, so it
needs the lift to stand apart, and full saturation glares against black.
The type is set larger and heavier than on a plain card (name 15.5px
bold, description 13px medium), because type on a colour has to work harder
than type on the page. The wheel is not used whole: a deep yellow is olive,
a deep orange is rust and a deep lime is moss, so the cards run from green
round through blue and purple to red and leave out everything between.
`courses.featuredInk: "dark"` gives the other treatment, dark text (at
least 5.5:1) on brighter colours; there orange and amber are kept, at their
own brightness rather than darkened to match the others. (Category outlines
skip yellow and orange too: a thin line cannot be that light and still show
on a pale page.) These colours
say nothing about category; anyone who wants categories has the index
beneath, which is deliberately quieter, its labels plain boxes edged in
their category colours. When a
self-directed course is featured too, that block splits in two
with a vertical rule between: **University** on the left, **Self-directed**
on the right (on phones and narrow windows the two stack, the rule turning
horizontal). Below it, one row per category: the category name on the left, its
courses on the right, each with that lead. A line marked **+** has more:
click or tap the line and the full description opens beneath it, in place.
(Clicking the category label on a wide screen opens the whole category as
cards instead.) Three rules shape the rows:

- **Category labels** come in three styles, set by `courses.labelStyle`:
  `"outline"` (the default: a plain box edged in the category's own hue),
  `"box"` (filled with it) or `"text"` (the name alone in that hue). All
  boxes are the same width. On a filled box or card the ink is picked by
  whichever of light or dark text gives the higher contrast, so it stays
  readable in every palette.
- **Featured cards** are each filled with their own colour
  (`courses.featuredStyle: "colour"`, the default) or left plain
  (`"plain"`). Their text is white on deep colours
  (`courses.featuredInk: "light"`, the default) or dark on brighter ones
  (`"dark"`). All three choices have switches in the editor under Courses.
- **`minor` courses** drop into a quieter second set of rows at the bottom,
  uncoloured. Those rows are not labelled as second-tier: `courses.altNames`
  gives each a neighbouring name for the same territory (for example
  "Systems & Networking" becomes "Operating Environments").
- **Online courses** (the source mentions Educative, NPTEL, Coursera, Udemy,
  edX or "online") sit in their own block after the degree coursework,
  grouped by provider.

On phones each category collapses to its heading; tapping it lists the
courses, and tapping a course opens its description. The Selected
coursework titles stay visible above as compact names; tapping one, or the
heading, opens their descriptions.
Everything that opens on a tap says so: headings, category labels and the
Selected coursework names carry a small chevron, and a course line with more
to read has a ringed **+** at its right edge that turns to **−** when open.

**Course links and certificates.** Any course can point at its course page
or certificate, and show the certificate itself in a popup. Two optional
entries in the bracketed tail of a comment-block line:

```latex
Working with Containers: Docker, Docker Compose and Swarm [Educative.io | Software Engineering | featured | link=https://www.educative.io/verify-certificate/...]
Some Course: what it covered [Coursera | AI & Machine Learning | cert=cert-some-course.pdf]
```

| Entry | What it is | How it shows |
|---|---|---|
| `link=` | The course page, or the certificate's own verification page | A link on the course: "Verify certificate" when the address mentions a certificate, otherwise "Course page" |
| `cert=` | An image or PDF of the certificate: a file in `assets/`, or a direct link to one | A **View certificate** button that opens it in a rectangle over the page |
| `popup=page` | Show the `link=` page in the popup instead of a file | The same button, with the page in a frame |

The popup shows an image as an image and anything else (a PDF, an
embeddable page) in a frame. Nothing is downloaded until it is opened, Esc
or a click outside closes it, and **Open in new tab** is always there:
phones often won't draw a PDF inside a page, and some sites refuse to be
framed at all.

`assets/cert-demo.svg` is a placeholder so the popup can be seen working:
the Docker course points at it. Replace the file, or change the name after
`cert=` to your own image or PDF.

**Showing the certificate page instead of a file.** With `popup=page` (or
**Popup shows: link page** in the editor) the button opens the page at
`link=` inside the popup. Whether that works is up to the other site: many
send a header (`X-Frame-Options`, or a `frame-ancestors` rule) telling
browsers not to show them inside another page, and the frame then simply
stays blank. A script on the page cannot detect that, so the popup always
carries an "open it in a new tab" line beneath a framed page, and the
editor's **check page** button asks the dev server to read those headers and
tells you beforehand whether the page will show. The framed page is
sandboxed, so it cannot navigate your site away.

The same two can be set from the editor instead: right-click the course and
fill in **Link**, **Certificate** and **Popup shows** (stored in
`courses.links` in `site-config.json`, which wins over the line in
`resume.tex`). There,
**fetch into assets** downloads the image or PDF at a link into your image
folder, so the site shows its own copy instead of depending on that link;
the dev server checks that what came back really is an image or a PDF
(15 MB at most) before saving it as `cert-<course>.<type>`. Commit the file
with the site. Use `link=` / `cert=` in the comment block only, not on the
`\item` lines: a `%` or `#` in an address would break LaTeX there.

**Courses in the PDF.** The same `\item` lines feed the PDF, and three
settings near the top of `resume.tex` (under *COURSES IN THE PDF*) decide
what it prints:

| Setting | Effect |
|---|---|
| `\pdfcoursesfeaturedonlytrue` / `false` | Print only the lines flagged `featured`, or every `\item` line |
| `\renewcommand{\pdfcoursestyle}{full}` | Name and the whole description |
| `\renewcommand{\pdfcoursestyle}{brief}` | Name and the description up to its first semicolon |
| `\renewcommand{\pdfcoursestyle}{names}` | Names only, run together on a line or two |
| `\pdfcoursessourcetrue` / `false` | Print or drop "(IIIT Hyderabad)" after each |

The bracketed `[Source | Category | flags]` tail is never printed as
written. This works through `\courselist`, the line after
`\begin{itemize}` in the Courses section: it makes `\item` read each line
apart instead of printing it verbatim (it needs the `xstring` package, part
of every TeX Live). A course in the comment block stays website-only
whatever its flags say, because LaTeX never reads a comment block.

To move a course into the PDF, cut its line from the comment block
and add it as an `\item` — the parser prefers the visible entry when a name
appears in both.

Both tiers live in `assets/resume.tex`; edit them there. To move a course
between tiers, cut its line from the comment block and add it as an `\item`
(or the reverse).

Individual courses can be hidden from the site by right-clicking the card
(stored in `media.hiddenCourses`); they stay in the PDF.

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

**Filters know what is already selected.** With nothing selected the rail
shows names only. Once any filter is on, every other filter shows a number:
how many projects you would have if you clicked it, under the current
combine mode. A filter that would leave none has its text faded; its box
and border stay as they are. It can still be clicked, but you can see
beforehand that the combination is empty.
A selected filter shows how many of the matching projects carry it. On
phones the dropdowns do the same per option, and each open dropdown states
how many projects match so far.

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


## Hiding filters and nav categories

Two lists, deliberately separate:

| Key | Controls |
|---|---|
| `filters.hidden` | Filter buttons in the All Projects rail and mobile chips |
| `filters.hiddenNav` | Domains in the top-bar **Projects** dropdown |

They're independent because they do different jobs. The dropdown is a short
table of contents and usually wants trimming hard; the rail is a working
tool, where you may still want to filter by a domain you've kept out of the
menu. Set `filters.navFollowsFilters: true` if you'd rather the dropdown
inherit the rail's hidden list too.

**From the editor:** right-click any filter button. A domain gives you two
switches — **In filter rail** and **In nav dropdown**. Hidden filters are
listed as restore chips in the same panel, since a hidden button can't be
right-clicked back.

**From `site-config.json`**, keyed `"<type>:<value>"`:

```json
"filters": {
  "hidden": {
    "tech:iptables": true
  },
  "hiddenNav": {
    "domain:Data Structures": true,
    "domain:Optimization": true
  },
  "navFollowsFilters": false
}
```

Types are `domain`, `tech` and `status`. Only `domain` appears in the nav.

Worth being clear about the limits: hiding removes the *button* or the menu
entry, nothing else. Every project stays visible and keeps its chips — a
project tagged "Optimization" still shows that chip on its card. To remove a
domain from the site entirely, edit the `topics:` lines in
`assets/resume.tex`, which is the source all three views derive from.


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

A featured project shows its one-line description by default. **Details**
swaps that line for the bullet points, and **Summary** swaps back: the two
say the same thing at different lengths, so only one is on screen at a
time. A project that has only one of the two simply shows it.

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
they stay as image files rather than being bundled into `editor.js`.

A skill card can also show a project's **official icon file** in place of its
symbol: right-click the card and fill in **Icon file** (and **Night file**, if
the project publishes a version for dark backgrounds). Stored in
`media.iconFiles`, shown exactly as published, never recoloured.


## Skill symbols

Every card in the Skills section, and the small mark beside a keyword on a
project card, is a **symbol for what the tool does**, not the tool's logo: a
cylinder for a database, a branch for Git, stacked containers for Docker.
Programming languages can't be told apart by a picture, so they get a file
badge carrying their extension (`py`, `rs`, `java`). One line weight, one
colour (the theme accent), one size.

Two rules decide a symbol: it says what the tool does (no plays on the
tool's name), and no two cards share a silhouette.

**Where things live**

| What | Where | Who downloads it |
|---|---|---|
| All 40 drawings (`ICON_CATALOG.symbols`) | `editor.js` | nobody but you |
| Tool-to-symbol rules (`ICON_CATALOG.symbolFor`) | `editor.js` | nobody but you |
| The drawings and rules *this resume uses* (`symbols.defs`, `symbols.map`) | `site-config.json` | visitors |
| Per-card choices (`media.cardSymbols`) | `site-config.json` | visitors |

The editor rewrites the visitor subset on every **Save**, so a symbol the
page doesn't show is never downloaded. If the resume gains a tool, the editor
notices on load and asks you to Save.

**Changing a card.** Right-click it:

- **Show as** icon / text
- **Symbol** — pick any drawing, or **auto** for the built-in choice
- **badge** — type a file extension (up to five characters) for a file badge
- **Icon file** / **Night file** — an official logo file instead (see Images)

**Adding a tool.** Add a line to `symbolFor` in `editor.js`. Keys are the
tool's name in lower case with spaces and punctuation removed, so
`'nodejs'` matches "Node.js":

```js
redis: 'cylinder',      // an existing drawing
kotlin: 'ext:kt',       // a file badge
```

**Adding a drawing.** Add an entry to `symbols` in `editor.js`: the inner SVG
for a `0 0 24 24` viewBox, outlines only. The wrapper supplies
`fill="none" stroke="currentColor" stroke-width="1.75"` with round caps and
joins, so a drawing is just shapes:

```js
'queue': '<rect x="3" y="5" width="18" height="4" rx="1"/><rect x="3" y="15" width="18" height="4" rx="1"/>',
```

**Brand logos instead.** The editor's **Skill icons** switch (symbols / brand
logos) swaps the whole site to the logo catalogue. That catalogue is written
into `site-config.json` only while the switch is on brand logos (about 10 KB
compressed); in symbol mode visitors never download it. Logos are other
people's trademarks and most brand guidelines forbid recolouring them, which
is why symbols are the default. A tool with neither a symbol nor a logo
simply shows its name.


## Project diagrams and media

Each showcased project (and the internship) carries a diagram that explains
what it does: terminal tools show their commands wired to the stage each one
drives, web tools show the clicks, and every flow ends on its real output.
They are inline SVG inside `script.js` (`PROJECT_DIAGRAMS`), so they cost no
extra requests and stay sharp at any size.

Three versions of each are written into the page and CSS shows one by screen
width, with no script involved:

| Version | Shape | Used |
|---|---|---|
| wide (`PROJECT_DIAGRAMS`) | horizontal flow, about 640 wide | desktop |
| narrow (`PROJECT_DIAGRAMS_MOBILE`) | recomposed top-to-bottom, 360 wide | an opened card on a phone |
| thumb (`PROJECT_DIAGRAMS_THUMB`) | one shared 3:1 strip | a collapsed card on a phone |

Diagrams are matched to a project by a keyword in its title
(`intrusion`, `agentic`, `citestat`, `crdt`, `cris`), case-insensitively, so
a title can be reworded without breaking the link. Colours inside the
diagrams are remapped per theme in `style.css`, so they hold their contrast
on light and dark backgrounds.

Settings, all under `media` in `site-config.json` and all editable from the
editor's **Project diagrams** group:

| Key | Values | Effect |
|---|---|---|
| `diagramPlacement` | `wide` (default), `beside`, `below`, `top`, `toggle` | Where the diagram sits relative to the text. `toggle` hides it behind a "How it works" control |
| `featuredMedia` | `image` (default), `gif`, `both` | Show the diagram, a GIF, or both |
| `mediaMode["<title>"]` | same three | Override for one project |
| `gifs["<title>"]` | filename in `assets/` | The GIF for that project. `.mp4` and `.webm` play like a GIF at a fraction of the size |
| `showDiagrams` | `true` / `false` | All diagrams on or off |
| `hiddenDiagrams["<title>"]` | `true` | Hide one |

A project with no GIF yet always falls back to its diagram, so choosing
`gif` early never leaves a blank slot.


## Phones

Below 640px the page is rearranged rather than shrunk:

- **Menu.** The top-bar links fold into a menu button; the day/night toggle
  stays in the bar.
- **Selected work.** The four featured projects stack as full-width rows:
  diagram strip, title, then the one-line description (two lines of it on
  tall phones, one on short ones), sized so all four fit on one screen with
  no frames or padding. Tap one to open it, which swaps the description
  for the bullet points; **Less** closes it.
- **All projects.** Each card collapses to one line plus a **More** toggle.
  Turn this off with `media.mobileCollapse: false`.
- **Courses.** Categories collapse to their headings, and each course opens
  on a tap (see Courses above).
- **Skills.** Three cards to a row.
- **Internship.** Its diagram is sized so the diagram, title and dates fit
  on one screen.

The 860px breakpoint described under "The All Projects section" is separate:
it switches the filter rail to dropdowns.

Phones can also have their own text size and spacing: `sizes.phone.textScale`
and `sizes.phone.density` in `site-config.json`, applied below 640px only and
set from the editor's **Phone text size** / **Phone density** sliders. Left
unset, phones use the general values.


## Page weight

Measured against the visitor view (`/live`), gzip-compressed:

| File | Size |
|---|---|
| `script.js` | 65 KB |
| `style.css` | 28 KB |
| `assets/resume.tex` | 16 KB |
| `site-config.json` | 5 KB |
| `index.html`, `projects.js`, `theme-init.js` | 7 KB |
| **Total, 7 requests** | **about 121 KB** |

On a throttled slow-4G connection with a 4x CPU slowdown, the first paint
comes at about 0.8 s and the resume content is on screen at about 1.6 s.
Those figures are from a copy served with gzip, as GitHub Pages serves it;
`dev_server.py` sends files uncompressed, so timing a load against it reads
about twice as slow and says nothing about the live site. First paint waits
only for `style.css`, so that file's size is the one that matters most.
`editor.js` (the largest file in the folder) is never requested by
a visitor. Three habits keep it this way: images load lazily, anything only
the editor needs stays in `editor.js`, and `site-config.json` carries only
what the page shows.


## Colour palettes

Every stylesheet holds a matched light and dark pair.

- `style.css` — rust on cream by day, violet by night (default)
- `style-rust-cream.css` — same, named explicitly
- `style-aegean-clay.css` — muted blue on warm sand
- `style-forest-green.css` — deep green on stone
- `style-day-night.css` — high-contrast sun and midnight
- `style-ink-vermilion.css` — near-black ink with a vermilion accent
- `style-nordic-frost.css` — cool grey-blue
- `style-olive-sand.css` — olive on sand
- `style-rose-plum.css` — rose and plum
- `style-graphite-cobalt.css` — neutral graphite with a cobalt accent

To change the deployed default, edit the stylesheet link in `index.html`:

```html
<link id="main-style" rel="stylesheet" href="style-aegean-clay.css">
```

The `style-*.css` files are generated from `style.css`: each palette supplies
five anchor colours per theme (background, ink, accent, rule, muted) and the
generator derives the rest. Every generated colour is then checked against
its background with the WCAG contrast formula and nudged until it passes
(body text 7:1, muted text and accents 4.6:1, cards visibly separate from the
page), so a new palette can't ship unreadable text. After any edit to
`style.css`, regenerate them:

```
dev> palettes
```

(or from a script: `python3 -c "import dev_server; dev_server.generate_palettes()"`)

**Theme identity.** Each stylesheet starts with an identity line, and the
same values as CSS variables:

```css
/* theme-id: nordic-frost   hash: fc4efcc3 */
:root { --theme-id: "nordic-frost"; --theme-hash: "fc4efcc3"; }
```

Colour changes made in the editor are stored under that id
(`colors.themes["nordic-frost"].light` / `.dark` in `site-config.json`), so
an override made for one stylesheet never leaks into another. The hash is a
fingerprint of the stylesheet's colour values: if you later edit those by
hand, the editor warns that the saved overrides were made against an older
version.


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
| Attribute selectors on SVG (`[fill="#..."]`) | Re-colour the inline project diagrams per theme without duplicating them | [MDN](https://developer.mozilla.org/en-US/docs/Web/CSS/Attribute_selectors) |
| Small-viewport units (`svh`) with `min()` | Size the phone project rows so four fit one screen, toolbars included | [MDN](https://developer.mozilla.org/en-US/docs/Web/CSS/length#relative_length_units_based_on_viewport) |
| `currentColor` | Skill symbols take the theme accent from CSS, so one drawing serves every palette | [MDN](https://developer.mozilla.org/en-US/docs/Web/CSS/color_value#currentcolor_keyword) |
| `<details>` / `<summary>` | The "How it works" diagram toggle, with no script | [MDN](https://developer.mozilla.org/en-US/docs/Web/HTML/Element/details) |
| `<dialog>` with `showModal()` | The certificate popup: the browser supplies the backdrop, focus trapping and Esc-to-close | [MDN](https://developer.mozilla.org/en-US/docs/Web/HTML/Element/dialog) |
| `-webkit-line-clamp` | Cuts the phone cards' summary line to one or two lines with an ellipsis | [MDN](https://developer.mozilla.org/en-US/docs/Web/CSS/-webkit-line-clamp) |
| Height media queries (`max-height`) | Short phones get one summary line and tighter gaps so four cards still fit | [MDN](https://developer.mozilla.org/en-US/docs/Web/CSS/@media/height) |

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
| WCAG relative luminance | Three uses: the palette generator's contrast checks, the ink colour on each course-category box, and (in brand-logo mode) nudging a logo's colour until it is legible on the page | [W3C](https://www.w3.org/WAI/GL/wiki/Relative_luminance) |
| Inline SVG built from strings | Skill symbols and project diagrams: no image requests, sharp at any size | [MDN](https://developer.mozilla.org/en-US/docs/Web/SVG/Tutorial/SVG_In_HTML_Introduction) |
| `SVGGraphicsElement.getBBox()` | Trims each diagram's viewBox to its drawn content so none carries blank margins | [MDN](https://developer.mozilla.org/en-US/docs/Web/API/SVGGraphicsElement/getBBox) |
| `getComputedStyle()` on custom properties | Reads `--theme-id` / `--theme-hash` to know which stylesheet is active | [MDN](https://developer.mozilla.org/en-US/docs/Web/API/Window/getComputedStyle) |
| Event delegation with `Element.closest()` | One listener handles every course line, card toggle and Details button, and survives re-renders | [MDN](https://developer.mozilla.org/en-US/docs/Web/API/Element/closest) |
| Same-origin `<iframe>` + CSS `transform: scale()` | The editor's phone view: a real phone-width copy of the page, enlarged without changing its layout, driven from the parent page | [MDN](https://developer.mozilla.org/en-US/docs/Web/HTML/Element/iframe) |
| TeX delimited macro arguments (`\def\item\textbf#1#2[#3]`) | Lets the PDF read a course line apart (name, description, tail) without changing how the line is written | [TeX by Topic, "Macros"](https://texdoc.org/serve/texbytopic/0) |
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
bottom-right corner — or **right-click anywhere on the page** — to open the
editor. It is docked to the right edge, so it never covers what you're
editing, and is organised into five tabs:

| Tab | Holds |
|---|---|
| **Inspect** | Whatever you right-clicked: a preview of that whole area (a card, a course row, a project), the colours it uses, and its own options |
| **Look** | Palette, colours, sizes, skill icons |
| **Content** | Text overrides, images, project diagrams and media |
| **Visibility** | Hidden sections, cards, courses and filters, with restore chips |
| **Source** | The matching lines of `resume.tex`, opened at the right place for editing |

**Phone view.** The **phone view** button at the top of the editor swaps
the page area for a phone-width copy of the site, so the phone layout can be
edited from the desktop without going to `/preview`. It is a real copy at
that width, so every phone rule and tap behaviour is the genuine one.

- **device** picks the phone's size; **size** shows it at 100% to 200%, or
  fitted to the window. Enlarging changes only how big it is drawn, not the
  layout, so small items are easier to hit. **tall** stretches the phone to
  the window height to show more of the page at once.
- **Right-click anything in the phone** and Inspect opens for it, exactly as
  on the desktop page. Clicks work as taps.
- Edits made in the editor show in the phone straight away, unsaved ones
  included; open cards stay open. Theme and palette follow the editor.
  **reload** loads the phone again from the files on disk.
- **back to desktop** returns to the normal page. The choice of view,
  device and size is remembered.

`/preview` is still the place for comparing device frames side by side at
true physical size; phone view is for editing.

Across those tabs it covers:

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
  search over the whole catalogue (kept inside `editor.js`). Three distinct
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
- **Size** — text scale and spacing sliders, globally, plus a separate pair
  for phones (below 640px) with a "same as desktop" reset
- **Per-section text** — an independent scale for each section
- **Skill cards** — icon or text, which symbol, a file badge, or an official
  icon file (see "Skill symbols")
- **Courses** — outline, box or text category labels; coloured or plain
  featured cards; hide a course; give a course a
  link and a certificate, and download a certificate file into `assets/`
- **Project diagrams** — placement, image / GIF / both, per-project GIF file

**Colour rows say what they do.** Each row names its role ("card
background", "accent", "hints") rather than only its variable. When you
right-click an item, Inspect lists the colours that item actually uses.
Hovering or clicking a row outlines every place on the page that uses the
colour.

**Changed colours are marked.** A row whose value differs from the
stylesheet shows a **changed** badge, the stylesheet's own value beside it,
and a reset button that returns it to the stylesheet default. A summary line
counts the overrides for the active stylesheet and offers reset-all.

Changes preview live. **Save** writes `site-config.json` and snapshots the
previous version into `.site-config-backups/`; **Revert** restores the newest
snapshot and reloads. From the CLI, `config` prints the current values and
`revert` does the same restore.

`index.html` loads `editor.js` only when the page is served from a local
address (`localhost`, `127.0.0.1`, `192.168.*`), so on the hosted site the
file is never requested. Force it with `?editor=1`, suppress it with
`?editor=0`, or turn it off from the CLI with `editor off`.

**Save keeps the visitor file lean.** On every Save the editor rewrites the
skill-symbol subset to match the resume, and leaves the brand-logo catalogue
out unless Skill icons is set to brand logos.

Colour edits apply to whichever theme is active (light or dark), and are
stored separately per theme *and per stylesheet* in `site-config.json`
(see "Theme identity" under Colour palettes).


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

### Missing fonts

The resume asks for **Linux Libertine O** (text) and **Libertinus Math**
(maths). If either is absent you'll see a run of:

```
Package fontspec Error: The font "Libertinus Math" cannot be found.
```

These are **non-fatal** — check the end of the log and you'll usually find
`Output written on resume.pdf (4 pages)`. The document contains no maths, so
the missing maths font changes nothing visible. But the noise buries real
errors, so the preamble now guards both with `\IfFontExistsTF` and falls back
to TeX Gyre Termes / Latin Modern Math, which ship with every TeX Live.

To get the intended faces:

```bash
# Debian / Ubuntu
sudo apt install fonts-linuxlibertine fonts-libertinus

# any TeX Live
tlmgr install libertinus-fonts libertine
```

Verify with `fc-list | grep -i libertin`.


## Live style preview

Three ways to try a palette without editing files.

### 1. CLI (server-wide)

```
dev> list
  aegean-clay         ->  style-aegean-clay.css
  day-night           ->  style-day-night.css
  forest-green        ->  style-forest-green.css
  graphite-cobalt     ->  style-graphite-cobalt.css
  ink-vermilion       ->  style-ink-vermilion.css
  nordic-frost        ->  style-nordic-frost.css
  olive-sand          ->  style-olive-sand.css
  rose-plum           ->  style-rose-plum.css
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
"Projects" disappears. On phones the same links live in the menu button.


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

**The PDF prints `[IIIT Hyderabad | Compilers | featured]` after each
course.** `\courselist` is missing from the line after `\begin{itemize}` in
the Courses section, so the lines print as written.

**LaTeX says "perhaps a missing \item" in Courses.** No course line
qualified: with `\pdfcoursesfeaturedonlytrue`, at least one `\item` line
must carry the `featured` flag.

**The certificate popup is blank.** The file is a PDF on a phone (use
**Open in new tab**), or the popup is set to show a web page that refuses to
be shown inside another site (the editor's **check page** tells you). An
image or PDF in **Certificate** always works, and "fetch into assets" makes
a local copy of one.

**Skill cards show names but no symbols.** `site-config.json` has no
`symbols` block, usually because an older copy of the file was restored.
Open the site through `dev_server.py`; the editor reports "Skill symbols
updated to match the resume" — press **Save**.

**A new skill shows as text.** Nothing in `symbolFor` (in `editor.js`)
matches its name. Add a line there, or right-click the card and pick a
symbol.

**Editor warns the stylesheet changed since colours were saved.** The
stylesheet's colour values were edited after the overrides were made, so the
hash no longer matches. The overrides still apply; reset them if they no
longer suit the new base colours.


## Credits and sources

Nothing on the page is loaded from a third party: no CDN, no web fonts, no
analytics. What was drawn on, and from where:

| Part | Source |
|---|---|
| **Skill symbols** (all 40, and the file badge) | Original drawings made for this site. The *style* follows the convention popularised by the open icon sets [Feather](https://feathericons.com) and [Lucide](https://lucide.dev): a 24-unit grid, outlines only, a 1.75 stroke, round caps and joins. Lucide icons were used on the page briefly during development and then replaced, and several *ideas* are the standard ones those sets (and most interface icon sets) share: a cylinder for a database, a branch for version control, a chip for a compiler target, a speech bubble for a chat assistant, a magnifier for search, a globe for HTTP, a brick wall for a firewall. No paths were copied, so no icon-set licence applies. The file-extension badge borrows the familiar idea of file-type icons in editors and file managers |
| **Project diagrams** | Original, drawn for these projects. They use ordinary flowchart and terminal-mock-up conventions; no template or diagram library |
| **Brand logos** (optional mode, off by default) | Path data from [Simple Icons](https://simpleicons.org) (CC0), kept in `editor.js`. The marks themselves belong to their owners |
| **Typefaces** | System font stacks by default. `style.css` has a commented-out block for [Fraunces](https://github.com/undercasetype/Fraunces), [Manrope](https://github.com/sharanda/manrope) and [JetBrains Mono](https://github.com/JetBrains/JetBrainsMono) (all SIL Open Font License) if you add the files to `/fonts` |
| **Contrast rules** | The [WCAG 2](https://www.w3.org/TR/WCAG21/#contrast-minimum) relative-luminance and contrast-ratio formulas, implemented directly in `dev_server.py` and `script.js` |
| **Platform features** | Looked up on [MDN](https://developer.mozilla.org/); each one is linked in "How this site works" |
| **Device preview** | Viewport sizes are the manufacturers' published CSS-pixel dimensions. 1:1 calibration uses the ISO/IEC 7810 ID-1 card width (85.6 mm) |
| **Palettes, layout, parser** | Written for this site; no theme, template or framework |

The symbols, diagrams and much of the code were produced with the help of
Claude, Anthropic's AI assistant, working to my direction.
