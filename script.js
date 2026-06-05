/* ============================================================
   script.js — engine
   --------------------------------------------------------------
   Fetches resume.tex, parses it, and renders every data-driven
   section of the portfolio. Per-section overrides come from
   resume-config.js (window.RESUME_CONFIG).
   ============================================================ */

(function () {
  "use strict";

  /* ----------------------------------------------------------
     1. LaTeX parser primitives
     ---------------------------------------------------------- */

  function stripComments(text) {
    let out = "";
    let i = 0;
    while (i < text.length) {
      if (text[i] === "\\" && text[i + 1] === "%") {
        out += "\\%";
        i += 2;
        continue;
      }
      if (text[i] === "%") {
        while (i < text.length && text[i] !== "\n") i++;
        continue;
      }
      out += text[i];
      i++;
    }
    return out;
  }

  function findBalancedBraces(text, startIndex) {
    if (text[startIndex] !== "{") return null;
    let depth = 1;
    let i = startIndex + 1;
    while (i < text.length) {
      if (text[i] === "\\" && i + 1 < text.length) {
        i += 2;
        continue;
      }
      if (text[i] === "{") depth++;
      else if (text[i] === "}") {
        depth--;
        if (depth === 0)
          return { content: text.slice(startIndex + 1, i), endIndex: i + 1 };
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
      result = result.replace(
        /\\(?:textbf|textit|emph|underline|texttt)\s*\{([^{}]*)\}/g,
        "$1",
      );
      result = result.replace(/\\href\s*\{[^}]*\}\s*\{([^{}]*)\}/g, "$1");
      result = result.replace(/\\fontsize\{[^}]+\}\{[^}]+\}/g, "");
      result = result.replace(/\\(?:hspace|vspace)\*?\s*\{[^}]+\}/g, "");
      result = result.replace(/\\faIcon\{[^}]+\}/g, "");
      result = result.replace(/\\rule\{[^}]+\}\{[^}]+\}/g, "");
      result = result.replace(/\\centerline\s*\{[^}]*\}/g, "");
      result = result.replace(
        /\\(?:selectfont|noindent|normalfont|large|Large|Huge|huge|hfill|itemsize|enspace|quad|qquad|textbullet|par)\b/g,
        " ",
      );
      result = result.replace(/\\\\/g, " ");
    } while (result !== prev);
    result = result
      .replace(/\\&/g, "&")
      .replace(/\\%/g, "%")
      .replace(/\\\$/g, "$")
      .replace(/\\#/g, "#")
      .replace(/\\_/g, "_")
      .replace(/~/g, " ");
    result = result.replace(/(\s)--(\s)/g, "$1–$2");
    result = result.replace(/[{}]/g, "");
    return result.replace(/\s+/g, " ").trim();
  }

  function extractItems(itemizeContent) {
    const items = [];
    let i = 0;
    const len = itemizeContent.length;
    while ((i = itemizeContent.indexOf("\\item", i)) !== -1) {
      let j = i + "\\item".length;
      while (j < len && /\s/.test(itemizeContent[j])) j++;
      if (itemizeContent[j] === "[") {
        const close = itemizeContent.indexOf("]", j);
        if (close !== -1) j = close + 1;
      }
      const nextItem = itemizeContent.indexOf("\\item", i + 5);
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
    const start = text.indexOf("\\begin{itemize}", fromIndex);
    if (start === -1) return null;
    let i = start + "\\begin{itemize}".length;
    if (text[i] === "[") {
      const close = text.indexOf("]", i);
      if (close !== -1) i = close + 1;
    }
    const end = text.indexOf("\\end{itemize}", i);
    if (end === -1) return null;
    return {
      content: text.slice(i, end),
      startIndex: start,
      endIndex: end + "\\end{itemize}".length,
    };
  }

  function findTextbfPositions(text) {
    const positions = [];
    let i = 0;
    while ((i = text.indexOf("\\textbf", i)) !== -1) {
      let j = i + "\\textbf".length;
      while (j < text.length && /\s/.test(text[j])) j++;
      if (text[j] !== "{") {
        i++;
        continue;
      }
      const braces = findBalancedBraces(text, j);
      if (!braces) {
        i++;
        continue;
      }
      positions.push({
        content: braces.content,
        startIndex: i,
        contentEnd: braces.endIndex,
      });
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
      if (url.startsWith("mailto:")) contact.email = url.slice(7);
      else if (url.includes("linkedin.com")) contact.linkedin = url;
      else if (url.includes("github.com")) contact.github = url;
      else if (url.includes("gitlab.com")) contact.gitlab = url;
    }

    function valueAfterLabel(label) {
      const idx = headerText.indexOf("\\textbf{" + label);
      if (idx === -1) return null;
      const lbBrace = headerText.indexOf("{", idx);
      const lbClose = findBalancedBraces(headerText, lbBrace);
      if (!lbClose) return null;
      let start = lbClose.endIndex;
      let end = headerText.length;
      const stops = [
        "\\\\",
        "\\quad",
        "\\textbullet",
        "\\href",
        "\\faIcon",
        "}",
        "\n\n",
      ];
      for (const s of stops) {
        const p = headerText.indexOf(s, start);
        if (p !== -1 && p < end) end = p;
      }
      return stripFormatting(headerText.slice(start, end));
    }

    const phone = valueAfterLabel("Phone:");
    if (phone) contact.phone = phone;
    const address = valueAfterLabel("Address:");
    if (address) contact.address = address;

    return contact;
  }

  function parseEducation(text) {
    const positions = findTextbfPositions(text);
    const entries = [];
    for (let k = 0; k < positions.length; k++) {
      const cur = positions[k];
      const nextStart =
        k + 1 < positions.length ? positions[k + 1].startIndex : text.length;
      const after = text.slice(cur.contentEnd, nextStart);
      const marked = after
        .replace(/\\hfill/g, " ||SEP|| ")
        .replace(/\\\\/g, " ||NL|| ");
      const cleaned = stripFormatting(marked);
      const lines = cleaned
        .split("||NL||")
        .map((s) => s.trim())
        .filter((s) => s);
      const entry = { institution: stripFormatting(cur.content) };
      if (lines.length >= 1) {
        const parts = lines[0]
          .split("||SEP||")
          .map((s) => s.trim())
          .filter((s) => s);
        entry.dates = parts[parts.length - 1] || "";
      }
      if (lines.length >= 2) {
        const parts = lines[1].split("||SEP||").map((s) => s.trim());
        entry.degree = parts[0] || "";
        entry.score = parts[1] || "";
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
      let end = block.length;
      let depth = 0;
      for (let i = start; i < block.length; i++) {
        const c = block[i];
        if (c === "\\") {
          if (block.slice(i, i + 6) === "\\hfill") {
            end = i;
            break;
          }
          i++;
          continue;
        }
        if (c === "{") depth++;
        else if (c === "}") {
          if (depth === 0) {
            end = i;
            break;
          }
          depth--;
        }
      }
      const kwText = stripFormatting(block.slice(start, end));
      item.stack = kwText
        .split(",")
        .map((s) => s.trim())
        .filter((s) => s);
    }
    const hrefMatch = /\\href\s*\{([^}]+)\}/.exec(block);
    if (hrefMatch) item.url = hrefMatch[1];
    const itemize = findItemizeBlock(block);
    if (itemize)
      item.bullets = extractItems(itemize.content).map((p) => p.cleaned);
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
      .filter((p) => !insideRange(itemizeRanges, p.startIndex))
      .filter((p) => !insideRange(hrefRanges, p.startIndex))
      .filter((p) => !/^Keywords\s*:?/i.test(p.content));

    const internships = [];
    for (let k = 0; k < positions.length; k++) {
      const cur = positions[k];
      const nextStart =
        k + 1 < positions.length ? positions[k + 1].startIndex : text.length;
      const block = text.slice(cur.contentEnd, nextStart);
      const intern = parseProjectLikeBlock(block, stripFormatting(cur.content));
      const hfillIdx = block.indexOf("\\hfill");
      if (hfillIdx !== -1) {
        let end = block.length;
        const stops = ["\\\\", "\\vspace", "\\noindent", "\\begin", "\n\n"];
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

  function parseProjects(text) {
    const re = /\\subsection\*\s*\{([^}]+)\}/g;
    const subs = [];
    let m;
    while ((m = re.exec(text)) !== null) {
      subs.push({
        title: m[1].trim(),
        startIndex: m.index,
        contentStart: m.index + m[0].length,
      });
    }
    const projects = [];
    for (let k = 0; k < subs.length; k++) {
      const cur = subs[k];
      const nextStart =
        k + 1 < subs.length ? subs[k + 1].startIndex : text.length;
      projects.push(
        parseProjectLikeBlock(
          text.slice(cur.contentStart, nextStart),
          cur.title,
        ),
      );
    }
    return projects;
  }

  function parseSkills(text) {
    const block = findItemizeBlock(text);
    if (!block) return [];
    const items = extractItems(block.content);
    const out = [];
    for (const it of items) {
      const colonIdx = it.cleaned.indexOf(":");
      if (colonIdx === -1) continue;
      const category = it.cleaned
        .slice(0, colonIdx)
        .replace(/\s*:\s*$/, "")
        .trim();
      const list = it.cleaned
        .slice(colonIdx + 1)
        .split(",")
        .map((s) => s.trim())
        .filter((s) => s);
      out.push({ category, items: list });
    }
    return out;
  }

  function parseSimpleList(text) {
    const block = findItemizeBlock(text);
    if (!block) return [];
    return extractItems(block.content).map((it) => it.cleaned);
  }

  function parseResume(latex) {
    const text = stripComments(latex);
    const sectionRe = /\\section\*\s*\{([^}]+)\}/g;
    const matches = [];
    let m;
    while ((m = sectionRe.exec(text)) !== null) {
      matches.push({
        name: m[1].trim(),
        startIndex: m.index,
        contentStart: m.index + m[0].length,
      });
    }
    const sections = {};
    for (let i = 0; i < matches.length; i++) {
      const end =
        i + 1 < matches.length ? matches[i + 1].startIndex : text.length;
      sections[matches[i].name] = text.slice(matches[i].contentStart, end);
    }
    const header = matches.length ? text.slice(0, matches[0].startIndex) : "";
    return {
      contact: parseContact(header),
      education: parseEducation(sections["Education"] || ""),
      internships: parseInternships(sections["Internships"] || ""),
      projects: parseProjects(sections["Projects"] || ""),
      skills: parseSkills(sections["Skills"] || ""),
      accomplishments: parseSimpleList(sections["Accomplishments"] || ""),
      interests: parseSimpleList(
        sections["Interests and Extracurricular Activities"] || "",
      ),
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

    latexEntries.forEach((entry) => {
      const id = entry[idKey];
      const cfg = config[id] || {};
      if (isHidden(cfg)) {
        seen[id] = true;
        return;
      }
      let merged = Object.assign({}, entry);
      if (cfg.useAlt && cfg.altData)
        merged = Object.assign({}, entry, cfg.altData);
      configOnlyFields.forEach((k) => {
        if (cfg[k] !== undefined) merged[k] = cfg[k];
      });
      seen[id] = true;
      out.push(merged);
    });

    Object.keys(config).forEach((key) => {
      if (seen[key]) return;
      const cfg = config[key];
      if (!cfg || !cfg.useAlt || !cfg.altData || isHidden(cfg)) return;
      const entry = Object.assign({ [idKey]: key }, cfg.altData);
      configOnlyFields.forEach((k) => {
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

    latexItems.forEach((text) => {
      const m = findCfg(text);
      const cfg = m ? m.cfg : null;
      if (m) matchedConfigKeys.add(m.key);
      if (isHidden(cfg)) return;
      if (cfg && cfg.altText) out.push(cfg.altText);
      else if (cfg && cfg.useAlt && cfg.altData && cfg.altData.text)
        out.push(cfg.altData.text);
      else out.push(text);
    });

    // Web-only items (config keys that didn't match any resume entry,
    // with useAlt:true OR altText)
    Object.keys(config).forEach((key) => {
      if (matchedConfigKeys.has(key)) return;
      const cfg = config[key];
      if (!cfg || isHidden(cfg)) return;
      if (cfg.altText) out.push(cfg.altText);
      else if (cfg.useAlt && cfg.altData && cfg.altData.text)
        out.push(cfg.altData.text);
    });

    return out;
  }

  // Contact has fixed field names; config keys match those names.
  // Supports { hide: true } and { override: "new value" }.
  function applyContactConfig(contact, contactCfg) {
    contactCfg = contactCfg || {};
    const result = Object.assign({}, contact);
    Object.keys(contactCfg).forEach((field) => {
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
    projects.forEach((p) => {
      const cat = p.category || "Other";
      if (!groups[cat]) {
        groups[cat] = [];
        naturalOrder.push(cat);
      }
      groups[cat].push(p);
    });
    let categories;
    if (Array.isArray(order) && order.length) {
      const inOrder = order.filter((c) => groups[c]);
      const extras = naturalOrder.filter((c) => order.indexOf(c) === -1);
      categories = inOrder.concat(extras);
    } else {
      categories = naturalOrder;
    }
    return categories.map((cat) => ({ category: cat, projects: groups[cat] }));
  }

  /* ----------------------------------------------------------
     5. Render helpers
     ---------------------------------------------------------- */

  function escapeHTML(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return {
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      }[c];
    });
  }

  function slug(s) {
    return String(s || "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
  }

  function inferLinkLabel(url) {
    if (!url) return "Link";
    if (url.includes("gitlab.com")) return "GitLab";
    if (url.includes("github.com")) return "GitHub";
    if (url.includes("bitbucket")) return "Bitbucket";
    return "Repo";
  }

  function renderStack(stack, className) {
    if (!Array.isArray(stack) || !stack.length) return "";
    return (
      '<div class="' +
      className +
      '">' +
      stack.map((t) => "<span>" + escapeHTML(t) + "</span>").join("") +
      "</div>"
    );
  }

  function renderBullets(bullets) {
    if (!Array.isArray(bullets) || !bullets.length) return "";
    return (
      "<ul>" +
      bullets.map((b) => "<li>" + escapeHTML(b) + "</li>").join("") +
      "</ul>"
    );
  }

  function renderLinks(links) {
    if (!Array.isArray(links) || !links.length) return "";
    return (
      '<div class="repo-links">' +
      links
        .map(
          (l) =>
            '<a class="repo-link" href="' +
            escapeHTML(l.url) +
            '" target="_blank" rel="noopener">' +
            escapeHTML(l.label) +
            ' <span class="arrow" aria-hidden="true">↗</span></a>',
        )
        .join("") +
      "</div>"
    );
  }

  function normalizeLinks(data) {
    if (Array.isArray(data.links) && data.links.length) return data.links;
    if (data.url) return [{ label: inferLinkLabel(data.url), url: data.url }];
    return [];
  }

  /* ----------------------------------------------------------
     6. Section renderers
     ---------------------------------------------------------- */

  function renderContact(c) {
    function set(id, value, href) {
      const el = document.getElementById(id);
      if (!el) return;
      if (!value) {
        el.textContent = "—";
        el.removeAttribute("href");
        return;
      }
      el.textContent = value;
      if (href != null) el.setAttribute("href", href);
    }
    set("contact-email", c.email, c.email ? "mailto:" + c.email : null);
    set(
      "contact-phone",
      c.phone,
      c.phone ? "tel:" + c.phone.replace(/[^+\d]/g, "") : null,
    );
    set(
      "contact-linkedin",
      c.linkedin
        ? c.linkedin.replace(/^https?:\/\/(www\.)?linkedin\.com\/in\//, "")
        : "",
      c.linkedin,
    );
    set(
      "contact-github",
      c.github ? c.github.replace(/^https?:\/\/(www\.)?github\.com\//, "") : "",
      c.github,
    );
    set(
      "contact-gitlab",
      c.gitlab ? c.gitlab.replace(/^https?:\/\/(www\.)?gitlab\.com\//, "") : "",
      c.gitlab,
    );
  }

  function renderEducation(entries) {
    const el = document.getElementById("education-list");
    if (!el) return;
    el.innerHTML = entries
      .map((e) => {
        const score = e.score || "";
        let scoreHTML = "";
        if (score) {
          if (score.indexOf(":") !== -1) {
            const parts = score.split(":");
            scoreHTML =
              escapeHTML(parts[0].trim()) +
              "<b>" +
              escapeHTML(parts.slice(1).join(":").trim()) +
              "</b>";
          } else {
            scoreHTML = "Score<b>" + escapeHTML(score) + "</b>";
          }
        }
        return (
          '<div class="timeline-row">' +
          '<div class="when">' +
          escapeHTML(e.dates || "") +
          "</div>" +
          '<div class="what">' +
          escapeHTML(e.institution || "") +
          (e.degree ? "<small>" + escapeHTML(e.degree) + "</small>" : "") +
          "</div>" +
          '<div class="score">' +
          scoreHTML +
          "</div>" +
          "</div>"
        );
      })
      .join("");
  }

  function renderInternships(internships) {
    const el = document.getElementById("internship-list");
    if (!el) return;
    el.innerHTML = internships
      .map((intern, idx) => {
        const links = normalizeLinks(intern);
        const num = String(idx + 1).padStart(2, "0");
        return (
          '<article class="work-item">' +
          '<span class="idx">' +
          num +
          " / Intern</span>" +
          "<div>" +
          "<h3>" +
          escapeHTML(intern.title || "Internship") +
          "</h3>" +
          (intern.dates
            ? '<div class="role">' + escapeHTML(intern.dates) + "</div>"
            : "") +
          renderBullets(intern.bullets) +
          renderStack(intern.stack, "stack") +
          "</div>" +
          '<div class="meta-right">' +
          renderLinks(links) +
          "</div>" +
          "</article>"
        );
      })
      .join("");
  }

  function renderFeaturedItem(project, index) {
    const links = normalizeLinks(project);
    const idx = String(index + 1).padStart(2, "0");
    const titleEl = links.length
      ? '<a href="' +
        escapeHTML(links[0].url) +
        '" target="_blank" rel="noopener">' +
        escapeHTML(project.title) +
        "</a>"
      : escapeHTML(project.title);
    return (
      '<article class="work-item">' +
      '<span class="idx">' +
      idx +
      " / Project</span>" +
      "<div>" +
      "<h3>" +
      titleEl +
      "</h3>" +
      (project.role
        ? '<div class="role">' + escapeHTML(project.role) + "</div>"
        : "") +
      (project.summary ? "<p>" + escapeHTML(project.summary) + "</p>" : "") +
      renderBullets(project.bullets) +
      renderStack(project.stack, "stack") +
      "</div>" +
      '<div class="meta-right">' +
      renderLinks(links) +
      "</div>" +
      "</article>"
    );
  }

  function renderCompactItem(project) {
    const links = normalizeLinks(project);
    return (
      '<article class="project-compact">' +
      '<header class="pc-head">' +
      '<h4 class="pc-title">' +
      escapeHTML(project.title) +
      "</h4>" +
      (project.category
        ? '<span class="pc-cat">' + escapeHTML(project.category) + "</span>"
        : "") +
      "</header>" +
      (project.summary
        ? '<p class="pc-desc">' + escapeHTML(project.summary) + "</p>"
        : Array.isArray(project.bullets) && project.bullets.length
          ? '<p class="pc-desc">' + escapeHTML(project.bullets[0]) + "</p>"
          : "") +
      '<div class="pc-foot">' +
      renderStack(project.stack, "pc-stack") +
      renderLinks(links) +
      "</div>" +
      "</article>"
    );
  }

  function renderProjects(projects, opts) {
    opts = opts || {};
    const categoryOrder = opts.categoryOrder;
    const groupByCat = opts.groupByCategory !== false;

    // Default behaviour: every project is featured. Only entries with
    // an explicit `featured: false` in projects.js drop to the compact
    // "All projects" list. This means an empty projects config still
    // surfaces everything from resume.tex prominently.
    const featured = projects.filter((p) => p.featured !== false);
    const rest = projects.filter((p) => p.featured === false);

    /* ---- Selected work (featured) ---- */
    const featuredEl = document.getElementById("featured-projects");
    if (featuredEl) {
      if (!featured.length) {
        featuredEl.innerHTML = "";
      } else {
        const hasCategories = featured.some((p) => p.category);
        if (groupByCat && hasCategories) {
          const groups = groupByCategory(featured, categoryOrder);
          let runningIdx = 0;
          featuredEl.innerHTML = groups
            .map((g) => {
              const items = g.projects
                .map((p) => renderFeaturedItem(p, runningIdx++))
                .join("");
              return (
                '<div class="project-group work-group" id="work-cat-' +
                slug(g.category) +
                '">' +
                '<h3 class="project-group-head">' +
                escapeHTML(g.category) +
                ' <span class="project-group-count">' +
                g.projects.length +
                "</span></h3>" +
                '<div class="project-group-list">' +
                items +
                "</div>" +
                "</div>"
              );
            })
            .join("");
        } else {
          featuredEl.innerHTML = featured.map(renderFeaturedItem).join("");
        }
      }
    }

    /* ---- All projects (demoted) — hide section if empty ---- */
    const allEl = document.getElementById("all-projects");
    const allSection = document.getElementById("projects-all");
    if (!allEl) return;
    if (!rest.length) {
      if (allSection) allSection.style.display = "none";
      return;
    }
    if (allSection) allSection.style.display = "";

    const hasCategories = rest.some((p) => p.category);
    if (groupByCat && hasCategories) {
      const groups = groupByCategory(rest, categoryOrder);
      allEl.innerHTML = groups
        .map(
          (g) =>
            '<div class="project-group" id="proj-cat-' +
            slug(g.category) +
            '">' +
            '<h3 class="project-group-head">' +
            escapeHTML(g.category) +
            ' <span class="project-group-count">' +
            g.projects.length +
            "</span></h3>" +
            '<div class="project-group-list">' +
            g.projects.map(renderCompactItem).join("") +
            "</div>" +
            "</div>",
        )
        .join("");
    } else {
      allEl.innerHTML = rest.map(renderCompactItem).join("");
    }
  }

  function renderSkills(skills) {
    const el = document.getElementById("skills-list");
    if (!el) return;
    el.innerHTML = skills
      .map(
        (s) =>
          '<div class="skills-cluster">' +
          "<h4>" +
          escapeHTML(s.category) +
          "</h4>" +
          '<div class="tags">' +
          (s.items || [])
            .map((i) => "<span>" + escapeHTML(i) + "</span>")
            .join("") +
          "</div>" +
          "</div>",
      )
      .join("");
  }

  function renderAccomplishments(items) {
    const el = document.getElementById("accomplishments-list");
    if (!el) return;
    el.innerHTML = items
      .map((t) => {
        const yearMatch = t.match(/\b(19|20)\d{2}\b/);
        const badge = yearMatch ? yearMatch[0] : "";
        const title = badge
          ? t.replace(badge, "").replace(/\s+/g, " ").trim()
          : t;
        return (
          "<li>" +
          '<span class="title">' +
          escapeHTML(title) +
          "</span>" +
          (badge
            ? '<span class="badge">' + escapeHTML(badge) + "</span>"
            : "") +
          "</li>"
        );
      })
      .join("");
  }

  /* ----------------------------------------------------------
     7. Reveal animation
     ---------------------------------------------------------- */

  function setupReveal() {
    const els = document.querySelectorAll(".reveal");
    if (!("IntersectionObserver" in window)) {
      els.forEach((el) => el.classList.add("in"));
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          if (e.isIntersecting) {
            e.target.classList.add("in");
            io.unobserve(e.target);
          }
        });
      },
      { threshold: 0.12, rootMargin: "0px 0px -40px 0px" },
    );
    els.forEach((el) => io.observe(el));
  }

  function showLoadError(err) {
    const attemptedUrl = (function () {
      try {
        return new URL("resume.tex", window.location.href).href;
      } catch (e) {
        return "resume.tex (relative to " + window.location.href + ")";
      }
    })();
    const isFileProtocol = window.location.protocol === "file:";

    /* Inject a highly-visible banner at the top of the shell so the
       user sees the failure immediately, even if styles haven't loaded.
       Uses inline styles only — independent of style.css. */
    const banner = document.createElement("div");
    banner.setAttribute("role", "alert");
    banner.style.cssText =
      "background:#fff3e0;" +
      "border:1px solid #d97706;" +
      "border-left:6px solid #d97706;" +
      "border-radius:8px;" +
      "padding:20px 24px;" +
      "margin:20px auto;" +
      "max-width:760px;" +
      "font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;" +
      "font-size:14px;" +
      "line-height:1.6;" +
      "color:#3a1d00;";
    banner.innerHTML =
      '<div style="font-family:ui-sans-serif,system-ui,sans-serif;font-size:18px;font-weight:600;margin-bottom:10px;">' +
      '⚠ Could not load <code style="background:#ffe7c1;padding:2px 6px;border-radius:3px;font-family:inherit;">resume.tex</code>' +
      "</div>" +
      '<div style="margin-bottom:14px;">' +
      "<b>Tried URL:</b> " +
      escapeHTML(attemptedUrl) +
      "<br>" +
      "<b>Error:</b> " +
      escapeHTML(err.message) +
      "</div>" +
      '<div style="font-family:ui-sans-serif,system-ui,sans-serif;font-weight:600;margin-bottom:6px;">' +
      "Check these in order:" +
      "</div>" +
      '<ol style="margin:0;padding-left:24px;font-family:ui-sans-serif,system-ui,sans-serif;font-size:14px;">' +
      (isFileProtocol
        ? "<li><b>You're opening the page via <code>file://</code>.</b> " +
          "Browsers refuse <code>fetch()</code> from file URLs. " +
          "Run a local server: <code>python3 -m http.server</code>, then open " +
          "<code>http://localhost:8000/</code>.</li>"
        : "<li>Open the URL above directly in a new tab. Do you see your resume LaTeX source? " +
          "If not, the file isn't at that path.</li>") +
      "<li>Confirm <code>resume.tex</code> sits in the <i>same folder</i> as " +
      "<code>index.html</code> (not in a subfolder).</li>" +
      "<li>If you're running <code>python3 -m http.server</code>, make sure you started it from the folder " +
      "containing <code>index.html</code>.</li>" +
      "<li>If you're using Ulaa, Brave, or any browser with built-in tracker protection, try " +
      "<b>incognito/private mode</b> — content blockers can intercept <code>fetch()</code> on local pages.</li>" +
      "<li>Open the browser <b>DevTools Console</b> for the full error trace.</li>" +
      "</ol>";

    const shell = document.querySelector(".shell") || document.body;
    if (shell.firstChild) shell.insertBefore(banner, shell.firstChild);
    else shell.appendChild(banner);

    /* Also note in each mount so empty sections don't look like a bug */
    const mounts = [
      "education-list",
      "internship-list",
      "featured-projects",
      "all-projects",
      "skills-list",
      "accomplishments-list",
    ];
    mounts.forEach((id) => {
      const el = document.getElementById(id);
      if (el)
        el.innerHTML =
          '<div style="color:var(--muted);font-family:var(--mono);font-size:13px;padding:12px 0;">' +
          "(see error banner at top of page)</div>";
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
    const STORAGE_KEY = "rs-theme";
    const root = document.documentElement;
    const btnD = document.getElementById("btn-day");
    const btnN = document.getElementById("btn-night");
    if (!btnD || !btnN) return;

    function effective() {
      if (root.classList.contains("theme-dark")) return "dark";
      if (root.classList.contains("theme-light")) return "light";
      return window.matchMedia &&
        window.matchMedia("(prefers-color-scheme: dark)").matches
        ? "dark"
        : "light";
    }
    function paint() {
      const current = effective();
      btnD.classList.toggle("active", current === "light");
      btnN.classList.toggle("active", current === "dark");
      btnD.setAttribute("aria-pressed", current === "light" ? "true" : "false");
      btnN.setAttribute("aria-pressed", current === "dark" ? "true" : "false");
    }
    function apply(theme) {
      root.classList.remove("theme-light", "theme-dark");
      if (theme === "light" || theme === "dark") {
        root.classList.add("theme-" + theme);
      }
      try {
        localStorage.setItem(STORAGE_KEY, theme);
      } catch (e) {}
      paint();
    }
    btnD.addEventListener("click", function () {
      apply("light");
    });
    btnN.addEventListener("click", function () {
      apply("dark");
    });

    if (window.matchMedia) {
      window
        .matchMedia("(prefers-color-scheme: dark)")
        .addEventListener("change", function () {
          let stored;
          try {
            stored = localStorage.getItem(STORAGE_KEY);
          } catch (e) {}
          if (stored !== "light" && stored !== "dark") paint();
        });
    }
    paint();
  }

  function setFooterYear() {
    const el = document.getElementById("year");
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
    const inOrder = order.filter((c) => set.has(c));
    const rest = cats.filter((c) => order.indexOf(c) === -1);
    return inOrder.concat(rest);
  }

  function uniqueCategories(items) {
    const out = [];
    const seen = Object.create(null);
    items.forEach((p) => {
      if (p && p.category && !seen[p.category]) {
        seen[p.category] = true;
        out.push(p.category);
      }
    });
    return out;
  }

  function buildNav(state) {
    const navEl = document.querySelector(".topbar nav");
    if (!navEl) return;

    // Preserve the theme switch — pull it out, rebuild nav, re-append
    const themeSwitch = navEl.querySelector(".theme-switch");

    const items = [];
    items.push({ type: "link", label: "About", href: "#about" });

    if (state.workHasContent) {
      const cats = state.workCategories || [];
      if (cats.length) {
        items.push({
          type: "group",
          label: "Work",
          href: "#work",
          children: cats.map((c) => ({
            label: c,
            href: "#work-cat-" + slug(c),
          })),
        });
      } else {
        items.push({ type: "link", label: "Work", href: "#work" });
      }
    }

    if (state.projectsAllHasContent) {
      const cats = state.projectsAllCategories || [];
      if (cats.length) {
        items.push({
          type: "group",
          label: "Projects",
          href: "#projects-all",
          children: cats.map((c) => ({
            label: c,
            href: "#proj-cat-" + slug(c),
          })),
        });
      } else {
        items.push({ type: "link", label: "Projects", href: "#projects-all" });
      }
    }

    if (state.educationHasContent) {
      items.push({ type: "link", label: "Path", href: "#education" });
    }

    items.push({ type: "link", label: "Contact", href: "#contact" });

    const html = items
      .map((item) => {
        if (item.type === "link") {
          return (
            '<a href="' + item.href + '">' + escapeHTML(item.label) + "</a>"
          );
        }
        const childLinks = item.children
          .map(
            (c) =>
              '<a href="' +
              c.href +
              '" class="nav-sub-link" role="menuitem">' +
              escapeHTML(c.label) +
              "</a>",
          )
          .join("");
        return (
          '<div class="nav-group">' +
          '<a href="' +
          item.href +
          '" class="nav-group-trigger" aria-haspopup="true">' +
          escapeHTML(item.label) +
          ' <span class="caret" aria-hidden="true">▾</span>' +
          "</a>" +
          '<div class="nav-dropdown" role="menu">' +
          childLinks +
          "</div>" +
          "</div>"
        );
      })
      .join("");

    navEl.innerHTML = html;
    if (themeSwitch) navEl.appendChild(themeSwitch);
  }

  /* ----------------------------------------------------------
     8. Boot
     ---------------------------------------------------------- */

  function hideSection(sectionId) {
    const el = document.getElementById(sectionId);
    if (el) el.style.display = "none";
  }

  function boot() {
    // Wire up UI that doesn't depend on resume.tex first — so the
    // theme toggle and footer year work even if the fetch below fails.
    setupThemeToggle();
    setFooterYear();

    console.log(
      "[Portfolio] Fetching resume.tex from",
      new URL("resume.tex", window.location.href).href,
    );
    fetch("resume.tex")
      .then((r) => {
        console.log(
          "[Portfolio] resume.tex response: HTTP",
          r.status,
          r.statusText,
        );
        if (!r.ok) throw new Error("HTTP " + r.status + " " + r.statusText);
        return r.text();
      })
      .then((latex) => {
        console.log("[Portfolio] resume.tex loaded:", latex.length, "bytes");
        const data = parseResume(latex);
        console.log(
          "[Portfolio] Parsed:",
          data.education.length,
          "education,",
          data.internships.length,
          "internships,",
          data.projects.length,
          "projects,",
          data.skills.length,
          "skill clusters,",
          data.accomplishments.length,
          "accomplishments",
        );

        // Read config — accept the new PORTFOLIO_CONFIG name, fall back
        // to the older RESUME_CONFIG, and finally to a flat PROJECTS_CONFIG.
        const cfg = Object.assign(
          {},
          window.PORTFOLIO_CONFIG || window.RESUME_CONFIG || {},
        );
        if (window.PROJECTS_CONFIG && !cfg.projects)
          cfg.projects = window.PROJECTS_CONFIG;

        const sec = cfg.sections || {};

        // Section toggles — hide whole sections when requested.
        if (sec.showEducation === false) hideSection("education");
        if (sec.showInternships === false || sec.showProjects === false) {
          // "Selected work" hosts both — hide only if BOTH are off.
          if (sec.showInternships === false && sec.showProjects === false)
            hideSection("work");
        }
        if (sec.showProjects === false) hideSection("projects-all");
        if (sec.showSkills === false) hideSection("skills");
        if (sec.showAccomplishments === false) hideSection("recognition");

        const projects = buildEntryList(
          data.projects || [],
          cfg.projects,
          "title",
          ["featured", "category"],
        );
        const education = buildEntryList(
          data.education || [],
          cfg.education,
          "institution",
          [],
        );
        const internships = buildEntryList(
          data.internships || [],
          cfg.internships,
          "title",
          [],
        );
        const skills = buildEntryList(
          data.skills || [],
          cfg.skills,
          "category",
          [],
        );
        const accomplishments = buildAccomplishmentsList(
          data.accomplishments || [],
          cfg.accomplishments,
        );
        const contact = applyContactConfig(data.contact || {}, cfg.contact);

        renderContact(contact);
        if (sec.showEducation !== false) renderEducation(education);
        if (sec.showInternships !== false) renderInternships(internships);
        if (sec.showProjects !== false) {
          // Pass grouping options to renderProjects:
          //   - category order list (display order of groups)
          //   - groupingEnabled toggle (default true if any project has category)
          renderProjects(projects, {
            categoryOrder: sec.projectCategoryOrder,
            groupByCategory: sec.groupProjectsByCategory !== false,
          });
        }
        if (sec.showSkills !== false) renderSkills(skills);
        if (sec.showAccomplishments !== false)
          renderAccomplishments(accomplishments);

        // Rebuild the top-bar nav based on what actually rendered.
        // Empty sections drop out; sections with categorised projects
        // get a hover dropdown of each category.
        const featuredProjs = projects.filter((p) => p.featured !== false);
        const restProjs = projects.filter((p) => p.featured === false);
        const groupEnabled = sec.groupProjectsByCategory !== false;
        const order = sec.projectCategoryOrder;
        const workCats = groupEnabled
          ? orderCategories(uniqueCategories(featuredProjs), order)
          : [];
        const restCats = groupEnabled
          ? orderCategories(uniqueCategories(restProjs), order)
          : [];

        const internshipsVisible =
          sec.showInternships !== false && internships.length > 0;
        const featuredVisible =
          sec.showProjects !== false && featuredProjs.length > 0;
        const restVisible = sec.showProjects !== false && restProjs.length > 0;
        const educationVisible =
          sec.showEducation !== false && education.length > 0;

        buildNav({
          workHasContent: internshipsVisible || featuredVisible,
          workCategories: featuredVisible ? workCats : [],
          projectsAllHasContent: restVisible,
          projectsAllCategories: restVisible ? restCats : [],
          educationHasContent: educationVisible,
        });

        setupReveal();
        window.__resumeData = data;
        window.__renderedProjects = projects;
        console.log("[Portfolio] Render complete.");
      })
      .catch((err) => {
        console.error("[Portfolio] Resume load failed:", err);
        showLoadError(err);
        setupReveal();
      });
  }

  if (typeof module !== "undefined" && module.exports) {
    module.exports = {
      parseResume,
      stripComments,
      stripFormatting,
      buildEntryList,
      buildAccomplishmentsList,
      applyContactConfig,
      groupByCategory,
    };
  } else if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
