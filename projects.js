/* ============================================================
   projects.js — portfolio configuration
   --------------------------------------------------------------
   By default, EVERYTHING in resume.tex shows up on the page, in
   the "All projects" section. To promote a project into the
   prominent "Selected work" section, set `featured: true` on it.

   Project categories are auto-extracted from each subsection
   title in resume.tex (the right-aligned tag after \hfill):

       \subsection*{JSON API server \hfill
                    {\normalfont\itshape\small Backend Development}}

   Per-project keys (all optional):
     featured: true             move into "Selected work" (also stays
                                in All projects unless featuredOnly)
     featuredOnly: true         show only in "Selected work", hide
                                from "All projects" (needs featured:true)
     show: false                drop the entry entirely
     hideDescription: true      hide the % description: comment
     useAlt: true               override resume's text with altData
     altData: {...}             title, role, summary, bullets, stack, links

   The same per-project block also accepts web-only entries — set
   useAlt:true and provide all the fields the resume would have.
   ============================================================ */

window.PORTFOLIO_CONFIG = {
  /* ============================================================
     SECTION-LEVEL TOGGLES
     ============================================================ */
  sections: {
    // showEducation:       false,    // hide whole education section
    // showInternships:     false,
    // showProjects:        false,
    // showSkills:          false,
    // showAccomplishments: false,

    // Group projects under category headings. On by default.
    groupProjectsByCategory: true,

    // Order of category groups on the page and in nav dropdowns.
    // Categories listed here appear in this order; any others fall
    // in after them as they're encountered in the resume. Strings
    // must match the category tag in resume.tex EXACTLY.
    projectCategoryOrder: ["Backend Development", "Machine Learning"],

    // Should the per-project "Details" dropdowns in the All-projects
    // section be expanded by default? false = closed (cleaner page).
    expandAllProjectsByDefault: false,

    // Show paragraph descriptions parsed from `% description:` LaTeX
    // comments in resume.tex. Flip to false to hide them site-wide.
    showProjectDescriptions: true,

    // Keep the Featured section a concise highlight reel: show each
    // project's description paragraph but NOT its detail bullets (the
    // full bullets still live in the All-projects "Details" dropdown).
    // Flip to true to show bullets on the featured cards too.
    showFeaturedBullets: false,
  },

  /* ============================================================
     EDUCATION — keyed by institution name from resume.tex
     ============================================================ */
  education: {
    // "Campion School Bhopal": { show: false }
  },

  /* ============================================================
     INTERNSHIPS — keyed by title from resume.tex
     ============================================================ */
  internships: {
    // (internships render straight from the resume by default)
  },

  /* ============================================================
     PROJECTS — keyed by \subsection*{...} title (the LEFT side
     of \hfill in the title; the RIGHT side is the category and
     is read straight from the resume).

     DEFAULT: every project shows in "All projects" only.
     Add `featured: true` to put a project in "Selected work"
     (it'll still appear in All projects unless you also set
     `featuredOnly: true`).
     ============================================================ */
  projects: {
    // ---- Selected work (featured) ----
    // Keys must match the parsed \subsection* title EXACTLY. Note the
    // en-dash (–) in the Citestat key: resume "--" is rendered as an
    // en-dash by the parser, so a literal "--" here would NOT match.
    "Real-Time Collaborative Text Editor using CRDT":    { featured: true },
    "Agentic AI Research Assistant":                     { featured: true },
    "Network Intrusion Detection and Prevention System": { featured: true },
    "Citestat – Academic Citation Analytics Dashboard":  { featured: true },
    "Racket-to-LLVM Compiler Frontend":                  { featured: true },

    // Examples — uncomment and adjust as needed:
    // Promote to "Selected work" (mirrors in All projects too):
    // "JSON API server": { featured: true },
    // Promote AND hide from All projects:
    // "JSON API server": { featured: true, featuredOnly: true },
    // Hide a project's description paragraph site-wide:
    // "Wine Classifier based on Decision Tree": { hideDescription: true },
    // Override with a richer web description:
    // "JSON API server": {
    //   featured: true,
    //   useAlt:   true,
    //   altData: {
    //     title:   "JSON API Server",
    //     role:    "Containerised Flask service",
    //     summary: "A small REST API over Postgres, ready to run from " +
    //              "one `docker compose up`.",
    //     bullets: ["..."],
    //     stack:   ["Flask", "Python", "PostgreSQL", "Docker"],
    //     links: [{ label: "GitLab", url: "https://gitlab.com/projectsa2/jsonapiserver" }]
    //   }
    // },
    // Add a project not in the resume (web-only):
    // "Portfolio Site": {
    //   featured: true,
    //   useAlt:   true,
    //   altData: {
    //     title:    "This portfolio",
    //     category: "Web Development",
    //     summary:  "The site you're looking at — parses my LaTeX resume on load.",
    //     stack:    ["HTML", "CSS", "Vanilla JS"],
    //     links: [{ label: "GitHub", url: "https://github.com/RishabhSahuIIIT/RishabhSahuIIIT.github.io" }]
    //   }
    // }
  },

  /* ============================================================
     SKILLS — keyed by cluster category from resume.tex
     ============================================================ */
  skills: {
    // "Core Concepts": { show: false }
  },

  /* ============================================================
     ACCOMPLISHMENTS — keyed by case-insensitive SUBSTRING of the
     accomplishment line in resume.tex. Use a distinctive phrase
     that appears LITERALLY in the resume (e.g. "N.T.S.E." with
     dots, not "NTSE").
     Per-entry: { show: false } to drop, { altText: "..." } to rewrite.
     ============================================================ */
  accomplishments: {
    // "GATE":     { altText: "GATE CS/IT 2024 — 95.4 percentile (top 5%)" },
    // "N.T.S.E.": { show: false }
  },
};

/* Backwards-compatible alias (used by older versions of script.js) */
window.PROJECTS_CONFIG = window.PORTFOLIO_CONFIG.projects;
