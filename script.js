/* ============================================================
   script.js — engine
   --------------------------------------------------------------
   Fetches assets/resume.tex, parses it, and renders every
   data-driven section of the portfolio. Per-project overrides
   come from projects.js (window.PORTFOLIO_CONFIG); visual
   settings come from site-config.json.
   ============================================================ */

(function () {
  'use strict';

  /* ----------------------------------------------------------
     Paths
     ----------------------------------------------------------
     Where the LaTeX source lives, relative to index.html. One
     constant so relocating the file is a single-line change
     instead of a hunt through the fetch call, the console
     logging and the error banner.
     ---------------------------------------------------------- */
  const RESUME_PATH = 'assets/resume.tex';

  /* ----------------------------------------------------------
     1. LaTeX parser primitives
     ---------------------------------------------------------- */

  function stripComments(text) {
    // First, remove multi-line LaTeX comment blocks so the rest of the
    // parser doesn't have to step over them:
    //   \begin{comment}...\end{comment}   (verbatim / comment package)
    //   \iffalse...\fi                     (built-in, no package needed)
    text = text.replace(/\\begin\{comment\}[\s\S]*?\\end\{comment\}/g, '');
    text = text.replace(/\\iffalse\b[\s\S]*?\\fi\b/g, '');
    // Then strip ordinary `%` line comments.
    let out = '';
    let i = 0;
    while (i < text.length) {
      if (text[i] === '\\' && text[i + 1] === '%') { out += '\\%'; i += 2; continue; }
      if (text[i] === '%') { while (i < text.length && text[i] !== '\n') i++; continue; }
      out += text[i]; i++;
    }
    return out;
  }

  /* Extract project descriptions from the RAW LaTeX, before any
     comment stripping. Two supported formats — pick whichever is
     present, multi-line block wins if both are there:

     1. Multi-line block (preferred for paragraphs)
            \begin{comment}
            description: A small backend service exposing teacher
            and course data from a Postgres database, used as a
            sandbox for Flask patterns and Docker deployment.
            \end{comment}
            \subsection*{JSON API server \hfill ...}

     2. Single line (convenient for short descriptions)
            % description: A small backend service.
            \subsection*{...}

     The scan for each subsection walks backward only to the previous
     \subsection* or \section*, so a comment can't bind to the wrong
     project. */
  /* Parse a `topics:` value into structured paths.

       "Security > Network Security; Systems Programming > Concurrency"
     becomes
       [ { domain:"Security",             leaf:"Network Security",
           path:["Security","Network Security"] },
         { domain:"Systems Programming",  leaf:"Concurrency",
           path:["Systems Programming","Concurrency"] } ]

     A path with no ">" has domain === leaf (e.g. "Compilers"). */
  function parseTopicPaths(value) {
    if (!value) return [];
    return String(value)
      .split(';')
      .map(s => s.trim())
      .filter(Boolean)
      .map(seg => {
        const parts = seg.split('>').map(s => s.trim()).filter(Boolean);
        if (!parts.length) return null;
        return {
          path:   parts,
          domain: parts[0],
          leaf:   parts[parts.length - 1]
        };
      })
      .filter(Boolean);
  }

  /* Extract per-project metadata from the LaTeX comment blocks that
     precede each \subsection*. Reads two fields:

       \begin{comment}
       topics: Security > Network Security; Systems Programming > Concurrency
       description:
       Free prose, newlines collapse to spaces.
       \end{comment}

     `topics:` is authoritative for the website's domain structure — the
     right-aligned tag on the title line only carries the leaf names, so
     the comment is the only place the full hierarchy lives.

     Returns a map keyed by project title:
       { description: "...", topics: [ {path, domain, leaf}, ... ] }        */
  /* Parse the scalar `key: value` lines that may precede `description:`
     inside a comment block. Everything before `description:` is treated as
     attributes; `description:` itself runs to the end of the block, so it
     must always come last.

       featured: true
       icon: 🛡
       image: assets/nids.png
       alt: Packet capture dashboard
       topics: Security > Network Security
       description:
       Free prose...                                                     */
  function parseAttrBlock(body) {
    const attrs = {};
    let description = null;

    const dm = /(?:^|\n)[ \t]*description[ \t]*:[ \t]*([\s\S]*)$/i.exec(body);
    const head = dm ? body.slice(0, dm.index) : body;
    if (dm && dm[1].trim()) description = dm[1].replace(/\s+/g, ' ').trim();

    head.split(/\r?\n/).forEach(line => {
      const lm = /^[ \t]*%?[ \t]*([A-Za-z][A-Za-z0-9_-]*)[ \t]*:[ \t]*(.*)$/.exec(line);
      if (!lm) return;
      const key = lm[1].toLowerCase();
      const val = lm[2].trim();
      if (!val) return;
      attrs[key] = val;
    });

    return { attrs, description };
  }

  function coerceAttr(v) {
    if (v === undefined || v === null) return v;
    const s = String(v).trim();
    if (/^(true|yes|on)$/i.test(s))  return true;
    if (/^(false|no|off)$/i.test(s)) return false;
    if (/^-?\d+(\.\d+)?$/.test(s))   return Number(s);
    return s;
  }

  /* Extract metadata from the comment blocks preceding each \section* and
     \subsection*. Sections and projects share one mechanism, so any block
     can carry `icon:`, `image:`, `alt:` and friends — not just projects.

     Returns { projects: {title -> meta}, sections: {name -> meta} } where
     meta is { attrs: {...}, description, topics: [...] }.               */
  function extractDocMeta(rawText) {
    const out = { projects: {}, sections: {} };
    const re = /\\(sub)?section\*\s*\{/g;
    let m;
    while ((m = re.exec(rawText)) !== null) {
      const isSub = !!m[1];
      const openBrace = m.index + m[0].length - 1;
      const bal = findBalancedBraces(rawText, openBrace);
      if (!bal) continue;

      const rawTitle = rawText.slice(openBrace + 1, bal.endIndex);
      const split    = splitTitleAndCategory(rawTitle);
      const title    = stripFormatting(split.name).trim();
      if (!title) continue;

      const before   = rawText.slice(0, m.index);
      const prevSub  = before.lastIndexOf('\\subsection*');
      const prevSec  = before.lastIndexOf('\\section*');
      const scanText = rawText.slice(Math.max(prevSub, prevSec, 0), m.index);

      let attrs = {}, description = null;

      /* Scan every block in the window and let later ones win — the block
         nearest the heading is the one that describes it. */
      const blockRe = /(?:\\begin\{comment\}|\\iffalse\b)([\s\S]*?)(?:\\end\{comment\}|\\fi\b)/g;
      let bm;
      while ((bm = blockRe.exec(scanText)) !== null) {
        const parsed = parseAttrBlock(bm[1]);
        Object.keys(parsed.attrs).forEach(k => { attrs[k] = parsed.attrs[k]; });
        if (parsed.description) description = parsed.description;
      }

      /* Single-line fallbacks: % key: value immediately before the heading.
         Restricted to known keys — a bare `%` comment in the preamble can
         easily look like `key: value` (e.g. "% links: 10.5pt Font") and
         would otherwise be misread as an attribute. */
      const KNOWN = ['featured', 'featuredonly', 'icon', 'image', 'alt',
                     'hide', 'topics', 'description', 'color', 'order', 'label'];
      const lineRe = /(?:^|\n)[ \t]*%[ \t]*([A-Za-z][A-Za-z0-9_-]*)[ \t]*:[ \t]*(.*?)(?=\r?\n|$)/gi;
      let lm;
      while ((lm = lineRe.exec(scanText)) !== null) {
        const key = lm[1].toLowerCase(), val = lm[2].trim();
        if (!val || KNOWN.indexOf(key) < 0) continue;
        if (key === 'description') { if (!description) description = val; }
        else if (attrs[key] === undefined) attrs[key] = val;
      }

      if (!Object.keys(attrs).length && !description) continue;

      const topicsRaw = attrs.topics || null;
      delete attrs.topics;

      const meta = {
        attrs: Object.keys(attrs).reduce((acc, k) => {
          acc[k] = coerceAttr(attrs[k]);
          return acc;
        }, {}),
        description: description || null,
        topics: parseTopicPaths(topicsRaw)
      };

      (isSub ? out.projects : out.sections)[title] = meta;
    }
    return out;
  }

  /* Back-compat wrapper — earlier code (and tests) call this for projects. */
  function extractProjectMeta(rawText) {
    const full = extractDocMeta(rawText);
    const map = {};
    Object.keys(full.projects).forEach(k => {
      const m = full.projects[k];
      map[k] = { description: m.description, topics: m.topics, attrs: m.attrs };
    });
    return map;
  }

  function findBalancedBraces(text, startIndex) {
    if (text[startIndex] !== '{') return null;
    let depth = 1;
    let i = startIndex + 1;
    while (i < text.length) {
      if (text[i] === '\\' && i + 1 < text.length) { i += 2; continue; }
      if (text[i] === '{') depth++;
      else if (text[i] === '}') {
        depth--;
        if (depth === 0) return { content: text.slice(startIndex + 1, i), endIndex: i + 1 };
      }
      i++;
    }
    return null;
  }

  function stripFormatting(text) {
    let result = String(text);
    let prev;
    do {
      prev = result;
      result = result.replace(/\\(?:textbf|textit|emph|underline|texttt)\s*\{([^{}]*)\}/g, '$1');
      result = result.replace(/\\href\s*\{[^}]*\}\s*\{([^{}]*)\}/g, '$1');
      result = result.replace(/\\fontsize\{[^}]+\}\{[^}]+\}/g, '');
      result = result.replace(/\\(?:hspace|vspace)\*?\s*\{[^}]+\}/g, '');
      result = result.replace(/\\faIcon\{[^}]+\}/g, '');
      result = result.replace(/\\rule\{[^}]+\}\{[^}]+\}/g, '');
      result = result.replace(/\\centerline\s*\{[^}]*\}/g, '');
      result = result.replace(/\\(?:selectfont|noindent|normalfont|large|Large|Huge|huge|small|footnotesize|scriptsize|tiny|normalsize|itshape|slshape|upshape|bfseries|mdseries|hfill|itemsize|enspace|quad|qquad|textbullet|par)\b/g, ' ');
      result = result.replace(/\\\\/g, ' ');
    } while (result !== prev);
    result = result.replace(/\\&/g, '&').replace(/\\%/g, '%').replace(/\\\$/g, '$')
                   .replace(/\\#/g, '#').replace(/\\_/g, '_').replace(/~/g, ' ');
    result = result.replace(/(\s)--(\s)/g, '$1–$2');
    result = result.replace(/[{}]/g, '');
    return result.replace(/\s+/g, ' ').trim();
  }

  function extractItems(itemizeContent) {
    const items = [];
    let i = 0;
    const len = itemizeContent.length;

    /* Find the next real \item, not a longer macro that merely starts with
       those characters. The resume defines \itemsize, and a plain substring
       search split it into "\item" + "size", prefixing every bullet with a
       stray "size". A control sequence ends at the first non-letter, so
       \item only counts when the next character isn't a letter. */
    const nextItemAt = (from) => {
      let k = from;
      while ((k = itemizeContent.indexOf('\\item', k)) !== -1) {
        const after = itemizeContent[k + 5];
        if (after === undefined || !/[a-zA-Z]/.test(after)) return k;
        k += 5;
      }
      return -1;
    };

    while ((i = nextItemAt(i)) !== -1) {
      let j = i + '\\item'.length;
      while (j < len && /\s/.test(itemizeContent[j])) j++;
      if (itemizeContent[j] === '[') {
        const close = itemizeContent.indexOf(']', j);
        if (close !== -1) j = close + 1;
      }
      const nextItem = nextItemAt(i + 5);
      const end = nextItem === -1 ? len : nextItem;
      const cleaned = stripFormatting(itemizeContent.slice(j, end));
      if (cleaned) items.push({ cleaned });
      i = end;
      if (i === len) break;
    }
    return items;
  }

  function findItemizeBlock(text, fromIndex) {
    fromIndex = fromIndex || 0;
    const start = text.indexOf('\\begin{itemize}', fromIndex);
    if (start === -1) return null;
    let i = start + '\\begin{itemize}'.length;
    if (text[i] === '[') {
      const close = text.indexOf(']', i);
      if (close !== -1) i = close + 1;
    }
    const end = text.indexOf('\\end{itemize}', i);
    if (end === -1) return null;
    return { content: text.slice(i, end), startIndex: start, endIndex: end + '\\end{itemize}'.length };
  }

  function findTextbfPositions(text) {
    const positions = [];
    let i = 0;
    while ((i = text.indexOf('\\textbf', i)) !== -1) {
      let j = i + '\\textbf'.length;
      while (j < text.length && /\s/.test(text[j])) j++;
      if (text[j] !== '{') { i++; continue; }
      const braces = findBalancedBraces(text, j);
      if (!braces) { i++; continue; }
      positions.push({ content: braces.content, startIndex: i, contentEnd: braces.endIndex });
      i = braces.endIndex;
    }
    return positions;
  }

  /* ----------------------------------------------------------
     2. Section-specific parsers
     ---------------------------------------------------------- */

  function parseContact(headerText) {
    const contact = {};
    const positions = findTextbfPositions(headerText);
    if (positions.length) contact.name = stripFormatting(positions[0].content);

    const hrefRe = /\\href\s*\{([^}]+)\}\s*\{([^}]*)\}/g;
    let m;
    while ((m = hrefRe.exec(headerText)) !== null) {
      const url = m[1];
      if (url.startsWith('mailto:')) contact.email = url.slice(7);
      else if (url.includes('linkedin.com')) contact.linkedin = url;
      else if (url.includes('github.com'))   contact.github   = url;
      else if (url.includes('gitlab.com'))   contact.gitlab   = url;
    }

    function valueAfterLabel(label) {
      const idx = headerText.indexOf('\\textbf{' + label);
      if (idx === -1) return null;
      const lbBrace = headerText.indexOf('{', idx);
      const lbClose = findBalancedBraces(headerText, lbBrace);
      if (!lbClose) return null;
      let start = lbClose.endIndex;
      let end = headerText.length;
      const stops = ['\\\\', '\\quad', '\\textbullet', '\\href', '\\faIcon', '}', '\n\n'];
      for (const s of stops) {
        const p = headerText.indexOf(s, start);
        if (p !== -1 && p < end) end = p;
      }
      return stripFormatting(headerText.slice(start, end));
    }

    const phone = valueAfterLabel('Phone:');
    if (phone) contact.phone = phone;
    const address = valueAfterLabel('Address:');
    if (address) contact.address = address;

    return contact;
  }

  function parseEducation(text) {
    const positions = findTextbfPositions(text);
    const entries = [];
    for (let k = 0; k < positions.length; k++) {
      const cur = positions[k];
      const nextStart = k + 1 < positions.length ? positions[k + 1].startIndex : text.length;
      const after = text.slice(cur.contentEnd, nextStart);
      const marked = after.replace(/\\hfill/g, ' ||SEP|| ').replace(/\\\\/g, ' ||NL|| ');
      const cleaned = stripFormatting(marked);
      const lines = cleaned.split('||NL||').map(s => s.trim()).filter(s => s);
      const entry = { institution: stripFormatting(cur.content) };
      if (lines.length >= 1) {
        const parts = lines[0].split('||SEP||').map(s => s.trim()).filter(s => s);
        entry.dates = parts[parts.length - 1] || '';
      }
      if (lines.length >= 2) {
        const parts = lines[1].split('||SEP||').map(s => s.trim());
        entry.degree = parts[0] || '';
        entry.score = parts[1] || '';
      }
      entries.push(entry);
    }
    return entries;
  }

  function parseProjectLikeBlock(block, title) {
    const item = { title };
    const kwMatch = /Keywords\s*:?\s*/i.exec(block);
    if (kwMatch) {
      let start = kwMatch.index + kwMatch[0].length;
      /* In the newer resume format, "Keywords:" lives in its OWN
         small bold group — e.g. `\textbf{Keywords:} Flask, ...`.
         Skip past any closing brace that immediately follows so the
         keyword scan reads the list that comes after the bold tag. */
      while (start < block.length && (block[start] === '}' || /\s/.test(block[start]))) {
        start++;
      }
      let end = block.length;
      let depth = 0;
      for (let i = start; i < block.length; i++) {
        const c = block[i];
        if (c === '\\') {
          if (block.slice(i, i + 6) === '\\hfill') { end = i; break; }
          i++; continue;
        }
        if (c === '{') depth++;
        else if (c === '}') { if (depth === 0) { end = i; break; } depth--; }
      }
      const kwText = stripFormatting(block.slice(start, end));
      item.stack = kwText.split(',').map(s => s.trim()).filter(s => s);
    }
    /* Capture EVERY \href in the block, with its visible label, so we can
       tell a repository link from a live deployment. The label is the
       second brace group and usually contains an icon macro plus bold
       text, e.g. \href{url}{\faIcon{globe}\textbf{Live demo}}. */
    const links = [];
    const hrefRe = /\\href\s*\{/g;
    let hm;
    while ((hm = hrefRe.exec(block)) !== null) {
      const urlOpen = hm.index + hm[0].length - 1;
      const urlBal = findBalancedBraces(block, urlOpen);
      if (!urlBal) continue;
      /* NOTE: findBalancedBraces returns `content` (inside the braces) and
         `endIndex` = the index just PAST the closing brace. */
      const url = urlBal.content.trim();

      // the label group immediately follows the url group
      let j = urlBal.endIndex;
      while (j < block.length && /\s/.test(block[j])) j++;
      let label = '';
      if (block[j] === '{') {
        const labBal = findBalancedBraces(block, j);
        if (labBal) label = stripFormatting(labBal.content).trim();
      }
      if (url) links.push({ url, label });
      hrefRe.lastIndex = urlBal.endIndex;
    }
    if (links.length) {
      item.links = links;
      item.url = links[0].url;                       // back-compat
      const liveLink = links.find(l => /live\s*demo|live\s*site|demo/i.test(l.label));
      if (liveLink) {
        item.live = true;
        item.liveUrl = liveLink.url;
      }
      const repoLink = links.find(l => /repos|repository|source|github|gitlab/i.test(l.label));
      if (repoLink) item.repoUrl = repoLink.url;
    }
    const itemize = findItemizeBlock(block);
    if (itemize) item.bullets = extractItems(itemize.content).map(p => p.cleaned);
    return item;
  }

  function parseInternships(text) {
    const itemizeRanges = [];
    let pi = 0;
    while (true) {
      const it = findItemizeBlock(text, pi);
      if (!it) break;
      itemizeRanges.push([it.startIndex, it.endIndex]);
      pi = it.endIndex;
    }
    const hrefRanges = [];
    const hrefRe = /\\href\s*\{[^}]*\}\s*\{/g;
    let hm;
    while ((hm = hrefRe.exec(text)) !== null) {
      const openBrace = hm.index + hm[0].length - 1;
      const bal = findBalancedBraces(text, openBrace);
      if (bal) hrefRanges.push([hm.index, bal.endIndex]);
    }
    function insideRange(ranges, idx) {
      return ranges.some(([s, e]) => idx >= s && idx < e);
    }
    const positions = findTextbfPositions(text)
      .filter(p => !insideRange(itemizeRanges, p.startIndex))
      .filter(p => !insideRange(hrefRanges, p.startIndex))
      .filter(p => !/^Keywords\s*:?/i.test(p.content));

    const internships = [];
    for (let k = 0; k < positions.length; k++) {
      const cur = positions[k];
      const nextStart = k + 1 < positions.length ? positions[k + 1].startIndex : text.length;
      const block = text.slice(cur.contentEnd, nextStart);
      const intern = parseProjectLikeBlock(block, stripFormatting(cur.content));
      const hfillIdx = block.indexOf('\\hfill');
      if (hfillIdx !== -1) {
        let end = block.length;
        const stops = ['\\\\', '\\vspace', '\\noindent', '\\begin', '\n\n'];
        for (const s of stops) {
          const p = block.indexOf(s, hfillIdx + 6);
          if (p !== -1 && p < end) end = p;
        }
        intern.dates = stripFormatting(block.slice(hfillIdx + 6, end));
      }
      internships.push(intern);
    }
    return internships;
  }

  /* Split a raw subsection title into (name, category) when an
     `\hfill` is present. The text on the left of \hfill is the
     project name; the text on the right is the category (with
     formatting commands we strip later). */
  function splitTitleAndCategory(rawTitle) {
    const hfillIdx = rawTitle.indexOf('\\hfill');
    if (hfillIdx === -1) return { name: rawTitle, category: '' };
    return {
      name:     rawTitle.slice(0, hfillIdx),
      category: rawTitle.slice(hfillIdx + 6)   // skip past '\hfill'
    };
  }

  function parseProjects(text) {
    /* Locate each `\subsection*{` and use balanced-brace matching to
       grab the whole title — needed because the title may contain
       formatting groups like `{\normalfont\itshape\small Category}`
       which a flat `[^}]+` would truncate. */
    const re = /\\subsection\*\s*\{/g;
    const subs = [];
    let m;
    while ((m = re.exec(text)) !== null) {
      const openBrace = m.index + m[0].length - 1;
      const bal = findBalancedBraces(text, openBrace);
      if (!bal) continue;
      const rawTitle = text.slice(openBrace + 1, bal.endIndex);
      const split = splitTitleAndCategory(rawTitle);
      subs.push({
        title:        stripFormatting(split.name).trim(),
        category:     split.category ? stripFormatting(split.category).trim() : '',
        startIndex:   m.index,
        contentStart: bal.endIndex + 1
      });
    }
    const projects = [];
    for (let k = 0; k < subs.length; k++) {
      const cur = subs[k];
      const nextStart = k + 1 < subs.length ? subs[k + 1].startIndex : text.length;
      const p = parseProjectLikeBlock(text.slice(cur.contentStart, nextStart), cur.title);
      if (cur.category) p.category = cur.category;
      projects.push(p);
    }
    return projects;
  }

  function parseSkills(text) {
    const block = findItemizeBlock(text);
    if (!block) return [];
    const items = extractItems(block.content);
    const out = [];
    for (const it of items) {
      const colonIdx = it.cleaned.indexOf(':');
      if (colonIdx === -1) continue;
      const category = it.cleaned.slice(0, colonIdx).replace(/\s*:\s*$/, '').trim();
      const list = it.cleaned.slice(colonIdx + 1).split(',').map(s => s.trim()).filter(s => s);
      out.push({ category, items: list });
    }
    return out;
  }

  function parseSimpleList(text) {
    const block = findItemizeBlock(text);
    if (!block) return [];
    return extractItems(block.content).map(it => it.cleaned);
  }

  /* The hero tagline and About paragraphs come from a comment block at the
     top of resume.tex — invisible in the PDF, but it keeps every piece of
     written content in the one source file rather than split between the
     LaTeX and index.html. */
  /* Courses reuse the Skills item shape (`\item \textbf{Name:} text`), so
     parseSkills does the heavy lifting. The only extra is the trailing
     "[Source]" tag, which is pulled out so the site can group by where a
     course was taken rather than printing it inline. */
  /* Courses come from two places: the \item list, which is what the PDF
     shows, and a `courses:` comment block holding everything else. Keeping
     the full list out of the LaTeX body is what stops 60 courses adding
     pages to the resume while still letting the site show them all. */
  /* A few words for the collapsed line, taken from the description's first
     clause. Keeping one description in resume.tex and deriving the short form
     avoids writing every course twice and letting the two drift apart. */
  /* LaTeX writes an ampersand as \&; the bracket tail isn't run through
     stripFormatting, so "Systems \& Networking" and "Systems & Networking"
     were arriving as two different domains. */
  function cleanTag(s) {
    return String(s || '').replace(/\\&/g, '&').replace(/\s+/g, ' ').trim();
  }
  /* The bracketed tail of a course line: "Source | Category | flags". Flags
     are `featured`, `minor`, and two optional pointers written key=value:
       link=https://...   the course page or the certificate's own page
       cert=file-or-URL   an image or PDF of the certificate, shown in a popup
       popup=page         show the link's page in the popup instead of a file
     Whatever isn't a flag is the category. */
  function courseMeta(parts) {
    const out = { source: parts[0] || '', domain: 'Other', featured: false, minor: false,
                  link: '', cert: '', popup: '' };
    let gotDomain = false;
    parts.slice(1).forEach(f => {
      const kv = /^(link|cert|popup)\s*=\s*(\S.*)$/i.exec(f);
      if (kv) { out[kv[1].toLowerCase()] = kv[2].trim(); return; }
      if (/^featured$/i.test(f)) out.featured = true;
      else if (/^minor$/i.test(f)) out.minor = true;
      else if (f && !gotDomain) { out.domain = f; gotDomain = true; }
    });
    return out;
  }

  /* The part of a course description shown before it is expanded: the
     first clause (up to a semicolon), capped at nine words. When the cap
     lands mid-item it backs up to the last comma, so the line ends on a
     whole entry rather than half of one, and never on "and" or "with". */
  function briefOf(desc) {
    if (!desc) return '';
    const first = String(desc).split(/[;:]|\.\s/)[0].trim();
    let words = first.split(/\s+/);
    if (words.length <= 9) return first.replace(/,$/, '');
    words = words.slice(0, 9);
    let cut = -1;
    for (let i = words.length - 1; i >= 2; i--) {
      if (/,$/.test(words[i])) { cut = i; break; }
    }
    if (cut >= 0) words = words.slice(0, cut + 1);
    while (words.length > 3 &&
           /^(and|or|of|the|a|an|in|on|with|for|to|via|over|using|&)$/i.test(words[words.length - 1])) {
      words.pop();
    }
    return words.join(' ').replace(/,$/, '') + '\u2026';
  }

  function parseCourses(section, rawText) {
    const fromComment = [];
    if (rawText) {
      const re = /\\begin\{comment\}([\s\S]*?)\\end\{comment\}/g;
      let bm;
      while ((bm = re.exec(rawText)) !== null) {
        const cm = /(?:^|\n)[ \t]*courses[ \t]*:[ \t]*\n([\s\S]*)$/i.exec(bm[1]);
        if (!cm) continue;
        cm[1].split(/\n/).forEach(line => {
          const t = line.trim();
          if (!t) return;
          /* "Name: description [Source]" — same shape as the \item form. */
          const m = /^([^:]+):\s*([\s\S]*?)\s*(?:\[([^\]]+)\])?\s*$/.exec(t);
          if (!m) return;
          fromComment.push(Object.assign(courseMeta((m[3] || '').split('|').map(cleanTag)), {
            /* Same em-dash conversion the \\item path does — without it the
               comment-block courses showed a literal "---" on the page. */
            name:        m[1].trim().replace(/\s*---\s*/g, ' \u2014 '),
            description: (m[2] || '').trim(),
            brief:       briefOf((m[2] || '').trim())
          }));
        });
        break;
      }
    }

    const fromItems = parseSkills(section).map(entry => {
      const raw = (entry.items || []).join(', ');
      const m = /^([\s\S]*?)\s*\[([^\]]+)\]\s*$/.exec(raw);
      /* The bracketed tail is "Source" or "Source | flag, flag". Splitting
         on the pipe keeps the source usable for grouping while letting a
         course opt into the selected list without a second section in the
         LaTeX. */
      /* `minor` marks lighter-weight coursework: it sorts to the bottom of
         the section in its own row rather than being hidden or labelled. */
      return Object.assign(courseMeta((m ? m[2] : '').split('|').map(cleanTag)), {
        /* LaTeX writes an em-dash as `---`; stripFormatting leaves it
           alone, so convert it here for display. */
        name:        String(entry.category).replace(/\s*---\s*/g, ' \u2014 '),
        description: (m ? m[1] : raw).trim(),
        brief:       briefOf((m ? m[1] : raw).trim())
      });
    }).filter(c => c.name);

    /* Visible items win on a name clash — the PDF is the deliberate
       selection, the comment block is the long tail. */
    const seen = {};
    fromItems.forEach(c => { seen[c.name.toLowerCase()] = true; });
    return fromItems.concat(
      fromComment.filter(c => !seen[c.name.toLowerCase()])
    );
  }

  function parseIntro(rawText) {
    const out = { tagline: null, about: [] };
    const docAt = rawText.indexOf('\\begin{document}');
    const head = docAt > 0 ? rawText.slice(0, docAt) : rawText.slice(0, 6000);
    /* The preamble already contains explanatory comment blocks, so take the
       first one that actually declares these fields rather than simply the
       first block found. */
    const re = /\\begin\{comment\}([\s\S]*?)\\end\{comment\}/g;
    let bm;
    while ((bm = re.exec(head)) !== null) {
      const body = bm[1];
      const tm = /(?:^|\n)[ \t]*tagline[ \t]*:[ \t]*([^\n]*)/i.exec(body);
      const am = /(?:^|\n)[ \t]*about[ \t]*:[ \t]*\n?([\s\S]*)$/i.exec(body);
      if (!tm && !am) continue;
      if (tm && tm[1].trim()) out.tagline = tm[1].trim();
      if (am) {
        out.about = am[1].split(/\n\s*\n/)
          .map(s => s.replace(/\s+/g, ' ').trim())
          .filter(Boolean);
      }
      break;
    }
    return out;
  }

  function parseResume(latex) {
    // Extract comment-block metadata BEFORE stripComments wipes it.
    const docMeta = extractDocMeta(latex);
    const meta = docMeta.projects;

    const text = stripComments(latex);
    const sectionRe = /\\section\*\s*\{([^}]+)\}/g;
    const matches = [];
    let m;
    while ((m = sectionRe.exec(text)) !== null) {
      matches.push({ name: m[1].trim(), startIndex: m.index, contentStart: m.index + m[0].length });
    }
    const sections = {};
    for (let i = 0; i < matches.length; i++) {
      const end = i + 1 < matches.length ? matches[i + 1].startIndex : text.length;
      sections[matches[i].name] = text.slice(matches[i].contentStart, end);
    }
    const header = matches.length ? text.slice(0, matches[0].startIndex) : '';

    const projects = parseProjects(sections['Projects'] || '');

    /* Attach comment metadata: description, topic paths, and any other
       attributes declared in the block (featured, icon, image, alt…).
       Attributes set here are defaults — projects.js still overrides. */
    projects.forEach(p => {
      const mt = meta[p.title];
      if (!mt) return;
      if (mt.description) p.description = mt.description;
      if (mt.topics && mt.topics.length) {
        p.topics  = mt.topics;                               // [{path,domain,leaf}]
        p.domains = uniqueStrings(mt.topics.map(t => t.domain));
        p.leaves  = uniqueStrings(mt.topics.map(t => t.leaf));
        // Back-compat: existing render/group code reads `category`.
        p.category = p.domains[0];
      }
      const a = mt.attrs || {};
      if (a.featured     !== undefined) p.featured     = a.featured === true;
      if (a.featuredonly !== undefined) p.featuredOnly = a.featuredonly === true;
      if (a.icon  !== undefined) p.icon  = a.icon;
      if (a.image !== undefined) p.image = a.image;
      if (a.alt   !== undefined) p.alt   = a.alt;
      if (a.hide  !== undefined) p.show  = !(a.hide === true);
      p.attrs = a;
    });

    /* Build the vocabulary of every domain + leaf name used anywhere, then
       strip those terms out of each project's keyword list. The resume
       deliberately repeats parent domains in Keywords (for ATS/readers) —
       without this the Tech filter would show duplicate chips that
       overlap the Domain filters. */
    const topicVocab = new Set();
    projects.forEach(p => {
      (p.topics || []).forEach(t => {
        t.path.forEach(seg => topicVocab.add(seg.toLowerCase()));
      });
    });
    projects.forEach(p => {
      if (!Array.isArray(p.stack)) return;
      p.stackAll = p.stack.slice();                          // keep the raw list
      p.stack = p.stack.filter(k => !topicVocab.has(String(k).trim().toLowerCase()));
    });

    return {
      contact:        parseContact(header),
      education:      parseEducation(sections['Education'] || ''),
      internships:    parseInternships(sections['Internships'] || ''),
      projects:       projects,
      skills:         parseSkills(sections['Skills'] || ''),
      accomplishments:parseSimpleList(sections['Accomplishments'] || ''),
      interests:      parseSimpleList(sections['Interests and Extracurricular Activities'] || ''),
      aiTools:        parseSkills(sections['AI Tools'] || ''),
      courses:        parseCourses(sections['Courses'] || '', latex),
      intro:          parseIntro(latex),
      /* Attributes declared in comment blocks before each \section*, keyed
         by section name — icon, image, alt, and anything else authored. */
      sectionMeta:    docMeta.sections
    };
  }

  /* ----------------------------------------------------------
     3. Config merging — works for any section
     ---------------------------------------------------------- */

  // Generic merger for sections whose entries are objects.
  // - hide: true OR show: false  → entry is dropped
  // - useAlt: true               → altData fields override the resume's
  // - featured/category          → preserved on the merged entry (projects)
  // Keys in `config` that don't match any LaTeX entry and have
  // useAlt:true are treated as web-only entries.
  function isHidden(cfg) {
    return !!(cfg && (cfg.hide === true || cfg.show === false));
  }
  function buildEntryList(latexEntries, config, idKey, configOnlyFields) {
    config = config || {};
    configOnlyFields = configOnlyFields || [];
    const seen = Object.create(null);
    const out = [];

    latexEntries.forEach(entry => {
      const id = entry[idKey];
      const cfg = config[id] || {};
      if (isHidden(cfg)) { seen[id] = true; return; }
      let merged = Object.assign({}, entry);
      if (cfg.useAlt && cfg.altData) merged = Object.assign({}, entry, cfg.altData);
      configOnlyFields.forEach(k => {
        if (cfg[k] !== undefined) merged[k] = cfg[k];
      });
      seen[id] = true;
      out.push(merged);
    });

    Object.keys(config).forEach(key => {
      if (seen[key]) return;
      const cfg = config[key];
      if (!cfg || !cfg.useAlt || !cfg.altData || isHidden(cfg)) return;
      const entry = Object.assign({ [idKey]: key }, cfg.altData);
      configOnlyFields.forEach(k => {
        if (cfg[k] !== undefined) entry[k] = cfg[k];
      });
      out.push(entry);
    });

    return out;
  }

  // Accomplishments are strings, not objects. Config keys are matched
  // case-insensitively as substrings against the resume text — pick a
  // distinctive phrase ("GATE", "NTSE") that hits exactly one item.
  // Per-entry: show:false / hide:true to drop, altText to replace.
  function buildAccomplishmentsList(latexItems, config) {
    config = config || {};
    const matchedConfigKeys = new Set();
    const out = [];

    function findCfg(text) {
      const lower = text.toLowerCase();
      for (const key of Object.keys(config)) {
        if (lower.indexOf(key.toLowerCase()) !== -1) {
          return { key, cfg: config[key] };
        }
      }
      return null;
    }

    latexItems.forEach(text => {
      const m = findCfg(text);
      const cfg = m ? m.cfg : null;
      if (m) matchedConfigKeys.add(m.key);
      if (isHidden(cfg)) return;
      if (cfg && cfg.altText) out.push(cfg.altText);
      else if (cfg && cfg.useAlt && cfg.altData && cfg.altData.text) out.push(cfg.altData.text);
      else out.push(text);
    });

    // Web-only items (config keys that didn't match any resume entry,
    // with useAlt:true OR altText)
    Object.keys(config).forEach(key => {
      if (matchedConfigKeys.has(key)) return;
      const cfg = config[key];
      if (!cfg || isHidden(cfg)) return;
      if (cfg.altText) out.push(cfg.altText);
      else if (cfg.useAlt && cfg.altData && cfg.altData.text) out.push(cfg.altData.text);
    });

    return out;
  }

  // Contact has fixed field names; config keys match those names.
  // Supports { hide: true } and { override: "new value" }.
  /* Brand marks for the contact links, drawn from the same logo catalogue
     the tools section uses, so the two read consistently. */
  const CONTACT_LOGOS = {
    email:    { n: 'Email',    c: '#8a5a44',
                d: 'M1.5 5.5h21v13h-21v-13zm1.9 1.5l8.6 6 8.6-6H3.4zM3 8.6V17h18V8.6l-9 6.3-9-6.3z' },
    phone:    { n: 'Phone',    c: '#5a7a4a',
                d: 'M6.6 2.5l3 3-2.2 2.2a14 14 0 007.9 7.9l2.2-2.2 3 3-2.6 2.6c-.7.7-1.8.9-2.7.5A21 21 0 013 8.1c-.4-.9-.2-2 .5-2.7L6.6 2.5z' },
    linkedin: { n: 'LinkedIn', c: '#0A66C2',
                d: 'M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 01-2.063-2.065 2.064 2.064 0 112.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z' },
    github:   { n: 'GitHub',   c: '#181717',
                d: 'M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12' },
    gitlab:   { n: 'GitLab',   c: '#FC6D26',
                d: 'M23.955 13.587l-1.342-4.135-2.664-8.189a.455.455 0 00-.867 0L16.418 9.45H7.582L4.919 1.263a.455.455 0 00-.867 0L1.388 9.452.046 13.587a.924.924 0 00.331 1.023L12 23.054l11.623-8.443a.92.92 0 00.332-1.024' }
  };

  function contactLogoSVG(key) {
    const media = SITE_CONFIG.media || {};
    if (media.showContactLogos === false) return '';
    const lg = CONTACT_LOGOS[key];
    if (!lg) return '';
    return logoSVG(lg, media.techLogoColor !== false);
  }

  function applyContactConfig(contact, contactCfg) {
    contactCfg = contactCfg || {};
    const result = Object.assign({}, contact);
    Object.keys(contactCfg).forEach(field => {
      const cfg = contactCfg[field];
      if (!cfg) return;
      if (cfg.hide) delete result[field];
      else if (cfg.override !== undefined) result[field] = cfg.override;
    });
    return result;
  }

  /* ----------------------------------------------------------
     4. Project grouping by category
     ---------------------------------------------------------- */

  function groupByCategory(projects, order) {
    const groups = {};
    const naturalOrder = [];
    projects.forEach(p => {
      const cat = p.category || 'Other';
      if (!groups[cat]) { groups[cat] = []; naturalOrder.push(cat); }
      groups[cat].push(p);
    });
    let categories;
    if (Array.isArray(order) && order.length) {
      const inOrder = order.filter(c => groups[c]);
      const extras = naturalOrder.filter(c => order.indexOf(c) === -1);
      categories = inOrder.concat(extras);
    } else {
      categories = naturalOrder;
    }
    return categories.map(cat => ({ category: cat, projects: groups[cat] }));
  }

  /* ----------------------------------------------------------
     5. Render helpers
     ---------------------------------------------------------- */

  function escapeHTML(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[c];
    });
  }

  function slug(s) {
    return String(s || '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
  }

  /* De-duplicate a list of strings, case-insensitively, preserving order
     and the first-seen capitalisation. */
  function uniqueStrings(list) {
    const seen = Object.create(null);
    const out = [];
    (list || []).forEach(s => {
      if (s == null) return;
      const v = String(s).trim();
      if (!v) return;
      const k = v.toLowerCase();
      if (seen[k]) return;
      seen[k] = true;
      out.push(v);
    });
    return out;
  }

  function inferLinkLabel(url) {
    if (!url) return 'Link';
    if (url.includes('gitlab.com')) return 'GitLab';
    if (url.includes('github.com')) return 'GitHub';
    if (url.includes('bitbucket'))  return 'Bitbucket';
    return 'Repo';
  }

  function renderStack(stack, className, suppress) {
    if (!Array.isArray(stack) || !stack.length) return '';
    let items = stack;
    if (suppress) {
      const target = String(suppress).trim().toLowerCase();
      items = stack.filter(t => String(t).trim().toLowerCase() !== target);
    }
    if (!items.length) return '';
    return '<div class="' + className + '">' +
      items.map(t => '<span>' + escapeHTML(t) + '</span>').join('') + '</div>';
  }

  function renderBullets(bullets) {
    if (!Array.isArray(bullets) || !bullets.length) return '';
    return '<ul>' + bullets.map(b => '<li>' + escapeHTML(b) + '</li>').join('') + '</ul>';
  }

  function renderLinks(links) {
    if (!Array.isArray(links) || !links.length) return '';
    return '<div class="repo-links">' +
      links.map(l => '<a class="repo-link" href="' + escapeHTML(l.url) +
        '" target="_blank" rel="noopener">' + escapeHTML(l.label) +
        ' <span class="arrow" aria-hidden="true">↗</span></a>').join('') + '</div>';
  }

  function normalizeLinks(data) {
    if (Array.isArray(data.links) && data.links.length) return data.links;
    if (data.url) return [{ label: inferLinkLabel(data.url), url: data.url }];
    return [];
  }

  /* ----------------------------------------------------------
     6. Section renderers
     ---------------------------------------------------------- */

  /* Optional portrait in the title block. Off unless a file is configured
     and the toggle is on, and it loads deferred like every other image. */
  function renderPortrait() {
    const media = SITE_CONFIG.media || {};
    const file = media.portrait;
    /* The hero section itself, not whatever the h1 happens to sit inside.
       The previous expression mixed ?: with || and resolved to the wrong
       node (or null), which is why nothing ever appeared. */
    /* Locate the hero by structure, not by an id. This project's index.html
       is hand-written and may differ from the copy these scripts shipped
       with, so anything that depends on an exact id silently no-ops. Fall
       back through: #hero, .hero, then the section containing the first h1. */
    let host = document.getElementById('hero') || document.querySelector('.hero');
    if (!host) {
      const h1 = document.querySelector('h1');
      host = h1 ? (h1.closest ? h1.closest('section, header, div') : h1.parentNode) : null;
    }
    const existing = document.getElementById('hero-portrait');
    if (existing) existing.remove();
    if (!file || media.showPortrait === false || !host) return;
    const px = media.portraitSize || 148;
    const wrap = document.createElement('div');
    wrap.id = 'hero-portrait';
    wrap.className = 'hero-portrait is-pending';
    wrap.style.setProperty('--tile-w', px + 'px');
    const img = document.createElement('img');
    img.alt = media.portraitAlt || 'Portrait';
    img.setAttribute('data-src', (media.imageDir || '') + file);
    img.loading = 'lazy';
    img.decoding = 'async';
    wrap.appendChild(img);
    host.insertBefore(wrap, host.firstChild);
  }

  /* AI Tools render as cards, same shape as the Tools section. */
  function renderAiTools(groups) {
    const el = document.getElementById('ai-tools-list');
    if (!el) return;
    const section = document.getElementById('ai-tools');
    const items = [].concat.apply([], groups.map(g => ({
      name: g.category, detail: (g.items || []).join(', ')
    })));
    if (!items.length) {
      if (section) section.style.display = 'none';
      return;
    }
    if (section) section.style.display = '';
    const media = SITE_CONFIG.media || {};
    el.innerHTML = items.map(it => {
      const mark = techMark(it.name, true);
      return '<div class="ai-card" data-entry="' + escapeHTML(it.name) + '">' +
        '<div class="ai-card-head">' + mark +
          '<span class="ai-card-name">' + escapeHTML(it.name) + '</span></div>' +
        (it.detail ? '<p class="ai-card-detail">' + escapeHTML(it.detail) + '</p>' : '') +
      '</div>';
    }).join('');
  }

  function renderContact(c) {
    /* Each contact line gets its brand mark, matching how the tools cards
       present a technology — same logo pipeline, same colour handling. */
    function set(id, value, href, logoKey) {
      const el = document.getElementById(id);
      if (!el) return;
      if (!value) { el.textContent = '—'; el.removeAttribute('href'); return; }
      const mark = logoKey ? contactLogoSVG(logoKey) : '';
      el.innerHTML = mark + '<span>' + escapeHTML(value) + '</span>';
      if (href != null) el.setAttribute('href', href);
      const item = el.closest ? el.closest('.item') : null;
      if (item && mark) item.classList.add('has-logo');
    }
    set('contact-email',    c.email, c.email ? 'mailto:' + c.email : null, 'email');
    set('contact-phone',    c.phone, c.phone ? 'tel:' + c.phone.replace(/[^+\d]/g, '') : null, 'phone');
    set('contact-linkedin', c.linkedin ? c.linkedin.replace(/^https?:\/\/(www\.)?linkedin\.com\/in\//, '') : '', c.linkedin, 'linkedin');
    set('contact-github',   c.github   ? c.github.replace(/^https?:\/\/(www\.)?github\.com\//, '') : '', c.github, 'github');
    set('contact-gitlab',   c.gitlab   ? c.gitlab.replace(/^https?:\/\/(www\.)?gitlab\.com\//, '') : '', c.gitlab, 'gitlab');
  }

  /* Logo / emoji for a single education or internship row, looked up in
     site-config.json by the same name the editor lists as a target. */
  /* An emoji is a glyph and belongs inline with the text. A photo or a
     school crest is not — shrunk to glyph size it's unreadable. So the two
     are rendered differently: emoji stay inline via entryMark(), images
     become a proper tile beside the entry via entryTile(). */
  /* Which section an entry belongs to, so section-level sizing can apply. */
  function sectionOf(name) {
    const d = window.__resumeData;
    if (!d) return '';
    if ((d.education || []).some(e => (e.institution || e.title) === name)) return 'Education';
    if ((d.internships || []).some(e => (e.title) === name)) return 'Internships';
    if ((d.projects || []).some(p => p.title === name)) return 'Projects';
    return '';
  }

  function entryMark(name) {
    const media = SITE_CONFIG.media || {};
    if (media.showIcons === false || media.noEmoji === true) return '';
    if ((media.images || {})[name]) return '';        // handled by entryTile
    const ico = (media.icons || {})[name];
    if (!ico) return '';
    const alt = (media.alts || {})[name] || name || '';
    const sz = (media.sizes || {})[name];
    const style = sz ? ' style="width:' + sz + 'em;height:' + sz + 'em;font-size:' +
                       (sz * 0.75) + 'em"' : '';
    /* Text presentation: append U+FE0E (VARIATION SELECTOR-15), which asks
       the font stack for the monochrome outline glyph a terminal would show
       rather than the colour emoji. That's a real different glyph, not a
       greyscale filter over the colour one. Fonts that only ship the colour
       form ignore it, so a CSS fallback goes alongside. */
    const monoOn = media.monoEmoji === true;
    const glyph = monoOn ? String(ico) + '\uFE0E' : ico;
    const mono = monoOn ? ' is-mono' : '';
    return '<span class="row-mark' + mono + '"' + style + ' role="img" aria-label="' +
           escapeHTML(alt) + '">' + escapeHTML(glyph) + '</span>';
  }

  /* Image tile shown alongside an entry. Sized in px rather than em so a
     crest or photograph reads at a sensible size independent of the text,
     and it collapses out of the way on narrow screens. */
  function entryTile(name) {
    const media = SITE_CONFIG.media || {};
    if (media.showIcons === false) return '';
    const img = (media.images || {})[name];
    if (!img) return '';
    const alt = (media.alts || {})[name] || name || '';
    /* Section-level default, then a per-item override. Letting a section
       set one size is what keeps a row of crests looking deliberate rather
       than assorted. */
    const secDefault = ((media.sectionTiles || {})[sectionOf(name)]) || media.tileSize || 84;
    const px = (media.tileSizes || {})[name] || secDefault;
    /* The tile starts collapsed and claims no space. The src is held in
       data-src until the page is idle, so text paints first; the tile only
       materialises once the image has actually decoded. If it 404s it stays
       collapsed and the layout simply closes up — an empty bordered box
       advertising a missing file helps nobody. */
    const tbg = (media.tileBg || {})[name];
    const bgStyle = tbg ? ';background:' + tbg + ';padding:8px' : '';
    return '<div class="entry-tile is-pending" style="--tile-w:' + px + 'px' + bgStyle + '">' +
           '<img data-src="' + escapeHTML((media.imageDir || '') + img) +
           '" alt="' + escapeHTML(alt) + '" loading="lazy" decoding="async"></div>';
  }

  function renderEducation(entries) {
    const el = document.getElementById('education-list');
    if (!el) return;
    /* If ANY row in the section has an image, every row reserves the same
       column. Otherwise rows with a crest indent differently from rows
       without, and a column of institutions stops lining up. */
    const anyTile = entries.some(e => entryTile(e.institution || ''));
    el.classList.toggle('has-any-tile', anyTile);
    el.innerHTML = entries.map(e => {
      const score = e.score || '';
      let scoreHTML = '';
      if (score) {
        if (score.indexOf(':') !== -1) {
          const parts = score.split(':');
          scoreHTML = escapeHTML(parts[0].trim()) + '<b>' + escapeHTML(parts.slice(1).join(':').trim()) + '</b>';
        } else {
          scoreHTML = 'Score<b>' + escapeHTML(score) + '</b>';
        }
      }
      const tile = entryTile(e.institution || '');
      return '<div class="timeline-row' + (anyTile ? ' has-tile' : '') +
             '" data-entry="' + escapeHTML(e.institution || '') + '">' +
        '<div class="when">' + escapeHTML(e.dates || '') + '</div>' +
        '<div class="what">' + entryMark(e.institution || '') + escapeHTML(e.institution || '') +
          (e.degree ? '<small>' + escapeHTML(e.degree) + '</small>' : '') +
        '</div>' +
        '<div class="score">' + scoreHTML + '</div>' +
        tile +
      '</div>';
    }).join('');
  }

  function renderInternships(internships) {
    const el = document.getElementById('internship-list');
    if (!el) return;
    markAnyTile('internship-list', internships.map(i => i.title || ''));
    el.innerHTML = internships.map((intern, idx) => {
      const links = normalizeLinks(intern);
      const num = String(idx + 1).padStart(2, '0');
      const P = placeDiagram(intern.title);
      return '<article class="work-item' + P.cls + mCls() + '" data-entry="' + escapeHTML(intern.title || '') + '">' +
        '<span class="idx">' + num + ' / Intern</span>' +
        '<div>' +
          P.top +
          '<h3>' + entryMark(intern.title || '') + escapeHTML(intern.title || 'Internship') + '</h3>' +
          P.wide +
          (intern.dates ? '<div class="role">' + escapeHTML(intern.dates) + '</div>' : '') +
          renderBullets(intern.bullets) +
          renderStack(intern.stack, 'stack') +
          P.below +
          (P.inline ? '<div class="feat-meta-inline">' + entryTile(intern.title || '') +
                      renderLinks(links) + '</div>' : '') +
        '</div>' +
        (P.side ? P.side : P.inline ? ''
                : '<div class="meta-right">' + entryTile(intern.title || '') +
                    renderLinks(links) + '</div>') +
        mToggle() +
      '</article>';
    }).join('');
  }

  /* Even spread around the wheel: 360/n apart, starting from the site
     accent's hue so the set still belongs to the palette. buildDomainPalette
     steps by a fixed angle, which is right for 17 domains but bunches four
     into one quarter of the wheel. */
  function spreadHues(names) {
    const out = {};
    if (!names.length) return out;
    let base = 20;
    try {
      const acc = getComputedStyle(document.documentElement)
        .getPropertyValue('--accent').trim();
      if (/^#[0-9a-f]{6}$/i.test(acc)) {
        const r = parseInt(acc.slice(1, 3), 16) / 255,
              g = parseInt(acc.slice(3, 5), 16) / 255,
              b = parseInt(acc.slice(5, 7), 16) / 255;
        const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
        if (d) {
          let h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
          base = (h * 60 + 360) % 360;
        }
      }
    } catch (e) { /* keep the default */ }
    names.forEach((n, i) => {
      const h = (base + i * 360 / names.length) % 360;
      out[n] = 'hsl(' + h.toFixed(0) + ', 58%, 56%)';
    });
    return out;
  }

  /* ----------------------------------------------------------
     Project diagrams
     ----------------------------------------------------------
     One inline SVG per showcased project, explaining what it does: terminal
     tools show their commands wired to the stage each one drives; web and
     mobile tools show taps, clicks and numbered steps. Each flow ends on its
     real output. Inline SVG rather than image files: no extra requests, sharp
     at any size, about 5.5 KB gzipped for all five.

     Keys are matched against the project title case-insensitively, so a
     title can change without breaking the link. Hide them all with
     media.showDiagrams = false, or one with media.hiddenDiagrams[title].
     ---------------------------------------------------------- */
  const PROJECT_DIAGRAMS = {
      "intrusion": "<svg viewBox=\"0 0 640 280\" xmlns=\"http://www.w3.org/2000/svg\" role=\"img\"><defs><marker id=\"a-nids\" viewBox=\"0 0 10 10\" refX=\"8.5\" refY=\"5\" markerWidth=\"7\" markerHeight=\"7\" orient=\"auto-start-reverse\"><path d=\"M0 0 L10 5 L0 10 z\" fill=\"#da8062\"/></marker></defs><rect x=\"14\" y=\"10\" width=\"612\" height=\"76\" rx=\"9\" fill=\"#0a0b16\" stroke=\"#2e3151\"/><rect x=\"14\" y=\"10\" width=\"612\" height=\"20\" rx=\"9\" fill=\"#15162a\"/><rect x=\"14\" y=\"21\" width=\"612\" height=\"9\" fill=\"#15162a\"/><circle cx=\"26\" cy=\"20\" r=\"3.2\" fill=\"#393c5b\"/><circle cx=\"37\" cy=\"20\" r=\"3.2\" fill=\"#393c5b\"/><circle cx=\"48\" cy=\"20\" r=\"3.2\" fill=\"#393c5b\"/><text x=\"26\" y=\"50\" class=\"dg-cmd\">$ sudo nids --iface eth0</text><text x=\"26\" y=\"71\" class=\"dg-warn\">[!] port scan 10.0.0.42 -&gt; blocked (iptables DROP)</text><rect x=\"14\" y=\"146\" width=\"104\" height=\"96\" rx=\"9\" fill=\"#0b0c17\" stroke=\"#3a3d5c\"/><rect x=\"24\" y=\"160\" width=\"22\" height=\"11\" rx=\"2.5\" fill=\"#2f3252\"/><rect x=\"52\" y=\"170\" width=\"22\" height=\"11\" rx=\"2.5\" fill=\"#da8062\"/><rect x=\"28\" y=\"186\" width=\"22\" height=\"11\" rx=\"2.5\" fill=\"#2f3252\"/><rect x=\"70\" y=\"156\" width=\"22\" height=\"11\" rx=\"2.5\" fill=\"#da8062\"/><rect x=\"84\" y=\"194\" width=\"22\" height=\"11\" rx=\"2.5\" fill=\"#2f3252\"/><rect x=\"46\" y=\"206\" width=\"22\" height=\"11\" rx=\"2.5\" fill=\"#da8062\"/><rect x=\"76\" y=\"218\" width=\"22\" height=\"11\" rx=\"2.5\" fill=\"#2f3252\"/><rect x=\"176\" y=\"138\" width=\"118\" height=\"108\" rx=\"7\" fill=\"#141528\" stroke=\"#3a3d5c\" stroke-width=\"1\"/><text x=\"184\" y=\"153\" class=\"dg-pk\">SYN  :22  10.0.0.42</text><text x=\"184\" y=\"165\" class=\"dg-pk\">SYN  :23  10.0.0.42</text><text x=\"184\" y=\"177\" class=\"dg-pk\">SYN  :80  10.0.0.42</text><text x=\"184\" y=\"189\" class=\"dg-pk\">SYN  :443 10.0.0.42</text><text x=\"184\" y=\"201\" class=\"dg-pkd\">ACK  :443 10.0.0.7</text><text x=\"184\" y=\"213\" class=\"dg-pk\">SYN  :8080 10.0.0.42</text><rect x=\"352\" y=\"146\" width=\"116\" height=\"92\" rx=\"7\" fill=\"#141528\" stroke=\"#da8062\" stroke-width=\"1.6\"/><rect x=\"352\" y=\"146\" width=\"116\" height=\"18\" rx=\"7\" fill=\"#da8062\"/><rect x=\"352\" y=\"157\" width=\"116\" height=\"7\" fill=\"#da8062\"/><text x=\"360\" y=\"158.5\" class=\"dg-bd\">⚠ PORT SCAN</text><text x=\"360\" y=\"177\" class=\"dg-al\">src  10.0.0.42</text><text x=\"360\" y=\"189\" class=\"dg-al\">37 ports / 2 s</text><text x=\"360\" y=\"201\" class=\"dg-al\">OS: Linux 5.x</text><rect x=\"518\" y=\"136\" width=\"108\" height=\"112\" rx=\"7\" fill=\"#141528\" stroke=\"#da8062\" stroke-width=\"1.6\"/><rect x=\"518\" y=\"136\" width=\"108\" height=\"18\" rx=\"7\" fill=\"#da8062\"/><rect x=\"518\" y=\"147\" width=\"108\" height=\"7\" fill=\"#da8062\"/><text x=\"526\" y=\"148.5\" class=\"dg-bd\">OUTPUT</text><text x=\"526\" y=\"167\" class=\"dg-rule\">DROP 10.0.0.42</text><text x=\"526\" y=\"179\" class=\"dg-al\">iptables · INPUT</text><text x=\"526\" y=\"191\" class=\"dg-al\">Win Firewall</text><text x=\"526\" y=\"203\" class=\"dg-okc\">✓ host protected</text><text x=\"66\" y=\"266\" class=\"dg-cap\" text-anchor=\"middle\">live traffic · eth0</text><text x=\"235\" y=\"266\" class=\"dg-cap\" text-anchor=\"middle\">captured packets</text><text x=\"410\" y=\"266\" class=\"dg-cap\" text-anchor=\"middle\">alert</text><text x=\"572\" y=\"266\" class=\"dg-cap\" text-anchor=\"middle\">attacker blocked</text><path d=\"M118 194 L172 194\" fill=\"none\" stroke=\"#da8062\" stroke-width=\"1.5\"  marker-end=\"url(#a-nids)\"/><path d=\"M294 194 L348 194\" fill=\"none\" stroke=\"#da8062\" stroke-width=\"1.5\"  marker-end=\"url(#a-nids)\"/><path d=\"M468 194 L514 194\" fill=\"none\" stroke=\"#da8062\" stroke-width=\"1.5\"  marker-end=\"url(#a-nids)\"/><rect x=\"98\" y=\"98\" width=\"96\" height=\"34\" rx=\"17\" fill=\"#1b1c31\" stroke=\"#da8062\" stroke-width=\"1.3\"/><g transform=\"translate(105 103)\" fill=\"none\" stroke=\"#da8062\" stroke-width=\"1.7\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><circle cx=\"12\" cy=\"17.5\" r=\"1.7\" fill=\"#da8062\" stroke=\"none\"/><path d=\"M7.6 13.3a6.2 6.2 0 0 1 8.8 0\"/><path d=\"M4.6 10.2a10.4 10.4 0 0 1 14.8 0\"/></g><text x=\"133\" y=\"113\" class=\"dg-ct\">Capture</text><text x=\"133\" y=\"125\" class=\"dg-cs\">Scapy</text><line x1=\"146\" y1=\"132\" x2=\"146\" y2=\"191\" stroke=\"#da8062\" stroke-width=\"1.2\" stroke-dasharray=\"2 3\" opacity=\".8\"/><circle cx=\"146\" cy=\"194\" r=\"3\" fill=\"#da8062\"/><rect x=\"276\" y=\"98\" width=\"92\" height=\"34\" rx=\"17\" fill=\"#1b1c31\" stroke=\"#da8062\" stroke-width=\"1.3\"/><g transform=\"translate(283 103)\" fill=\"none\" stroke=\"#da8062\" stroke-width=\"1.7\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><circle cx=\"10.5\" cy=\"10.5\" r=\"6.2\"/><path d=\"M15.1 15.1 20.6 20.6\"/><path d=\"M8 10.5h5M10.5 8v5\"/></g><text x=\"311\" y=\"113\" class=\"dg-ct\">Detect</text><text x=\"311\" y=\"125\" class=\"dg-cs\">sliding win</text><line x1=\"322\" y1=\"132\" x2=\"322\" y2=\"191\" stroke=\"#da8062\" stroke-width=\"1.2\" stroke-dasharray=\"2 3\" opacity=\".8\"/><circle cx=\"322\" cy=\"194\" r=\"3\" fill=\"#da8062\"/><rect x=\"444\" y=\"98\" width=\"92\" height=\"34\" rx=\"17\" fill=\"#1b1c31\" stroke=\"#da8062\" stroke-width=\"1.3\"/><g transform=\"translate(451 103)\" fill=\"none\" stroke=\"#da8062\" stroke-width=\"1.7\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path d=\"M12 2.6 19.4 5.5V11c0 5-3.3 8.4-7.4 10.4C7.9 19.4 4.6 16 4.6 11V5.5Z\"/><path d=\"M8.6 8.6l6.8 6.8\"/></g><text x=\"479\" y=\"113\" class=\"dg-ct\">Block</text><text x=\"479\" y=\"125\" class=\"dg-cs\">auto</text><line x1=\"490\" y1=\"132\" x2=\"490\" y2=\"191\" stroke=\"#da8062\" stroke-width=\"1.2\" stroke-dasharray=\"2 3\" opacity=\".8\"/><circle cx=\"490\" cy=\"194\" r=\"3\" fill=\"#da8062\"/><path d=\"M60 86 L60 142\" fill=\"none\" stroke=\"#da8062\" stroke-width=\"1.5\" stroke-dasharray=\"4 4\" marker-end=\"url(#a-nids)\"/><path d=\"M572 136 C 572 118, 592 104, 592 90\" fill=\"none\" stroke=\"#da8062\" stroke-width=\"1.5\" stroke-dasharray=\"4 4\" marker-end=\"url(#a-nids)\"/></svg>",
      "agentic": "<svg viewBox=\"0 0 640 292\" xmlns=\"http://www.w3.org/2000/svg\" role=\"img\"><defs><marker id=\"a-ai\" viewBox=\"0 0 10 10\" refX=\"8.5\" refY=\"5\" markerWidth=\"7\" markerHeight=\"7\" orient=\"auto-start-reverse\"><path d=\"M0 0 L10 5 L0 10 z\" fill=\"#75c25b\"/></marker></defs><rect x=\"14\" y=\"10\" width=\"612\" height=\"76\" rx=\"9\" fill=\"#0a0b16\" stroke=\"#2e3151\"/><rect x=\"14\" y=\"10\" width=\"612\" height=\"20\" rx=\"9\" fill=\"#15162a\"/><rect x=\"14\" y=\"21\" width=\"612\" height=\"9\" fill=\"#15162a\"/><circle cx=\"26\" cy=\"20\" r=\"3.2\" fill=\"#393c5b\"/><circle cx=\"37\" cy=\"20\" r=\"3.2\" fill=\"#393c5b\"/><circle cx=\"48\" cy=\"20\" r=\"3.2\" fill=\"#393c5b\"/><text x=\"26\" y=\"50\" class=\"dg-cmd\">$ research papers/*.pdf       # 3 PDFs</text><text x=\"26\" y=\"71\" class=\"dg-ok\">[ok] survey.md · 742 words · 11 citations across 3 papers</text><path d=\"M14 128 H86 L96 138 V220 H14 Z\" fill=\"#141528\" stroke=\"#3a3d5c\" stroke-width=\"1\"/><path d=\"M86 128 V138 H96\" fill=\"none\" stroke=\"#3a3d5c\"/><text x=\"22\" y=\"144\" class=\"dg-pt\">paper-1.pdf</text><path d=\"M24 147 H96 L106 157 V239 H24 Z\" fill=\"#141528\" stroke=\"#3a3d5c\" stroke-width=\"1\"/><path d=\"M96 147 V157 H106\" fill=\"none\" stroke=\"#3a3d5c\"/><text x=\"32\" y=\"163\" class=\"dg-pt\">paper-2.pdf</text><path d=\"M34 166 H106 L116 176 V258 H34 Z\" fill=\"#141528\" stroke=\"#3a3d5c\" stroke-width=\"1\"/><path d=\"M106 166 V176 H116\" fill=\"none\" stroke=\"#3a3d5c\"/><text x=\"42\" y=\"182\" class=\"dg-pt\">paper-3.pdf</text><rect x=\"42\" y=\"192\" width=\"61\" height=\"3.2\" rx=\"1.6\" fill=\"#2f3252\"/><rect x=\"42\" y=\"201\" width=\"61\" height=\"3.2\" rx=\"1.6\" fill=\"#2f3252\"/><rect x=\"42\" y=\"210\" width=\"41\" height=\"3.2\" rx=\"1.6\" fill=\"#2f3252\"/><rect x=\"42\" y=\"219\" width=\"61\" height=\"3.2\" rx=\"1.6\" fill=\"#2f3252\"/><rect x=\"42\" y=\"228\" width=\"61\" height=\"3.2\" rx=\"1.6\" fill=\"#2f3252\"/><rect x=\"42\" y=\"237\" width=\"41\" height=\"3.2\" rx=\"1.6\" fill=\"#2f3252\"/><rect x=\"40\" y=\"243\" width=\"28\" height=\"12\" rx=\"3\" fill=\"#c3c7e0\"/><text x=\"44\" y=\"252\" class=\"dg-bd\">PDF</text><path d=\"M184 158 H244 L254 168 V250 H184 Z\" fill=\"#141528\" stroke=\"#3a3d5c\" stroke-width=\"1\"/><path d=\"M244 158 V168 H254\" fill=\"none\" stroke=\"#3a3d5c\"/><rect x=\"192\" y=\"174\" width=\"50\" height=\"3.2\" rx=\"1.6\" fill=\"#2f3252\"/><rect x=\"192\" y=\"183\" width=\"50\" height=\"3.2\" rx=\"1.6\" fill=\"#2f3252\"/><rect x=\"192\" y=\"192\" width=\"33\" height=\"3.2\" rx=\"1.6\" fill=\"#2f3252\"/><path d=\"M177 151 H237 L247 161 V243 H177 Z\" fill=\"#141528\" stroke=\"#3a3d5c\" stroke-width=\"1\"/><path d=\"M237 151 V161 H247\" fill=\"none\" stroke=\"#3a3d5c\"/><rect x=\"185\" y=\"167\" width=\"50\" height=\"3.2\" rx=\"1.6\" fill=\"#2f3252\"/><rect x=\"185\" y=\"176\" width=\"50\" height=\"3.2\" rx=\"1.6\" fill=\"#2f3252\"/><rect x=\"185\" y=\"185\" width=\"33\" height=\"3.2\" rx=\"1.6\" fill=\"#2f3252\"/><path d=\"M170 144 H230 L240 154 V236 H170 Z\" fill=\"#141528\" stroke=\"#75c25b\" stroke-width=\"1.6\"/><path d=\"M230 144 V154 H240\" fill=\"none\" stroke=\"#75c25b\"/><rect x=\"178\" y=\"160\" width=\"50\" height=\"3.2\" rx=\"1.6\" fill=\"#2f3252\"/><rect x=\"178\" y=\"169\" width=\"50\" height=\"3.2\" rx=\"1.6\" fill=\"#2f3252\"/><rect x=\"178\" y=\"178\" width=\"33\" height=\"3.2\" rx=\"1.6\" fill=\"#2f3252\"/><rect x=\"334\" y=\"138\" width=\"96\" height=\"52\" rx=\"7\" fill=\"#141528\" stroke=\"#3a3d5c\" stroke-width=\"1\"/><text x=\"342\" y=\"153\" class=\"dg-nt2\">· key claim</text><text x=\"342\" y=\"165\" class=\"dg-nt2\">· method</text><text x=\"342\" y=\"177\" class=\"dg-nt2\">· result</text><rect x=\"334\" y=\"198\" width=\"96\" height=\"52\" rx=\"7\" fill=\"#141528\" stroke=\"#3a3d5c\" stroke-width=\"1\"/><text x=\"342\" y=\"213\" class=\"dg-okc\">✓ supported</text><text x=\"342\" y=\"225\" class=\"dg-bad\">✗ overstated</text><text x=\"342\" y=\"237\" class=\"dg-okc\">✓ cited</text><path d=\"M512 130 H616 L626 140 V260 H512 Z\" fill=\"#141528\" stroke=\"#75c25b\" stroke-width=\"1.6\"/><path d=\"M616 130 V140 H626\" fill=\"none\" stroke=\"#75c25b\"/><text x=\"520\" y=\"146\" class=\"dg-pt\">Survey</text><rect x=\"520\" y=\"156\" width=\"90\" height=\"3.2\" rx=\"1.6\" fill=\"#2f3252\"/><text x=\"613\" y=\"160\" class=\"dg-cm\" fill=\"#75c25b\">[1]</text><rect x=\"520\" y=\"165\" width=\"90\" height=\"3.2\" rx=\"1.6\" fill=\"#2f3252\"/><rect x=\"520\" y=\"174\" width=\"61\" height=\"3.2\" rx=\"1.6\" fill=\"#2f3252\"/><text x=\"584\" y=\"178\" class=\"dg-cm\" fill=\"#75c25b\">[2]</text><rect x=\"520\" y=\"183\" width=\"90\" height=\"3.2\" rx=\"1.6\" fill=\"#2f3252\"/><rect x=\"520\" y=\"192\" width=\"90\" height=\"3.2\" rx=\"1.6\" fill=\"#2f3252\"/><rect x=\"520\" y=\"201\" width=\"61\" height=\"3.2\" rx=\"1.6\" fill=\"#2f3252\"/><text x=\"584\" y=\"205\" class=\"dg-cm\" fill=\"#75c25b\">[3]</text><rect x=\"520\" y=\"210\" width=\"90\" height=\"3.2\" rx=\"1.6\" fill=\"#2f3252\"/><rect x=\"520\" y=\"219\" width=\"90\" height=\"3.2\" rx=\"1.6\" fill=\"#2f3252\"/><rect x=\"520\" y=\"228\" width=\"61\" height=\"3.2\" rx=\"1.6\" fill=\"#2f3252\"/><rect x=\"518\" y=\"245\" width=\"47\" height=\"12\" rx=\"3\" fill=\"#75c25b\"/><text x=\"522\" y=\"254\" class=\"dg-bd\">OUTPUT</text><text x=\"62\" y=\"278\" class=\"dg-cap\" text-anchor=\"middle\">3 input papers</text><text x=\"214\" y=\"278\" class=\"dg-cap\" text-anchor=\"middle\">chunks</text><text x=\"382\" y=\"278\" class=\"dg-cap\" text-anchor=\"middle\">summaries + critiques</text><text x=\"569\" y=\"278\" class=\"dg-cap\" text-anchor=\"middle\">cited survey</text><path d=\"M116 196 L166 196\" fill=\"none\" stroke=\"#75c25b\" stroke-width=\"1.5\"  marker-end=\"url(#a-ai)\"/><path d=\"M254 196 L330 196\" fill=\"none\" stroke=\"#75c25b\" stroke-width=\"1.5\"  marker-end=\"url(#a-ai)\"/><path d=\"M430 196 L508 196\" fill=\"none\" stroke=\"#75c25b\" stroke-width=\"1.5\"  marker-end=\"url(#a-ai)\"/><rect x=\"88\" y=\"98\" width=\"104\" height=\"34\" rx=\"17\" fill=\"#1b1c31\" stroke=\"#75c25b\" stroke-width=\"1.3\"/><g transform=\"translate(95 103)\" fill=\"none\" stroke=\"#75c25b\" stroke-width=\"1.7\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><circle cx=\"5\" cy=\"12\" r=\"2\"/><circle cx=\"19\" cy=\"6\" r=\"2\"/><circle cx=\"19\" cy=\"18\" r=\"2\"/><path d=\"M7 12h4l6-5.4M11 12l6 5.4\"/></g><text x=\"123\" y=\"113\" class=\"dg-ct\">Router</text><text x=\"123\" y=\"125\" class=\"dg-cs\">Llama 3.2</text><line x1=\"141\" y1=\"132\" x2=\"141\" y2=\"193\" stroke=\"#75c25b\" stroke-width=\"1.2\" stroke-dasharray=\"2 3\" opacity=\".8\"/><circle cx=\"141\" cy=\"196\" r=\"3\" fill=\"#75c25b\"/><rect x=\"232\" y=\"98\" width=\"118\" height=\"34\" rx=\"17\" fill=\"#1b1c31\" stroke=\"#75c25b\" stroke-width=\"1.3\"/><g transform=\"translate(239 103)\" fill=\"none\" stroke=\"#75c25b\" stroke-width=\"1.7\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path d=\"M4 6h16M4 10h12.5M4 14h9M4 18h5.5\"/></g><text x=\"267\" y=\"113\" class=\"dg-ct\">Summarise</text><text x=\"267\" y=\"125\" class=\"dg-cs\">+ critique</text><line x1=\"291\" y1=\"132\" x2=\"291\" y2=\"193\" stroke=\"#75c25b\" stroke-width=\"1.2\" stroke-dasharray=\"2 3\" opacity=\".8\"/><circle cx=\"291\" cy=\"196\" r=\"3\" fill=\"#75c25b\"/><rect x=\"406\" y=\"98\" width=\"112\" height=\"34\" rx=\"17\" fill=\"#1b1c31\" stroke=\"#75c25b\" stroke-width=\"1.3\"/><g transform=\"translate(413 103)\" fill=\"none\" stroke=\"#75c25b\" stroke-width=\"1.7\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path d=\"M4 5c6 0 6 7 10 7M4 19c6 0 6-7 10-7h6\"/><path d=\"M17 9l3 3-3 3\"/></g><text x=\"441\" y=\"113\" class=\"dg-ct\">Synthesise</text><text x=\"441\" y=\"125\" class=\"dg-cs\">Llama 3.1</text><line x1=\"462\" y1=\"132\" x2=\"462\" y2=\"193\" stroke=\"#75c25b\" stroke-width=\"1.2\" stroke-dasharray=\"2 3\" opacity=\".8\"/><circle cx=\"462\" cy=\"196\" r=\"3\" fill=\"#75c25b\"/><path d=\"M54 86 L54 124\" fill=\"none\" stroke=\"#75c25b\" stroke-width=\"1.5\" stroke-dasharray=\"4 4\" marker-end=\"url(#a-ai)\"/><path d=\"M569 130 C 569 112, 592 102, 592 90\" fill=\"none\" stroke=\"#75c25b\" stroke-width=\"1.5\" stroke-dasharray=\"4 4\" marker-end=\"url(#a-ai)\"/></svg>",
      "citestat": "<svg viewBox=\"0 0 600 260\" xmlns=\"http://www.w3.org/2000/svg\" role=\"img\"><defs><marker id=\"a-cite\" viewBox=\"0 0 10 10\" refX=\"8.5\" refY=\"5\" markerWidth=\"7\" markerHeight=\"7\" orient=\"auto-start-reverse\"><path d=\"M0 0 L10 5 L0 10 z\" fill=\"#5ab9d8\"/></marker></defs><rect x=\"14\" y=\"14\" width=\"330\" height=\"226\" rx=\"9\" fill=\"#141528\" stroke=\"#2f3252\"/><rect x=\"14\" y=\"14\" width=\"330\" height=\"22\" rx=\"9\" fill=\"#16172a\"/><rect x=\"14\" y=\"26\" width=\"330\" height=\"10\" fill=\"#16172a\"/><circle cx=\"26\" cy=\"25\" r=\"3.2\" fill=\"#3a3d5c\"/><circle cx=\"37\" cy=\"25\" r=\"3.2\" fill=\"#3a3d5c\"/><circle cx=\"48\" cy=\"25\" r=\"3.2\" fill=\"#3a3d5c\"/><rect x=\"60\" y=\"20\" width=\"272\" height=\"11\" rx=\"5.5\" fill=\"#24263f\"/><text x=\"68\" y=\"29\" class=\"dg-url\">citestat · search</text><rect x=\"32\" y=\"50\" width=\"220\" height=\"26\" rx=\"6\" fill=\"#0b0c17\" stroke=\"#5ab9d8\" stroke-width=\"1.4\"/><text x=\"42\" y=\"67\" class=\"dg-ph\">Author name or DOI</text><rect x=\"262\" y=\"50\" width=\"64\" height=\"26\" rx=\"6\" fill=\"#5ab9d8\"/><text x=\"294\" y=\"67\" class=\"dg-btn\" text-anchor=\"middle\">Search</text><rect x=\"36\" y=\"174\" width=\"15\" height=\"22\" rx=\"2.5\" fill=\"#5ab9d8\" opacity=\"0.35\"/><rect x=\"60\" y=\"158\" width=\"15\" height=\"38\" rx=\"2.5\" fill=\"#5ab9d8\" opacity=\"0.44\"/><rect x=\"84\" y=\"166\" width=\"15\" height=\"30\" rx=\"2.5\" fill=\"#5ab9d8\" opacity=\"0.53\"/><rect x=\"108\" y=\"144\" width=\"15\" height=\"52\" rx=\"2.5\" fill=\"#5ab9d8\" opacity=\"0.62\"/><rect x=\"132\" y=\"150\" width=\"15\" height=\"46\" rx=\"2.5\" fill=\"#5ab9d8\" opacity=\"0.71\"/><rect x=\"156\" y=\"132\" width=\"15\" height=\"64\" rx=\"2.5\" fill=\"#5ab9d8\" opacity=\"0.80\"/><rect x=\"180\" y=\"138\" width=\"15\" height=\"58\" rx=\"2.5\" fill=\"#5ab9d8\" opacity=\"0.89\"/><line x1=\"32\" y1=\"197\" x2=\"210\" y2=\"197\" stroke=\"#3a3d5c\"/><rect x=\"230\" y=\"120\" width=\"96\" height=\"76\" rx=\"8\" fill=\"#1b1c31\" stroke=\"#3a3d5c\"/><text x=\"244\" y=\"141\" class=\"dg-ns\">h-index</text><text x=\"244\" y=\"172\" class=\"dg-metric\" fill=\"#5ab9d8\">14</text><text x=\"244\" y=\"188\" class=\"dg-ns\">m-quotient 1.2</text><circle cx=\"322\" cy=\"72\" r=\"9\" fill=\"none\" stroke=\"#5ab9d8\" stroke-width=\"1.4\" opacity=\".75\"/><circle cx=\"322\" cy=\"72\" r=\"15\" fill=\"none\" stroke=\"#5ab9d8\" stroke-width=\"1\" opacity=\".35\"/><path d=\"M322 72 l0 15 l4 -4 l3 7 l3 -1.4 l-3 -7 l6 0 z\" fill=\"#f2f0ff\" stroke=\"#0b0c17\" stroke-width=\"1.1\" stroke-linejoin=\"round\"/><circle cx=\"300\" cy=\"98\" r=\"8.5\" fill=\"#5ab9d8\"/><text x=\"300\" y=\"101.6\" class=\"dg-sn\" text-anchor=\"middle\">1</text><rect x=\"420\" y=\"40\" width=\"164\" height=\"46\" rx=\"9\" fill=\"#1b1c31\" stroke=\"#5ab9d8\" stroke-width=\"1.6\"/><text x=\"432\" y=\"59\" class=\"dg-nt\">Crossref API</text><text x=\"432\" y=\"75\" class=\"dg-ns\">citation records</text><path d=\"M346 63 L416 63\" fill=\"none\" stroke=\"#5ab9d8\" stroke-width=\"1.5\" stroke-dasharray=\"4 4\" marker-end=\"url(#a-cite)\"/><circle cx=\"381\" cy=\"50\" r=\"8.5\" fill=\"#5ab9d8\"/><text x=\"381\" y=\"53.6\" class=\"dg-sn\" text-anchor=\"middle\">2</text><path d=\"M500 86 C 500 150, 420 158, 330 158\" fill=\"none\" stroke=\"#5ab9d8\" stroke-width=\"1.5\" stroke-dasharray=\"4 4\" marker-end=\"url(#a-cite)\"/><circle cx=\"470\" cy=\"150\" r=\"8.5\" fill=\"#5ab9d8\"/><text x=\"470\" y=\"153.6\" class=\"dg-sn\" text-anchor=\"middle\">3</text><text x=\"356\" y=\"214\" class=\"dg-lab\" text-anchor=\"start\">metrics computed in the browser —</text><text x=\"356\" y=\"230\" class=\"dg-lab\" text-anchor=\"start\">no backend server</text></svg>",
      "crdt": "<svg viewBox=\"0 0 640 490\" xmlns=\"http://www.w3.org/2000/svg\" role=\"img\"><defs><marker id=\"a-crdt\" viewBox=\"0 0 10 10\" refX=\"8.5\" refY=\"5\" markerWidth=\"7\" markerHeight=\"7\" orient=\"auto-start-reverse\"><path d=\"M0 0 L10 5 L0 10 z\" fill=\"#c888dd\"/></marker><marker id=\"a-crdtb\" viewBox=\"0 0 10 10\" refX=\"8.5\" refY=\"5\" markerWidth=\"7\" markerHeight=\"7\" orient=\"auto-start-reverse\"><path d=\"M0 0 L10 5 L0 10 z\" fill=\"#e6c069\"/></marker></defs><g transform=\"translate(36 17)\" fill=\"none\" stroke=\"#c888dd\" stroke-width=\"1.7\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><circle cx=\"12\" cy=\"8\" r=\"3.6\"/><path d=\"M5 20c0-3.9 3.1-6.5 7-6.5s7 2.6 7 6.5\"/></g><text x=\"66\" y=\"34\" class=\"dg-devA\" fill=\"#c888dd\">DEVICE 1 · LAPTOP</text><rect x=\"36\" y=\"48\" width=\"250\" height=\"88\" rx=\"9\" fill=\"#141528\" stroke=\"#c888dd\" stroke-width=\"2\"/><rect x=\"44\" y=\"56\" width=\"234\" height=\"72\" rx=\"4\" fill=\"#0e0f1d\"/><path d=\"M22 140 H300 L290 152 H32 Z\" fill=\"#1b1c31\" stroke=\"#c888dd\" stroke-width=\"2\"/><rect x=\"141\" y=\"143\" width=\"40\" height=\"3\" rx=\"1.5\" fill=\"#c888dd\" opacity=\".6\"/><text x=\"60\" y=\"98\" class=\"dg-typed\">Hello <tspan fill=\"#c888dd\" font-weight=\"700\">big </tspan>world</text><g transform=\"translate(248 60)\" fill=\"none\" stroke=\"#9ad09a\" stroke-width=\"1.7\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><circle cx=\"12\" cy=\"17.5\" r=\"1.7\" fill=\"#9ad09a\" stroke=\"none\"/><path d=\"M7.6 13.3a6.2 6.2 0 0 1 8.8 0\"/><path d=\"M4.6 10.2a10.4 10.4 0 0 1 14.8 0\"/></g><g transform=\"translate(476 17)\" fill=\"none\" stroke=\"#e6c069\" stroke-width=\"1.7\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><circle cx=\"12\" cy=\"8\" r=\"3.6\"/><path d=\"M5 20c0-3.9 3.1-6.5 7-6.5s7 2.6 7 6.5\"/></g><text x=\"506\" y=\"34\" class=\"dg-devA\" fill=\"#e6c069\">DEVICE 2 · PHONE</text><rect x=\"476\" y=\"48\" width=\"126\" height=\"150\" rx=\"22\" fill=\"#141528\" stroke=\"#e6c069\" stroke-width=\"2\"/><rect x=\"484\" y=\"56\" width=\"110\" height=\"134\" rx=\"16\" fill=\"#0e0f1d\"/><rect x=\"520\" y=\"61\" width=\"38\" height=\"7\" rx=\"3.5\" fill=\"#1b1c31\"/><rect x=\"519\" y=\"182\" width=\"40\" height=\"3\" rx=\"1.5\" fill=\"#e6c069\" opacity=\".6\"/><text x=\"494\" y=\"114\" class=\"dg-typed\">Hello</text><text x=\"494\" y=\"136\" class=\"dg-typed\">world<tspan fill=\"#e6c069\" font-weight=\"700\">!</tspan></text><g transform=\"translate(568 72)\" fill=\"none\" stroke=\"#e08b8b\" stroke-width=\"1.7\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><circle cx=\"12\" cy=\"17.5\" r=\"1.7\" fill=\"#e08b8b\" stroke=\"none\"/><path d=\"M7.6 13.3a6.2 6.2 0 0 1 8.8 0\"/><path d=\"M4.6 10.2a10.4 10.4 0 0 1 14.8 0\"/><path d=\"M4 4l16 16\"/></g><rect x=\"488\" y=\"156\" width=\"102\" height=\"18\" rx=\"9\" fill=\"#2a2210\" stroke=\"#e6c069\"/><text x=\"539\" y=\"168.5\" class=\"dg-off\" text-anchor=\"middle\">offline · 1 queued</text><circle cx=\"372\" cy=\"102\" r=\"8.5\" fill=\"#c888dd\"/><text x=\"372\" y=\"105.6\" class=\"dg-sn\" text-anchor=\"middle\">1</text><text x=\"372\" y=\"128\" class=\"dg-lab\" text-anchor=\"middle\">both edit at once</text><text x=\"372\" y=\"141\" class=\"dg-lab\" text-anchor=\"middle\">— phone is offline —</text><rect x=\"244\" y=\"218\" width=\"152\" height=\"50\" rx=\"9\" fill=\"#1b1c31\" stroke=\"#c888dd\" stroke-width=\"1.6\"/><g transform=\"translate(254 231.0)\" fill=\"none\" stroke=\"#c888dd\" stroke-width=\"1.7\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path d=\"M4 5c6 0 6 7 10 7M4 19c6 0 6-7 10-7h6\"/><path d=\"M17 9l3 3-3 3\"/></g><text x=\"284\" y=\"237\" class=\"dg-nt\">Relay</text><text x=\"284\" y=\"253\" class=\"dg-ns\">WebSocket · RGA</text><path d=\"M160 158 C 160 200, 200 243, 240 243\" fill=\"none\" stroke=\"#c888dd\" stroke-width=\"1.5\"  marker-end=\"url(#a-crdt)\"/><path d=\"M539 200 C 539 228, 444 243, 400 243\" fill=\"none\" stroke=\"#e6c069\" stroke-width=\"1.5\" stroke-dasharray=\"4 4\" marker-end=\"url(#a-crdtb)\"/><text x=\"150\" y=\"206\" class=\"dg-lab\" text-anchor=\"end\">insert &quot;big &quot;</text><text x=\"486\" y=\"214\" class=\"dg-lab\" text-anchor=\"end\">sent on reconnect</text><path d=\"M276 268 C 230 280, 168 282, 160 296\" fill=\"none\" stroke=\"#e6c069\" stroke-width=\"1.5\" stroke-dasharray=\"4 4\" marker-end=\"url(#a-crdtb)\"/><path d=\"M364 268 C 410 282, 520 288, 539 300\" fill=\"none\" stroke=\"#c888dd\" stroke-width=\"1.5\" stroke-dasharray=\"4 4\" marker-end=\"url(#a-crdt)\"/><circle cx=\"320\" cy=\"292\" r=\"8.5\" fill=\"#c888dd\"/><text x=\"320\" y=\"295.6\" class=\"dg-sn\" text-anchor=\"middle\">2</text><rect x=\"36\" y=\"302\" width=\"250\" height=\"88\" rx=\"9\" fill=\"#141528\" stroke=\"#c888dd\" stroke-width=\"2\"/><rect x=\"44\" y=\"310\" width=\"234\" height=\"72\" rx=\"4\" fill=\"#0e0f1d\"/><path d=\"M22 394 H300 L290 406 H32 Z\" fill=\"#1b1c31\" stroke=\"#c888dd\" stroke-width=\"2\"/><rect x=\"141\" y=\"397\" width=\"40\" height=\"3\" rx=\"1.5\" fill=\"#c888dd\" opacity=\".6\"/><text x=\"60\" y=\"352\" class=\"dg-typed\">Hello <tspan fill=\"#c888dd\" font-weight=\"700\">big </tspan>world<tspan fill=\"#e6c069\" font-weight=\"700\">!</tspan></text><g transform=\"translate(248 314)\" fill=\"none\" stroke=\"#9ad09a\" stroke-width=\"1.7\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><circle cx=\"12\" cy=\"17.5\" r=\"1.7\" fill=\"#9ad09a\" stroke=\"none\"/><path d=\"M7.6 13.3a6.2 6.2 0 0 1 8.8 0\"/><path d=\"M4.6 10.2a10.4 10.4 0 0 1 14.8 0\"/></g><rect x=\"476\" y=\"302\" width=\"126\" height=\"150\" rx=\"22\" fill=\"#141528\" stroke=\"#e6c069\" stroke-width=\"2\"/><rect x=\"484\" y=\"310\" width=\"110\" height=\"134\" rx=\"16\" fill=\"#0e0f1d\"/><rect x=\"520\" y=\"315\" width=\"38\" height=\"7\" rx=\"3.5\" fill=\"#1b1c31\"/><rect x=\"519\" y=\"436\" width=\"40\" height=\"3\" rx=\"1.5\" fill=\"#e6c069\" opacity=\".6\"/><text x=\"494\" y=\"368\" class=\"dg-typed\">Hello <tspan fill=\"#c888dd\" font-weight=\"700\">big</tspan></text><text x=\"494\" y=\"390\" class=\"dg-typed\">world<tspan fill=\"#e6c069\" font-weight=\"700\">!</tspan></text><g transform=\"translate(568 326)\" fill=\"none\" stroke=\"#9ad09a\" stroke-width=\"1.7\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><circle cx=\"12\" cy=\"17.5\" r=\"1.7\" fill=\"#9ad09a\" stroke=\"none\"/><path d=\"M7.6 13.3a6.2 6.2 0 0 1 8.8 0\"/><path d=\"M4.6 10.2a10.4 10.4 0 0 1 14.8 0\"/></g><circle cx=\"372\" cy=\"352\" r=\"8.5\" fill=\"#c888dd\"/><text x=\"372\" y=\"355.6\" class=\"dg-sn\" text-anchor=\"middle\">3</text><text x=\"372\" y=\"378\" class=\"dg-lab\" text-anchor=\"middle\">same text on both</text><text x=\"320\" y=\"476\" class=\"dg-lab\" text-anchor=\"middle\">back online, both converge with neither edit lost — the relay only forwards; each device merges</text></svg>",
      "cris": "<svg viewBox=\"0 0 640 350\" xmlns=\"http://www.w3.org/2000/svg\" role=\"img\"><defs><marker id=\"a-cris\" viewBox=\"0 0 10 10\" refX=\"8.5\" refY=\"5\" markerWidth=\"7\" markerHeight=\"7\" orient=\"auto-start-reverse\"><path d=\"M0 0 L10 5 L0 10 z\" fill=\"#e3829f\"/></marker></defs><g transform=\"translate(16 10)\" fill=\"none\" stroke=\"#e3829f\" stroke-width=\"1.7\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><circle cx=\"12\" cy=\"8\" r=\"3.6\"/><path d=\"M5 20c0-3.9 3.1-6.5 7-6.5s7 2.6 7 6.5\"/></g><text x=\"46\" y=\"27\" class=\"dg-devA\" fill=\"#e3829f\">APPLICANT · APP</text><rect x=\"16\" y=\"40\" width=\"144\" height=\"276\" rx=\"22\" fill=\"#141528\" stroke=\"#e3829f\" stroke-width=\"2\"/><rect x=\"24\" y=\"48\" width=\"128\" height=\"260\" rx=\"16\" fill=\"#0e0f1d\"/><rect x=\"69\" y=\"53\" width=\"38\" height=\"6\" rx=\"3\" fill=\"#1b1c31\"/><rect x=\"30\" y=\"66\" width=\"116\" height=\"22\" rx=\"5\" fill=\"#e3829f\"/><text x=\"38\" y=\"81\" class=\"dg-ab\">Divyangjan Card</text><text x=\"32\" y=\"104\" class=\"dg-fl\">Name</text><rect x=\"32\" y=\"108\" width=\"112\" height=\"15\" rx=\"3\" fill=\"#0b0c17\" stroke=\"#3a3d5c\"/><text x=\"37\" y=\"118.5\" class=\"dg-fv\">R. Kumar</text><text x=\"32\" y=\"132\" class=\"dg-fl\">Disability type</text><rect x=\"32\" y=\"136\" width=\"112\" height=\"15\" rx=\"3\" fill=\"#0b0c17\" stroke=\"#3a3d5c\"/><text x=\"37\" y=\"146.5\" class=\"dg-fv\">Locomotor</text><text x=\"138\" y=\"146.5\" class=\"dg-fv\" text-anchor=\"end\">▾</text><text x=\"32\" y=\"160\" class=\"dg-fl\">Certificate</text><rect x=\"32\" y=\"164\" width=\"112\" height=\"15\" rx=\"3\" fill=\"#0b0c17\" stroke=\"#3a3d5c\"/><text x=\"37\" y=\"174.5\" class=\"dg-fv\">cert.pdf</text><text x=\"138\" y=\"174.5\" class=\"dg-fv\" text-anchor=\"end\">⇪</text><text x=\"32\" y=\"188\" class=\"dg-fl\">Division</text><rect x=\"32\" y=\"192\" width=\"112\" height=\"15\" rx=\"3\" fill=\"#0b0c17\" stroke=\"#3a3d5c\"/><text x=\"37\" y=\"202.5\" class=\"dg-fv\">Secunderabad</text><text x=\"138\" y=\"202.5\" class=\"dg-fv\" text-anchor=\"end\">▾</text><rect x=\"32\" y=\"214\" width=\"112\" height=\"22\" rx=\"6\" fill=\"#e3829f\"/><text x=\"88\" y=\"229\" class=\"dg-ab\" text-anchor=\"middle\">Submit</text><circle cx=\"120\" cy=\"225\" r=\"15\" fill=\"none\" stroke=\"#e3829f\" stroke-width=\"1\" opacity=\".35\"/><circle cx=\"120\" cy=\"225\" r=\"9\" fill=\"none\" stroke=\"#e3829f\" stroke-width=\"1.4\" opacity=\".75\"/><circle cx=\"120\" cy=\"225\" r=\"4.5\" fill=\"#f2f0ff\" stroke=\"#0b0c17\" stroke-width=\"1\"/><circle cx=\"46\" cy=\"255\" r=\"8.5\" fill=\"#e3829f\"/><text x=\"46\" y=\"258.6\" class=\"dg-sn\" text-anchor=\"middle\">1</text><rect x=\"32\" y=\"266\" width=\"112\" height=\"32\" rx=\"7\" fill=\"#12301c\" stroke=\"#5f9e6e\"/><text x=\"40\" y=\"280\" class=\"dg-okc\">✓ submitted</text><text x=\"40\" y=\"292\" class=\"dg-fv\">ID DV-2041 · pending</text><rect x=\"192\" y=\"90\" width=\"152\" height=\"76\" rx=\"7\" fill=\"#141528\" stroke=\"#e3829f\" stroke-width=\"1.6\"/><rect x=\"192\" y=\"90\" width=\"152\" height=\"18\" rx=\"7\" fill=\"#e3829f\"/><rect x=\"192\" y=\"101\" width=\"152\" height=\"7\" fill=\"#e3829f\"/><text x=\"200\" y=\"102.5\" class=\"dg-bd\">application.json</text><text x=\"200\" y=\"121\" class=\"dg-js\">name: &quot;R. Kumar&quot;</text><text x=\"200\" y=\"133\" class=\"dg-js\">type: &quot;locomotor&quot;</text><text x=\"200\" y=\"145\" class=\"dg-js\">cert: cert.pdf</text><text x=\"200\" y=\"157\" class=\"dg-js\">division: &quot;SC&quot;</text><path d=\"M146 225 C 170 225, 166 128, 188 128\" fill=\"none\" stroke=\"#e3829f\" stroke-width=\"1.5\"  marker-end=\"url(#a-cris)\"/><rect x=\"192\" y=\"204\" width=\"152\" height=\"44\" rx=\"9\" fill=\"#1b1c31\" stroke=\"#e3829f\" stroke-width=\"1.6\"/><g transform=\"translate(202 214.0)\" fill=\"none\" stroke=\"#e3829f\" stroke-width=\"1.7\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path d=\"M8 6 3.5 12 8 18M16 6l4.5 6L16 18M13.5 4.5l-3 15\"/></g><text x=\"232\" y=\"223\" class=\"dg-nt\">Node.js API</text><text x=\"232\" y=\"239\" class=\"dg-ns\">POST /applications</text><path d=\"M268 166 L268 200\" fill=\"none\" stroke=\"#e3829f\" stroke-width=\"1.5\"  marker-end=\"url(#a-cris)\"/><rect x=\"192\" y=\"276\" width=\"152\" height=\"44\" rx=\"9\" fill=\"#1b1c31\" stroke=\"#e3829f\" stroke-width=\"1.6\"/><g transform=\"translate(202 286.0)\" fill=\"none\" stroke=\"#e3829f\" stroke-width=\"1.7\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><ellipse cx=\"12\" cy=\"5.5\" rx=\"7.5\" ry=\"2.8\"/><path d=\"M4.5 5.5v13c0 1.5 3.4 2.8 7.5 2.8s7.5-1.3 7.5-2.8v-13\"/><path d=\"M4.5 12c0 1.5 3.4 2.8 7.5 2.8s7.5-1.3 7.5-2.8\"/></g><text x=\"232\" y=\"295\" class=\"dg-nt\">MySQL</text><text x=\"232\" y=\"311\" class=\"dg-ns\">applications table</text><path d=\"M268 248 L268 272\" fill=\"none\" stroke=\"#e3829f\" stroke-width=\"1.5\"  marker-end=\"url(#a-cris)\"/><rect x=\"350\" y=\"215\" width=\"78\" height=\"20\" rx=\"10\" fill=\"#1b1c31\" stroke=\"#3a3d5c\"/><text x=\"389\" y=\"228.5\" class=\"dg-cs\" text-anchor=\"middle\">tested · Postman</text><line x1=\"344\" y1=\"225\" x2=\"350\" y2=\"225\" stroke=\"#3a3d5c\"/><circle cx=\"176\" cy=\"262\" r=\"8.5\" fill=\"#e3829f\"/><text x=\"176\" y=\"265.6\" class=\"dg-sn\" text-anchor=\"middle\">2</text><g transform=\"translate(432 10)\" fill=\"none\" stroke=\"#e3829f\" stroke-width=\"1.7\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><circle cx=\"12\" cy=\"8\" r=\"3.6\"/><path d=\"M5 20c0-3.9 3.1-6.5 7-6.5s7 2.6 7 6.5\"/></g><text x=\"462\" y=\"27\" class=\"dg-devA\" fill=\"#e3829f\">OFFICIALS · WEB</text><rect x=\"432\" y=\"40\" width=\"196\" height=\"276\" rx=\"9\" fill=\"#141528\" stroke=\"#2f3252\"/><rect x=\"432\" y=\"40\" width=\"196\" height=\"22\" rx=\"9\" fill=\"#16172a\"/><rect x=\"432\" y=\"52\" width=\"196\" height=\"10\" fill=\"#16172a\"/><circle cx=\"444\" cy=\"51\" r=\"3.2\" fill=\"#3a3d5c\"/><circle cx=\"455\" cy=\"51\" r=\"3.2\" fill=\"#3a3d5c\"/><circle cx=\"466\" cy=\"51\" r=\"3.2\" fill=\"#3a3d5c\"/><rect x=\"478\" y=\"46\" width=\"138\" height=\"11\" rx=\"5.5\" fill=\"#24263f\"/><text x=\"486\" y=\"55\" class=\"dg-url\">cris · reports</text><text x=\"444\" y=\"80\" class=\"dg-nt\">Division-wise report</text><rect x=\"444\" y=\"90\" width=\"98\" height=\"18\" rx=\"4\" fill=\"#0b0c17\" stroke=\"#e3829f\"/><text x=\"450\" y=\"102.5\" class=\"dg-fv\">Division: all ▾</text><circle cx=\"528\" cy=\"104\" r=\"9\" fill=\"none\" stroke=\"#e3829f\" stroke-width=\"1.4\" opacity=\".75\"/><circle cx=\"528\" cy=\"104\" r=\"15\" fill=\"none\" stroke=\"#e3829f\" stroke-width=\"1\" opacity=\".35\"/><path d=\"M528 104 l0 15 l4 -4 l3 7 l3 -1.4 l-3 -7 l6 0 z\" fill=\"#f2f0ff\" stroke=\"#0b0c17\" stroke-width=\"1.1\" stroke-linejoin=\"round\"/><circle cx=\"560\" cy=\"99\" r=\"8.5\" fill=\"#e3829f\"/><text x=\"560\" y=\"102.6\" class=\"dg-sn\" text-anchor=\"middle\">3</text><rect x=\"448\" y=\"169\" width=\"20\" height=\"99\" rx=\"3\" fill=\"#e3829f\" opacity=\"0.45\"/><text x=\"458\" y=\"165\" class=\"dg-cv\" text-anchor=\"middle\">38</text><text x=\"458\" y=\"281\" class=\"dg-cv\" text-anchor=\"middle\">SC</text><rect x=\"477\" y=\"193\" width=\"20\" height=\"75\" rx=\"3\" fill=\"#e3829f\" opacity=\"0.54\"/><text x=\"487\" y=\"189\" class=\"dg-cv\" text-anchor=\"middle\">29</text><text x=\"487\" y=\"281\" class=\"dg-cv\" text-anchor=\"middle\">HYB</text><rect x=\"506\" y=\"154\" width=\"20\" height=\"114\" rx=\"3\" fill=\"#e3829f\" opacity=\"0.63\"/><text x=\"516\" y=\"150\" class=\"dg-cv\" text-anchor=\"middle\">44</text><text x=\"516\" y=\"281\" class=\"dg-cv\" text-anchor=\"middle\">BZA</text><rect x=\"535\" y=\"221\" width=\"20\" height=\"47\" rx=\"3\" fill=\"#e3829f\" opacity=\"0.72\"/><text x=\"545\" y=\"217\" class=\"dg-cv\" text-anchor=\"middle\">18</text><text x=\"545\" y=\"281\" class=\"dg-cv\" text-anchor=\"middle\">GTL</text><rect x=\"564\" y=\"208\" width=\"20\" height=\"60\" rx=\"3\" fill=\"#e3829f\" opacity=\"0.81\"/><text x=\"574\" y=\"204\" class=\"dg-cv\" text-anchor=\"middle\">23</text><text x=\"574\" y=\"281\" class=\"dg-cv\" text-anchor=\"middle\">GNT</text><rect x=\"593\" y=\"237\" width=\"20\" height=\"31\" rx=\"3\" fill=\"#e3829f\" opacity=\"0.90\"/><text x=\"603\" y=\"233\" class=\"dg-cv\" text-anchor=\"middle\">12</text><text x=\"603\" y=\"281\" class=\"dg-cv\" text-anchor=\"middle\">NED</text><line x1=\"444\" y1=\"269\" x2=\"618\" y2=\"269\" stroke=\"#3a3d5c\"/><rect x=\"444\" y=\"292\" width=\"56\" height=\"13\" rx=\"3\" fill=\"#e3829f\"/><text x=\"449\" y=\"301.5\" class=\"dg-bd\">OUTPUT</text><path d=\"M344 298 L428 298\" fill=\"none\" stroke=\"#e3829f\" stroke-width=\"1.5\" stroke-dasharray=\"4 4\" marker-end=\"url(#a-cris)\"/><text x=\"320\" y=\"338\" class=\"dg-lab\" text-anchor=\"middle\">applicants apply on a Flutter app — officials review applications by railway division</text></svg>"
  };

  /* Phone-width versions of the same five diagrams. Not a shrunk copy: a
     640-wide horizontal flow can't stay legible at phone width, so each is
     recomposed to run top-to-bottom at 360 wide. Both versions are written
     into the page and CSS shows one by screen width, so rotating a phone
     or resizing a window switches instantly with no script involved. */
  const PROJECT_DIAGRAMS_MOBILE = {
      "intrusion": "<svg class=\"dg-narrow\" viewBox=\"0 0 360 558\" xmlns=\"http://www.w3.org/2000/svg\" role=\"img\"><defs><marker id=\"a-nidsm\" viewBox=\"0 0 10 10\" refX=\"8.5\" refY=\"5\" markerWidth=\"7\" markerHeight=\"7\" orient=\"auto-start-reverse\"><path d=\"M0 0 L10 5 L0 10 z\" fill=\"#da8062\"/></marker></defs><rect x=\"16\" y=\"12\" width=\"328\" height=\"70\" rx=\"9\" fill=\"#0a0b16\" stroke=\"#2e3151\"/><rect x=\"16\" y=\"12\" width=\"328\" height=\"18\" rx=\"9\" fill=\"#15162a\"/><rect x=\"16\" y=\"22\" width=\"328\" height=\"8\" fill=\"#15162a\"/><circle cx=\"28\" cy=\"21\" r=\"3\" fill=\"#393c5b\"/><circle cx=\"38\" cy=\"21\" r=\"3\" fill=\"#393c5b\"/><circle cx=\"48\" cy=\"21\" r=\"3\" fill=\"#393c5b\"/><text x=\"28\" y=\"50\" class=\"dg-mtc\">$ sudo nids --iface eth0</text><text x=\"28\" y=\"70\" class=\"dg-mtw\">[!] 10.0.0.42 → blocked</text><rect x=\"16\" y=\"96\" width=\"328\" height=\"50\" rx=\"9\" fill=\"#0b0c17\" stroke=\"#3a3d5c\"/><text x=\"28\" y=\"126\" class=\"dg-mcap\" text-anchor=\"start\">live traffic · eth0</text><rect x=\"178\" y=\"106\" width=\"20\" height=\"11\" rx=\"2.5\" fill=\"#2f3252\"/><rect x=\"206\" y=\"122\" width=\"20\" height=\"11\" rx=\"2.5\" fill=\"#da8062\"/><rect x=\"234\" y=\"108\" width=\"20\" height=\"11\" rx=\"2.5\" fill=\"#2f3252\"/><rect x=\"262\" y=\"124\" width=\"20\" height=\"11\" rx=\"2.5\" fill=\"#da8062\"/><rect x=\"290\" y=\"108\" width=\"20\" height=\"11\" rx=\"2.5\" fill=\"#2f3252\"/><rect x=\"316\" y=\"122\" width=\"20\" height=\"11\" rx=\"2.5\" fill=\"#da8062\"/><path d=\"M40 150 L40 190\" fill=\"none\" stroke=\"#da8062\" stroke-width=\"1.5\"  marker-end=\"url(#a-nidsm)\"/><rect x=\"58\" y=\"153.0\" width=\"210\" height=\"34\" rx=\"17\" fill=\"#1b1c31\" stroke=\"#da8062\" stroke-width=\"1.3\"/><g transform=\"translate(66 158.0)\" fill=\"none\" stroke=\"#da8062\" stroke-width=\"1.7\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><circle cx=\"12\" cy=\"17.5\" r=\"1.7\" fill=\"#da8062\" stroke=\"none\"/><path d=\"M7.6 13.3a6.2 6.2 0 0 1 8.8 0\"/><path d=\"M4.6 10.2a10.4 10.4 0 0 1 14.8 0\"/></g><text x=\"96\" y=\"168.0\" class=\"dg-mct\">Capture</text><text x=\"96\" y=\"181.0\" class=\"dg-mcs\">raw packets via Scapy</text><rect x=\"16\" y=\"194\" width=\"328\" height=\"92\" rx=\"9\" fill=\"#141528\" stroke=\"#3a3d5c\" stroke-width=\"1\"/><text x=\"28\" y=\"218\" class=\"dg-mbw\">SYN  :22  10.0.0.42</text><text x=\"28\" y=\"236\" class=\"dg-mbw\">SYN  :23  10.0.0.42</text><text x=\"28\" y=\"254\" class=\"dg-mbw\">SYN  :80  10.0.0.42</text><text x=\"28\" y=\"272\" class=\"dg-mbd\">ACK  :443 10.0.0.7</text><text x=\"332\" y=\"212\" class=\"dg-mcap\" text-anchor=\"end\">packets</text><path d=\"M40 290 L40 330\" fill=\"none\" stroke=\"#da8062\" stroke-width=\"1.5\"  marker-end=\"url(#a-nidsm)\"/><rect x=\"58\" y=\"293.0\" width=\"210\" height=\"34\" rx=\"17\" fill=\"#1b1c31\" stroke=\"#da8062\" stroke-width=\"1.3\"/><g transform=\"translate(66 298.0)\" fill=\"none\" stroke=\"#da8062\" stroke-width=\"1.7\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><circle cx=\"10.5\" cy=\"10.5\" r=\"6.2\"/><path d=\"M15.1 15.1 20.6 20.6\"/><path d=\"M8 10.5h5M10.5 8v5\"/></g><text x=\"96\" y=\"308.0\" class=\"dg-mct\">Detect</text><text x=\"96\" y=\"321.0\" class=\"dg-mcs\">sliding time window</text><rect x=\"16\" y=\"334\" width=\"328\" height=\"72\" rx=\"9\" fill=\"#141528\" stroke=\"#da8062\" stroke-width=\"1.6\"/><rect x=\"16\" y=\"334\" width=\"328\" height=\"23\" rx=\"9\" fill=\"#da8062\"/><rect x=\"16\" y=\"346\" width=\"328\" height=\"11\" fill=\"#da8062\"/><text x=\"28\" y=\"350\" class=\"dg-mhd\">⚠ PORT SCAN</text><text x=\"28\" y=\"374\" class=\"dg-mb\">src 10.0.0.42 · 37 ports / 2 s</text><text x=\"28\" y=\"392\" class=\"dg-mb\">OS fingerprint: Linux 5.x</text><path d=\"M40 410 L40 450\" fill=\"none\" stroke=\"#da8062\" stroke-width=\"1.5\"  marker-end=\"url(#a-nidsm)\"/><rect x=\"58\" y=\"413.0\" width=\"210\" height=\"34\" rx=\"17\" fill=\"#1b1c31\" stroke=\"#da8062\" stroke-width=\"1.3\"/><g transform=\"translate(66 418.0)\" fill=\"none\" stroke=\"#da8062\" stroke-width=\"1.7\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path d=\"M12 2.6 19.4 5.5V11c0 5-3.3 8.4-7.4 10.4C7.9 19.4 4.6 16 4.6 11V5.5Z\"/><path d=\"M8.6 8.6l6.8 6.8\"/></g><text x=\"96\" y=\"428.0\" class=\"dg-mct\">Block</text><text x=\"96\" y=\"441.0\" class=\"dg-mcs\">automatic response</text><rect x=\"16\" y=\"454\" width=\"328\" height=\"90\" rx=\"9\" fill=\"#141528\" stroke=\"#da8062\" stroke-width=\"1.6\"/><rect x=\"16\" y=\"454\" width=\"328\" height=\"23\" rx=\"9\" fill=\"#da8062\"/><rect x=\"16\" y=\"466\" width=\"328\" height=\"11\" fill=\"#da8062\"/><text x=\"28\" y=\"470\" class=\"dg-mhd\">OUTPUT</text><text x=\"28\" y=\"494\" class=\"dg-mt\">DROP 10.0.0.42</text><text x=\"28\" y=\"512\" class=\"dg-mb\">iptables · Windows Firewall</text><text x=\"28\" y=\"530\" class=\"dg-mok\">✓ host protected</text></svg>",
      "agentic": "<svg class=\"dg-narrow\" viewBox=\"0 0 360 560\" xmlns=\"http://www.w3.org/2000/svg\" role=\"img\"><defs><marker id=\"a-aim\" viewBox=\"0 0 10 10\" refX=\"8.5\" refY=\"5\" markerWidth=\"7\" markerHeight=\"7\" orient=\"auto-start-reverse\"><path d=\"M0 0 L10 5 L0 10 z\" fill=\"#75c25b\"/></marker></defs><rect x=\"16\" y=\"12\" width=\"328\" height=\"70\" rx=\"9\" fill=\"#0a0b16\" stroke=\"#2e3151\"/><rect x=\"16\" y=\"12\" width=\"328\" height=\"18\" rx=\"9\" fill=\"#15162a\"/><rect x=\"16\" y=\"22\" width=\"328\" height=\"8\" fill=\"#15162a\"/><circle cx=\"28\" cy=\"21\" r=\"3\" fill=\"#393c5b\"/><circle cx=\"38\" cy=\"21\" r=\"3\" fill=\"#393c5b\"/><circle cx=\"48\" cy=\"21\" r=\"3\" fill=\"#393c5b\"/><text x=\"28\" y=\"50\" class=\"dg-mtc\">$ research papers/*.pdf</text><text x=\"28\" y=\"70\" class=\"dg-mtc\">[ok] survey.md · 11 citations</text><path d=\"M16 96 H102 L112 106 V158 H16 Z\" fill=\"#141528\" stroke=\"#3a3d5c\"/><text x=\"24\" y=\"114\" class=\"dg-mfv\">paper-1.pdf</text><rect x=\"24\" y=\"124\" width=\"78\" height=\"3.4\" rx=\"1.7\" fill=\"#2f3252\"/><rect x=\"24\" y=\"133\" width=\"78\" height=\"3.4\" rx=\"1.7\" fill=\"#2f3252\"/><rect x=\"24\" y=\"142\" width=\"50\" height=\"3.4\" rx=\"1.7\" fill=\"#2f3252\"/><path d=\"M122 96 H208 L218 106 V158 H122 Z\" fill=\"#141528\" stroke=\"#3a3d5c\"/><text x=\"130\" y=\"114\" class=\"dg-mfv\">paper-2.pdf</text><rect x=\"130\" y=\"124\" width=\"78\" height=\"3.4\" rx=\"1.7\" fill=\"#2f3252\"/><rect x=\"130\" y=\"133\" width=\"78\" height=\"3.4\" rx=\"1.7\" fill=\"#2f3252\"/><rect x=\"130\" y=\"142\" width=\"50\" height=\"3.4\" rx=\"1.7\" fill=\"#2f3252\"/><path d=\"M228 96 H314 L324 106 V158 H228 Z\" fill=\"#141528\" stroke=\"#3a3d5c\"/><text x=\"236\" y=\"114\" class=\"dg-mfv\">paper-3.pdf</text><rect x=\"236\" y=\"124\" width=\"78\" height=\"3.4\" rx=\"1.7\" fill=\"#2f3252\"/><rect x=\"236\" y=\"133\" width=\"78\" height=\"3.4\" rx=\"1.7\" fill=\"#2f3252\"/><rect x=\"236\" y=\"142\" width=\"50\" height=\"3.4\" rx=\"1.7\" fill=\"#2f3252\"/><path d=\"M40 162 L40 202\" fill=\"none\" stroke=\"#75c25b\" stroke-width=\"1.5\"  marker-end=\"url(#a-aim)\"/><rect x=\"58\" y=\"165.0\" width=\"210\" height=\"34\" rx=\"17\" fill=\"#1b1c31\" stroke=\"#75c25b\" stroke-width=\"1.3\"/><g transform=\"translate(66 170.0)\" fill=\"none\" stroke=\"#75c25b\" stroke-width=\"1.7\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><circle cx=\"5\" cy=\"12\" r=\"2\"/><circle cx=\"19\" cy=\"6\" r=\"2\"/><circle cx=\"19\" cy=\"18\" r=\"2\"/><path d=\"M7 12h4l6-5.4M11 12l6 5.4\"/></g><text x=\"96\" y=\"180.0\" class=\"dg-mct\">Router</text><text x=\"96\" y=\"193.0\" class=\"dg-mcs\">Llama 3.2 · splits &amp; routes</text><rect x=\"16\" y=\"206\" width=\"58\" height=\"40\" rx=\"5\" fill=\"#141528\" stroke=\"#75c25b\"/><rect x=\"24\" y=\"216\" width=\"42\" height=\"3.2\" rx=\"1.6\" fill=\"#2f3252\"/><rect x=\"24\" y=\"225\" width=\"42\" height=\"3.2\" rx=\"1.6\" fill=\"#2f3252\"/><rect x=\"24\" y=\"234\" width=\"26\" height=\"3.2\" rx=\"1.6\" fill=\"#2f3252\"/><rect x=\"82\" y=\"206\" width=\"58\" height=\"40\" rx=\"5\" fill=\"#141528\" stroke=\"#3a3d5c\"/><rect x=\"90\" y=\"216\" width=\"42\" height=\"3.2\" rx=\"1.6\" fill=\"#2f3252\"/><rect x=\"90\" y=\"225\" width=\"42\" height=\"3.2\" rx=\"1.6\" fill=\"#2f3252\"/><rect x=\"90\" y=\"234\" width=\"26\" height=\"3.2\" rx=\"1.6\" fill=\"#2f3252\"/><rect x=\"148\" y=\"206\" width=\"58\" height=\"40\" rx=\"5\" fill=\"#141528\" stroke=\"#3a3d5c\"/><rect x=\"156\" y=\"216\" width=\"42\" height=\"3.2\" rx=\"1.6\" fill=\"#2f3252\"/><rect x=\"156\" y=\"225\" width=\"42\" height=\"3.2\" rx=\"1.6\" fill=\"#2f3252\"/><rect x=\"156\" y=\"234\" width=\"26\" height=\"3.2\" rx=\"1.6\" fill=\"#2f3252\"/><rect x=\"214\" y=\"206\" width=\"58\" height=\"40\" rx=\"5\" fill=\"#141528\" stroke=\"#3a3d5c\"/><rect x=\"222\" y=\"216\" width=\"42\" height=\"3.2\" rx=\"1.6\" fill=\"#2f3252\"/><rect x=\"222\" y=\"225\" width=\"42\" height=\"3.2\" rx=\"1.6\" fill=\"#2f3252\"/><rect x=\"222\" y=\"234\" width=\"26\" height=\"3.2\" rx=\"1.6\" fill=\"#2f3252\"/><rect x=\"280\" y=\"206\" width=\"58\" height=\"40\" rx=\"5\" fill=\"#141528\" stroke=\"#3a3d5c\"/><rect x=\"288\" y=\"216\" width=\"42\" height=\"3.2\" rx=\"1.6\" fill=\"#2f3252\"/><rect x=\"288\" y=\"225\" width=\"42\" height=\"3.2\" rx=\"1.6\" fill=\"#2f3252\"/><rect x=\"288\" y=\"234\" width=\"26\" height=\"3.2\" rx=\"1.6\" fill=\"#2f3252\"/><text x=\"344\" y=\"262\" class=\"dg-mcap\" text-anchor=\"end\">chunks</text><path d=\"M40 272 L40 312\" fill=\"none\" stroke=\"#75c25b\" stroke-width=\"1.5\"  marker-end=\"url(#a-aim)\"/><rect x=\"58\" y=\"275.0\" width=\"210\" height=\"34\" rx=\"17\" fill=\"#1b1c31\" stroke=\"#75c25b\" stroke-width=\"1.3\"/><g transform=\"translate(66 280.0)\" fill=\"none\" stroke=\"#75c25b\" stroke-width=\"1.7\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path d=\"M4 6h16M4 10h12.5M4 14h9M4 18h5.5\"/></g><text x=\"96\" y=\"290.0\" class=\"dg-mct\">Summarise + critique</text><text x=\"96\" y=\"303.0\" class=\"dg-mcs\">map-reduce over chunks</text><rect x=\"16\" y=\"316\" width=\"158\" height=\"74\" rx=\"9\" fill=\"#141528\" stroke=\"#3a3d5c\" stroke-width=\"1\"/><text x=\"28\" y=\"340\" class=\"dg-mb\">· key claim</text><text x=\"28\" y=\"358\" class=\"dg-mb\">· method</text><text x=\"28\" y=\"376\" class=\"dg-mb\">· result</text><rect x=\"186\" y=\"316\" width=\"158\" height=\"74\" rx=\"9\" fill=\"#141528\" stroke=\"#3a3d5c\" stroke-width=\"1\"/><text x=\"198\" y=\"340\" class=\"dg-mok\">✓ supported</text><text x=\"198\" y=\"358\" class=\"dg-mbad\">✗ overstated</text><text x=\"198\" y=\"376\" class=\"dg-mok\">✓ cited</text><path d=\"M40 394 L40 434\" fill=\"none\" stroke=\"#75c25b\" stroke-width=\"1.5\"  marker-end=\"url(#a-aim)\"/><rect x=\"58\" y=\"397.0\" width=\"210\" height=\"34\" rx=\"17\" fill=\"#1b1c31\" stroke=\"#75c25b\" stroke-width=\"1.3\"/><g transform=\"translate(66 402.0)\" fill=\"none\" stroke=\"#75c25b\" stroke-width=\"1.7\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path d=\"M4 5c6 0 6 7 10 7M4 19c6 0 6-7 10-7h6\"/><path d=\"M17 9l3 3-3 3\"/></g><text x=\"96\" y=\"412.0\" class=\"dg-mct\">Synthesise</text><text x=\"96\" y=\"425.0\" class=\"dg-mcs\">Llama 3.1 · writes survey</text><rect x=\"16\" y=\"438\" width=\"328\" height=\"108\" rx=\"9\" fill=\"#141528\" stroke=\"#75c25b\" stroke-width=\"1.6\"/><rect x=\"16\" y=\"438\" width=\"328\" height=\"23\" rx=\"9\" fill=\"#75c25b\"/><rect x=\"16\" y=\"450\" width=\"328\" height=\"11\" fill=\"#75c25b\"/><text x=\"28\" y=\"454\" class=\"dg-mhd\">OUTPUT</text><text x=\"28\" y=\"478\" class=\"dg-mt\">Survey of 3 papers · 742 words</text><text x=\"28\" y=\"496\" class=\"dg-mb\">… builds on prior work  [1]</text><text x=\"28\" y=\"514\" class=\"dg-mb\">… differs in method  [2]</text><text x=\"28\" y=\"532\" class=\"dg-mb\">… confirms the result  [3]</text></svg>",
      "citestat": "<svg class=\"dg-narrow\" viewBox=\"0 0 360 320\" xmlns=\"http://www.w3.org/2000/svg\" role=\"img\"><defs><marker id=\"a-citem\" viewBox=\"0 0 10 10\" refX=\"8.5\" refY=\"5\" markerWidth=\"7\" markerHeight=\"7\" orient=\"auto-start-reverse\"><path d=\"M0 0 L10 5 L0 10 z\" fill=\"#5ab9d8\"/></marker></defs><rect x=\"16\" y=\"12\" width=\"328\" height=\"96\" rx=\"9\" fill=\"#141528\" stroke=\"#2f3252\"/><rect x=\"16\" y=\"12\" width=\"328\" height=\"22\" rx=\"9\" fill=\"#16172a\"/><rect x=\"16\" y=\"24\" width=\"328\" height=\"10\" fill=\"#16172a\"/><circle cx=\"28\" cy=\"23\" r=\"3.2\" fill=\"#3a3d5c\"/><circle cx=\"39\" cy=\"23\" r=\"3.2\" fill=\"#3a3d5c\"/><circle cx=\"50\" cy=\"23\" r=\"3.2\" fill=\"#3a3d5c\"/><rect x=\"62\" y=\"18\" width=\"270\" height=\"11\" rx=\"5.5\" fill=\"#24263f\"/><text x=\"70\" y=\"27\" class=\"dg-url\">citestat · search</text><rect x=\"28\" y=\"52\" width=\"210\" height=\"30\" rx=\"6\" fill=\"#0b0c17\" stroke=\"#5ab9d8\" stroke-width=\"1.4\"/><text x=\"38\" y=\"71\" class=\"dg-mfl\">Author name or DOI</text><rect x=\"246\" y=\"52\" width=\"86\" height=\"30\" rx=\"6\" fill=\"#5ab9d8\"/><text x=\"289\" y=\"71.5\" class=\"dg-mab\" text-anchor=\"middle\">Search</text><circle cx=\"324\" cy=\"76\" r=\"9\" fill=\"none\" stroke=\"#5ab9d8\" stroke-width=\"1.4\" opacity=\".75\"/><circle cx=\"324\" cy=\"76\" r=\"15\" fill=\"none\" stroke=\"#5ab9d8\" stroke-width=\"1\" opacity=\".35\"/><path d=\"M324 76 l0 15 l4 -4 l3 7 l3 -1.4 l-3 -7 l6 0 z\" fill=\"#f2f0ff\" stroke=\"#0b0c17\" stroke-width=\"1.1\" stroke-linejoin=\"round\"/><circle cx=\"38\" cy=\"98\" r=\"10\" fill=\"#5ab9d8\"/><text x=\"38\" y=\"101.8\" class=\"dg-msn\" text-anchor=\"middle\">1</text><text x=\"54\" y=\"102\" class=\"dg-mcap\" text-anchor=\"start\">search a researcher</text><path d=\"M40 112 L40 152\" fill=\"none\" stroke=\"#5ab9d8\" stroke-width=\"1.5\"  marker-end=\"url(#a-citem)\"/><rect x=\"58\" y=\"115.0\" width=\"210\" height=\"34\" rx=\"17\" fill=\"#1b1c31\" stroke=\"#5ab9d8\" stroke-width=\"1.3\"/><g transform=\"translate(66 120.0)\" fill=\"none\" stroke=\"#5ab9d8\" stroke-width=\"1.7\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path d=\"M8 6 3.5 12 8 18M16 6l4.5 6L16 18M13.5 4.5l-3 15\"/></g><text x=\"96\" y=\"130.0\" class=\"dg-mct\">Crossref API</text><text x=\"96\" y=\"143.0\" class=\"dg-mcs\">fetch citation records</text><rect x=\"16\" y=\"158\" width=\"328\" height=\"128\" rx=\"9\" fill=\"#141528\" stroke=\"#5ab9d8\" stroke-width=\"1.6\"/><rect x=\"16\" y=\"158\" width=\"328\" height=\"23\" rx=\"9\" fill=\"#5ab9d8\"/><rect x=\"16\" y=\"170\" width=\"328\" height=\"11\" fill=\"#5ab9d8\"/><text x=\"28\" y=\"174\" class=\"dg-mhd\">OUTPUT · computed in the browser</text><text x=\"30\" y=\"204\" class=\"dg-mcs\">h-index</text><text x=\"30\" y=\"242\" class=\"dg-mbig\" fill=\"#5ab9d8\">14</text><text x=\"30\" y=\"266\" class=\"dg-mcs\">m-quotient 1.2</text><rect x=\"148\" y=\"250\" width=\"18\" height=\"22\" rx=\"3\" fill=\"#5ab9d8\" opacity=\"0.40\"/><rect x=\"174\" y=\"234\" width=\"18\" height=\"38\" rx=\"3\" fill=\"#5ab9d8\" opacity=\"0.48\"/><rect x=\"200\" y=\"242\" width=\"18\" height=\"30\" rx=\"3\" fill=\"#5ab9d8\" opacity=\"0.56\"/><rect x=\"226\" y=\"220\" width=\"18\" height=\"52\" rx=\"3\" fill=\"#5ab9d8\" opacity=\"0.64\"/><rect x=\"252\" y=\"226\" width=\"18\" height=\"46\" rx=\"3\" fill=\"#5ab9d8\" opacity=\"0.72\"/><rect x=\"278\" y=\"208\" width=\"18\" height=\"64\" rx=\"3\" fill=\"#5ab9d8\" opacity=\"0.80\"/><rect x=\"304\" y=\"214\" width=\"18\" height=\"58\" rx=\"3\" fill=\"#5ab9d8\" opacity=\"0.88\"/><line x1=\"144\" y1=\"273\" x2=\"334\" y2=\"273\" stroke=\"#3a3d5c\"/><text x=\"16\" y=\"308\" class=\"dg-mcap\" text-anchor=\"start\">no backend server — everything runs client-side</text></svg>",
      "crdt": "<svg class=\"dg-narrow\" viewBox=\"0 0 360 406\" xmlns=\"http://www.w3.org/2000/svg\" role=\"img\"><defs><marker id=\"a-crdtmb\" viewBox=\"0 0 10 10\" refX=\"8.5\" refY=\"5\" markerWidth=\"7\" markerHeight=\"7\" orient=\"auto-start-reverse\"><path d=\"M0 0 L10 5 L0 10 z\" fill=\"#e6c069\"/></marker><marker id=\"a-crdtm\" viewBox=\"0 0 10 10\" refX=\"8.5\" refY=\"5\" markerWidth=\"7\" markerHeight=\"7\" orient=\"auto-start-reverse\"><path d=\"M0 0 L10 5 L0 10 z\" fill=\"#c888dd\"/></marker></defs><circle cx=\"28\" cy=\"20\" r=\"10\" fill=\"#c888dd\"/><text x=\"28\" y=\"23.8\" class=\"dg-msn\" text-anchor=\"middle\">1</text><text x=\"44\" y=\"24\" class=\"dg-mcap\" text-anchor=\"start\">both edit at once — the phone is offline</text><text x=\"24\" y=\"52\" class=\"dg-mdev\" fill=\"#c888dd\">LAPTOP</text><rect x=\"24\" y=\"62\" width=\"176\" height=\"62\" rx=\"7\" fill=\"#141528\" stroke=\"#c888dd\" stroke-width=\"2\"/><rect x=\"30\" y=\"68\" width=\"164\" height=\"50\" rx=\"3\" fill=\"#0e0f1d\"/><path d=\"M16 127 H208 L202 135 H22 Z\" fill=\"#1b1c31\" stroke=\"#c888dd\" stroke-width=\"2\"/><text x=\"38\" y=\"98\" class=\"dg-mtyp\">Hello <tspan fill=\"#c888dd\" font-weight=\"700\">big </tspan>world</text><g transform=\"translate(172 70)\" fill=\"none\" stroke=\"#9ad09a\" stroke-width=\"1.7\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><circle cx=\"12\" cy=\"17.5\" r=\"1.7\" fill=\"#9ad09a\" stroke=\"none\"/><path d=\"M7.6 13.3a6.2 6.2 0 0 1 8.8 0\"/><path d=\"M4.6 10.2a10.4 10.4 0 0 1 14.8 0\"/></g><text x=\"220\" y=\"52\" class=\"dg-mdev\" fill=\"#e6c069\">PHONE</text><rect x=\"220\" y=\"62\" width=\"124\" height=\"96\" rx=\"16\" fill=\"#141528\" stroke=\"#e6c069\" stroke-width=\"2\"/><rect x=\"226\" y=\"68\" width=\"112\" height=\"84\" rx=\"11\" fill=\"#0e0f1d\"/><text x=\"234\" y=\"94\" class=\"dg-mtyp\">Hello</text><text x=\"234\" y=\"112\" class=\"dg-mtyp\">world<tspan fill=\"#e6c069\" font-weight=\"700\">!</tspan></text><g transform=\"translate(312 70)\" fill=\"none\" stroke=\"#e08b8b\" stroke-width=\"1.7\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><circle cx=\"12\" cy=\"17.5\" r=\"1.7\" fill=\"#e08b8b\" stroke=\"none\"/><path d=\"M7.6 13.3a6.2 6.2 0 0 1 8.8 0\"/><path d=\"M4.6 10.2a10.4 10.4 0 0 1 14.8 0\"/><path d=\"M4 4l16 16\"/></g><rect x=\"230\" y=\"130\" width=\"104\" height=\"16\" rx=\"8\" fill=\"#2a2210\" stroke=\"#e6c069\"/><text x=\"282\" y=\"141.5\" class=\"dg-moff\" text-anchor=\"middle\">offline · 1 queued</text><rect x=\"100\" y=\"192\" width=\"160\" height=\"46\" rx=\"9\" fill=\"#1b1c31\" stroke=\"#c888dd\" stroke-width=\"1.6\"/><g transform=\"translate(110 203.0)\" fill=\"none\" stroke=\"#c888dd\" stroke-width=\"1.7\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path d=\"M4 5c6 0 6 7 10 7M4 19c6 0 6-7 10-7h6\"/><path d=\"M17 9l3 3-3 3\"/></g><text x=\"140\" y=\"211\" class=\"dg-nt\">Relay</text><text x=\"140\" y=\"227\" class=\"dg-ns\">WebSocket · RGA</text><path d=\"M106 156 C 106 186, 70 215, 96 215\" fill=\"none\" stroke=\"#c888dd\" stroke-width=\"1.5\"  marker-end=\"url(#a-crdtm)\"/><path d=\"M282 146 C 282 186, 290 215, 264 215\" fill=\"none\" stroke=\"#e6c069\" stroke-width=\"1.5\" stroke-dasharray=\"4 4\" marker-end=\"url(#a-crdtmb)\"/><text x=\"270\" y=\"172\" class=\"dg-mcap\" text-anchor=\"end\">sent on reconnect</text><path d=\"M150 238 C 120 252, 106 252, 106 266\" fill=\"none\" stroke=\"#e6c069\" stroke-width=\"1.5\" stroke-dasharray=\"4 4\" marker-end=\"url(#a-crdtmb)\"/><path d=\"M210 238 C 240 252, 282 252, 282 266\" fill=\"none\" stroke=\"#c888dd\" stroke-width=\"1.5\" stroke-dasharray=\"4 4\" marker-end=\"url(#a-crdtm)\"/><rect x=\"24\" y=\"278\" width=\"176\" height=\"62\" rx=\"7\" fill=\"#141528\" stroke=\"#c888dd\" stroke-width=\"2\"/><rect x=\"30\" y=\"284\" width=\"164\" height=\"50\" rx=\"3\" fill=\"#0e0f1d\"/><path d=\"M16 343 H208 L202 351 H22 Z\" fill=\"#1b1c31\" stroke=\"#c888dd\" stroke-width=\"2\"/><text x=\"38\" y=\"314\" class=\"dg-mtyp\">Hello <tspan fill=\"#c888dd\" font-weight=\"700\">big </tspan>world<tspan fill=\"#e6c069\" font-weight=\"700\">!</tspan></text><g transform=\"translate(172 286)\" fill=\"none\" stroke=\"#9ad09a\" stroke-width=\"1.7\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><circle cx=\"12\" cy=\"17.5\" r=\"1.7\" fill=\"#9ad09a\" stroke=\"none\"/><path d=\"M7.6 13.3a6.2 6.2 0 0 1 8.8 0\"/><path d=\"M4.6 10.2a10.4 10.4 0 0 1 14.8 0\"/></g><rect x=\"220\" y=\"278\" width=\"124\" height=\"96\" rx=\"16\" fill=\"#141528\" stroke=\"#e6c069\" stroke-width=\"2\"/><rect x=\"226\" y=\"284\" width=\"112\" height=\"84\" rx=\"11\" fill=\"#0e0f1d\"/><text x=\"234\" y=\"310\" class=\"dg-mtyp\">Hello <tspan fill=\"#c888dd\" font-weight=\"700\">big</tspan></text><text x=\"234\" y=\"328\" class=\"dg-mtyp\">world<tspan fill=\"#e6c069\" font-weight=\"700\">!</tspan></text><g transform=\"translate(312 286)\" fill=\"none\" stroke=\"#9ad09a\" stroke-width=\"1.7\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><circle cx=\"12\" cy=\"17.5\" r=\"1.7\" fill=\"#9ad09a\" stroke=\"none\"/><path d=\"M7.6 13.3a6.2 6.2 0 0 1 8.8 0\"/><path d=\"M4.6 10.2a10.4 10.4 0 0 1 14.8 0\"/></g><circle cx=\"28\" cy=\"386\" r=\"10\" fill=\"#c888dd\"/><text x=\"28\" y=\"389.8\" class=\"dg-msn\" text-anchor=\"middle\">2</text><text x=\"44\" y=\"390\" class=\"dg-mcap\" text-anchor=\"start\">back online — both converge, nothing lost</text></svg>",
      "cris": "<svg class=\"dg-narrow\" viewBox=\"0 0 360 550\" xmlns=\"http://www.w3.org/2000/svg\" role=\"img\"><defs><marker id=\"a-crism\" viewBox=\"0 0 10 10\" refX=\"8.5\" refY=\"5\" markerWidth=\"7\" markerHeight=\"7\" orient=\"auto-start-reverse\"><path d=\"M0 0 L10 5 L0 10 z\" fill=\"#e3829f\"/></marker></defs><g transform=\"translate(16 6)\" fill=\"none\" stroke=\"#e3829f\" stroke-width=\"1.7\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><circle cx=\"12\" cy=\"8\" r=\"3.6\"/><path d=\"M5 20c0-3.9 3.1-6.5 7-6.5s7 2.6 7 6.5\"/></g><text x=\"44\" y=\"22\" class=\"dg-mdev\" fill=\"#e3829f\">APPLICANT · APP</text><rect x=\"16\" y=\"30\" width=\"150\" height=\"234\" rx=\"20\" fill=\"#141528\" stroke=\"#e3829f\" stroke-width=\"2\"/><rect x=\"23\" y=\"37\" width=\"136\" height=\"220\" rx=\"14\" fill=\"#0e0f1d\"/><rect x=\"30\" y=\"48\" width=\"122\" height=\"24\" rx=\"5\" fill=\"#e3829f\"/><text x=\"38\" y=\"64\" class=\"dg-mab\">Divyangjan Card</text><text x=\"32\" y=\"88\" class=\"dg-mfl\">Name</text><rect x=\"32\" y=\"93\" width=\"118\" height=\"20\" rx=\"4\" fill=\"#0b0c17\" stroke=\"#3a3d5c\"/><text x=\"38\" y=\"107\" class=\"dg-mfv\">R. Kumar</text><text x=\"32\" y=\"128\" class=\"dg-mfl\">Disability</text><rect x=\"32\" y=\"133\" width=\"118\" height=\"20\" rx=\"4\" fill=\"#0b0c17\" stroke=\"#3a3d5c\"/><text x=\"38\" y=\"147\" class=\"dg-mfv\">Locomotor</text><text x=\"144\" y=\"147\" class=\"dg-mfv\" text-anchor=\"end\">▾</text><text x=\"32\" y=\"168\" class=\"dg-mfl\">Division</text><rect x=\"32\" y=\"173\" width=\"118\" height=\"20\" rx=\"4\" fill=\"#0b0c17\" stroke=\"#3a3d5c\"/><text x=\"38\" y=\"187\" class=\"dg-mfv\">Secunderabad</text><text x=\"144\" y=\"187\" class=\"dg-mfv\" text-anchor=\"end\">▾</text><rect x=\"32\" y=\"212\" width=\"118\" height=\"26\" rx=\"6\" fill=\"#e3829f\"/><text x=\"91.0\" y=\"229\" class=\"dg-mab\" text-anchor=\"middle\">Submit</text><circle cx=\"132\" cy=\"225\" r=\"13\" fill=\"none\" stroke=\"#e3829f\" stroke-width=\"1\" opacity=\".4\"/><circle cx=\"132\" cy=\"225\" r=\"4.5\" fill=\"#f2f0ff\" stroke=\"#0b0c17\" stroke-width=\"1\"/><circle cx=\"158\" cy=\"258\" r=\"10\" fill=\"#e3829f\"/><text x=\"158\" y=\"261.8\" class=\"dg-msn\" text-anchor=\"middle\">1</text><rect x=\"186\" y=\"30\" width=\"158\" height=\"92\" rx=\"8\" fill=\"#141528\" stroke=\"#e3829f\" stroke-width=\"1.6\"/><rect x=\"186\" y=\"30\" width=\"158\" height=\"21\" rx=\"8\" fill=\"#e3829f\"/><rect x=\"186\" y=\"41\" width=\"158\" height=\"10\" fill=\"#e3829f\"/><text x=\"196\" y=\"45\" class=\"dg-mhd\">application.json</text><text x=\"196\" y=\"70\" class=\"dg-mbw\">name: \"R. Kumar\"</text><text x=\"196\" y=\"87\" class=\"dg-mbw\">type: \"locomotor\"</text><text x=\"196\" y=\"104\" class=\"dg-mbw\">division: \"SC\"</text><path d=\"M166 170 C 178 170, 172 76, 183 76\" fill=\"none\" stroke=\"#e3829f\" stroke-width=\"1.5\"  marker-end=\"url(#a-crism)\"/><path d=\"M265.0 122 L265.0 138\" fill=\"none\" stroke=\"#e3829f\" stroke-width=\"1.5\"  marker-end=\"url(#a-crism)\"/><rect x=\"186\" y=\"142\" width=\"158\" height=\"44\" rx=\"9\" fill=\"#1b1c31\" stroke=\"#e3829f\" stroke-width=\"1.6\"/><g transform=\"translate(196 152.0)\" fill=\"none\" stroke=\"#e3829f\" stroke-width=\"1.7\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path d=\"M8 6 3.5 12 8 18M16 6l4.5 6L16 18M13.5 4.5l-3 15\"/></g><text x=\"226\" y=\"161\" class=\"dg-nt\">Node.js API</text><text x=\"226\" y=\"177\" class=\"dg-ns\">POST /applications</text><path d=\"M265.0 186 L265.0 202\" fill=\"none\" stroke=\"#e3829f\" stroke-width=\"1.5\"  marker-end=\"url(#a-crism)\"/><rect x=\"186\" y=\"206\" width=\"158\" height=\"44\" rx=\"9\" fill=\"#1b1c31\" stroke=\"#e3829f\" stroke-width=\"1.6\"/><g transform=\"translate(196 216.0)\" fill=\"none\" stroke=\"#e3829f\" stroke-width=\"1.7\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><ellipse cx=\"12\" cy=\"5.5\" rx=\"7.5\" ry=\"2.8\"/><path d=\"M4.5 5.5v13c0 1.5 3.4 2.8 7.5 2.8s7.5-1.3 7.5-2.8v-13\"/><path d=\"M4.5 12c0 1.5 3.4 2.8 7.5 2.8s7.5-1.3 7.5-2.8\"/></g><text x=\"226\" y=\"225\" class=\"dg-nt\">MySQL</text><text x=\"226\" y=\"241\" class=\"dg-ns\">applications</text><circle cx=\"176\" cy=\"196\" r=\"10\" fill=\"#e3829f\"/><text x=\"176\" y=\"199.8\" class=\"dg-msn\" text-anchor=\"middle\">2</text><path d=\"M265.0 260 C 265.0 278, 180 274, 180 296\" fill=\"none\" stroke=\"#e3829f\" stroke-width=\"1.5\" stroke-dasharray=\"4 4\" marker-end=\"url(#a-crism)\"/><g transform=\"translate(16 300)\" fill=\"none\" stroke=\"#e3829f\" stroke-width=\"1.7\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><circle cx=\"12\" cy=\"8\" r=\"3.6\"/><path d=\"M5 20c0-3.9 3.1-6.5 7-6.5s7 2.6 7 6.5\"/></g><text x=\"44\" y=\"316\" class=\"dg-mdev\" fill=\"#e3829f\">OFFICIALS · WEB</text><rect x=\"16\" y=\"326\" width=\"328\" height=\"190\" rx=\"9\" fill=\"#141528\" stroke=\"#2f3252\"/><rect x=\"16\" y=\"326\" width=\"328\" height=\"22\" rx=\"9\" fill=\"#16172a\"/><rect x=\"16\" y=\"338\" width=\"328\" height=\"10\" fill=\"#16172a\"/><circle cx=\"28\" cy=\"337\" r=\"3.2\" fill=\"#3a3d5c\"/><circle cx=\"39\" cy=\"337\" r=\"3.2\" fill=\"#3a3d5c\"/><circle cx=\"50\" cy=\"337\" r=\"3.2\" fill=\"#3a3d5c\"/><rect x=\"62\" y=\"332\" width=\"270\" height=\"11\" rx=\"5.5\" fill=\"#24263f\"/><text x=\"70\" y=\"341\" class=\"dg-url\">cris · reports</text><text x=\"28\" y=\"370\" class=\"dg-mt\">Division-wise report</text><rect x=\"240\" y=\"356\" width=\"92\" height=\"22\" rx=\"5\" fill=\"#0b0c17\" stroke=\"#e3829f\"/><text x=\"248\" y=\"371\" class=\"dg-mfv\">Division ▾</text><circle cx=\"322\" cy=\"374\" r=\"9\" fill=\"none\" stroke=\"#e3829f\" stroke-width=\"1.4\" opacity=\".75\"/><circle cx=\"322\" cy=\"374\" r=\"15\" fill=\"none\" stroke=\"#e3829f\" stroke-width=\"1\" opacity=\".35\"/><path d=\"M322 374 l0 15 l4 -4 l3 7 l3 -1.4 l-3 -7 l6 0 z\" fill=\"#f2f0ff\" stroke=\"#0b0c17\" stroke-width=\"1.1\" stroke-linejoin=\"round\"/><circle cx=\"224\" cy=\"367\" r=\"10\" fill=\"#e3829f\"/><text x=\"224\" y=\"370.8\" class=\"dg-msn\" text-anchor=\"middle\">3</text><rect x=\"38\" y=\"410\" width=\"32\" height=\"80\" rx=\"3\" fill=\"#e3829f\" opacity=\"0.45\"/><text x=\"54\" y=\"405\" class=\"dg-mcs\" text-anchor=\"middle\">38</text><text x=\"54\" y=\"505\" class=\"dg-mcs\" text-anchor=\"middle\">SC</text><rect x=\"88\" y=\"429\" width=\"32\" height=\"61\" rx=\"3\" fill=\"#e3829f\" opacity=\"0.54\"/><text x=\"104\" y=\"424\" class=\"dg-mcs\" text-anchor=\"middle\">29</text><text x=\"104\" y=\"505\" class=\"dg-mcs\" text-anchor=\"middle\">HYB</text><rect x=\"138\" y=\"398\" width=\"32\" height=\"92\" rx=\"3\" fill=\"#e3829f\" opacity=\"0.63\"/><text x=\"154\" y=\"393\" class=\"dg-mcs\" text-anchor=\"middle\">44</text><text x=\"154\" y=\"505\" class=\"dg-mcs\" text-anchor=\"middle\">BZA</text><rect x=\"188\" y=\"452\" width=\"32\" height=\"38\" rx=\"3\" fill=\"#e3829f\" opacity=\"0.72\"/><text x=\"204\" y=\"447\" class=\"dg-mcs\" text-anchor=\"middle\">18</text><text x=\"204\" y=\"505\" class=\"dg-mcs\" text-anchor=\"middle\">GTL</text><rect x=\"238\" y=\"442\" width=\"32\" height=\"48\" rx=\"3\" fill=\"#e3829f\" opacity=\"0.81\"/><text x=\"254\" y=\"437\" class=\"dg-mcs\" text-anchor=\"middle\">23</text><text x=\"254\" y=\"505\" class=\"dg-mcs\" text-anchor=\"middle\">GNT</text><rect x=\"288\" y=\"465\" width=\"32\" height=\"25\" rx=\"3\" fill=\"#e3829f\" opacity=\"0.90\"/><text x=\"304\" y=\"460\" class=\"dg-mcs\" text-anchor=\"middle\">12</text><text x=\"304\" y=\"505\" class=\"dg-mcs\" text-anchor=\"middle\">NED</text><line x1=\"30\" y1=\"491\" x2=\"330\" y2=\"491\" stroke=\"#3a3d5c\"/><text x=\"16\" y=\"538\" class=\"dg-mcap\" text-anchor=\"start\">officials review applications by railway division</text></svg>"
  };

  /* Card thumbnails: one shared 3:1 shape for every featured project — four
     tiles ending in the output — so collapsed cards on phones look like a set.
     The detailed diagrams have different shapes (CRDT is nearly square), which
     made the thumbnails come out different sizes. Desktop and opened cards keep
     using the detailed versions. */
  const PROJECT_DIAGRAMS_THUMB = {
      "intrusion": "<svg class=\"dg-thumb\" preserveAspectRatio=\"xMidYMid slice\" viewBox=\"0 0 600 200\" xmlns=\"http://www.w3.org/2000/svg\" role=\"img\"><defs><marker id=\"a-nidst\" viewBox=\"0 0 10 10\" refX=\"8.5\" refY=\"5\" markerWidth=\"7\" markerHeight=\"7\" orient=\"auto-start-reverse\"><path d=\"M0 0 L10 5 L0 10 z\" fill=\"#da8062\"/></marker></defs><rect x=\"4\" y=\"14\" width=\"88\" height=\"172\" rx=\"13\" fill=\"#141528\" stroke=\"#3a3d5c\" stroke-width=\"1.5\"/><g transform=\"translate(21.599999999999998 55.599999999999994) scale(2.2)\" fill=\"none\" stroke=\"#da8062\" stroke-width=\"1.45\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><circle cx=\"12\" cy=\"12\" r=\"3\"/><circle cx=\"4\" cy=\"5\" r=\"2\"/><circle cx=\"20\" cy=\"5\" r=\"2\"/><circle cx=\"4\" cy=\"19\" r=\"2\"/><circle cx=\"20\" cy=\"19\" r=\"2\"/><path d=\"M5.6 6.3 9.7 10M18.4 6.3 14.3 10M5.6 17.7 9.7 14M18.4 17.7 14.3 14\"/></g><text x=\"48.0\" y=\"150\" class=\"dg-tl\" text-anchor=\"middle\">Network</text><rect x=\"108\" y=\"14\" width=\"88\" height=\"172\" rx=\"13\" fill=\"#141528\" stroke=\"#3a3d5c\" stroke-width=\"1.5\"/><g transform=\"translate(125.6 55.599999999999994) scale(2.2)\" fill=\"none\" stroke=\"#da8062\" stroke-width=\"1.45\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><circle cx=\"10.5\" cy=\"10.5\" r=\"6.2\"/><path d=\"M15.1 15.1 20.6 20.6\"/><path d=\"M8 10.5h5M10.5 8v5\"/></g><text x=\"152.0\" y=\"150\" class=\"dg-tl\" text-anchor=\"middle\">Detect</text><rect x=\"212\" y=\"14\" width=\"88\" height=\"172\" rx=\"13\" fill=\"#141528\" stroke=\"#3a3d5c\" stroke-width=\"1.5\"/><g transform=\"translate(229.6 55.599999999999994) scale(2.2)\" fill=\"none\" stroke=\"#da8062\" stroke-width=\"1.45\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path d=\"M12 2.6 19.4 5.5V11c0 5-3.3 8.4-7.4 10.4C7.9 19.4 4.6 16 4.6 11V5.5Z\"/><path d=\"M8.6 8.6l6.8 6.8\"/></g><text x=\"256.0\" y=\"150\" class=\"dg-tl\" text-anchor=\"middle\">Block</text><rect x=\"316\" y=\"14\" width=\"280\" height=\"172\" rx=\"13\" fill=\"#141528\" stroke=\"#da8062\" stroke-width=\"2.5\"/><path d=\"M316 27 a13 13 0 0 1 13 -13 h254 a13 13 0 0 1 13 13 v19 h-280 z\" fill=\"#da8062\"/><text x=\"330\" y=\"35\" class=\"dg-to\">OUTPUT</text><text x=\"332\" y=\"78\" class=\"dg-ob\" text-anchor=\"start\">DROP 10.0.0.42</text><text x=\"332\" y=\"106\" class=\"dg-od\" text-anchor=\"start\">port scan · 37 ports / 2s</text><text x=\"332\" y=\"130\" class=\"dg-od\" text-anchor=\"start\">iptables · Win Firewall</text><text x=\"332\" y=\"162\" class=\"dg-og\" text-anchor=\"start\">✓ attacker blocked</text><path d=\"M94 100.0 L105 100.0\" fill=\"none\" stroke=\"#da8062\" stroke-width=\"1.5\"  marker-end=\"url(#a-nidst)\"/><path d=\"M198 100.0 L209 100.0\" fill=\"none\" stroke=\"#da8062\" stroke-width=\"1.5\"  marker-end=\"url(#a-nidst)\"/><path d=\"M302 100.0 L313 100.0\" fill=\"none\" stroke=\"#da8062\" stroke-width=\"1.5\"  marker-end=\"url(#a-nidst)\"/></svg>",
      "agentic": "<svg class=\"dg-thumb\" preserveAspectRatio=\"xMidYMid slice\" viewBox=\"0 0 600 200\" xmlns=\"http://www.w3.org/2000/svg\" role=\"img\"><defs><marker id=\"a-ait\" viewBox=\"0 0 10 10\" refX=\"8.5\" refY=\"5\" markerWidth=\"7\" markerHeight=\"7\" orient=\"auto-start-reverse\"><path d=\"M0 0 L10 5 L0 10 z\" fill=\"#75c25b\"/></marker></defs><rect x=\"4\" y=\"14\" width=\"88\" height=\"172\" rx=\"13\" fill=\"#141528\" stroke=\"#3a3d5c\" stroke-width=\"1.5\"/><path d=\"M19.0 50 h24 l10 10 v32 h-34 z\" fill=\"#141528\" stroke=\"#75c25b\" stroke-width=\"2\"/><path d=\"M43.0 50 v10 h10\" fill=\"none\" stroke=\"#75c25b\" stroke-width=\"2\"/><path d=\"M33.0 60 h24 l10 10 v32 h-34 z\" fill=\"#141528\" stroke=\"#75c25b\" stroke-width=\"2\"/><path d=\"M57.0 60 v10 h10\" fill=\"none\" stroke=\"#75c25b\" stroke-width=\"2\"/><path d=\"M47.0 70 h24 l10 10 v32 h-34 z\" fill=\"#141528\" stroke=\"#75c25b\" stroke-width=\"2\"/><path d=\"M71.0 70 v10 h10\" fill=\"none\" stroke=\"#75c25b\" stroke-width=\"2\"/><rect x=\"47.0\" y=\"88\" width=\"27\" height=\"12\" rx=\"2.5\" fill=\"#75c25b\"/><text x=\"60.5\" y=\"97.5\" class=\"dg-tp\" text-anchor=\"middle\">PDF</text><text x=\"48.0\" y=\"150\" class=\"dg-tl\" text-anchor=\"middle\">PDFs</text><rect x=\"108\" y=\"14\" width=\"88\" height=\"172\" rx=\"13\" fill=\"#141528\" stroke=\"#3a3d5c\" stroke-width=\"1.5\"/><g transform=\"translate(125.6 55.599999999999994) scale(2.2)\" fill=\"none\" stroke=\"#75c25b\" stroke-width=\"1.45\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><circle cx=\"5\" cy=\"12\" r=\"2\"/><circle cx=\"19\" cy=\"6\" r=\"2\"/><circle cx=\"19\" cy=\"18\" r=\"2\"/><path d=\"M7 12h4l6-5.4M11 12l6 5.4\"/></g><text x=\"152.0\" y=\"150\" class=\"dg-tl\" text-anchor=\"middle\">Router</text><rect x=\"212\" y=\"14\" width=\"88\" height=\"172\" rx=\"13\" fill=\"#141528\" stroke=\"#3a3d5c\" stroke-width=\"1.5\"/><g transform=\"translate(229.6 55.599999999999994) scale(2.2)\" fill=\"none\" stroke=\"#75c25b\" stroke-width=\"1.45\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path d=\"M4 6h16M4 10h12.5M4 14h9M4 18h5.5\"/></g><text x=\"256.0\" y=\"150\" class=\"dg-tl\" text-anchor=\"middle\">Summary</text><rect x=\"316\" y=\"14\" width=\"280\" height=\"172\" rx=\"13\" fill=\"#141528\" stroke=\"#75c25b\" stroke-width=\"2.5\"/><path d=\"M316 27 a13 13 0 0 1 13 -13 h254 a13 13 0 0 1 13 13 v19 h-280 z\" fill=\"#75c25b\"/><text x=\"330\" y=\"35\" class=\"dg-to\">OUTPUT</text><text x=\"332\" y=\"78\" class=\"dg-ob\" text-anchor=\"start\">Survey of 3 papers</text><text x=\"332\" y=\"104\" class=\"dg-od\" text-anchor=\"start\">742 words · 11 citations</text><rect x=\"332\" y=\"118\" width=\"186\" height=\"4\" rx=\"2\" fill=\"#3a3d5c\"/><text x=\"526\" y=\"123\" class=\"dg-oc\" fill=\"#75c25b\">[1]</text><rect x=\"332\" y=\"135\" width=\"160\" height=\"4\" rx=\"2\" fill=\"#3a3d5c\"/><text x=\"500\" y=\"140\" class=\"dg-oc\" fill=\"#75c25b\">[2]</text><rect x=\"332\" y=\"152\" width=\"176\" height=\"4\" rx=\"2\" fill=\"#3a3d5c\"/><text x=\"516\" y=\"157\" class=\"dg-oc\" fill=\"#75c25b\">[3]</text><path d=\"M94 100.0 L105 100.0\" fill=\"none\" stroke=\"#75c25b\" stroke-width=\"1.5\"  marker-end=\"url(#a-ait)\"/><path d=\"M198 100.0 L209 100.0\" fill=\"none\" stroke=\"#75c25b\" stroke-width=\"1.5\"  marker-end=\"url(#a-ait)\"/><path d=\"M302 100.0 L313 100.0\" fill=\"none\" stroke=\"#75c25b\" stroke-width=\"1.5\"  marker-end=\"url(#a-ait)\"/></svg>",
      "citestat": "<svg class=\"dg-thumb\" preserveAspectRatio=\"xMidYMid slice\" viewBox=\"0 0 600 200\" xmlns=\"http://www.w3.org/2000/svg\" role=\"img\"><defs><marker id=\"a-citet\" viewBox=\"0 0 10 10\" refX=\"8.5\" refY=\"5\" markerWidth=\"7\" markerHeight=\"7\" orient=\"auto-start-reverse\"><path d=\"M0 0 L10 5 L0 10 z\" fill=\"#5ab9d8\"/></marker></defs><rect x=\"4\" y=\"14\" width=\"88\" height=\"172\" rx=\"13\" fill=\"#141528\" stroke=\"#3a3d5c\" stroke-width=\"1.5\"/><g transform=\"translate(21.599999999999998 55.599999999999994) scale(2.2)\" fill=\"none\" stroke=\"#5ab9d8\" stroke-width=\"1.45\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><circle cx=\"12\" cy=\"8\" r=\"3.6\"/><path d=\"M5 20c0-3.9 3.1-6.5 7-6.5s7 2.6 7 6.5\"/></g><text x=\"48.0\" y=\"150\" class=\"dg-tl\" text-anchor=\"middle\">Author</text><rect x=\"108\" y=\"14\" width=\"88\" height=\"172\" rx=\"13\" fill=\"#141528\" stroke=\"#3a3d5c\" stroke-width=\"1.5\"/><g transform=\"translate(125.6 55.599999999999994) scale(2.2)\" fill=\"none\" stroke=\"#5ab9d8\" stroke-width=\"1.45\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path d=\"M8 6 3.5 12 8 18M16 6l4.5 6L16 18M13.5 4.5l-3 15\"/></g><text x=\"152.0\" y=\"150\" class=\"dg-tl\" text-anchor=\"middle\">Crossref</text><rect x=\"212\" y=\"14\" width=\"88\" height=\"172\" rx=\"13\" fill=\"#141528\" stroke=\"#3a3d5c\" stroke-width=\"1.5\"/><g transform=\"translate(229.6 55.599999999999994) scale(2.2)\" fill=\"none\" stroke=\"#5ab9d8\" stroke-width=\"1.45\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path d=\"M5 20V13M10 20V8M15 20v-5M20 20V4M3 20.5h18\"/></g><text x=\"256.0\" y=\"150\" class=\"dg-tl\" text-anchor=\"middle\">Analyse</text><rect x=\"316\" y=\"14\" width=\"280\" height=\"172\" rx=\"13\" fill=\"#141528\" stroke=\"#5ab9d8\" stroke-width=\"2.5\"/><path d=\"M316 27 a13 13 0 0 1 13 -13 h254 a13 13 0 0 1 13 13 v19 h-280 z\" fill=\"#5ab9d8\"/><text x=\"330\" y=\"35\" class=\"dg-to\">OUTPUT</text><text x=\"332\" y=\"114\" class=\"dg-obig\" text-anchor=\"start\">14</text><text x=\"332\" y=\"138\" class=\"dg-od\" text-anchor=\"start\">h-index</text><text x=\"332\" y=\"162\" class=\"dg-od\" text-anchor=\"start\">m-quotient 1.2</text><rect x=\"492\" y=\"138\" width=\"9\" height=\"26\" rx=\"2\" fill=\"#5ab9d8\" opacity=\"0.45\"/><rect x=\"506\" y=\"120\" width=\"9\" height=\"44\" rx=\"2\" fill=\"#5ab9d8\" opacity=\"0.54\"/><rect x=\"520\" y=\"130\" width=\"9\" height=\"34\" rx=\"2\" fill=\"#5ab9d8\" opacity=\"0.63\"/><rect x=\"534\" y=\"104\" width=\"9\" height=\"60\" rx=\"2\" fill=\"#5ab9d8\" opacity=\"0.72\"/><rect x=\"548\" y=\"112\" width=\"9\" height=\"52\" rx=\"2\" fill=\"#5ab9d8\" opacity=\"0.81\"/><rect x=\"562\" y=\"90\" width=\"9\" height=\"74\" rx=\"2\" fill=\"#5ab9d8\" opacity=\"0.90\"/><rect x=\"576\" y=\"98\" width=\"9\" height=\"66\" rx=\"2\" fill=\"#5ab9d8\" opacity=\"0.99\"/><line x1=\"488\" y1=\"165\" x2=\"582\" y2=\"165\" stroke=\"#3a3d5c\" stroke-width=\"1.5\"/><text x=\"582\" y=\"78\" class=\"dg-og\" text-anchor=\"end\">no backend</text><path d=\"M94 100.0 L105 100.0\" fill=\"none\" stroke=\"#5ab9d8\" stroke-width=\"1.5\"  marker-end=\"url(#a-citet)\"/><path d=\"M198 100.0 L209 100.0\" fill=\"none\" stroke=\"#5ab9d8\" stroke-width=\"1.5\"  marker-end=\"url(#a-citet)\"/><path d=\"M302 100.0 L313 100.0\" fill=\"none\" stroke=\"#5ab9d8\" stroke-width=\"1.5\"  marker-end=\"url(#a-citet)\"/></svg>",
      "crdt": "<svg class=\"dg-thumb\" preserveAspectRatio=\"xMidYMid slice\" viewBox=\"0 0 600 200\" xmlns=\"http://www.w3.org/2000/svg\" role=\"img\"><defs><marker id=\"a-crdttb\" viewBox=\"0 0 10 10\" refX=\"8.5\" refY=\"5\" markerWidth=\"7\" markerHeight=\"7\" orient=\"auto-start-reverse\"><path d=\"M0 0 L10 5 L0 10 z\" fill=\"#e6c069\"/></marker><marker id=\"a-crdtt\" viewBox=\"0 0 10 10\" refX=\"8.5\" refY=\"5\" markerWidth=\"7\" markerHeight=\"7\" orient=\"auto-start-reverse\"><path d=\"M0 0 L10 5 L0 10 z\" fill=\"#c888dd\"/></marker></defs><rect x=\"14\" y=\"10\" width=\"164\" height=\"50\" rx=\"6\" fill=\"#141528\" stroke=\"#c888dd\" stroke-width=\"2.2\"/><path d=\"M7 63 H185 L180 70 H12 Z\" fill=\"#1b1c31\" stroke=\"#c888dd\" stroke-width=\"2.2\"/><text x=\"26\" y=\"41\" class=\"dg-dt\">Hello <tspan fill=\"#c888dd\" font-weight=\"700\">big </tspan>world</text><rect x=\"14\" y=\"84\" width=\"104\" height=\"104\" rx=\"14\" fill=\"#141528\" stroke=\"#e6c069\" stroke-width=\"2.2\"/><rect x=\"54.0\" y=\"90\" width=\"24\" height=\"4\" rx=\"2\" fill=\"#3a3d5c\"/><text x=\"26\" y=\"132\" class=\"dg-dt\">Hello</text><text x=\"26\" y=\"156\" class=\"dg-dt\">world<tspan fill=\"#e6c069\" font-weight=\"700\">!</tspan></text><g transform=\"translate(92.36 99.36) scale(0.72)\" fill=\"none\" stroke=\"#e08b8b\" stroke-width=\"1.45\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><circle cx=\"12\" cy=\"17.5\" r=\"1.7\" fill=\"#e08b8b\" stroke=\"none\"/><path d=\"M7.6 13.3a6.2 6.2 0 0 1 8.8 0\"/><path d=\"M4.6 10.2a10.4 10.4 0 0 1 14.8 0\"/><path d=\"M4 4l16 16\"/></g><rect x=\"422\" y=\"10\" width=\"164\" height=\"50\" rx=\"6\" fill=\"#141528\" stroke=\"#c888dd\" stroke-width=\"2.2\"/><path d=\"M415 63 H593 L588 70 H420 Z\" fill=\"#1b1c31\" stroke=\"#c888dd\" stroke-width=\"2.2\"/><text x=\"434\" y=\"41\" class=\"dg-dt\">Hello <tspan fill=\"#c888dd\" font-weight=\"700\">big </tspan>world<tspan fill=\"#e6c069\" font-weight=\"700\">!</tspan></text><rect x=\"422\" y=\"84\" width=\"104\" height=\"104\" rx=\"14\" fill=\"#141528\" stroke=\"#e6c069\" stroke-width=\"2.2\"/><rect x=\"462.0\" y=\"90\" width=\"24\" height=\"4\" rx=\"2\" fill=\"#3a3d5c\"/><text x=\"434\" y=\"132\" class=\"dg-dt\">Hello <tspan fill=\"#c888dd\" font-weight=\"700\">big</tspan></text><text x=\"434\" y=\"156\" class=\"dg-dt\">world<tspan fill=\"#e6c069\" font-weight=\"700\">!</tspan></text><g transform=\"translate(500.36 99.36) scale(0.72)\" fill=\"none\" stroke=\"#9ad09a\" stroke-width=\"1.45\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><circle cx=\"12\" cy=\"17.5\" r=\"1.7\" fill=\"#9ad09a\" stroke=\"none\"/><path d=\"M7.6 13.3a6.2 6.2 0 0 1 8.8 0\"/><path d=\"M4.6 10.2a10.4 10.4 0 0 1 14.8 0\"/></g><rect x=\"250\" y=\"66\" width=\"100\" height=\"64\" rx=\"12\" fill=\"#141528\" stroke=\"#3a3d5c\" stroke-width=\"1.6\"/><g transform=\"translate(284.4 72.4) scale(1.3)\" fill=\"none\" stroke=\"#c888dd\" stroke-width=\"1.45\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path d=\"M4 5c6 0 6 7 10 7M4 19c6 0 6-7 10-7h6\"/><path d=\"M17 9l3 3-3 3\"/></g><text x=\"300\" y=\"120\" class=\"dg-tl\" text-anchor=\"middle\">Relay</text><path d=\"M186 36 C 215 36, 220 84, 246 86\" fill=\"none\" stroke=\"#c888dd\" stroke-width=\"1.5\"  marker-end=\"url(#a-crdtt)\"/><path d=\"M122 136 C 200 136, 222 116, 246 112\" fill=\"none\" stroke=\"#e6c069\" stroke-width=\"1.5\" stroke-dasharray=\"4 4\" marker-end=\"url(#a-crdttb)\"/><path d=\"M354 86 C 380 84, 386 36, 412 36\" fill=\"none\" stroke=\"#c888dd\" stroke-width=\"1.5\"  marker-end=\"url(#a-crdtt)\"/><path d=\"M354 112 C 380 116, 392 136, 418 136\" fill=\"none\" stroke=\"#e6c069\" stroke-width=\"1.5\"  marker-end=\"url(#a-crdttb)\"/><text x=\"300\" y=\"168\" class=\"dg-og\" text-anchor=\"middle\">✓ both edits kept</text></svg>"
  };

  function diagramFor(title) {
    const media = SITE_CONFIG.media || {};
    if (media.showDiagrams === false) return '';
    if ((media.hiddenDiagrams || {})[title]) return '';
    const t = String(title || '').toLowerCase().replace(/\./g, '');
    const key = Object.keys(PROJECT_DIAGRAMS).find(k => t.indexOf(k) >= 0);
    if (!key) return '';
    const wide = PROJECT_DIAGRAMS[key].replace('<svg ', '<svg class="dg-wide" ');
    const narrow = PROJECT_DIAGRAMS_MOBILE[key] || '';
    const thumb = PROJECT_DIAGRAMS_THUMB[key] || '';
    return '<figure class="proj-diagram" data-diagram="' + key + '">' +
             wide + narrow + thumb +
           '</figure>';
  }


  /* Where a project's diagram goes. Four layouts, chosen with
     media.diagramPlacement:
       beside  text on the left, diagram on the right (stacks on narrow screens)
       below   full width, after the description and stack
       top     full width, leading the entry, before the title
       toggle  collapsed behind a "How it works" control
     Returns the pieces each renderer drops into place, so the two renderers
     can't drift apart in how they handle it. */
  /* ---------- Project media: image, GIF, or both ----------
     Each showcased project can carry a diagram (the "image") and, once you
     make one, a GIF or short video. media.featuredMedia picks which to show
     — "image", "gif" or "both" — and media.mediaMode[title] overrides it per
     project. A project with no GIF yet always falls back to its image, so
     choosing "gif" early never leaves a blank slot.

     GIF paths live in media.gifs[title], relative to media.imageDir.
     .mp4 / .webm play like a GIF (autoplay, muted, looping) at a fraction
     of the size, so they're accepted too. */
  function gifFor(title) {
    const media = SITE_CONFIG.media || {};
    const g = (media.gifs || {})[title];
    if (!g) return '';
    const src = /^(https?:|\/|data:)/.test(g) ? g : (media.imageDir || 'assets/') + g;
    const alt = escapeHTML(title) + ' in action';
    if (/\.(mp4|webm)(\?|$)/i.test(src)) {
      return '<figure class="proj-gif-frame"><video class="proj-gif" src="' + escapeHTML(src) +
             '" autoplay muted loop playsinline preload="metadata" aria-label="' + alt + '"></video></figure>';
    }
    return '<figure class="proj-gif-frame"><img class="proj-gif" src="' + escapeHTML(src) +
           '" alt="' + alt + '" loading="lazy" decoding="async"></figure>';
  }
  function mediaModeFor(title) {
    const media = SITE_CONFIG.media || {};
    return (media.mediaMode || {})[title] || media.featuredMedia || 'image';
  }
  function mediaRow(title) {
    const fig = diagramFor(title);
    const gif = gifFor(title);
    let mode = mediaModeFor(title);
    if (!gif) mode = 'image';            /* no GIF yet: the image stands in */
    if (!fig && gif) mode = 'gif';
    if (!fig && !gif) return '';
    if (mode === 'gif')  return '<div class="dg-media is-gif">' + gif + '</div>';
    if (mode === 'both') return '<div class="dg-media is-both">' + fig + gif + '</div>';
    return '<div class="dg-media is-image">' + fig + '</div>';
  }

  /* Where a project's media goes. media.diagramPlacement:
       wide    title, then the media across the full width, then the text
               (default — nothing is left empty beside a short image)
       beside  text on the left, media on the right
       below   full width, after the text
       top     full width, before the title
       toggle  collapsed behind a "How it works" control */
  function placeDiagram(title) {
    const fig = mediaRow(title);
    const mode = ((SITE_CONFIG.media || {}).diagramPlacement) || 'wide';
    const out = { top: '', wide: '', below: '', side: '', cls: '', inline: false, mode: mode };
    if (!fig) return out;
    if (mode === 'top') out.top = fig;
    else if (mode === 'below') out.below = fig;
    else if (mode === 'toggle') {
      out.below = '<details class="dg-toggle"><summary>How it works</summary>' + fig + '</details>';
    } else if (mode === 'beside') {
      out.side = '<div class="dg-side">' + fig + '</div>';
      out.cls = ' dg-beside';
      out.inline = true;
    } else {
      out.wide = fig;
      out.cls = ' dg-widelayout';
      out.inline = true;               /* no right-hand column: links go inline */
    }
    return out;
  }


  /* ---------- Compact cards on phones ----------
     On a phone each project collapses to its visual plus one line of text,
     with the rest behind a More toggle, so the whole list can be scanned
     before choosing what to read. Desktop is untouched: the toggle is hidden
     there and nothing collapses. Turn it off with media.mobileCollapse =
     false. */
  function mCollapseOn() { return ((SITE_CONFIG.media || {}).mobileCollapse) !== false; }
  function mToggle() {
    if (!mCollapseOn()) return '';
    return '<button type="button" class="m-more" aria-expanded="false">' +
             '<span class="m-more-l">More</span><span class="m-more-c" aria-hidden="true">\u25be</span>' +
           '</button>';
  }
  function mCls() { return mCollapseOn() ? ' m-collapsible' : ''; }

  let _mBound = false;
  function bindMobileToggles() {
    if (_mBound) return; _mBound = true;
    const setOpen = (card, open) => {
      card.classList.toggle('is-open', open);
      const btn = card.querySelector(':scope > .m-more');
      if (btn) {
        btn.setAttribute('aria-expanded', String(open));
        const l = btn.querySelector('.m-more-l'); if (l) l.textContent = open ? 'Less' : 'More';
      }
    };
    document.addEventListener('click', e => {
      const cb = e.target.closest ? e.target.closest('.course-cert') : null;
      if (cb) { certPopup(cb.dataset.cert, cb.dataset.name); return; }
      /* Featured projects: swap the summary line for the bullets and back. */
      const fm = e.target.closest ? e.target.closest('.feat-more') : null;
      if (fm) {
        const card = fm.closest('.work-item');
        const on = !card.classList.contains('is-detail');
        card.classList.toggle('is-detail', on);
        fm.setAttribute('aria-expanded', String(on));
        const fl = fm.querySelector('.feat-more-l');
        if (fl) fl.textContent = on ? 'Summary' : 'Details';
        return;
      }
      /* Selected-coursework names on a phone are compact pills; tapping one
         opens the block so its description can be read. */
      const pill = e.target.closest ? e.target.closest('#courses-featured:not(.m-open) .course-card') : null;
      if (pill && window.matchMedia('(max-width: 640px)').matches) {
        const blk = document.getElementById('courses-featured');
        blk.classList.add('m-open');
        const hd = blk.querySelector('.course-featured-head');
        if (hd) hd.setAttribute('aria-expanded', 'true');
        setTimeout(() => pill.scrollIntoView({ block: 'center', behavior: 'smooth' }), 40);
        return;
      }
      const btn = e.target.closest ? e.target.closest('.m-more') : null;
      if (btn) {
        const card = btn.parentNode;
        const opening = !card.classList.contains('is-open');
        setOpen(card, opening);
        /* Closing a long card would leave you far below it; bring its top
           back into view so you keep your place in the list. */
        if (!opening && card.getBoundingClientRect().top < 0) {
          card.scrollIntoView({ block: 'start', behavior: 'smooth' });
        }
        return;
      }
      /* A collapsed project card opens when tapped anywhere on it (links
         still work as links). Only opening — closing stays on the chevron,
         so reading or selecting text in an open card doesn't snap it shut. */
      const pc = e.target.closest
        ? e.target.closest('.pc-card.m-collapsible:not(.is-open), .work-item.m-collapsible:not(.is-open)')
        : null;
      /* On a collapsed tile the title is still a link to the repo; a tap
         there should open the tile, not leave the site. The repo link is
         reachable once it's open. */
      const titleLink = pc && e.target.closest ? e.target.closest('h3 a, h4 a') : null;
      if (pc && (!e.target.closest('a') || titleLink) &&
          window.matchMedia('(max-width: 640px)').matches) {
        if (titleLink) e.preventDefault();
        setOpen(pc, true);
        /* A featured tile jumps from half width to full width when it opens;
           keep its top in view so the reader lands on what they tapped. */
        if (pc.classList.contains('feature')) {
          setTimeout(() => pc.scrollIntoView({ block: 'start', behavior: 'smooth' }), 30);
        }
        return;
      }
      /* Course blocks on phones: tapping a heading shows or hides the
         courses beneath it. Category rows already toggle on their label. */
      const ch = e.target.closest ? e.target.closest('.course-featured-head, .course-online-head') : null;
      if (ch && window.matchMedia('(max-width: 640px)').matches) {
        const blk = ch.parentNode;
        const open = !blk.classList.contains('m-open');
        blk.classList.toggle('m-open', open);
        ch.setAttribute('aria-expanded', String(open));
        return;
      }
      /* Tapping the faded diagram preview opens the card too — it's the
         thing that looks tappable. */
      const fig = e.target.closest ? e.target.closest('.m-collapsible:not(.is-open) .proj-diagram') : null;
      if (fig && window.matchMedia('(max-width: 640px)').matches) {
        setOpen(fig.closest('.m-collapsible'), true);
      }
    });
  }


  /* Trim each diagram to what's actually drawn. The drawings were authored
     with a margin inside their viewBox, and on short phones a full-width
     image box letterboxed the scaled-down drawing with bands of background
     either side — both read as padding. Measuring the drawn content and
     setting the viewBox to it (plus a hair for stroke widths), and an
     aspect-ratio to match, lets the box hug the drawing exactly. */
  function fitDiagramBoxes() {
    document.querySelectorAll('.proj-diagram svg:not(.dg-thumb)').forEach(svg => {
      if (svg.dataset.fitted) return;
      let bb;
      try { bb = svg.getBBox(); } catch (e) { return; }
      if (!bb || !bb.width || !bb.height) return;    /* hidden right now: try later */
      const pad = 3;
      const x = bb.x - pad, y = bb.y - pad, w = bb.width + pad * 2, h = bb.height + pad * 2;
      svg.setAttribute('viewBox', x + ' ' + y + ' ' + w + ' ' + h);
      svg.style.aspectRatio = w + ' / ' + h;
      svg.style.setProperty('--ar', (w / h).toFixed(4));   /* for CSS width maths */
      svg.dataset.fitted = '1';
    });
  }


  /* ---------- Phone menu ----------
     At phone width the nav bar's links are hidden, so a menu button lists
     every section actually on the page — built from the sections themselves,
     in page order, so it can't drift from the layout. Tapping one scrolls to
     it and closes the menu; tapping outside or pressing Esc closes it too. */
  function buildMobileMenu() {
    const bar = document.querySelector('.topbar');
    if (!bar || bar.querySelector('.m-menu-btn')) return;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'm-menu-btn';
    btn.setAttribute('aria-label', 'Menu');
    btn.setAttribute('aria-expanded', 'false');
    btn.innerHTML = '<span></span><span></span><span></span>';
    /* a div with role=navigation, not a <nav>: the phone rules that hide the
       desktop nav's links target `.topbar nav`, and would hide these too */
    const panel = document.createElement('div');
    panel.setAttribute('role', 'navigation');
    panel.className = 'm-menu';
    panel.setAttribute('aria-label', 'Sections');
    const fill = () => {
      const secs = [...document.querySelectorAll('.shell > section[id]')]
        .filter(s => s.id !== 'hero' && s.offsetParent !== null && getComputedStyle(s).display !== 'none');
      panel.innerHTML = secs.map(s => {
        /* Short section names, not the headings: "What I studied." makes a
           poor menu item where "Courses" is clear. */
        const NAMES = { Work: 'Experience', Featured: 'Selected projects', Projects: 'All projects' };
        const key = (s.querySelector('[data-section-title]') || {}).getAttribute
          ? s.querySelector('[data-section-title]').getAttribute('data-section-title') : '';
        const label = NAMES[key] || key || (s.id.charAt(0).toUpperCase() + s.id.slice(1).replace(/-.*/, ''));
        return '<a href="#' + s.id + '">' + escapeHTML(label) + '</a>';
      }).join('');
    };
    const setOpen = open => {
      bar.classList.toggle('m-nav-open', open);
      btn.setAttribute('aria-expanded', String(open));
      if (open) fill();
    };
    btn.addEventListener('click', e => { e.stopPropagation(); setOpen(!bar.classList.contains('m-nav-open')); });
    panel.addEventListener('click', e => {
      const a = e.target.closest('a'); if (!a) return;
      e.preventDefault();
      setOpen(false);
      const t = document.querySelector(a.getAttribute('href'));
      if (t) {
        /* Layout position, not the on-screen one: a section that hasn't
           revealed yet is still offset by its fade-in slide, and measuring
           that made the scroll overshoot and tuck it under the sticky bar. */
        let y = 0;
        for (let n = t; n; n = n.offsetParent) y += n.offsetTop;
        window.scrollTo({ top: Math.max(0, y - bar.offsetHeight - 6), behavior: 'smooth' });
      }
    });
    document.addEventListener('click', e => {
      if (bar.classList.contains('m-nav-open') && !e.target.closest('.m-menu, .m-menu-btn')) setOpen(false);
    });
    document.addEventListener('keydown', e => { if (e.key === 'Escape') setOpen(false); });
    bar.appendChild(btn);
    bar.appendChild(panel);
  }

  let _featurePalette = null;

  function renderFeaturedItem(project, index, opts) {
    opts = opts || {};
    const showDescription = opts.showDescription !== false;
    const links = normalizeLinks(project);
    const num = String(index + 1).padStart(2, '0');
    const domain = (project.domains || [])[0] || 'Project';
    const leaves = (project.leaves || []).filter(l => l !== domain).slice(0, 3);

    /* Each feature takes its domain's hue, so the four read as a set of
       distinct pieces of work rather than four copies of one template. */
    /* The palette must be built across ALL domains at once: it assigns hues
       by position in the list, so building it per project gave every
       project's first domain position 0 — the same colour four times. */
    const hue = (_featurePalette && _featurePalette[domain]) || '';

    const titleEl = links.length
      ? '<a href="' + escapeHTML(links[0].url) + '" target="_blank" rel="noopener">' +
          escapeHTML(project.title) + '</a>'
      : escapeHTML(project.title);
    const showDesc = showDescription && project.description && !project.hideDescription;
    /* The one-line description and the bullets say the same thing at two
       lengths, so only one shows at a time: the line by default, the bullets
       once "Details" is pressed (on phones, once the card is opened). A
       project with only one of the two simply shows it. */
    const swap = !!(showDesc && Array.isArray(project.bullets) && project.bullets.length);

    const P = placeDiagram(project.title);
    const meta = entryTile(project.title || '') + renderLinks(links);
    /* Beside mode needs the right-hand column for the diagram, so the links
       move into the body instead. */
    return '<article class="work-item feature' + P.cls + mCls() + (swap ? ' has-detail' : '') +
        '" data-entry="' + escapeHTML(project.title || '') + '"' +
        (hue ? ' style="--feat:' + hue + '"' : '') + '>' +
      '<div class="feat-rail">' +
        '<span class="feat-num">' + num + '</span>' +
        '<span class="feat-domain">' + escapeHTML(domain) + '</span>' +
        (leaves.length
          ? '<span class="feat-leaves">' +
              leaves.map(l => '<span>' + escapeHTML(l) + '</span>').join('') + '</span>'
          : '') +
      '</div>' +
      '<div class="feat-body">' +
        P.top +
        '<h3>' + entryMark(project.title || '') + titleEl + '</h3>' +
        P.wide +
        (project.role ? '<div class="role">' + escapeHTML(project.role) + '</div>' : '') +
        (showDesc ? '<p class="feat-lede">' + escapeHTML(project.description) + '</p>' : '') +
        (project.summary ? '<p>' + escapeHTML(project.summary) + '</p>' : '') +
        renderBullets(project.bullets) +
        (swap ? '<button type="button" class="feat-more" aria-expanded="false">' +
                  '<span class="feat-more-l">Details</span>' +
                  '<span class="feat-more-c" aria-hidden="true">\u25be</span></button>' : '') +
        renderStack(project.stack, 'stack', project.category) +
        P.below +
        (P.inline ? '<div class="feat-meta-inline">' + meta + '</div>' : '') +
      '</div>' +
      (P.side ? P.side : P.inline ? '' : '<div class="meta-right">' + meta + '</div>') +
      mToggle() +
    '</article>';
  }

  /* All-projects card: title + category + chips + link are always
     visible; description and bullets sit inside a <details> dropdown
     so the list stays compact by default. Open state controlled by
     opts.expandByDefault (config: sections.expandAllProjectsByDefault). */
  function renderCompactItem(project, opts) {
    opts = opts || {};
    const expandByDefault = !!opts.expandByDefault;
    const showDescription = opts.showDescription !== false;
    const links = normalizeLinks(project);
    const titleEl = links.length
      ? '<a href="' + escapeHTML(links[0].url) + '" target="_blank" rel="noopener">' + escapeHTML(project.title) + '</a>'
      : escapeHTML(project.title);

    const hasDescription = showDescription && project.description && !project.hideDescription;
    const hasBullets     = Array.isArray(project.bullets) && project.bullets.length;
    const hasDropdown    = hasDescription || hasBullets;

    let dropdownHtml = '';
    if (hasDropdown) {
      const openAttr = expandByDefault ? ' open' : '';
      let inner = '';
      if (hasDescription) {
        inner += '<p class="pc-description">' + escapeHTML(project.description) + '</p>';
      }
      if (hasBullets) {
        inner += '<ul class="pc-bullets">' +
          project.bullets.map(b => '<li>' + escapeHTML(b) + '</li>').join('') +
        '</ul>';
      }
      dropdownHtml =
        '<details class="pc-details"' + openAttr + '>' +
          '<summary class="pc-summary">' +
            '<span class="pc-summary-label">Details</span>' +
          '</summary>' +
          '<div class="pc-content">' + inner + '</div>' +
        '</details>';
    }

    return '<article class="project-compact">' +
      '<header class="pc-head">' +
        '<h4 class="pc-title">' + titleEl + '</h4>' +
        (project.category ? '<span class="pc-cat">' + escapeHTML(project.category) + '</span>' : '') +
      '</header>' +
      '<div class="pc-foot">' +
        renderStack(project.stack, 'pc-stack', project.category) +
        renderLinks(links) +
      '</div>' +
      dropdownHtml +
    '</article>';
  }

  /* Reserve the meta column across a whole work list on the same
     principle: consistent placement beats per-row optimisation. */
  function markAnyTile(containerId, names) {
    const el = document.getElementById(containerId);
    if (!el) return;
    el.classList.toggle('has-any-tile', names.some(n => entryTile(n)));
  }

  function renderProjects(projects, opts) {
    opts = opts || {};
    const categoryOrder = opts.categoryOrder;
    const groupByCat    = opts.groupByCategory !== false;
    const compactOpts   = {
      expandByDefault: !!opts.expandAllProjects,
      showDescription: opts.showDescriptions !== false
    };
    const featuredOpts  = {
      showDescription: opts.showDescriptions !== false
    };

    /* Inverted default: a project is in "Selected work" only when
       projects.js explicitly sets `featured: true`. Every project is
       in "All projects" by default; `featuredOnly: true` removes a
       featured project from the All-projects mirror. */
    const featured = projects.filter(p => p.featured === true);
    const rest     = projects.filter(p => !(p.featured === true && p.featuredOnly === true));

    /* ---- Selected work (featured) ---- */
    const featuredEl = document.getElementById('featured-projects');
    if (featuredEl) {
      if (!featured.length) {
        featuredEl.innerHTML = '';
      } else {
        markAnyTile('featured-projects', featured.map(p => p.title || ''));
        const hasCategories = featured.some(p => p.category);
        if (groupByCat && hasCategories) {
          const groups = groupByCategory(featured, categoryOrder);
          let runningIdx = 0;
          featuredEl.innerHTML = groups.map(g => {
            if (!_featurePalette) {
              try {
                _featurePalette = spreadHues(uniqueStrings(
                  featured.map(p => (p.domains || [])[0]).filter(Boolean)));
              } catch (e) { _featurePalette = null; }
            }
            const items = g.projects.map(p => renderFeaturedItem(p, runningIdx++, featuredOpts)).join('');
            return '<div class="project-group work-group" id="work-cat-' + slug(g.category) + '">' +
              '<h3 class="project-group-head">' + escapeHTML(g.category) +
                '</h3>' +
              '<div class="project-group-list">' + items + '</div>' +
            '</div>';
          }).join('');
        } else {
          /* Spread hues across only the featured projects' lead domains.
             Built from all 17 domains, neighbours crowded — Security and
             Distributed Systems both came out green. Four cards spread
             evenly around the wheel are maximally distinct. */
          try {
            _featurePalette = spreadHues(uniqueStrings(
              featured.map(p => (p.domains || [])[0]).filter(Boolean)));
          } catch (e) { _featurePalette = null; }
          featuredEl.innerHTML = featured.map((p, i) => renderFeaturedItem(p, i, featuredOpts)).join('');
        }
      }
    }

    /* ---- All projects — hand off to the filterable explorer ---- */
    const allEl      = document.getElementById('all-projects');
    const allSection = document.getElementById('projects-all');
    if (!allEl) return;
    if (!rest.length) {
      if (allSection) allSection.style.display = 'none';
      return;
    }
    if (allSection) allSection.style.display = '';
    initProjectExplorer(rest);
  }

  /* ----------------------------------------------------------
     6b. Project explorer — filters, connector lines, grouping
     ----------------------------------------------------------
     Wide screens: filter rail + SVG connector lines to matching
     cards (lanes / hover-isolation / staggered anchors).
     Narrow screens: filter chips, and the list regroups with
     multi-filter matches first.
     ---------------------------------------------------------- */

  const PF = {
    projects: [],
    sel: { domain: [], tech: [], status: [] },
    logic: 'hybrid',
    hover: null,
    palette: {}
  };

  /* Colour per domain, pulled from a repeating accent ramp so it
     follows whichever palette stylesheet is active. */
  function buildDomainPalette(domains) {
    const css = getComputedStyle(document.documentElement);
    const read = n => (css.getPropertyValue(n) || '').trim();
    const ramp = [
      read('--accent') || '#8a5a44',
      read('--ink-soft') || '#5c5344',
      read('--accent-2') || '#4a6b8a',
      read('--muted') || '#8a7e6a'
    ].filter(Boolean);
    /* Spread hues around the accent so adjacent domains stay distinct
       even when the palette only defines one or two accents. */
    /* Explicit per-domain colours from site-config.json win; anything not
       pinned falls back to a hue-rotated accent so new domains still get a
       distinct colour without needing configuration. */
    const pinned = (SITE_CONFIG.colors && SITE_CONFIG.colors.domains) || {};
    const map = {};
    domains.forEach((d, i) => {
      if (pinned[d]) { map[d] = pinned[d]; return; }
      const base = ramp[i % ramp.length];
      map[d] = shiftHue(base, (i * 47) % 360, i);
    });
    return map;
  }

  function shiftHue(hex, deg, idx) {
    const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex || '');
    if (!m) return hex || '#666';
    let r = parseInt(m[1], 16) / 255, g = parseInt(m[2], 16) / 255, b = parseInt(m[3], 16) / 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    let h, s, l = (max + min) / 2;
    if (max === min) { h = s = 0; }
    else {
      const d = max - min;
      s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
      if (max === r) h = ((g - b) / d + (g < b ? 6 : 0));
      else if (max === g) h = (b - r) / d + 2;
      else h = (r - g) / d + 4;
      h /= 6;
    }
    h = (h * 360 + deg) % 360 / 360;
    s = Math.min(0.72, Math.max(0.34, s + (idx % 2 ? 0.06 : -0.03)));
    l = Math.min(0.56, Math.max(0.32, l));
    const hue2rgb = (p, q, t) => {
      if (t < 0) t += 1; if (t > 1) t -= 1;
      if (t < 1/6) return p + (q - p) * 6 * t;
      if (t < 1/2) return q;
      if (t < 2/3) return p + (q - p) * (2/3 - t) * 6;
      return p;
    };
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
    const to = v => ('0' + Math.round(hue2rgb(p, q, v) * 255).toString(16)).slice(-2);
    return '#' + to(h + 1/3) + to(h) + to(h - 1/3);
  }


  /* ----------------------------------------------------------
     Tech logos — inline SVG beside recognised keyword chips.
     ----------------------------------------------------------
     Only terms with an actual brand mark get one. Concepts like
     "Compiler Design" or "Dataflow Analysis" have no logo and
     correctly render as plain text rather than a broken image.
     Matching is on a normalised string so "Postgresql", "C++"
     and "Llama 3.1/3.2" all resolve.
     ---------------------------------------------------------- */
  /* Logos come from site-config.json — a small selected subset written by
     the editor — NOT from the full catalogue, which visitors never fetch.
     Each entry is { n, d, c, t } where t is 1 for primary tech and 2 for
     secondary, so the whole secondary set can be hidden with one toggle. */
  let _logoIndex = null, _logoIndexOf = null;
  function logoIndex() {
    /* Rebuilt when the list itself is replaced (the editor swaps it in and
       out when Skill icons changes between symbols and brand logos). */
    if (_logoIndex && _logoIndexOf === SITE_CONFIG.logos) return _logoIndex;
    _logoIndex = {};
    _logoIndexOf = SITE_CONFIG.logos;
    const list = (SITE_CONFIG.logos) || [];
    list.forEach(l => {
      (l.match || []).forEach(m => { _logoIndex[normTerm(m)] = l; });
      _logoIndex[normTerm(l.n)] = l;
    });
    return _logoIndex;
  }
  function normTerm(s) {
    return String(s || '').toLowerCase().replace(/[\s._/-]+/g, '').trim();
  }
  function logoFor(term) {
    const cfg = (SITE_CONFIG.media || {});
    if (cfg.showTechLogos === false) return null;
    const hit = logoIndex()[normTerm(term)];
    if (!hit) return null;
    // secondary logos (Scapy, PySpark, Flask…) hide as a group
    if (hit.t === 2 && cfg.showSecondaryLogos === false) return null;
    return hit;
  }
  /* Brand colours are chosen for a white page, so many of them vanish on
     one theme or the other — pure-black marks (Rust, Flask, Express) are
     invisible on a dark background, and pale ones (JavaScript yellow, React
     cyan) disappear on cream. Rather than hand-picking a second palette,
     measure contrast against the actual page background at render time and
     nudge the lightness until the mark is legible, preserving its hue. */
  function _relLum(hex) {
    const h = String(hex || '').replace('#', '');
    if (h.length < 6) return 0;
    const ch = [0, 2, 4].map(i => {
      const v = parseInt(h.slice(i, i + 2), 16) / 255;
      return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
  }
  function _contrast(a, b) {
    const la = _relLum(a), lb = _relLum(b);
    return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
  }
  function _adjustL(hex, dl) {
    const h = String(hex).replace('#', '');
    let r = parseInt(h.slice(0, 2), 16) / 255,
        g = parseInt(h.slice(2, 4), 16) / 255,
        b = parseInt(h.slice(4, 6), 16) / 255;
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
    let hh, s, l = (mx + mn) / 2;
    if (mx === mn) { hh = 0; s = 0; }
    else {
      const d = mx - mn;
      s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
      if (mx === r) hh = (g - b) / d + (g < b ? 6 : 0);
      else if (mx === g) hh = (b - r) / d + 2;
      else hh = (r - g) / d + 4;
      hh /= 6;
    }
    l = Math.max(0, Math.min(1, l + dl));
    if (s === 0) { r = g = b = l; }
    else {
      const hue2rgb = (p, q, t) => {
        if (t < 0) t += 1; if (t > 1) t -= 1;
        if (t < 1/6) return p + (q - p) * 6 * t;
        if (t < 1/2) return q;
        if (t < 2/3) return p + (q - p) * (2/3 - t) * 6;
        return p;
      };
      const q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
      r = hue2rgb(p, q, hh + 1/3); g = hue2rgb(p, q, hh); b = hue2rgb(p, q, hh - 1/3);
    }
    const to = v => ('0' + Math.round(v * 255).toString(16)).slice(-2);
    return '#' + to(r) + to(g) + to(b);
  }

  let _bgCache = null;
  function _pageBg() {
    if (_bgCache) return _bgCache;
    const v = getComputedStyle(document.documentElement)
      .getPropertyValue('--bg-soft').trim() || '#ffffff';
    _bgCache = v.charAt(0) === '#' ? v : '#ffffff';
    return _bgCache;
  }

  /* 3.2 rather than 2.6: at 2.6 deep brand colours like NumPy's navy came
     out technically legible but visibly dim beside their neighbours. */
  const MIN_LOGO_CONTRAST = 3.2;
  function legibleLogoColor(brand) {
    const bg = _pageBg();
    if (_contrast(brand, bg) >= MIN_LOGO_CONTRAST) return brand;
    // Move away from the background: lighten on dark pages, darken on light.
    const goLighter = _relLum(bg) < 0.5;
    let out = brand;
    for (let i = 0; i < 24; i++) {
      out = _adjustL(out, goLighter ? 0.04 : -0.04);
      if (_contrast(out, bg) >= MIN_LOGO_CONTRAST) break;
    }
    return out;
  }

  /* An entry without path data renders as a colour-matched monogram tile
     rather than nothing. Several catalogue entries deliberately carry no
     path: an inaccurate glyph reads worse than a clean initial, and the
     tiles also give every card the same optical weight, which mixed
     third-party artwork never does. Drop real Simple Icons path data into
     the catalogue's `d:` field to upgrade any of them. */
  function logoSVG(logo, colored) {
    /* Stroke glyphs (s: 1) are original icons drawn as outlines rather than
       filled brand marks. They're symbolic, not trademarks, so they never get
       a backing plate — the stroke is just lightened or darkened to stay
       legible on the current background. */
    if (logo && logo.s && logo.d) {
      const col = colored ? legibleLogoColor(logo.c) : 'currentColor';
      return '<svg class="pc-logo pc-glyph" viewBox="0 0 24 24" aria-hidden="true" ' +
             'preserveAspectRatio="xMidYMid meet" fill="none" stroke="' + col + '" ' +
             'stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">' +
             '<path d="' + logo.d + '"/></svg>';
    }
    /* A `tile` logo's artwork is a solid brand-colour block with the glyph
       cut out of it. Shifting that colour for contrast destroys the mark —
       JavaScript's yellow becomes olive — so keep it exactly and give the
       tile a hairline outline to hold its edge on a similar background. */
    const tint = !colored ? 'currentColor'
               : (logo.tile ? logo.c : legibleLogoColor(logo.c));
    /* No vetted path? Render nothing here and let the label take the whole
       card — a placeholder glyph adds noise without adding information. The
       card styles itself via .is-textonly so the name gets the full space. */
    if (!logo.d) return '';
    /* preserveAspectRatio keeps every mark optically centred at the same
       size regardless of how its own viewBox is proportioned. */
    return '<svg class="pc-logo' + (logo.tile ? ' pc-logo-tile' : '') +
           '" viewBox="0 0 24 24" aria-hidden="true" ' +
           'preserveAspectRatio="xMidYMid meet" ' +
           'fill="' + tint + '"><path d="' + logo.d + '"/></svg>';
  }


  /* ----------------------------------------------------------
     Skill symbols
     ----------------------------------------------------------
     Every skill card shows a symbol for what the tool is used for, not the
     tool's logo: a cylinder for a database, a branch for Git, a container
     for Docker. One line weight, one colour, one size, and nothing here is
     anyone's trademark, so nothing has to be recoloured for the theme.
     Programming languages can't be told apart by a generic picture, so they
     get a file badge carrying their file extension (py, rs, java).

     The drawings are data, not code: site-config.json carries
     symbols.map (tool -> symbol) and symbols.defs (symbol -> drawing) for
     exactly the tools the resume names. The editor holds the full set and
     rewrites that subset on Save, so visitors never download a symbol the
     page doesn't show. A tool with no entry simply shows its name. Every
     drawing, and the file badge below, is original to this site - no
     third-party icons. */

  /* 'symbols' (default) or 'brand' (a logo catalogue the editor writes into
     site-config.json only while this is set to 'brand'). */
  function symbolsOn() {
    return (SITE_CONFIG.media || {}).skillIcons !== 'brand';
  }
  function symbolSpecFor(name) {
    const media = SITE_CONFIG.media || {};
    if (media.showTechLogos === false) return '';
    const own = (media.cardSymbols || {})[name];
    if (own !== undefined) return own;          // '' = no symbol on this card
    return ((SITE_CONFIG.symbols || {}).map || {})[normTerm(name)] || '';
  }
  /* small = inside a one-line chip, where a badge's lettering would be a
     smudge; languages get the plain "code file" symbol there instead. */
  function symbolSVG(spec, small) {
    if (!spec) return '';
    const media = SITE_CONFIG.media || {};
    const defs = (SITE_CONFIG.symbols || {}).defs || {};
    const cls = 'pc-logo pc-sym' + (media.techLogoColor === false ? ' is-plain' : '');
    const open = '<svg class="' + cls + '" viewBox="0 0 24 24" aria-hidden="true" ' +
      'fill="none" stroke="currentColor" stroke-width="' + (small ? 2 : 1.75) +
      '" stroke-linecap="round" stroke-linejoin="round">';
    if (spec.slice(0, 4) === 'ext:') {
      if (small) return defs['file-code'] ? open + defs['file-code'] + '</svg>' : '';
      const label = spec.slice(4).replace(/[^A-Za-z0-9+#.]/g, '').slice(0, 5);
      return open +
        '<path d="M4 10.5V5a2.5 2.5 0 0 1 2.5-2.5h7L20 9v1.5"/>' +
        '<path d="M13.5 2.5V9H20"/>' +
        '<rect x="1" y="10.5" width="22" height="11" rx="2"/>' +
        '<text class="pc-ext" x="12" y="18.5" text-anchor="middle" font-size="' +
        (label.length > 4 ? 5.6 : 7) + '" stroke="none" fill="currentColor">' +
        escapeHTML(label) + '</text></svg>';
    }
    return defs[spec] ? open + defs[spec] + '</svg>' : '';
  }
  /* One place decides what mark a tool name gets, so the skill cards, the
     project keyword chips and the AI cards can never disagree. */
  function techMark(name, small) {
    if (symbolsOn()) return symbolSVG(symbolSpecFor(name), small);
    const lg = logoFor(name);
    return lg ? logoSVG(lg, (SITE_CONFIG.media || {}).techLogoColor !== false) : '';
  }

  function pfDomainsOf(p)  { return p.domains || (p.category ? [p.category] : []); }
  function pfTechOf(p)     { return p.stack || []; }
  function pfIsLive(p)     { return !!p.live; }

  function pfAnyActive() {
    return PF.sel.domain.length || PF.sel.tech.length || PF.sel.status.length;
  }
  function pfMatches(p) { return pfMatchesSel(p, PF.sel); }
  /* The same test against any selection, so a filter can be tried out
     before it is applied (see pfCountIfToggled). */
  function pfMatchesSel(p, sel) {
    if (!(sel.domain.length || sel.tech.length || sel.status.length)) return true;
    const dHit = v => pfDomainsOf(p).indexOf(v) >= 0;
    const tHit = v => pfTechOf(p).indexOf(v) >= 0;
    const sHit = () => pfIsLive(p);
    if (PF.logic === 'and') {
      return sel.domain.every(dHit) && sel.tech.every(tHit) &&
             (!sel.status.length || sHit());
    }
    if (PF.logic === 'or') {
      return sel.domain.some(dHit) || sel.tech.some(tHit) ||
             (sel.status.length ? sHit() : false);
    }
    // hybrid: OR inside each group, AND across groups
    const d = sel.domain.length ? sel.domain.some(dHit) : true;
    const t = sel.tech.length   ? sel.tech.some(tHit)   : true;
    const s = sel.status.length ? sHit()                : true;
    return d && t && s;
  }
  /* How many projects would match if this one filter were clicked now: added
     to the current selection if it is off, taken out if it is on. This is
     what makes the filters context-aware: every button can say in advance
     whether the combination it would create has any projects in it. */
  function pfCountIfToggled(type, val) {
    const sel = { domain: PF.sel.domain.slice(), tech: PF.sel.tech.slice(),
                  status: PF.sel.status.slice() };
    const i = sel[type].indexOf(val);
    if (i >= 0) sel[type].splice(i, 1); else sel[type].push(val);
    return PF.projects.filter(p => pfMatchesSel(p, sel)).length;
  }
  function pfHas(p, type, val) {
    return type === 'domain' ? pfDomainsOf(p).indexOf(val) >= 0 :
           type === 'tech'   ? pfTechOf(p).indexOf(val) >= 0 : pfIsLive(p);
  }
  /* What one filter control should say. Nothing selected: nothing to say on
     the rail (a number beside every button is noise). Something selected: a
     selected filter reports how many of the shown projects carry it; an
     unselected one reports what clicking it would give, and is marked empty
     when that is zero. Empty filters stay clickable. */
  function pfFilterState(type, val, on) {
    if (!pfAnyActive()) return { n: pfCount(type, val), empty: false, tip: '' };
    if (on) {
      const n = PF.projects.filter(p => pfMatches(p) && pfHas(p, type, val)).length;
      return { n: n, empty: false, tip: n + ' of the matching projects' };
    }
    const n = pfCountIfToggled(type, val);
    return { n: n, empty: n === 0,
             tip: n === 0 ? 'No project matches this together with the current filters'
                          : 'Adding this gives ' + n + ' project' + (n === 1 ? '' : 's') };
  }
  function pfMatchedFilters(p) {
    const out = [];
    PF.sel.domain.forEach(v => { if (pfDomainsOf(p).indexOf(v) >= 0) out.push({ type: 'domain', val: v, color: PF.palette[v] || 'var(--accent)' }); });
    PF.sel.tech.forEach(v   => { if (pfTechOf(p).indexOf(v) >= 0)   out.push({ type: 'tech',   val: v, color: 'var(--filter-tech)' }); });
    PF.sel.status.forEach(v => { if (pfIsLive(p))                    out.push({ type: 'status', val: v, color: 'var(--live, #0F7B54)' }); });
    return out;
  }
  function pfActiveFilters() {
    const out = [];
    PF.sel.status.forEach(v => out.push({ type: 'status', val: v, color: 'var(--live, #0F7B54)' }));
    PF.sel.domain.forEach(v => out.push({ type: 'domain', val: v, color: PF.palette[v] || 'var(--accent)' }));
    PF.sel.tech.forEach(v   => out.push({ type: 'tech',   val: v, color: 'var(--filter-tech)' }));
    return out;
  }
  function pfCount(type, val) {
    return PF.projects.filter(p =>
      type === 'domain' ? pfDomainsOf(p).indexOf(val) >= 0 :
      type === 'tech'   ? pfTechOf(p).indexOf(val) >= 0 :
      pfIsLive(p)
    ).length;
  }
  function pfToggle(type, val) {
    const arr = PF.sel[type];
    const i = arr.indexOf(val);
    if (i >= 0) arr.splice(i, 1); else arr.push(val);
    /* Remember which dropdown was open so multi-select doesn't force the
       user to reopen the menu after every choice. */
    const openGroup = (function () {
      const el = document.querySelector('.pf-dd.is-open');
      return el ? el.dataset.group : null;
    })();
    pfRender();
    if (openGroup) {
      const el = document.querySelector('.pf-dd[data-group="' + openGroup + '"]');
      if (el) {
        el.classList.add('is-open');
        const t = el.querySelector('.pf-dd-trigger');
        if (t) t.setAttribute('aria-expanded', 'true');
      }
    }
  }

  function pfCardHTML(p, opts) {
    opts = opts || {};
    const matched = pfMatchedFilters(p);
    const domHTML = pfDomainsOf(p).map(d =>
      '<span class="pc-topic" style="background:' + (PF.palette[d] || 'var(--accent)') + '22;color:' +
      (PF.palette[d] || 'var(--accent)') + '">' + escapeHTML(d) + '</span>').join('');
    const leafHTML = (p.leaves || []).filter(l => pfDomainsOf(p).indexOf(l) < 0)
      .map(l => '<span class="pc-topic" style="border:1px solid var(--rule);color:var(--muted)">' + escapeHTML(l) + '</span>').join('');
    const colored = (SITE_CONFIG.media || {}).techLogoColor !== false;
    const techHTML = pfTechOf(p).map(t => {
      return '<span>' + techMark(t, true) + escapeHTML(t) + '</span>';
    }).join('');
    const dots = (pfAnyActive() && matched.length)
      ? '<span class="pc-match-dots">' + matched.map(f =>
          '<span title="' + escapeHTML(f.val) + '" style="background:' + f.color + '"></span>').join('') + '</span>'
      : '';
    const live = pfIsLive(p) ? '<span class="pc-live">LIVE</span>' : '';
    const links = (p.links || []).map(l =>
      '<a href="' + escapeHTML(l.url) + '" target="_blank" rel="noopener">' +
      escapeHTML(l.label || 'Link') + ' &#8599;</a>').join('');

    /* Representative image or emoji, declared in the project's comment
       block (image: / icon: / alt:). Images resolve against media.imageDir. */
    const media = (SITE_CONFIG.media || {});
    const showIcons = media.showIcons !== false;
    /* site-config overrides resume.tex, so the editor can preview a change
       without rewriting the LaTeX that feeds the PDF. */
    const ovIcon  = (media.icons  || {})[p.title];
    const ovImage = (media.images || {})[p.title];
    const ovAlt   = (media.alts   || {})[p.title];
    p = Object.assign({}, p, {
      icon:  ovIcon  !== undefined ? ovIcon  : p.icon,
      image: ovImage !== undefined ? ovImage : p.image,
      alt:   ovAlt   !== undefined ? ovAlt   : p.alt
    });
    let iconHTML = '', thumbHTML = '';
    if (showIcons && p.image) {
      thumbHTML = '<img class="pc-thumb" src="' + escapeHTML((media.imageDir || '') + p.image) +
                  '" alt="' + escapeHTML(p.alt || p.title) + '" loading="lazy">';
    } else if (showIcons && p.icon) {
      iconHTML = '<span class="pc-icon" role="img" aria-label="' +
                 escapeHTML(p.alt || p.title) + '">' + escapeHTML(p.icon) + '</span>';
    }

    let edge = '';
    let cls = 'pc-card';
    if (opts.multi) { cls += ' is-multi is-hit'; edge =
      '<span class="pc-multi-edge">' + matched.map(f => '<span style="background:' + f.color + '"></span>').join('') + '</span>'; }
    else {
      if (opts.faded) cls += ' is-faded';
      if (opts.hit)   cls += ' is-hit';
    }
    const borderColor = opts.color || PF.palette[pfDomainsOf(p)[0]] || 'var(--rule)';
    const style = opts.multi ? '' : ' style="border-left-color:' + borderColor + '"';

    return '<article class="' + cls + mCls() + '"' + style + ' data-title="' + escapeHTML(p.title) + '">' +
      edge +
      thumbHTML +
      '<div class="pc-card-head">' +
        '<h4 class="pc-card-title">' + iconHTML + escapeHTML(p.title) + '</h4>' + live + dots +
      '</div>' +
      '<div class="pc-topics">' + domHTML + leafHTML + '</div>' +
      (p.description ? '<p class="pc-desc">' + escapeHTML(p.description) + '</p>' : '') +
      (techHTML ? '<div class="pc-tech">' + techHTML + '</div>' : '') +
      (links ? '<div class="pc-links">' + links + '</div>' : '') +
      mToggle() +
    '</article>';
  }

  function pfIsNarrow() { return window.matchMedia('(max-width: 860px)').matches; }

  /* Measure the fixed topbar once per layout change and expose it as a CSS
     variable, so sticky elements can sit flush beneath it instead of
     guessing a height (a wrong guess leaves a gap that content scrolls
     through, which reads as a floating panel). */
  function pfSyncTopbarHeight() {
    const bar = document.querySelector('.topbar');
    const h = bar ? Math.round(bar.getBoundingClientRect().height) : 56;
    document.documentElement.style.setProperty('--topbar-h', h + 'px');
  }

  /* Filter terms the editor marked hidden (filters.hidden in site-config,
     keyed "type:value") are dropped before rendering — from the rail, the
     chips, and the narrow-screen dropdowns alike. Cards and their tags are
     untouched; only the filter button disappears. */
  function pfApplyHiddenFilters(groups) {
    const hidden = (SITE_CONFIG.filters || {}).hidden || {};
    groups.forEach(g => {
      g.values = g.values.filter(v => !hidden[g.type + ':' + v]);
    });
    return groups.filter(g => g.values.length);
  }

  function pfFilterGroups() {
    const groups = [];
    const liveN = PF.projects.filter(pfIsLive).length;
    if (liveN) groups.push({ label: 'Status', type: 'status', values: ['Live'] });

    /* Order domains by family so related filters sit together — AI and
       Machine Learning next to each other, the systems cluster together —
       instead of appearing in whatever order they were parsed. */
    const FAMILY = [
      ['Artificial Intelligence', 'Machine Learning', 'Reinforcement Learning',
       'Natural Language Processing', 'Optimization'],
      ['Systems Programming', 'Distributed Systems', 'Parallel Computing',
       'Concurrency', 'Networking'],
      ['Compilers', 'Programming Languages', 'Type Systems',
       'Data Structures', 'Algorithms'],
      ['Security'],
      ['Robotics', 'Motion Planning'],
      ['Web Development', 'Backend Development']
    ];
    const rank = {};
    FAMILY.forEach((fam, fi) => fam.forEach((d, di) => { rank[d] = fi * 100 + di; }));
    const domains = uniqueStrings([].concat.apply([], PF.projects.map(pfDomainsOf)))
      .sort((a, b) => (rank[a] === undefined ? 999 : rank[a]) -
                      (rank[b] === undefined ? 999 : rank[b]));
    if (domains.length) {
      groups.push({ label: 'Domain', type: 'domain', values: domains,
                    families: FAMILY });
    }

    /* Only 8 of 64 tech terms appear in more than one project, so a "2+"
       rule hid almost everything. Show every term, most-used first, with
       the long tail behind a "more" toggle rather than dropped. */
    const techCount = {};
    PF.projects.forEach(p => pfTechOf(p).forEach(t => { techCount[t] = (techCount[t] || 0) + 1; }));
    const techLimit = ((SITE_CONFIG.media || {}).techFilterLimit) || 14;

    /* Ordering comes from site-config so it can be tuned without touching
       code: frameworks and tools first (what people scan for), then
       languages, then everything else alphabetically. */
    const tg = (SITE_CONFIG.filters || {}).techGroups || {};
    const bandOf = (t) => {
      const lower = String(t).toLowerCase();
      const bands = tg.order || ['frameworks', 'languages', 'other'];
      for (let i = 0; i < bands.length; i++) {
        const list = (tg[bands[i]] || []).map(s => s.toLowerCase());
        if (list.indexOf(lower) >= 0) return i;
      }
      return bands.length;                       // unlisted: last band
    };
    const tech = Object.keys(techCount).sort((a, b) =>
      (bandOf(a) - bandOf(b)) ||
      (techCount[b] - techCount[a]) ||
      a.localeCompare(b));
    if (tech.length) {
      groups.push({ label: 'Tech', type: 'tech', values: tech,
                    collapseAfter: techLimit, bandOf: bandOf });
    }
    return pfApplyHiddenFilters(groups);
  }

  /* Narrow screens: one dropdown per filter group, so a dozen filters
     occupy a single row rather than wrapping into a block of chips. */
  function pfBuildDropdowns(container) {
    container.innerHTML = '';
    pfFilterGroups().forEach(g => {
      const wrap = document.createElement('div');
      wrap.className = 'pf-dd';
      wrap.dataset.group = g.type;

      const trigger = document.createElement('button');
      trigger.type = 'button';
      trigger.className = 'pf-dd-trigger';
      trigger.setAttribute('aria-haspopup', 'true');
      trigger.setAttribute('aria-expanded', 'false');
      trigger.innerHTML =
        '<span class="pf-dd-name">' + escapeHTML(g.label) + '</span>' +
        '<span class="pf-dd-badge" hidden></span>' +
        '<span class="pf-dd-caret">&#9662;</span>';

      const panel = document.createElement('div');
      panel.className = 'pf-dd-panel';
      panel.setAttribute('role', 'menu');
      /* The form says where the current combination stands before another
         option is added to it. */
      const note = document.createElement('div');
      note.className = 'pf-dd-note';
      panel.appendChild(note);

      g.values.forEach(v => {
        const label = g.type === 'status' ? 'Live demo' : v;
        const color = g.type === 'domain' ? (PF.palette[v] || 'var(--accent)')
                    : g.type === 'status' ? 'var(--live, #0F7B54)'
                    : 'var(--ink-soft)';
        const opt = document.createElement('button');
        opt.type = 'button';
        opt.className = 'pf-opt';
        opt.dataset.type = g.type;
        opt.dataset.val  = v;
        opt.innerHTML =
          '<span class="pf-tick" data-color="' + color + '"></span>' +
          '<span>' + escapeHTML(label) + '</span>' +
          '<span class="pf-opt-n">' + pfCount(g.type, v) + '</span>';
        opt.addEventListener('click', e => { e.stopPropagation(); pfToggle(g.type, v); });
        panel.appendChild(opt);
      });

      trigger.addEventListener('click', e => {
        e.stopPropagation();
        const open = wrap.classList.contains('is-open');
        container.querySelectorAll('.pf-dd').forEach(d => d.classList.remove('is-open'));
        wrap.classList.toggle('is-open', !open);
        trigger.setAttribute('aria-expanded', String(!open));
      });

      wrap.appendChild(trigger);
      wrap.appendChild(panel);
      container.appendChild(wrap);
    });

    if (!container._ddOutsideBound) {
      document.addEventListener('click', () => {
        container.querySelectorAll('.pf-dd').forEach(d => {
          d.classList.remove('is-open');
          const t = d.querySelector('.pf-dd-trigger');
          if (t) t.setAttribute('aria-expanded', 'false');
        });
      });
      container._ddOutsideBound = true;
    }
  }

  function pfPaintDropdowns() {
    document.querySelectorAll('.pf-dd').forEach(dd => {
      const type = dd.dataset.group;
      const sel  = PF.sel[type] || [];
      const badge = dd.querySelector('.pf-dd-badge');
      if (badge) {
        badge.hidden = sel.length === 0;
        badge.textContent = sel.length || '';
      }
      const note = dd.querySelector('.pf-dd-note');
      if (note) {
        const shown = PF.projects.filter(pfMatches).length;
        note.textContent = pfAnyActive()
          ? shown + ' of ' + PF.projects.length + ' projects match so far. ' +
            'Each number is what adding that option gives.'
          : 'Each number is how many projects have it.';
      }
      dd.querySelectorAll('.pf-opt').forEach(opt => {
        const on = sel.indexOf(opt.dataset.val) >= 0;
        opt.classList.toggle('is-on', on);
        const st = pfFilterState(type, opt.dataset.val, on);
        opt.classList.toggle('is-empty', st.empty);
        opt.title = st.tip;
        const cn = opt.querySelector('.pf-opt-n');
        if (cn) cn.textContent = st.n;
        const tick = opt.querySelector('.pf-tick');
        if (tick) {
          tick.style.background = on ? (tick.dataset.color || 'var(--accent)') : 'transparent';
          tick.textContent = on ? '\u2713' : '';
        }
      });
    });
  }

  function pfBuildFilterButtons(container, asChips) {
    container.innerHTML = '';
    const groups = [];
    const liveN = PF.projects.filter(pfIsLive).length;
    if (liveN) groups.push({ label: 'Status', type: 'status', values: ['Live'] });

    /* Order domains by family so related filters sit together — AI and
       Machine Learning next to each other, the systems cluster together —
       instead of appearing in whatever order they were parsed. */
    const FAMILY = [
      ['Artificial Intelligence', 'Machine Learning', 'Reinforcement Learning',
       'Natural Language Processing', 'Optimization'],
      ['Systems Programming', 'Distributed Systems', 'Parallel Computing',
       'Concurrency', 'Networking'],
      ['Compilers', 'Programming Languages', 'Type Systems',
       'Data Structures', 'Algorithms'],
      ['Security'],
      ['Robotics', 'Motion Planning'],
      ['Web Development', 'Backend Development']
    ];
    const rank = {};
    FAMILY.forEach((fam, fi) => fam.forEach((d, di) => { rank[d] = fi * 100 + di; }));
    const domains = uniqueStrings([].concat.apply([], PF.projects.map(pfDomainsOf)))
      .sort((a, b) => (rank[a] === undefined ? 999 : rank[a]) -
                      (rank[b] === undefined ? 999 : rank[b]));
    if (domains.length) {
      groups.push({ label: 'Domain', type: 'domain', values: domains,
                    families: FAMILY });
    }

    /* Only surface tech terms used by 2+ projects, so the rail stays
       readable — the long tail is still visible on each card. */
    /* Only 8 of 64 tech terms appear in more than one project, so a "2+"
       rule hid almost everything. Show every term, most-used first, with
       the long tail behind a "more" toggle rather than dropped. */
    const techCount = {};
    PF.projects.forEach(p => pfTechOf(p).forEach(t => { techCount[t] = (techCount[t] || 0) + 1; }));
    const techLimit = ((SITE_CONFIG.media || {}).techFilterLimit) || 14;

    /* Ordering comes from site-config so it can be tuned without touching
       code: frameworks and tools first (what people scan for), then
       languages, then everything else alphabetically. */
    const tg = (SITE_CONFIG.filters || {}).techGroups || {};
    const bandOf = (t) => {
      const lower = String(t).toLowerCase();
      const bands = tg.order || ['frameworks', 'languages', 'other'];
      for (let i = 0; i < bands.length; i++) {
        const list = (tg[bands[i]] || []).map(s => s.toLowerCase());
        if (list.indexOf(lower) >= 0) return i;
      }
      return bands.length;                       // unlisted: last band
    };
    const tech = Object.keys(techCount).sort((a, b) =>
      (bandOf(a) - bandOf(b)) ||
      (techCount[b] - techCount[a]) ||
      a.localeCompare(b));
    if (tech.length) {
      groups.push({ label: 'Tech', type: 'tech', values: tech,
                    collapseAfter: techLimit, bandOf: bandOf });
    }

    pfApplyHiddenFilters(groups).forEach(g => {
      const lab = document.createElement('div');
      lab.className = 'pf-group-label';
      lab.textContent = g.label;
      container.appendChild(lab);
      let lastFamily = -1;
      const limit = g.collapseAfter || g.values.length;
      let overflow = [];
      g.values.forEach((v, vi) => {
        if (vi >= limit) { overflow.push(v); return; }
        if (g.bandOf && !asChips) {
          const band = g.bandOf(v);
          if (lastFamily !== -1 && band !== lastFamily) {
            const gap = document.createElement('div');
            gap.className = 'pf-fam-gap';
            container.appendChild(gap);
          }
          lastFamily = band;
        }
        if (g.families && !asChips) {
          const fam = g.families.findIndex(f => f.indexOf(v) >= 0);
          if (lastFamily !== -1 && fam !== lastFamily) {
            const gap = document.createElement('div');
            gap.className = 'pf-fam-gap';
            container.appendChild(gap);
          }
          lastFamily = fam;
        }
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'pf-btn';
        b.dataset.type = g.type;
        b.dataset.val  = v;
        const label = g.type === 'status' ? 'Live demo' : v;
        /* No standing count: a number beside every filter is noise until
           you've actually chosen one. The count appears on the selected
           filter only, and the status line reports the total. */
        b.innerHTML = '<span>' + escapeHTML(label) + '</span>' +
                      '<span class="pf-n" hidden></span>';
        b.dataset.count = pfCount(g.type, v);
        b.addEventListener('click', () => pfToggle(g.type, v));
        if (!asChips) {
          b.addEventListener('mouseenter', () => {
            PF.hover = g.type + ':' + v;
            const hint = document.getElementById('pf-hover-hint');
            if (hint) hint.textContent = 'isolating: ' + label;
            pfDrawLines();
          });
          b.addEventListener('mouseleave', () => {
            PF.hover = null;
            const hint = document.getElementById('pf-hover-hint');
            if (hint) hint.textContent = '';
            pfDrawLines();
          });
        }
        container.appendChild(b);
      });

      if (overflow.length) {
        const more = document.createElement('button');
        more.type = 'button';
        more.className = 'pf-btn pf-more';
        more.innerHTML = '<span>+ ' + overflow.length + ' more</span>';
        more.addEventListener('click', () => {
          more.remove();
          overflow.forEach(v => {
            const b = document.createElement('button');
            b.type = 'button';
            b.className = 'pf-btn';
            b.dataset.type = g.type;
            b.dataset.val = v;
            b.innerHTML = '<span>' + escapeHTML(v) + '</span><span class="pf-n" hidden></span>';
            b.dataset.count = pfCount(g.type, v);
            b.addEventListener('click', () => pfToggle(g.type, v));
            container.appendChild(b);
          });
          pfPaintButtons();
        });
        container.appendChild(more);
      }
    });
  }

  function pfPaintButtons() {
    document.querySelectorAll('.pf-btn').forEach(b => {
      const arr = PF.sel[b.dataset.type] || [];
      const on = arr.indexOf(b.dataset.val) >= 0;
      const color = b.dataset.type === 'domain' ? (PF.palette[b.dataset.val] || 'var(--accent)')
                  : b.dataset.type === 'status' ? 'var(--live, #0F7B54)'
                  : 'var(--filter-tech)';
      b.style.background  = on ? color : 'var(--bg-soft)';
      b.style.color       = on ? '#fff' : 'var(--ink-soft)';
      b.style.borderColor = on ? color : 'var(--rule)';
      const n = b.querySelector('.pf-n');
      if (!b.dataset.val) return;                 /* the "+ N more" expander */
      const any = pfAnyActive();
      const st = pfFilterState(b.dataset.type, b.dataset.val, on);
      b.classList.toggle('is-empty', st.empty);
      b.title = st.tip;
      if (n) {
        n.hidden = !any;
        n.textContent = any ? st.n : '';
      }
    });
    document.querySelectorAll('.pf-lg').forEach(b => {
      b.classList.toggle('is-on', b.dataset.logic === PF.logic);
    });
  }

  function pfDrawLines() {
    const svg = document.getElementById('pf-lines');
    const gutter = document.getElementById('pf-gutter');
    if (!svg || !gutter) return;
    svg.innerHTML = '';
    if (pfIsNarrow() || !pfAnyActive()) return;

    const grect = gutter.getBoundingClientRect();
    if (!grect.width || !grect.height) return;
    svg.setAttribute('viewBox', '0 0 ' + grect.width + ' ' + grect.height);

    const acts = pfActiveFilters();
    const lane = {};
    acts.forEach((f, i) => { lane[f.type + ':' + f.val] = (i + 1) / (acts.length + 1); });

    PF.projects.forEach(p => {
      if (!pfMatches(p)) return;
      const card = document.querySelector('.pc-card[data-title="' + cssEscape(p.title) + '"]');
      if (!card) return;
      const matched = pfMatchedFilters(p);
      matched.forEach((f, idx) => {
        const key = f.type + ':' + f.val;
        const btn = document.querySelector('.pf-rail .pf-btn[data-type="' + f.type + '"][data-val="' + cssEscape(f.val) + '"]');
        if (!btn) return;
        const br = btn.getBoundingClientRect();
        const cr = card.getBoundingClientRect();
        const x1 = 0;
        const y1 = br.top + br.height / 2 - grect.top;
        const yOff = (idx - (matched.length - 1) / 2) * 7;   // staggered anchors
        const x2 = grect.width;
        const y2 = cr.top + cr.height / 2 - grect.top + yOff;
        const lx = grect.width * lane[key];                   // per-filter lane
        const d = 'M' + x1 + ',' + y1 +
                  ' C' + (lx * 0.6) + ',' + y1 + ' ' + lx + ',' + y1 + ' ' + lx + ',' + ((y1 + y2) / 2) +
                  ' C' + lx + ',' + y2 + ' ' + (lx + (x2 - lx) * 0.4) + ',' + y2 + ' ' + x2 + ',' + y2;
        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        path.setAttribute('d', d);
        path.setAttribute('fill', 'none');
        path.setAttribute('stroke', f.color);
        path.setAttribute('stroke-width', '2');
        const isolated = PF.hover && PF.hover !== key;        // hover isolation
        const lineOp = (getComputedStyle(document.documentElement)
                          .getPropertyValue('--line-opacity') || '0.82').trim();
        path.setAttribute('opacity', isolated ? '0.05' : lineOp);
        svg.appendChild(path);
      });
    });
  }

  function cssEscape(s) { return String(s).replace(/"/g, '\\"'); }

  function pfRenderList() {
    const el = document.getElementById('all-projects');
    if (!el) return;
    const hits = PF.projects.filter(pfMatches);
    const miss = PF.projects.filter(p => !pfMatches(p));

    if (!pfAnyActive()) {
      el.innerHTML = PF.projects.map(p => pfCardHTML(p, {})).join('');
      return;
    }

    /* Wide screens keep source order so the connector lines stay
       readable. Narrow screens regroup: multi-filter matches first,
       then a group per filter, then faded non-matches. */
    if (!pfIsNarrow()) {
      el.innerHTML = PF.projects.map(p => {
        const m = pfMatches(p);
        const mf = pfMatchedFilters(p);
        return pfCardHTML(p, { hit: m, faded: !m, multi: m && mf.length > 1 });
      }).join('');
      return;
    }

    let html = '';
    const placed = {};
    const multi = hits.filter(p => pfMatchedFilters(p).length > 1)
                      .sort((a, b) => pfMatchedFilters(b).length - pfMatchedFilters(a).length);
    if (multi.length) {
      const swatches = pfActiveFilters().map(f => '<span style="background:' + f.color + '"></span>').join('');
      html += '<div class="pf-group-head"><span class="pf-sw-multi">' + swatches + '</span>' +
              'Matches multiple filters <span class="pf-gn">' + multi.length + '</span>' +
              '<span class="pf-group-note">ranked by match count</span></div>';
      multi.forEach(p => { placed[p.title] = true; html += pfCardHTML(p, { multi: true }); });
    }
    pfActiveFilters().forEach(f => {
      const items = hits.filter(p => !placed[p.title] &&
        pfMatchedFilters(p).some(m => m.type === f.type && m.val === f.val));
      if (!items.length) return;
      const label = f.type === 'status' ? 'Live demo' : f.val;
      html += '<div class="pf-group-head" style="color:' + f.color + '">' +
              '<span class="pf-sw" style="background:' + f.color + '"></span>' +
              escapeHTML(label) + ' <span class="pf-gn">' + items.length + '</span></div>';
      items.forEach(p => { placed[p.title] = true; html += pfCardHTML(p, { hit: true, color: f.color }); });
    });
    if (miss.length) {
      html += '<div class="pf-divider">' + miss.length + ' other projects</div>';
      miss.forEach(p => { html += pfCardHTML(p, { faded: true }); });
    }
    el.innerHTML = html;
  }

  function pfRender() {
    pfSyncTopbarHeight();
    const narrow = pfIsNarrow();
    const rail  = document.getElementById('pf-rail');
    const chips = document.getElementById('pf-chips');
    if (rail  && !narrow) pfBuildFilterButtons(rail, false);
    if (chips &&  narrow) pfBuildDropdowns(chips);

    pfRenderList();
    pfPaintButtons();
    if (narrow) pfPaintDropdowns();

    const countEl = document.getElementById('pf-count');
    const clearEl = document.getElementById('pf-clear');
    const shown = PF.projects.filter(pfMatches).length;
    const nSel = PF.sel.domain.length + PF.sel.tech.length + PF.sel.status.length;
    if (countEl) {
      countEl.textContent = shown + ' of ' + PF.projects.length + ' shown' +
        (nSel ? ' · ' + nSel + ' filter' + (nSel > 1 ? 's' : '') + ' active' : '');
    }
    if (clearEl) clearEl.hidden = !nSel;

    requestAnimationFrame(pfDrawLines);
  }

  function initProjectExplorer(projects) {
    PF.projects = projects;
    const domains = uniqueStrings([].concat.apply([], projects.map(pfDomainsOf)));
    PF.palette = buildDomainPalette(domains);

    document.querySelectorAll('.pf-lg').forEach(b => {
      b.addEventListener('click', () => { PF.logic = b.dataset.logic; pfRender(); });
    });
    const clearEl = document.getElementById('pf-clear');
    if (clearEl) clearEl.addEventListener('click', () => {
      PF.sel = { domain: [], tech: [], status: [] };
      pfRender();
    });

    let rt;
    window.addEventListener('resize', () => {
      clearTimeout(rt);
      rt = setTimeout(pfRender, 120);
    });
    window.addEventListener('scroll', pfDrawLines, { passive: true });

    pfRender();
  }

  /* Courses grouped by where they were taken. Sources keep the order they
     first appear in resume.tex, so degree coursework leads and online
     courses follow, without needing a hardcoded list here. */
  /* Domain colours for the Courses section. Hues are spread around the wheel
     and each is solved for a target luminance rather than a fixed lightness —
     blue and yellow at equal HSL lightness differ hugely in perceived
     brightness, which left some categories indistinguishable from the page. */
  let _courseCols = null;
  /* What the course colours were last worked out from, so a theme switch can
     repaint them in place (keeping open lines open) instead of re-rendering. */
  let _courseRender = null;
  function recolourCourses() {
    const r = _courseRender;
    if (!r) return;
    if (r.domains.length) {
      const C = courseColors(r.domains);
      document.querySelectorAll('#courses-list [data-cat]').forEach(e => {
        const d = e.getAttribute('data-cat');
        if (!C.vivid[d]) return;
        if (e.classList.contains('is-text')) e.style.color = C.vivid[d];
        else if (e.classList.contains('is-outline')) e.style.borderColor = C.vivid[d];
        else { e.style.background = C.vivid[d]; e.style.color = C.ink[d]; }
      });
    }
    if (r.feat.length) {
      const F = courseColors(r.feat, r.mode);
      document.querySelectorAll('#courses-featured .course-card.is-filled').forEach(e => {
        const n = e.getAttribute('data-entry');
        if (!F.vivid[n]) return;
        e.style.setProperty('--cat', F.vivid[n]);
        e.style.setProperty('--cat-ink', F.ink[n]);
      });
    }
  }
  function courseColors(domains, fill) {
    const bg = _pageBg();
    const dark = _relLum(bg) < 0.5;
    const key = (fill || 0) + (dark ? 'd|' : 'l|') + domains.join('|');
    if (_courseCols && _courseCols.key === key) return _courseCols;
    const toHex = (r, g, b) =>
      '#' + [r, g, b].map(v => ('0' + Math.round(v * 255).toString(16)).slice(-2)).join('');
    const hls = (h, l, s) => {
      if (s === 0) return [l, l, l];
      const q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
      const f = t => {
        if (t < 0) t += 1; if (t > 1) t -= 1;
        if (t < 1/6) return p + (q - p) * 6 * t;
        if (t < 1/2) return q;
        if (t < 2/3) return p + (q - p) * (2/3 - t) * 6;
        return p;
      };
      return [f(h + 1/3), f(h), f(h - 1/3)];
    };
    /* fill: 0 outlines, 1 bright cards with dark text, 2 deep cards with
       white text.
       Not the whole wheel is used. Yellow and yellow-green only look like
       themselves when they are very bright; at the brightness these need
       they turn olive, khaki and mustard, the one dull stretch of the
       spectrum, so that arc is left out. Outlines skip the browns as well
       (from 30 degrees); bright cards keep orange and amber, at their own
       brightness (see floor); a deep orange is rust and a deep lime is
       moss, so deep cards run from green round to red and nothing between. */
    const deep = fill === 2;
    const SKIP_FROM = deep ? 10 : fill ? 46 : 30, SKIP_TO = deep ? 110 : 100;
    /* Deep cards: dark enough that white text reads at about 6:1 on a light
       page. On a dark page the same colours sit closer to the background
       and their saturation glares, so there they are a step lighter and a
       little calmer (white text still about 5:1). Outlines and bright cards
       solve for a luminance that clears the page by a wide margin. */
    const target = deep ? (dark ? 0.16 : 0.125)
      : dark ? Math.max(0.32, _relLum(bg) * 9) : Math.min(0.30, _relLum(bg) / 3);
    const sat = deep && !dark ? 0.78 : 0.70;
    const colourAt = deg => {
      const h = (deg % 360) / 360;
      let lo = 0, hi = 1, c = '#888';
      for (let k = 0; k < 26; k++) {
        const mid = (lo + hi) / 2;
        c = toHex.apply(null, hls(h, mid, sat));
        if (_relLum(c) < target) lo = mid; else hi = mid;
      }
      /* An orange darkened to match the others is brown. On a bright card
         it is kept at least as light as the pure hue instead: the card is a
         block of colour, so it does not need the page contrast a thin
         outline does, and its text is dark either way. */
      const d = deg % 360;
      if (fill === 1 && d > 12 && d < 50 && lo < 0.52) c = toHex.apply(null, hls(h, 0.52, 0.82));
      return c;
    };
    /* Spacing by how different the colours look, not by angle. Equal steps
       of hue are not equal steps to the eye: dark greens and teals differ
       far less than blues and purples, so even angles put near-twins side
       by side there. The arc is walked in small steps, the visible change
       measured along it (distance in OKLab, a space built to match
       perceived difference), and the colours placed at equal shares of
       that total, so neighbours all differ by about the same amount. */
    const lab = c => {
      const v = [1, 3, 5].map(i => {
        const x = parseInt(c.substr(i, 2), 16) / 255;
        return x <= 0.04045 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
      });
      const l = Math.cbrt(0.4122214708 * v[0] + 0.5363355889 * v[1] + 0.0514459929 * v[2]),
            m = Math.cbrt(0.2119034982 * v[0] + 0.6806995451 * v[1] + 0.1073969566 * v[2]),
            s = Math.cbrt(0.0883024619 * v[0] + 0.2817188376 * v[1] + 0.6299787005 * v[2]);
      return [0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s,
              1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s,
              0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s];
    };
    const degs = [], cum = [0];
    for (let d = SKIP_TO; d <= SKIP_FROM + 360; d += 3) degs.push(d);
    let prev = lab(colourAt(degs[0]));
    for (let j = 1; j < degs.length; j++) {
      const cur = lab(colourAt(degs[j]));
      cum.push(cum[j - 1] + Math.hypot(cur[0] - prev[0], cur[1] - prev[1], cur[2] - prev[2]));
      prev = cur;
    }
    const n = domains.length, total = cum[cum.length - 1], pts = [];
    for (let k = 0, j = 1; k < n; k++) {
      const t = (k + 0.5) * total / n;
      while (j < cum.length - 1 && cum[j] < t) j++;
      const f = (t - cum[j - 1]) / ((cum[j] - cum[j - 1]) || 1);
      pts.push(degs[j - 1] + f * (degs[j] - degs[j - 1]));
    }
    /* The sequence starts from the colour nearest blue and runs round. */
    let k0 = 0;
    const gap = d => Math.abs(((d - 209) % 360 + 540) % 360 - 180);
    pts.forEach((d, k) => { if (gap(d) < gap(pts[k0])) k0 = k; });

    const out = { key: key, vivid: {}, ink: {} };
    domains.forEach((d, i) => {
      const c = colourAt(pts[(k0 + i) % n]);
      out.vivid[d] = c;
      /* Pick whichever ink actually contrasts more. A fixed brightness
         cut-off put white text on mid-tone boxes in light mode, which read
         at about 3:1. */
      const L = _relLum(c);
      const onDark  = (L + 0.05) / (_relLum('#12101c') + 0.05);
      const onLight = (_relLum('#f4f2ff') + 0.05) / (L + 0.05);
      out.ink[d] = deep ? '#fff' : onDark >= onLight ? '#12101c' : '#f4f2ff';
    });
    return (_courseCols = out);
  }

  /* A course's link and certificate. resume.tex can carry them in the line's
     tail; the editor stores its own in courses.links[name], which wins. */
  function courseLinks(c) {
    const o = ((SITE_CONFIG.courses || {}).links || {})[c.name] || {};
    const link = o.link !== undefined ? o.link : c.link;
    const out = { link: /^https?:\/\//i.test(link || '') ? link : '',
                  cert: (o.cert !== undefined ? o.cert : c.cert) || '' };
    /* What the popup shows: the certificate file, or (popup = "page") the
       link's own page in a frame. */
    const page = String(o.popup !== undefined ? o.popup : c.popup).toLowerCase() === 'page';
    out.show = page && out.link ? out.link : out.cert;
    return out;
  }
  function courseActs(c) {
    const k = courseLinks(c);
    if (!k.link && !k.show) return '';
    return '<span class="course-acts">' +
      (k.show ? '<button type="button" class="course-cert" data-cert="' + escapeHTML(k.show) +
                '" data-name="' + escapeHTML(c.name) + '">View certificate</button>' : '') +
      (k.link ? '<a class="course-link" href="' + escapeHTML(k.link) + '" target="_blank" rel="noopener">' +
                (/certif|verify|credential/i.test(k.link) ? 'Verify certificate' : 'Course page') +
                ' \u2197</a>' : '') +
    '</span>';
  }
  /* The certificate in a rectangle over the page. An image file or link is
     shown as an image; anything else (a PDF, an embeddable page) goes in a
     frame. Nothing is fetched until the popup is opened, and "Open in new
     tab" is always there for phones and for pages that refuse to be framed. */
  function certPopup(src, title) {
    const dir = (SITE_CONFIG.media || {}).imageDir || 'assets/';
    const url = /^(https?:|\/|data:)/i.test(src) ? src : dir + src;
    if (!window.HTMLDialogElement) { window.open(url, '_blank', 'noopener'); return; }
    let dlg = document.getElementById('cert-pop');
    if (!dlg) {
      dlg = document.createElement('dialog');
      dlg.id = 'cert-pop';
      dlg.className = 'cert-pop';
      document.body.appendChild(dlg);
      dlg.addEventListener('click', e => {
        if (e.target === dlg || (e.target.closest && e.target.closest('.cert-x'))) dlg.close();
      });
      dlg.addEventListener('close', () => { dlg.innerHTML = ''; });
    }
    const label = escapeHTML('Certificate: ' + title);
    const isImg = /\.(png|jpe?g|webp|gif|svg|avif)([?#]|$)/i.test(url);
    /* Someone else's web page (not a file): shown in a sandboxed frame that
       can't navigate this page away, with a way out if the site refuses to
       be shown inside another page, which a script here has no way to detect. */
    const isPage = !isImg && /^https?:/i.test(url) && !/\.pdf([?#]|$)/i.test(url);
    dlg.innerHTML =
      '<div class="cert-hd"><span class="cert-t">' + escapeHTML(title) + '</span>' +
        '<a class="cert-open" href="' + escapeHTML(url) + '" target="_blank" rel="noopener">Open in new tab \u2197</a>' +
        '<button type="button" class="cert-x" aria-label="Close">\u00d7</button></div>' +
      '<div class="cert-bd">' +
        (isImg
          ? '<img src="' + escapeHTML(url) + '" alt="' + label + '">'
          : '<iframe src="' + escapeHTML(url) + '" title="' + label + '"' +
            (isPage ? ' referrerpolicy="no-referrer" sandbox="allow-scripts allow-same-origin allow-popups allow-forms"' : '') +
            '></iframe>') +
      '</div>' +
      (isPage ? '<div class="cert-note">Not showing? Some sites won\u2019t load inside another page. ' +
                '<a href="' + escapeHTML(url) + '" target="_blank" rel="noopener">Open it in a new tab \u2197</a></div>' : '');
    dlg.showModal();
  }

  /* Wording the page writes itself (not from resume.tex or index.html),
     e.g. "Selected coursework". text.labels[original] in site-config.json
     replaces it; the element keeps the original in data-ui so the editor
     can find and rename it. */
  function uiLabel(s) {
    const l = (SITE_CONFIG.text || {}).labels || {};
    return escapeHTML(l[s] || s);
  }
  function renderCourses(courses) {
    window.__pfRenderCourses = renderCourses;   // let the editor re-render live
    const el = document.getElementById('courses-list');
    const featEl = document.getElementById('courses-featured');
    const section = document.getElementById('courses');
    if (!el) return;
    if (!courses || !courses.length) {
      if (section) section.style.display = 'none';
      return;
    }
    if (section) section.style.display = '';

    const media = SITE_CONFIG.media || {};
    const cfg = SITE_CONFIG.courses || {};
    const hidden = media.hiddenCourses || {};
    const visible = courses.filter(c => hidden[c.name] !== true);
    /* Category labels: "outline" (a plain box edged in the category's colour),
       "box" (filled with it) or "text". Featured cards: "colour" (each filled
       with a colour of its own) or "plain". The defaults put the colour on
       the featured courses and leave the category index quiet beneath them. */
    const style = /^(box|text)$/.test(cfg.labelStyle) ? cfg.labelStyle : 'outline';
    const featColour = cfg.featuredStyle !== 'plain';

    const DEFAULT_ORDER = [
      'Systems & Networking', 'Distributed & Parallel', 'Compilers', 'Security',
      'AI & Machine Learning', 'Algorithms & Theory', 'Data & Databases',
      'Robotics', 'Software Engineering', 'Mathematics', 'Foundations', 'Professional'
    ];
    const order = cfg.domainOrder || DEFAULT_ORDER;
    const rank = d => { const i = order.indexOf(d); return i < 0 ? order.length : i; };

    const groups = {};
    visible.forEach(c => { (groups[c.domain || 'Other'] = groups[c.domain || 'Other'] || []).push(c); });
    const domains = Object.keys(groups).sort((a, b) => rank(a) - rank(b));
    const COLS = courseColors(domains);
    _courseRender = { domains: domains, feat: [], mode: 2 };

    /* Featured stays its own block above; the list below carries no extra
       emphasis for those courses, since that job is already done. */
    const isOnline = c =>
      /educative|nptel|coursera|udemy|edx|hackerrank|udacity|datacamp|online/i.test(c.source || '');
    const featured = visible.filter(c => c.featured);
    if (featEl) {
      if (featured.length && media.showFeaturedCourses !== false) {
        /* University courses on the left, self-directed ones on the right
           of a divider (stacked under their own labels on phones). With no
           self-directed course featured it is one plain grid, as before. */
        /* A featured card's colour says nothing about its category: nobody
           reads the Selected block to learn categories, and anyone who wants
           them has the index below. Each card simply takes the next hue
           around the wheel, in the order shown, so no two cards match and
           the block runs through the whole spectrum. */
        const fUni = featured.filter(c => !isOnline(c)), fSelf = featured.filter(isOnline);
        const fNames = fUni.concat(fSelf).map(c => c.name), fMode = cfg.featuredInk === 'dark' ? 1 : 2;
        const FC = featColour ? courseColors(fNames, fMode) : null;
        _courseRender = { domains: domains, feat: featColour ? fNames : [], mode: fMode };
        const fCard = c =>
          '<article class="course-card is-featured' + (featColour ? ' is-filled' : '') +
            '" data-entry="' + escapeHTML(c.name) + '"' +
            (featColour ? ' style="--cat:' + FC.vivid[c.name] + ';--cat-ink:' + FC.ink[c.name] + '"' : '') + '>' +
            '<h5 class="course-name">' + escapeHTML(c.name) + '</h5>' +
            (c.description ? '<p class="course-desc">' + escapeHTML(c.description) + '</p>' : '') +
            '<span class="course-origin">' + escapeHTML(c.source || '') + '</span>' +
            courseActs(c) +
          '</article>';
        const col = (cls, lab, items) =>
          '<div class="course-feat-col ' + cls + '">' +
            (fSelf.length && fUni.length ? '<div class="course-feat-lab" data-ui="' + lab + '">' + uiLabel(lab) + '</div>' : '') +
            '<div class="course-items is-open">' + items.map(fCard).join('') + '</div>' +
          '</div>';
        featEl.innerHTML =
          '<h4 class="course-featured-head" data-ui="Selected coursework">' + uiLabel('Selected coursework') +
            '<span class="course-count">' + featured.length + '</span></h4>' +
          '<div class="course-feat-split' + (fSelf.length && fUni.length ? ' has-self' : '') + '">' +
            (fUni.length ? col('is-uni', 'University', fUni) : '') +
            (fSelf.length ? col('is-self', 'Self-directed', fSelf) : '') +
          '</div>';
        featEl.style.display = '';
      } else { featEl.innerHTML = ''; featEl.style.display = 'none'; }
    }

    /* The secondary row used to be "<Domain> b", which announces itself as
       a demotion. An adjacent name for the same territory reads as a normal
       category instead. Overridable from site-config. */
    const ALT = Object.assign({
      'Systems & Networking':   'Operating Environments',
      'Distributed & Parallel': 'Large-Scale & Decentralised Systems',
      'AI & Machine Learning':  'Applied Machine Learning',
      'Algorithms & Theory':    'Formal Methods',
      'Data & Databases':       'Data Infrastructure',
      'Security':               'Applied Security',
      'Compilers':              'Language Implementation',
      'Software Engineering':   'Development Practice'
    }, cfg.altNames || {});
    const altName = d => ALT[d] || (d + ' — further study');

    const label = (d, n, secondary) => {
      const text = secondary ? altName(d) : d;
      if (style === 'text') {
        return '<div class="course-lab is-text' + (secondary ? ' is-b' : '') + '"' +
               (secondary ? '' : ' data-cat="' + escapeHTML(d) + '" style="color:' + COLS.vivid[d] + '"') + '>' +
               escapeHTML(text) +
               '<span class="course-count">' + n + '</span></div>';
      }
      /* Filled box. Secondary rows are deliberately uncoloured — a plain
         outline reads as "same category, less of it" without adding a
         second tone to keep track of. */
      return '<div class="course-lab"><span class="lab-box' + (secondary ? ' is-b' : '') +
               (!secondary && style === 'outline' ? ' is-outline' : '') + '"' +
             (secondary ? '' : ' data-cat="' + escapeHTML(d) + '"') +
             (secondary ? ''
               : style === 'outline' ? ' style="border-color:' + COLS.vivid[d] + '"'
               : ' style="background:' + COLS.vivid[d] + ';color:' + COLS.ink[d] + '"') + '>' +
             escapeHTML(text) +
             '<span class="course-count">' + n + '</span></span></div>';
    };

    /* A line shows the course and the lead of its description. When there
       is more to read, the line itself is the control: a click or tap opens
       the full description in place. (On phones this is the only way to it:
       the card grid that desktop shows on expanding a category is hidden
       there, which used to leave descriptions unreachable.) */
    const line = c => {
      const more = !!(c.description && c.description !== c.brief);
      return '<span class="course-line' + (more ? ' has-more' : '') +
          '" data-entry="' + escapeHTML(c.name) + '"' +
          (more ? ' role="button" tabindex="0" aria-expanded="false"' : '') + '>' +
        escapeHTML(c.name) +
        (isOnline(c)
          ? '<span class="course-ext"> \u2197</span>' : '') +
        (c.brief ? '<span class="course-gloss">' + escapeHTML(c.brief) + '</span>' : '') +
        (more
          ? '<span class="course-more" aria-hidden="true"></span>' +
            '<span class="course-full">' + escapeHTML(c.description) +
              (c.source ? '<span class="course-full-src">' + escapeHTML(c.source) + '</span>' : '') +
              courseActs(c) +
            '</span>'
          : '') +
      '</span>';
    };

    const cards = (items, d) => items.map(c =>
      '<article class="course-card" data-entry="' + escapeHTML(c.name) + '"' +
        ' style="border-left-color:' + COLS.vivid[d] + '">' +
        '<h5 class="course-name">' + escapeHTML(c.name) + '</h5>' +
        (c.description ? '<p class="course-desc">' + escapeHTML(c.description) + '</p>' : '') +
        '<span class="course-origin">' + escapeHTML(c.source || '') + '</span>' +
      '</article>').join('');

    const row = (d, items, secondary) =>
      '<section class="course-group is-collapsed' + (secondary ? ' is-secondary' : '') +
        '" data-domain="' + escapeHTML(d) + '">' +
        label(d, items.length, secondary) +
        '<div class="course-body">' +
          '<div class="course-lines">' + items.map(line).join('') + '</div>' +
          '<div class="course-items">' + cards(items, d) + '</div>' +
        '</div>' +
      '</section>';

    /* Online courses are a different kind of evidence from a degree — chosen
       rather than required — so they get their own block after the college
       coursework instead of being mixed into its categories. */

    /* College rows first, in domain order; the lighter-weight rows after
       them, renamed so they don't read as a demotion. */
    let main = '', tail = '';
    domains.forEach(d => {
      const items = groups[d].filter(c => !isOnline(c));
      const m = items.filter(c => !c.minor), q = items.filter(c => c.minor);
      if (m.length) main += row(d, m, false);
      if (q.length) tail += row(d, q, true);
    });

    const online = visible.filter(isOnline);
    let onlineHTML = '';
    if (online.length) {
      const providers = {};
      online.forEach(c => { (providers[c.source] = providers[c.source] || []).push(c); });
      onlineHTML =
        '<div class="course-online">' +
          '<h4 class="course-online-head" data-ui="Self-directed">' + uiLabel('Self-directed') +
            '<span class="course-online-sub" data-ui="courses taken outside the degree">' +
              uiLabel('courses taken outside the degree') + '</span>' +
            '<span class="course-count">' + online.length + '</span></h4>' +
          '<div class="course-online-list">' +
            Object.keys(providers).map(p =>
              providers[p].map(c =>
                '<article class="course-online-item" data-entry="' + escapeHTML(c.name) + '">' +
                  '<span class="course-online-prov">' + escapeHTML(p) + '</span>' +
                  '<span class="course-online-name">' + escapeHTML(c.name) + '</span>' +
                  (c.description
                    ? '<span class="course-online-desc">' + escapeHTML(c.description) + '</span>'
                    : '') +
                  courseActs(c) +
                '</article>').join('')
            ).join('') +
          '</div>' +
        '</div>';
    }
    el.innerHTML = main + tail + onlineHTML;

    el.querySelectorAll('.course-lab').forEach(lab => {
      lab.addEventListener('click', () => {
        const g = lab.parentNode;
        g.classList.toggle('is-collapsed');
      });
    });
    /* Bound once on the container, which outlives every re-render. */
    if (!el._lineBound) {
      el._lineBound = true;
      const flip = ln => {
        const open = !ln.classList.contains('is-open');
        ln.classList.toggle('is-open', open);
        ln.setAttribute('aria-expanded', String(open));
      };
      el.addEventListener('click', e => {
        if (e.target.closest && e.target.closest('.course-acts')) return;   /* a link or button, not the line */
        const ln = e.target.closest ? e.target.closest('.course-line.has-more') : null;
        if (ln) flip(ln);
      });
      el.addEventListener('keydown', e => {
        if (e.key !== 'Enter' && e.key !== ' ') return;
        const ln = e.target.closest ? e.target.closest('.course-line.has-more') : null;
        if (ln) { e.preventDefault(); flip(ln); }
      });
    }
  }


  /* Official icon files for skill cards: media.iconFiles[name] is a path or
     URL, or { light, dark } when the project publishes separate versions for
     light and dark backgrounds. Shown exactly as published — never recoloured
     or put on a plate — so a brand mark looks like the real one. Paths are
     relative to media.imageDir. */
  function iconFileFor(name) {
    const media = SITE_CONFIG.media || {};
    const spec = (media.iconFiles || {})[name];
    if (!spec) return '';
    const dark = document.documentElement.getAttribute('data-theme') === 'dark';
    const f = typeof spec === 'string' ? spec : ((dark && spec.dark) || spec.light || spec.dark);
    if (!f) return '';
    const src = /^(https?:|\/|data:)/.test(f) ? f : (media.imageDir || 'assets/') + f;
    return '<img class="pc-logo pc-logo-img" src="' + escapeHTML(src) + '" alt="" ' +
           'width="44" height="44" loading="lazy" decoding="async">';
  }

  function renderSkills(skills) {
    window.__pfRenderSkills = renderSkills;   // editor re-renders live
    const el = document.getElementById('skills-list');
    if (!el) return;
    const colored = (SITE_CONFIG.media || {}).techLogoColor !== false;
    el.innerHTML = skills.map(s =>
      '<div class="skills-cluster">' +
        '<h4>' + escapeHTML(s.category) + '</h4>' +
        '<div class="tags">' +
          (s.items || []).filter(i =>
            ((SITE_CONFIG.media || {}).hiddenCards || {})[i] !== true
          ).map(i => {
            /* A per-card override wins over the catalogue match, so any tool
               can be given a different mark — or none — without touching the
               catalogue. `cardLogos[name]` may be a catalogue logo name, an
               emoji, or an empty string to suppress the mark entirely.
               data-entry makes the card right-clickable like every other
               item, which is what surfaces its source and edit options. */
            const over = ((SITE_CONFIG.media || {}).cardLogos || {})[i];
            const file = iconFileFor(i);
            let mark = '';
            if (over === '') {
              mark = '';
            } else if (file) {
              mark = file;
            } else if (over && !(symbolsOn() && /[A-Za-z]/.test(over))) {
              /* In symbol mode a leftover brand-logo name is ignored (the
                 card falls through to its symbol); an emoji still wins. */
              const byName = (SITE_CONFIG.logos || [])
                .filter(l => String(l.n).toLowerCase() === String(over).toLowerCase())[0];
              const monoOn = (SITE_CONFIG.media || {}).monoEmoji === true;
              mark = byName
                ? logoSVG(byName, colored)
                : '<span class="card-emoji' + (monoOn ? ' is-mono' : '') + '">' +
                  escapeHTML(monoOn ? String(over) + '\uFE0E' : over) + '</span>';
            } else {
              mark = techMark(i, false);
            }
            return '<span class="' + (mark ? 'has-logo' : 'is-textonly') +
                   '" data-entry="' + escapeHTML(i) + '">' +
                   mark + escapeHTML(i) + '</span>';
          }).join('') +
        '</div>' +
      '</div>'
    ).join('');
  }

  function renderAccomplishments(items) {
    const el = document.getElementById('accomplishments-list');
    if (!el) return;
    el.innerHTML = items.map(t => {
      const yearMatch = t.match(/\b(19|20)\d{2}\b/);
      const badge = yearMatch ? yearMatch[0] : '';
      const title = badge ? t.replace(badge, '').replace(/\s+/g, ' ').trim() : t;
      return '<li>' +
        '<span class="title">' + escapeHTML(title) + '</span>' +
        (badge ? '<span class="badge">' + escapeHTML(badge) + '</span>' : '') +
      '</li>';
    }).join('');
  }

  /* ----------------------------------------------------------
     7. Reveal animation
     ---------------------------------------------------------- */

  function setupReveal() {
    const els = document.querySelectorAll('.reveal');
    if (!('IntersectionObserver' in window)) {
      els.forEach(el => el.classList.add('in'));
      return;
    }
    const io = new IntersectionObserver(entries => {
      entries.forEach(e => {
        if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); }
      });
    /* threshold 0, not a fraction: a fraction is "this share of the section
       must be visible", and a section taller than about 8x the screen can
       never reach 12% — on a phone the project list is ~6,200px in a ~670px
       screen, so it stayed at opacity 0 forever. Any part entering view now
       triggers it; the bottom margin keeps it fading in as you scroll rather
       than popping in at the screen's edge. */
    }, { threshold: 0, rootMargin: '0px 0px -8% 0px' });
    els.forEach(el => io.observe(el));
  }

  function showLoadError(err) {
    const attemptedUrl = (function () {
      try { return new URL(RESUME_PATH, window.location.href).href; }
      catch (e) { return RESUME_PATH + ' (relative to ' + window.location.href + ')'; }
    })();
    const isFileProtocol = window.location.protocol === 'file:';

    /* Inject a highly-visible banner at the top of the shell so the
       user sees the failure immediately, even if styles haven't loaded.
       Uses inline styles only — independent of style.css. */
    const banner = document.createElement('div');
    banner.setAttribute('role', 'alert');
    banner.style.cssText =
      'background:#fff3e0;' +
      'border:1px solid #d97706;' +
      'border-left:6px solid #d97706;' +
      'border-radius:8px;' +
      'padding:20px 24px;' +
      'margin:20px auto;' +
      'max-width:760px;' +
      'font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;' +
      'font-size:14px;' +
      'line-height:1.6;' +
      'color:#3a1d00;';
    banner.innerHTML =
      '<div style="font-family:ui-sans-serif,system-ui,sans-serif;font-size:18px;font-weight:600;margin-bottom:10px;">' +
        '⚠ Could not load <code style="background:#ffe7c1;padding:2px 6px;border-radius:3px;font-family:inherit;">' +
        RESUME_PATH + '</code>' +
      '</div>' +
      '<div style="margin-bottom:14px;">' +
        '<b>Tried URL:</b> ' + escapeHTML(attemptedUrl) + '<br>' +
        '<b>Error:</b> ' + escapeHTML(err.message) +
      '</div>' +
      '<div style="font-family:ui-sans-serif,system-ui,sans-serif;font-weight:600;margin-bottom:6px;">' +
        'Check these in order:' +
      '</div>' +
      '<ol style="margin:0;padding-left:24px;font-family:ui-sans-serif,system-ui,sans-serif;font-size:14px;">' +
        (isFileProtocol
          ? '<li><b>You\'re opening the page via <code>file://</code>.</b> ' +
            'Browsers refuse <code>fetch()</code> from file URLs. ' +
            'Run a local server: <code>python3 -m http.server</code>, then open ' +
            '<code>http://localhost:8000/</code>.</li>'
          : '<li>Open the URL above directly in a new tab. Do you see your resume LaTeX source? ' +
            'If not, the file isn\'t at that path.</li>') +
        '<li>Confirm <code>' + RESUME_PATH + '</code> exists, relative to ' +
          '<code>index.html</code>.</li>' +
        '<li>If you\'re running <code>python3 -m http.server</code>, make sure you started it from the folder ' +
          'containing <code>index.html</code>.</li>' +
        '<li>If you\'re using Ulaa, Brave, or any browser with built-in tracker protection, try ' +
          '<b>incognito/private mode</b> — content blockers can intercept <code>fetch()</code> on local pages.</li>' +
        '<li>Open the browser <b>DevTools Console</b> for the full error trace.</li>' +
      '</ol>';

    const shell = document.querySelector('.shell') || document.body;
    if (shell.firstChild) shell.insertBefore(banner, shell.firstChild);
    else shell.appendChild(banner);

    /* Also note in each mount so empty sections don't look like a bug */
    const mounts = ['education-list','internship-list','featured-projects','all-projects','skills-list','accomplishments-list'];
    mounts.forEach(id => {
      const el = document.getElementById(id);
      if (el) el.innerHTML =
        '<div style="color:var(--muted);font-family:var(--mono);font-size:13px;padding:12px 0;">' +
        '(see error banner at top of page)</div>';
    });
  }

  /* ----------------------------------------------------------
     7b. Theme toggle (sun ↔ moon)
     ----------------------------------------------------------
     Pairs with the class-based override blocks in the palette CSS
     and the anti-FOUC script (theme-init.js). Lives here, not
     inline in HTML, so it survives strict CSPs from browsers and
     extensions (Ulaa's built-in dark mode, Brave Shields, etc.).
     ---------------------------------------------------------- */

  function setupThemeToggle() {
    const STORAGE_KEY = 'rs-theme';
    const root = document.documentElement;
    const btnD = document.getElementById('btn-day');
    const btnN = document.getElementById('btn-night');
    if (!btnD || !btnN) return;

    function effective() {
      if (root.classList.contains('theme-dark'))  return 'dark';
      if (root.classList.contains('theme-light')) return 'light';
      return (window.matchMedia &&
              window.matchMedia('(prefers-color-scheme: dark)').matches)
                ? 'dark' : 'light';
    }
    function paint() {
      const current = effective();
      /* Keep the attribute in step with the class so the editor and
         applySiteConfig always see the effective theme, including the OS
         default when no explicit choice exists. */
      root.setAttribute('data-theme', current);
      _bgCache = null;
      applySiteConfig(SITE_CONFIG);
      btnD.classList.toggle('active', current === 'light');
      btnN.classList.toggle('active', current === 'dark');
      btnD.setAttribute('aria-pressed', current === 'light' ? 'true' : 'false');
      btnN.setAttribute('aria-pressed', current === 'dark'  ? 'true' : 'false');
    }
    function apply(theme) {
      root.classList.remove('theme-light', 'theme-dark');
      if (theme === 'light' || theme === 'dark') {
        root.classList.add('theme-' + theme);
      }
      try { localStorage.setItem(STORAGE_KEY, theme); } catch (e) {}
      paint();
    }
    btnD.addEventListener('click', function () { apply('light'); });
    btnN.addEventListener('click', function () { apply('dark');  });

    if (window.matchMedia) {
      window.matchMedia('(prefers-color-scheme: dark)')
        .addEventListener('change', function () {
          let stored;
          try { stored = localStorage.getItem(STORAGE_KEY); } catch (e) {}
          if (stored !== 'light' && stored !== 'dark') paint();
        });
    }
    paint();
  }

  function setFooterYear() {
    const el = document.getElementById('year');
    if (el) el.textContent = new Date().getFullYear();
  }

  /* ----------------------------------------------------------
     7c. Dynamic nav builder
     ----------------------------------------------------------
     Rebuilds the top-bar nav based on what's actually rendered:
       • Empty sections (Work / Projects / Path) drop out of nav.
       • Sections with categorised content (e.g. Selected Work
         grouped by Backend / AI · ML / Systems) get a hover
         dropdown listing each category as a sub-link.
     The Day/Night theme switch is preserved.
     ---------------------------------------------------------- */

  function orderCategories(cats, order) {
    if (!order || !order.length) return cats.slice();
    const set = new Set(cats);
    const inOrder = order.filter(c => set.has(c));
    const rest = cats.filter(c => order.indexOf(c) === -1);
    return inOrder.concat(rest);
  }

  function uniqueCategories(items) {
    const out = [];
    const seen = Object.create(null);
    items.forEach(p => {
      if (p && p.category && !seen[p.category]) {
        seen[p.category] = true;
        out.push(p.category);
      }
    });
    return out;
  }

  function buildNav(state) {
    const navEl = document.querySelector('.topbar nav');
    if (!navEl) return;

    // Preserve the theme switch — pull it out, rebuild nav, re-append
    const themeSwitch = navEl.querySelector('.theme-switch');

    const items = [];
    items.push({ type: 'link', label: 'About', href: '#about' });

    if (state.workHasContent) {
      const cats = state.workCategories || [];
      if (cats.length) {
        items.push({
          type: 'group', label: 'Work', href: '#work',
          children: cats.map(c => ({ label: c, href: '#work-cat-' + slug(c) }))
        });
      } else {
        items.push({ type: 'link', label: 'Work', href: '#work' });
      }
    }

    if (state.projectsAllHasContent) {
      const cats = state.projectsAllCategories || [];
      if (cats.length) {
        items.push({
          type: 'group', label: 'Projects', href: '#projects-all',
          children: cats.map(c => ({
            label: c,
            href: '#projects-all',
            filterDomain: c            // selects the domain filter on click
          }))
        });
      } else {
        items.push({ type: 'link', label: 'Projects', href: '#projects-all' });
      }
    }

    if (state.educationHasContent) {
      items.push({ type: 'link', label: 'Path', href: '#education' });
    }

    items.push({ type: 'link', label: 'Contact', href: '#contact' });

    const html = items.map(item => {
      if (item.type === 'link') {
        return '<a href="' + item.href + '">' + escapeHTML(item.label) + '</a>';
      }
      const childLinks = item.children.map(c =>
        '<a href="' + c.href + '" class="nav-sub-link" role="menuitem"' +
          (c.filterDomain
            ? ' data-filter-domain="' + escapeHTML(c.filterDomain) + '"' +
              /* Right-clicking a dropdown entry should edit THAT entry.
                 Without a data-entry hook the editor walked up to the
                 enclosing section instead, so there was no way to reach
                 these from where they actually appear. */
              ' data-entry="Nav: ' + escapeHTML(c.filterDomain) + '"'
            : '') +
        '>' + escapeHTML(c.label) + '</a>'
      ).join('');
      return '<div class="nav-group">' +
        '<a href="' + item.href + '" class="nav-group-trigger" aria-haspopup="true">' +
          escapeHTML(item.label) +
          ' <span class="caret" aria-hidden="true">▾</span>' +
        '</a>' +
        '<div class="nav-dropdown" role="menu">' + childLinks + '</div>' +
      '</div>';
    }).join('');

    navEl.innerHTML = html;
    if (themeSwitch) navEl.appendChild(themeSwitch);

    /* Category sub-links used to jump to per-category anchors. All Projects
       is now filter-driven and has no such anchors, so a sub-link instead
       selects that domain filter and scrolls the section into view. */
    navEl.querySelectorAll('.nav-sub-link[data-filter-domain]').forEach(a => {
      a.addEventListener('click', e => {
        e.preventDefault();
        const domain = a.dataset.filterDomain;
        if (PF && PF.sel && PF.sel.domain) {
          PF.sel.domain = [domain];
          PF.sel.tech = [];
          PF.sel.status = [];
          pfRender();
        }
        const target = document.getElementById('projects-all');
        if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    });
  }

  /* Send load timing and transfer size to the dev server, which prints it
     at the prompt. Only ever fires on a local address, so the deployed site
     makes no such request. */
  /* Print what actually wired up. When a fix "doesn't work", the first
     question is whether the browser is running the current file at all —
     this answers it without guesswork. */
  const BUILD = 'v12';
  function selfCheck(data) {
    const media = SITE_CONFIG.media || {};
    const rows = [
      ['build', BUILD],
      ['skill cards clickable', document.querySelectorAll('.skills-cluster .tags span[data-entry]').length],
      ['intro regions tagged', document.querySelectorAll('[data-entry="Title"], [data-entry="Tagline"], [data-entry="About"], [data-entry="Meta lines"], [data-entry="Availability"]').length + '/5'],
      ['filters config loaded', !!(SITE_CONFIG.filters || {}).techGroups],
      ['hero element found', !!(document.getElementById('hero') ||
          document.querySelector('.hero') ||
          (document.querySelector('h1') || {}).parentNode)],
      ['portrait', media.portrait
          ? (document.getElementById('hero-portrait') ? 'rendered: ' + media.portrait
                                                      : 'configured but NOT rendered')
          : 'no file set (editor → Portrait → choose…)'],
      ['section padding', getComputedStyle(document.documentElement)
          .getPropertyValue('--block-pad-y').trim() || '(unset)'],
      ['tech filters', (document.querySelectorAll('.pf-rail .pf-btn[data-type="tech"]').length || 0) +
          ' shown, grouped=' + !!(SITE_CONFIG.filters || {}).techGroups]
    ];
    console.log('%c[Portfolio ' + BUILD + '] self-check', 'font-weight:bold');
    rows.forEach(r => console.log('   ' + String(r[0]).padEnd(24) + r[1]));
  }

  function reportPerf() {
    const h = window.location.hostname;
    const local = h === 'localhost' || h === '127.0.0.1' || h === '::1' ||
                  h === '' || /^192\.168\./.test(h);
    if (!local) return;
    setTimeout(() => {
      try {
        const nav = performance.getEntriesByType('navigation')[0];
        const res = performance.getEntriesByType('resource');
        let bytes = 0;
        const byType = {};
        res.forEach(r => {
          const n = r.transferSize || r.encodedBodySize || 0;
          bytes += n;
          const ext = (r.name.split('?')[0].split('.').pop() || '?').slice(0, 5);
          byType[ext] = (byType[ext] || 0) + n;
        });
        const payload = {
          domContentLoaded: nav ? Math.round(nav.domContentLoadedEventEnd) : null,
          loadComplete:     nav ? Math.round(nav.loadEventEnd) : null,
          firstPaint:       Math.round((performance.getEntriesByName('first-contentful-paint')[0] || {}).startTime || 0),
          renderDone:       Math.round(performance.now()),
          resources:        res.length,
          bytes:            bytes,
          byType:           byType
        };
        fetch('/__perf', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        }).catch(() => {});
      } catch (e) { /* timing API unavailable: not worth failing over */ }
    }, 600);          // let deferred images finish first
  }

  /* Promote every deferred tile image to a real src, once the browser is
     idle and the text has painted. */
  function loadDeferredImages() {
    const run = () => {
      document.querySelectorAll('.entry-tile img[data-src], .hero-portrait img[data-src]').forEach(img => {
        const tile = img.parentNode;
        img.addEventListener('load', () => {
          tile.classList.remove('is-pending');
          tile.classList.add('is-ready');
        });
        img.addEventListener('error', () => {
          /* Leave the tile collapsed and drop it from the layout entirely,
             so a missing file costs nothing but the space it never took. */
          tile.remove();
        });
        img.src = img.getAttribute('data-src');
        img.removeAttribute('data-src');
      });
    };
    if ('requestIdleCallback' in window) {
      requestIdleCallback(run, { timeout: 2000 });
    } else {
      setTimeout(run, 200);
    }
  }

  /* ----------------------------------------------------------
     Site config — visual settings from site-config.json
     ----------------------------------------------------------
     Content lives in resume.tex, per-project flags in projects.js,
     and how things LOOK lives here. Loading is best-effort: a
     missing or malformed file leaves the stylesheet untouched.
     ---------------------------------------------------------- */
  const SITE_CONFIG_DEFAULTS = {
    colors: { light: {}, dark: {}, recent: [] },
    sizes:  { textScale: 1, density: 1, maxWidth: null },
    sections: {},
    filters: {},
    logos:  [],
    media:  { imageDir: 'assets/', showIcons: true, iconStyle: 'emoji',
              showTechLogos: true, techLogoColor: true, showSecondaryLogos: true,
              skillIcons: 'symbols', cardSymbols: {} },
    symbols: { map: {}, defs: {} }
  };

  let SITE_CONFIG = JSON.parse(JSON.stringify(SITE_CONFIG_DEFAULTS));

  function loadSiteConfig() {
    return fetch('site-config.json', { cache: 'no-store' })
      .then(r => (r.ok ? r.json() : null))
      .then(json => {
        if (!json) return SITE_CONFIG;
        if (Array.isArray(json.logos)) SITE_CONFIG.logos = json.logos;
        _logoIndex = null;          // config changed — rebuild the lookup
        if (json.text) SITE_CONFIG.text = json.text;
        /* `filters` was missing from this list, so the grouping rules in
           site-config.json never reached the runtime and every tech term
           landed in the same band — which looked exactly like the ordering
           code doing nothing. */
        ['colors', 'sizes', 'sections', 'media', 'filters', 'courses', 'symbols'].forEach(k => {
          if (json[k] && typeof json[k] === 'object') {
            SITE_CONFIG[k] = Object.assign({}, SITE_CONFIG[k], json[k]);
          }
        });
        return SITE_CONFIG;
      })
      .catch(() => SITE_CONFIG);           // absent file is fine
  }


  /* ---------- Colour overrides, per stylesheet ----------
     Overrides live in colors.themes[<stylesheet id>][light|dark]; the id
     comes from the active stylesheet's --theme-id token, so a colour set
     while one theme is loaded never bleeds into another. A config written
     before this existed (plain colors.light / colors.dark) still applies
     to whatever stylesheet is loaded, until the editor migrates it. */
  function activeThemeId() {
    const v = getComputedStyle(document.documentElement).getPropertyValue('--theme-id');
    return (v || '').trim().replace(/^["']|["']$/g, '') || 'default';
  }
  function colourSetFor(cfg, mode) {
    const c = (cfg && cfg.colors) || {};
    if (c.themes) return ((c.themes[activeThemeId()] || {})[mode]) || {};
    return c[mode] || {};
  }
  function applyColourOverrides(cfg) {
    const root = document.documentElement;
    const c = (cfg && cfg.colors) || {};
    /* Clear every key any set could have written: switching mode OR
       stylesheet must not leave a stale inline value behind. */
    const sets = [c.light, c.dark];
    Object.keys(c.themes || {}).forEach(id => {
      const t = c.themes[id] || {}; sets.push(t.light, t.dark);
    });
    sets.forEach(set => Object.keys(set || {}).forEach(k => {
      if (k.charAt(0) === '_') return;
      root.style.removeProperty(k.charAt(0) === '-' ? k : '--' + k);
    }));
    const mode = root.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
    const set = colourSetFor(cfg, mode);
    Object.keys(set).forEach(k => {
      if (k.charAt(0) === '_') return;
      root.style.setProperty(k.charAt(0) === '-' ? k : '--' + k, set[k]);
    });
  }
  if (typeof window !== 'undefined') {     /* the parser is also loaded in node */
    /* sizes as well as colours: applySiteConfig ends by applying the colours */
    window.__applyColourOverrides = () => applySiteConfig(SITE_CONFIG);
    window.__activeThemeId = activeThemeId;
  }

  function applySiteConfig(cfg) {
    _bgCache = null;   // theme may have changed
    cfg = cfg || SITE_CONFIG;
    const root = document.documentElement;

    const sizes = cfg.sizes || {};
    /* sizes.phone holds separate text and spacing scales for phone widths;
       a value left out falls back to the general one. */
    const onPhone = !!(window.matchMedia && window.matchMedia('(max-width: 640px)').matches);
    const ph = (onPhone && sizes.phone) || {};
    const ts = ph.textScale || sizes.textScale, dn = ph.density || sizes.density;
    if (ts) root.style.setProperty('--text-scale', String(ts));
    if (dn) root.style.setProperty('--density',    String(dn));
    if (!applySiteConfig._mq && window.matchMedia) {
      applySiteConfig._mq = window.matchMedia('(max-width: 640px)');
      const again = () => applySiteConfig(SITE_CONFIG);
      if (applySiteConfig._mq.addEventListener) applySiteConfig._mq.addEventListener('change', again);
    }
    /* --block-pad-y is the actual spacing between sections (padding top and
       bottom on each block). The old --section-gap only added to it, so the
       slider read 0 while the page clearly had gaps. Drive the real value. */
    if (sizes.sectionGap !== undefined && sizes.sectionGap !== null) {
      root.style.setProperty('--block-pad-y', sizes.sectionGap + 'rem');
    }
    const media = cfg.media || {};
    if (media.logoShadow !== undefined && media.logoShadow !== null) {
      let s = Number(media.logoShadow);
      if (media.autoShadow !== false) {
        /* A shadow tuned for cream disappears on a dark page and vice
           versa, so scale it by how dark the surface actually is. Turn
           autoShadow off to use the raw value. */
        const bg = (getComputedStyle(root).getPropertyValue('--bg-soft') || '').trim();
        if (/^#/.test(bg)) {
          const lum = _relLum(bg);
          s = s * (lum < 0.5 ? 1.55 : 1);
        }
      }
      root.style.setProperty('--logo-shadow', String(Math.min(1, s)));
    }
    if (sizes.maxWidth)  root.style.setProperty('--site-max-w',
      typeof sizes.maxWidth === 'number' ? sizes.maxWidth + 'px' : sizes.maxWidth);

    applyColourOverrides(cfg);
    _bgCache = null;
    recolourCourses();
  }

  /* Per-section size overrides + icon rendering. Called after render so
     the section elements exist. */
  /* Prose overrides for the hand-written blocks (hero heading, lede, about
     paragraphs). These live in index.html rather than resume.tex, so the
     editor stores replacements in site-config.json instead of rewriting
     markup — the source file stays the source file. */
  function applyTextConfig(cfg, intro) {
    const text = (cfg || SITE_CONFIG).text || {};
    /* resume.tex is the source; site-config overrides only where set, so
       the editor can preview a change without rewriting the LaTeX. */
    if (intro) {
      if (!text.lede && intro.tagline) {
        const el = document.getElementById('hero-lede');
        if (el) el.textContent = intro.tagline;
      }
      if (!Array.isArray(text.about) && intro.about && intro.about.length) {
        const box = document.getElementById('about-copy');
        if (box) {
          box.querySelectorAll('p').forEach(p => p.remove());
          intro.about.forEach(para => {
            const p = document.createElement('p');
            p.textContent = para;
            box.appendChild(p);
          });
        }
      }
    }
    if (text.heroName) {
      const h1 = document.querySelector('.hero h1, #hero h1, h1');
      if (h1) {
        const parts = String(text.heroName).split(/\s+/);
        const last = parts.length > 1 ? parts.pop() : '';
        h1.innerHTML = escapeHTML(parts.join(' ')) +
                       (last ? '<br><span class="italic">' + escapeHTML(last) + '</span>' : '');
      }
    }
    if (text.lede) {
      const el = document.querySelector('[data-entry="Tagline"]') ||
                 document.getElementById('hero-lede');
      if (el) el.textContent = text.lede;
    }
    if (Array.isArray(text.meta) && text.meta.length) {
      const box = document.querySelector('[data-entry="Meta lines"]');
      if (box) {
        box.innerHTML = text.meta
          .map(s => '<span>' + escapeHTML(s) + '</span>').join('');
        box.setAttribute('data-entry', 'Meta lines');
      }
    }
    if (Array.isArray(text.corner) && text.corner.length) {
      const box = document.querySelector('[data-entry="Availability"]') ||
                  document.querySelector('#hero .corner, .hero .corner, .corner');
      if (box) {
        const lines = text.corner.map(escapeHTML);
        /* First line stays small, the rest render bold — same shape as the
           hand-written markup. */
        box.innerHTML = lines.length > 1
          ? lines[0] + '<br><b>' + lines.slice(1).join('<br>') + '</b>'
          : lines[0];
      }
    }
    if (Array.isArray(text.about) && text.about.length) {
      const box = document.querySelector('[data-entry="About"]') ||
                  document.getElementById('about-copy');
      if (box) {
        box.querySelectorAll('p').forEach(p => p.remove());
        text.about.forEach(para => {
          const p = document.createElement('p');
          p.textContent = para;
          box.appendChild(p);
        });
      }
    }
  }

  /* Section headings are overridable, so "Skills" can become "Toolbelt"
     without touching markup. Any h2 carrying data-section-title is fair
     game; the value is looked up by that key. */
  /* Give the hand-written blocks the same data-entry hook every rendered
     row has, so right-click treats them like any other item. */
  function tagIntroRegions() {
    /* Everything here is located structurally with an id as a first
       preference only. index.html is hand-written and this script has to
       work against whatever shape it happens to have — matching on ids
       alone meant these regions were never tagged, so right-clicking them
       offered nothing. */
    const tag = (el, name) => {
      if (el && !el.getAttribute('data-entry')) el.setAttribute('data-entry', name);
    };

    const h1 = document.querySelector('#hero h1, .hero h1, h1');
    tag(h1, 'Title');

    tag(document.getElementById('hero-lede') ||
        document.querySelector('#hero .lede, .hero .lede, p.lede'), 'Tagline');

    /* The small lines above the name: an explicit id, else a .meta block
       inside the hero, else the first element of short spans before the h1. */
    let meta = document.getElementById('hero-meta') ||
               document.querySelector('#hero .meta, .hero .meta, .meta');
    if (!meta && h1 && h1.parentNode) {
      const prev = h1.previousElementSibling;
      if (prev && prev.children.length && prev.children.length <= 6) meta = prev;
    }
    tag(meta, 'Meta lines');

    const about = document.getElementById('about-copy') ||
                  document.querySelector('#about .about-grid, .about-grid') ||
                  document.querySelector('#about');
    tag(about, 'About');

    /* The availability note in the hero corner ("Open to …"). */
    tag(document.querySelector('#hero .corner, .hero .corner, .corner'),
        'Availability');
  }

  /* Section titles. index.html carries each <h2>; site-config.json can
     override its wording (text.sectionTitles[key]) and the small numbered
     label above it (text.sectionLabels[key]). In an override, *word* sets
     the italic word, as the headings in index.html do with <em>. A heading
     without a data-section-title gets one from its section's id, so every
     title can be overridden and picked out in the editor. Clearing an
     override puts back exactly what index.html had. */
  const _titleOrig = new WeakMap();
  function titleHTML(s) {
    return escapeHTML(String(s)).replace(/\*([^*]+)\*/g, '<em>$1</em>');
  }
  function applySectionTitles(cfg) {
    const text = (cfg || SITE_CONFIG).text || {};
    const titles = text.sectionTitles || {}, labels = text.sectionLabels || {};
    document.querySelectorAll('section[id] h2:not([data-section-title])').forEach(h => {
      const id = h.closest('section').id;
      h.setAttribute('data-section-title',
        id.charAt(0).toUpperCase() + id.slice(1).replace(/-(\w)/g, (m, c) => ' ' + c.toUpperCase()));
    });
    document.querySelectorAll('[data-section-title]').forEach(h => {
      const key = h.getAttribute('data-section-title');
      /* A section icon (.sec-icon) sits inside the heading; it is not part
         of the wording, so it is kept aside and put back in front. */
      const icon = h.querySelector(':scope > .sec-icon');
      if (!_titleOrig.has(h)) {
        const c = h.cloneNode(true);
        const ci = c.querySelector(':scope > .sec-icon');
        if (ci) ci.remove();
        _titleOrig.set(h, c.innerHTML);
      }
      h.innerHTML = titles[key] ? titleHTML(titles[key]) : _titleOrig.get(h);
      if (icon) h.insertBefore(icon, h.firstChild);
      const sec = h.closest('section');
      const lab = sec && sec.querySelector('.col-label');
      if (lab) {
        if (!_titleOrig.has(lab)) _titleOrig.set(lab, lab.textContent);
        lab.textContent = labels[key] || _titleOrig.get(lab);
      }
    });
  }

  /* Per-entry visibility, keyed the same way icons and images are. */
  function applyEntryToggles(cfg) {
    const hidden = ((cfg || SITE_CONFIG).media || {}).hiddenEntries || {};
    Object.keys(hidden).forEach(name => {
      if (!hidden[name]) return;
      document.querySelectorAll('[data-entry], [data-title]').forEach(el => {
        const n = el.getAttribute('data-entry') || el.getAttribute('data-title');
        if (n === name) el.style.display = 'none';
      });
    });
  }

  function applySectionConfig(cfg, sectionMeta) {
    cfg = cfg || SITE_CONFIG;
    const perSection = cfg.sections || {};
    const media = cfg.media || {};
    const showIcons = media.showIcons !== false;

    const MAP = {
      'Education':       'education',
      'Internships':     'work',
      'Projects':        'projects-all',
      'Courses':         'courses',
      'Skills':          'skills',
      'Accomplishments': 'accomplishments'
    };

    Object.keys(MAP).forEach(name => {
      const el = document.getElementById(MAP[name]);
      if (!el) return;

      const s = perSection[name] || {};
      if (s.textScale) el.style.setProperty('--text-scale', String(s.textScale));
      if (s.density)   el.style.setProperty('--density',    String(s.density));

      if (!showIcons || s.showIcon === false) return;
      const meta = (sectionMeta || {})[name];
      const attrs = (meta && meta.attrs) || {};
      const ovI = (media.icons  || {})[name];
      const ovG = (media.images || {})[name];
      const ovA = (media.alts   || {})[name];
      const icon  = ovI !== undefined ? ovI : attrs.icon;
      const image = ovG !== undefined ? ovG : attrs.image;
      const alt   = ovA !== undefined ? ovA : (attrs.alt || name);
      if (!icon && !image) return;

      const h2 = el.querySelector('h2');
      if (!h2 || h2.querySelector('.sec-icon')) return;
      const span = document.createElement('span');
      span.className = 'sec-icon';
      if (image) {
        const dir = media.imageDir || '';
        const img = document.createElement('img');
        img.src = dir + image;
        img.alt = alt;
        span.appendChild(img);
      } else {
        span.textContent = icon;
        span.setAttribute('role', 'img');
        span.setAttribute('aria-label', alt);
      }
      h2.insertBefore(span, h2.firstChild);
    });
  }

  function hideSection(sectionId) {
    const el = document.getElementById(sectionId);
    if (el) el.style.display = 'none';
  }

  function boot() {
    // Wire up UI that doesn't depend on resume.tex first — so the
    // theme toggle and footer year work even if the fetch below fails.
    setupThemeToggle();
    setFooterYear();

    /* Load visual settings BEFORE the resume renders, not alongside it.
       These used to be two independent promises, which meant the render
       could win the race and build its logo lookup while SITE_CONFIG.logos
       was still empty — memoising an empty index, so no tech logo ever
       appeared. Chaining removes the race entirely. A missing or malformed
       site-config.json still resolves, so the site renders either way. */
    console.log('[Portfolio] Fetching', RESUME_PATH, 'from',
                new URL(RESUME_PATH, window.location.href).href);
    loadSiteConfig()
      .then(cfg => { applySiteConfig(cfg); return fetch(RESUME_PATH); })
      .then(r => {
        console.log('[Portfolio] resume.tex response: HTTP', r.status, r.statusText);
        if (!r.ok) throw new Error('HTTP ' + r.status + ' ' + r.statusText);
        return r.text();
      })
      .then(latex => {
        console.log('[Portfolio] resume.tex loaded:', latex.length, 'bytes');
        const data = parseResume(latex);
        console.log('[Portfolio] Parsed:',
          data.education.length, 'education,',
          data.internships.length, 'internships,',
          data.projects.length, 'projects,',
          data.skills.length, 'skill clusters,',
          data.accomplishments.length, 'accomplishments');

        // Read config — accept the new PORTFOLIO_CONFIG name, fall back
        // to the older RESUME_CONFIG, and finally to a flat PROJECTS_CONFIG.
        const cfg = Object.assign({},
          window.PORTFOLIO_CONFIG || window.RESUME_CONFIG || {});
        if (window.PROJECTS_CONFIG && !cfg.projects) cfg.projects = window.PROJECTS_CONFIG;

        const sec = cfg.sections || {};

        // Section toggles — hide whole sections when requested.
        if (sec.showEducation       === false) hideSection('education');
        if (sec.showInternships     === false || sec.showProjects === false) {
          // "Selected work" hosts both — hide only if BOTH are off.
          if (sec.showInternships === false && sec.showProjects === false) hideSection('work');
        }
        if (sec.showProjects        === false) hideSection('projects-all');
        if (sec.showCourses         === false) hideSection('courses');
        if (sec.showSkills          === false) hideSection('skills');
        if (sec.showAccomplishments === false) hideSection('recognition');

        const projects        = buildEntryList(data.projects    || [], cfg.projects,    'title',       ['featured', 'featuredOnly', 'category', 'hideDescription']);
        const education       = buildEntryList(data.education   || [], cfg.education,   'institution', []);
        const internships     = buildEntryList(data.internships || [], cfg.internships, 'title',       []);
        const skills          = buildEntryList(data.skills      || [], cfg.skills,      'category',    []);
        const accomplishments = buildAccomplishmentsList(data.accomplishments || [], cfg.accomplishments);
        const contact         = applyContactConfig(data.contact || {}, cfg.contact);

        renderContact(contact);
        if (sec.showEducation   !== false) renderEducation(education);
        /* Wrapped so the editor can redraw these two sections in place when a
           layout setting changes, without a full reload. */
        const renderWork = () => {
          if (sec.showInternships !== false) renderInternships(internships);
          if (sec.showProjects    !== false) {
            renderProjects(projects, {
              categoryOrder:          sec.projectCategoryOrder,
              groupByCategory:        sec.groupProjectsByCategory !== false,
              expandAllProjects:      !!sec.expandAllProjectsByDefault,
              showDescriptions:       sec.showProjectDescriptions !== false
            });
          }
        };
        renderWork();
        bindMobileToggles();
        buildMobileMenu();

        /* Logo legibility (lighten a mark, or put a dark one on a plate) is
           decided when cards are drawn, against the current background. The
           page draws in whichever theme it loads in, so switching theme left
           marks tuned for the other one — black Rust, Flask, Express and
           Linux logos on dark cards. Redraw the cards that carry logos
           whenever the theme actually changes. */
        let _lastTheme = document.documentElement.getAttribute('data-theme');
        new MutationObserver(() => {
          const t = document.documentElement.getAttribute('data-theme');
          if (t === _lastTheme) return;
          _lastTheme = t;
          requestAnimationFrame(() => {
            try {
              if (sec.showSkills !== false) renderSkills(skills);
              if (window.__pfRenderWork) window.__pfRenderWork();
            } catch (e) { console.warn('[portfolio] theme redraw failed', e); }
          });
        }).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'class'] });
        requestAnimationFrame(fitDiagramBoxes);
        /* a diagram hidden at load (the phone version on desktop, say) is
           fitted the first time it can be measured */
        window.addEventListener('resize', () => requestAnimationFrame(fitDiagramBoxes));
        document.addEventListener('click', () => requestAnimationFrame(fitDiagramBoxes));
        window.__pfRenderWork = () => { renderWork(); loadDeferredImages(); requestAnimationFrame(fitDiagramBoxes); };
        if (sec.showCourses         !== false) renderCourses(data.courses || []);
        if (sec.showSkills          !== false) renderSkills(skills);
        if (sec.showAccomplishments !== false) renderAccomplishments(accomplishments);

        // Rebuild the top-bar nav based on what actually rendered.
        // Featured projects = explicit { featured: true } in projects.js.
        // Rest = all projects, minus any marked { featuredOnly: true }.
        const featuredProjs = projects.filter(p => p.featured === true);
        const restProjs     = projects.filter(p => !(p.featured === true && p.featuredOnly === true));
        const order         = sec.projectCategoryOrder;
        const workCats      = orderCategories(uniqueCategories(featuredProjs), order);
        /* All Projects is filter-driven, so its nav sub-links mirror the
           Domain filters rather than old per-category anchors. Derive them
           from the parsed topic domains, not the legacy single `category`. */
        /* The nav dropdown keeps its OWN hidden list (filters.hiddenNav),
           separate from the filter rail's (filters.hidden). The two serve
           different purposes: the dropdown is a short table of contents and
           usually wants trimming hard, while the rail is a working tool
           where you may still want to filter by a domain you've kept out of
           the menu. Set `filters.navFollowsFilters: true` to make the
           dropdown inherit the rail's hidden list as well. */
        const F = SITE_CONFIG.filters || {};
        const hiddenNav = F.hiddenNav || {};
        const hiddenRail = F.hidden || {};
        const follows = F.navFollowsFilters === true;
        const restCats = uniqueStrings(
          [].concat.apply([], restProjs.map(p => p.domains || (p.category ? [p.category] : [])))
        ).filter(c => !hiddenNav['domain:' + c] &&
                      !(follows && hiddenRail['domain:' + c]));

        const internshipsVisible = (sec.showInternships !== false) && internships.length > 0;
        const featuredVisible    = (sec.showProjects    !== false) && featuredProjs.length > 0;
        const restVisible        = (sec.showProjects    !== false) && restProjs.length > 0;
        const educationVisible   = (sec.showEducation   !== false) && education.length > 0;

        buildNav({
          workHasContent:          internshipsVisible || featuredVisible,
          workCategories:          featuredVisible ? workCats : [],
          projectsAllHasContent:   restVisible,
          projectsAllCategories:   restVisible ? restCats : [],
          educationHasContent:     educationVisible
        });

        applySectionConfig(SITE_CONFIG, data.sectionMeta);
        /* Both were defined but never called, so title overrides and hidden
           entries saved from the editor vanished on reload. */
        applySectionTitles(SITE_CONFIG);
        applyEntryToggles(SITE_CONFIG);
        /* Tag first: applyTextConfig now finds its targets via data-entry,
           so tagging has to happen before it runs or the overrides miss. */
        tagIntroRegions();
        applyTextConfig(SITE_CONFIG, data.intro);
        renderPortrait();

        setupReveal();
        window.__resumeData = data;
        /* Tell the dev editor the parse is done. It builds its target list
           from this data, and without a signal it would populate at init —
           before the fetch resolves — and list only the section headings. */
        loadDeferredImages();
        reportPerf();
        selfCheck(data);
        try {
          document.dispatchEvent(new CustomEvent('portfolio:rendered', { detail: data }));
        } catch (e) { /* CustomEvent unsupported: editor falls back to polling */ }
        window.__siteConfig = SITE_CONFIG;
        /* A live view, not a copy: PF.palette is rebuilt (a new object) when
           the theme changes, and a plain assignment left the editor reading
           the old day palette in night mode. Writes go through to PF. */
        Object.defineProperty(window, '__domainPalette', {
          configurable: true,
          get: () => PF.palette,
          set: v => { PF.palette = v; }
        });
        /* Hook for the dev editor: re-render the filter UI and redraw the
           connector lines after a colour change, without a page reload. */
        window.__pfRedraw = function () { pfRender(); };
        /* Dev editor: re-apply text and per-section overrides in place. (The
           editor's phone view drives a second copy of this page through
           these hooks; the logic for that lives in editor.js, not here.) */
        window.__pfApplyText = function () {
          applySectionConfig(SITE_CONFIG, data.sectionMeta);
          applySectionTitles(SITE_CONFIG);
          applyTextConfig(SITE_CONFIG, data.intro);
        };
        /* ...and redraw titles from the config the editor is working on. */
        window.__pfApplyTitles = cfg => applySectionTitles(cfg || SITE_CONFIG);
        window.__renderedProjects = projects;
        console.log('[Portfolio] Render complete.');
      })
      .catch(err => {
        console.error('[Portfolio] Resume load failed:', err);
        showLoadError(err);
        setupReveal();
      });
  }

  /* ----------------------------------------------------------
     9. Live stylesheet preview — call from DevTools console:
          setStyle('aegean-clay')   → loads style-aegean-clay.css
          setStyle('default')       → loads style.css
          listStyles()              → prints the built-in palettes
          clearStyle()              → reset to style.css, clear storage
        Persisted via localStorage 'rs-style', so a refresh keeps your
        choice. theme-init.js also reads the same key (and the URL
        param ?style=<name>) so it takes effect before first paint.
     ---------------------------------------------------------- */
  function findMainStyleLink() {
    return document.getElementById('main-style') ||
           document.querySelector('link[rel="stylesheet"]');
  }
  if (typeof window !== 'undefined') {
    window.setStyle = function (name) {
      if (typeof name !== 'string' || !/^[a-z0-9-]+$/.test(name)) {
        console.warn('[Portfolio] setStyle: name must be lowercase letters/digits/hyphens.');
        return;
      }
      const link = findMainStyleLink();
      if (!link) {
        console.warn('[Portfolio] setStyle: no <link rel="stylesheet"> found.');
        return;
      }
      const href = name === 'default' ? 'style.css' : 'style-' + name + '.css';
      link.href = href;
      try { localStorage.setItem('rs-style', name); } catch (e) {}
      console.log('[Portfolio] Style switched to', href, '(persisted)');
    };
    window.clearStyle = function () {
      const link = findMainStyleLink();
      if (link) link.href = 'style.css';
      try { localStorage.removeItem('rs-style'); } catch (e) {}
      console.log('[Portfolio] Style reset to style.css.');
    };
    window.listStyles = function () {
      console.log('[Portfolio] Built-in palettes — call setStyle("<name>") to swap:');
      console.log('  default       → style.css');
      console.log('  rust-cream    → style-rust-cream.css');
      console.log('  aegean-clay   → style-aegean-clay.css');
      console.log('  forest-green  → style-forest-green.css');
      console.log('  day-night     → style-day-night.css');
      console.log('  <custom>      → style-<custom>.css   (drop any file matching this name into the folder)');
      console.log('You can also set the URL param ?style=<name> for a permalink.');
    };
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { parseResume, stripComments, stripFormatting, buildEntryList, buildAccomplishmentsList, applyContactConfig, groupByCategory, parseTopicPaths, extractProjectMeta, uniqueStrings };
  } else if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
