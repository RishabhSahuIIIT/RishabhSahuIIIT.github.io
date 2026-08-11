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
      const lg = logoFor(it.name);
      const mark = lg ? logoSVG(lg, media.techLogoColor !== false) : '';
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
      return '<article class="work-item" data-entry="' + escapeHTML(intern.title || '') + '">' +
        '<span class="idx">' + num + ' / Intern</span>' +
        '<div>' +
          '<h3>' + entryMark(intern.title || '') + escapeHTML(intern.title || 'Internship') + '</h3>' +
          (intern.dates ? '<div class="role">' + escapeHTML(intern.dates) + '</div>' : '') +
          renderBullets(intern.bullets) +
          renderStack(intern.stack, 'stack') +
        '</div>' +
        '<div class="meta-right">' + entryTile(intern.title || '') +
          renderLinks(links) + '</div>' +
      '</article>';
    }).join('');
  }

  function renderFeaturedItem(project, index, opts) {
    opts = opts || {};
    const showDescription = opts.showDescription !== false;
    const links = normalizeLinks(project);
    const idx = String(index + 1).padStart(2, '0');
    const titleEl = links.length
      ? '<a href="' + escapeHTML(links[0].url) + '" target="_blank" rel="noopener">' + escapeHTML(project.title) + '</a>'
      : escapeHTML(project.title);
    const showDesc = showDescription && project.description && !project.hideDescription;
    /* Featured projects previously carried "NN / Intern" because they share
       the work-item template with internships. They're a separate section
       now, so they get their own label — and no running count, which said
       nothing useful. */
    return '<article class="work-item" data-entry="' + escapeHTML(project.title || '') + '">' +
      '<span class="idx">' + escapeHTML((project.domains || [])[0] || 'Project') + '</span>' +
      '<div>' +
        '<h3>' + entryMark(project.title || '') + titleEl + '</h3>' +
        (project.role ? '<div class="role">' + escapeHTML(project.role) + '</div>' : '') +
        (project.summary ? '<p>' + escapeHTML(project.summary) + '</p>' : '') +
        (showDesc ? '<p class="project-description">' + escapeHTML(project.description) + '</p>' : '') +
        renderBullets(project.bullets) +
        renderStack(project.stack, 'stack', project.category) +
      '</div>' +
      '<div class="meta-right">' + entryTile(project.title || '') +
        renderLinks(links) + '</div>' +
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
            const items = g.projects.map(p => renderFeaturedItem(p, runningIdx++, featuredOpts)).join('');
            return '<div class="project-group work-group" id="work-cat-' + slug(g.category) + '">' +
              '<h3 class="project-group-head">' + escapeHTML(g.category) +
                '</h3>' +
              '<div class="project-group-list">' + items + '</div>' +
            '</div>';
          }).join('');
        } else {
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
  let _logoIndex = null;
  function logoIndex() {
    if (_logoIndex) return _logoIndex;
    _logoIndex = {};
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

  const MIN_LOGO_CONTRAST = 2.6;
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

  function pfDomainsOf(p)  { return p.domains || (p.category ? [p.category] : []); }
  function pfTechOf(p)     { return p.stack || []; }
  function pfIsLive(p)     { return !!p.live; }

  function pfAnyActive() {
    return PF.sel.domain.length || PF.sel.tech.length || PF.sel.status.length;
  }
  function pfMatches(p) {
    if (!pfAnyActive()) return true;
    const dHit = v => pfDomainsOf(p).indexOf(v) >= 0;
    const tHit = v => pfTechOf(p).indexOf(v) >= 0;
    const sHit = () => pfIsLive(p);
    if (PF.logic === 'and') {
      return PF.sel.domain.every(dHit) && PF.sel.tech.every(tHit) &&
             (!PF.sel.status.length || sHit());
    }
    if (PF.logic === 'or') {
      return PF.sel.domain.some(dHit) || PF.sel.tech.some(tHit) ||
             (PF.sel.status.length ? sHit() : false);
    }
    // hybrid: OR inside each group, AND across groups
    const d = PF.sel.domain.length ? PF.sel.domain.some(dHit) : true;
    const t = PF.sel.tech.length   ? PF.sel.tech.some(tHit)   : true;
    const s = PF.sel.status.length ? sHit()                    : true;
    return d && t && s;
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
      const lg = logoFor(t);
      return '<span>' + (lg ? logoSVG(lg, colored) : '') + escapeHTML(t) + '</span>';
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

    return '<article class="' + cls + '"' + style + ' data-title="' + escapeHTML(p.title) + '">' +
      edge +
      thumbHTML +
      '<div class="pc-card-head">' +
        '<h4 class="pc-card-title">' + iconHTML + escapeHTML(p.title) + '</h4>' + live + dots +
      '</div>' +
      '<div class="pc-topics">' + domHTML + leafHTML + '</div>' +
      (p.description ? '<p class="pc-desc">' + escapeHTML(p.description) + '</p>' : '') +
      (techHTML ? '<div class="pc-tech">' + techHTML + '</div>' : '') +
      (links ? '<div class="pc-links">' + links + '</div>' : '') +
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
      dd.querySelectorAll('.pf-opt').forEach(opt => {
        const on = sel.indexOf(opt.dataset.val) >= 0;
        opt.classList.toggle('is-on', on);
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
      if (n) {
        n.hidden = !on;
        n.textContent = on ? (b.dataset.count || '') : '';
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

  function renderSkills(skills) {
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
            let mark = '';
            if (over === '') {
              mark = '';
            } else if (over) {
              const byName = (SITE_CONFIG.logos || [])
                .filter(l => String(l.n).toLowerCase() === String(over).toLowerCase())[0];
              const monoOn = (SITE_CONFIG.media || {}).monoEmoji === true;
              mark = byName
                ? logoSVG(byName, colored)
                : '<span class="card-emoji' + (monoOn ? ' is-mono' : '') + '">' +
                  escapeHTML(monoOn ? String(over) + '\uFE0E' : over) + '</span>';
            } else {
              const lg = logoFor(i);
              mark = lg ? logoSVG(lg, colored) : '';
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
    }, { threshold: 0.12, rootMargin: '0px 0px -40px 0px' });
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
          (c.filterDomain ? ' data-filter-domain="' + escapeHTML(c.filterDomain) + '"' : '') +
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
              showTechLogos: true, techLogoColor: true, showSecondaryLogos: true }
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
        ['colors', 'sizes', 'sections', 'media', 'filters'].forEach(k => {
          if (json[k] && typeof json[k] === 'object') {
            SITE_CONFIG[k] = Object.assign({}, SITE_CONFIG[k], json[k]);
          }
        });
        return SITE_CONFIG;
      })
      .catch(() => SITE_CONFIG);           // absent file is fine
  }

  function applySiteConfig(cfg) {
    _bgCache = null;   // theme may have changed
    cfg = cfg || SITE_CONFIG;
    const root = document.documentElement;

    const sizes = cfg.sizes || {};
    if (sizes.textScale) root.style.setProperty('--text-scale', String(sizes.textScale));
    if (sizes.density)   root.style.setProperty('--density',    String(sizes.density));
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

    /* Colour overrides are plain CSS variable assignments, applied for the
       theme currently in effect. theme-init.js sets data-theme before paint. */
    const theme = root.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
    const other = theme === 'dark' ? 'light' : 'dark';
    /* Inline styles on :root outrank the stylesheet, so an override left
       behind from the other theme would leak across when you switch. Clear
       the other set first, then apply this one. */
    Object.keys((cfg.colors && cfg.colors[other]) || {}).forEach(k => {
      if (k.charAt(0) === '_') return;
      root.style.removeProperty(k.charAt(0) === '-' ? k : '--' + k);
    });
    const overrides = (cfg.colors && cfg.colors[theme]) || {};
    Object.keys(overrides).forEach(k => {
      if (k.charAt(0) === '_') return;
      const name = k.charAt(0) === '-' ? k : '--' + k;
      root.style.setProperty(name, overrides[k]);
    });
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

  function applySectionTitles(cfg) {
    const titles = ((cfg || SITE_CONFIG).text || {}).sectionTitles || {};
    document.querySelectorAll('[data-section-title]').forEach(h => {
      const key = h.getAttribute('data-section-title');
      const val = titles[key];
      if (val) h.textContent = val;
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
        if (sec.showInternships !== false) renderInternships(internships);
        if (sec.showProjects    !== false) {
          renderProjects(projects, {
            categoryOrder:          sec.projectCategoryOrder,
            groupByCategory:        sec.groupProjectsByCategory !== false,
            expandAllProjects:      !!sec.expandAllProjectsByDefault,
            showDescriptions:       sec.showProjectDescriptions !== false
          });
        }
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
        const restCats = uniqueStrings(
          [].concat.apply([], restProjs.map(p => p.domains || (p.category ? [p.category] : [])))
        );

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
        window.__domainPalette = PF.palette;
        /* Hook for the dev editor: re-render the filter UI and redraw the
           connector lines after a colour change, without a page reload. */
        window.__pfRedraw = function () { pfRender(); };
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
