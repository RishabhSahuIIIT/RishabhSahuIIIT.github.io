/* ============================================================
   projects.js — portfolio configuration
   --------------------------------------------------------------
   By default, EVERYTHING in resume.tex shows up on the page.
   You only add entries here when you want to deviate from that:

     • hide an entry          →  { show: false }
     • move a project to the
       compact "All projects" →  { featured: false }
     • give a project a
       category (for grouping)→  { category: "Backend" }
     • override the resume's
       text with custom copy  →  { useAlt: true, altData: { ... } }
     • add a web-only entry
       not in the resume      →  { useAlt: true, altData: { ... } }

   Every per-entry block is optional. Sections you don't touch
   keep using whatever resume.tex provides.
   ============================================================ */

window.PORTFOLIO_CONFIG = {
  /* ============================================================
     SECTION-LEVEL TOGGLES (all default to sensible values)
     ============================================================ */
  sections: {
    // showEducation:       false,    // hide whole education section
    // showInternships:     false,
    // showProjects:        false,
    // showSkills:          false,
    // showAccomplishments: false,

    // Group projects under category headings. On by default.
    // Set to false for a flat list.
    groupProjectsByCategory: true,

    // Order of category groups. Categories you list here appear in
    // this order; any others are appended at the end as encountered.
    projectCategoryOrder: [
      "Web Development",
      "Backend",
      "Systems",
      "AI / ML",
      "Cybersecurity",
    ],
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
    // (nothing needed — internships render straight from the resume)
  },

  /* ============================================================
     PROJECTS — keyed by \subsection*{...} title in resume.tex
     Default: every project is featured (shows as a full card in
     "Selected work"). Only add an entry to deviate.
     ============================================================ */
  projects: {
    // Group by category — this is the most common reason to add
    // a project entry. Uncategorized projects still render fine.
    "JSON API server": { category: "Backend" },
    "Wine Classifier based on Decision Tree": { category: "AI / ML" },

    // Demote to the compact "All projects" list:
    // "Some Old Project": { featured: false, category: "Misc" }

    // Override with a richer web description:
    // "JSON API server": {
    //   category: "Backend",
    //   useAlt:   true,
    //   altData: {
    //     title:    "JSON API Server",
    //     role:     "Containerised Flask service",
    //     summary:  "A small REST API over Postgres, ready to run from " +
    //               "one `docker compose up`.",
    //     bullets:  ["…"],
    //     stack:    ["Flask", "Python", "PostgreSQL", "Docker"],
    //     links: [{ label: "GitLab", url: "https://gitlab.com/projectsa2/jsonapiserver" }]
    //   }
    // },

    // Add a project not in the resume (web-only):
    // "Portfolio Site": {
    //   category: "Web Development",
    //   useAlt:   true,
    //   altData: {
    //     title:   "This portfolio",
    //     summary: "The site you're looking at — parses my LaTeX resume on load.",
    //     stack:   ["HTML", "CSS", "Vanilla JS"],
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
     Per-entry: { show: false } to drop, { altText: "…" } to rewrite.
     ============================================================ */
  accomplishments: {
    // "GATE":     { altText: "GATE CS/IT 2024 — 95.4 percentile (top 5%)" },
    // "N.T.S.E.": { show: false }
  },
};

/* Backwards-compatible alias (used by older versions of script.js) */
window.PROJECTS_CONFIG = window.PORTFOLIO_CONFIG.projects;
