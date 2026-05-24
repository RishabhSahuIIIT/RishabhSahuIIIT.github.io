/* ============================================================
   projects.js — the only file you usually need to edit
   --------------------------------------------------------------
   Each entry below describes one project. To add a new project,
   copy any existing block and edit the fields.

   FIELDS
   --------------------------------------------------------------
   id          string   — unique slug, used as a stable key.
   title       string   — required, displayed as the heading.
   featured    boolean  — true → appears in "Selected Work" with
                          full details. false → appears in the
                          compact "All Projects" list.
   category    string   — optional, free text. Useful for GitLab
                          group/subgroup paths like
                          "infra/backend" or simple tags like
                          "machine-learning". Shown as a small
                          badge in the compact list.
   role        string   — short subtitle (featured only).
   summary     string   — 1–3 sentence description. Shown in
                          both featured and compact layouts.
   bullets     string[] — bullet highlights (featured only).
   stack       string[] — tech tags, e.g. ["Python", "Flask"].
   links       object[] — repo / demo links. Each link is
                          { label: "GitHub", url: "https://..." }.
                          Add as many as you want — GitHub, GitLab
                          self-hosted, demo URL, slides, anything.
   meta        string   — small caption shown in the right-hand
                          column of the featured layout (optional,
                          newline-separated lines allowed).

   ORDERING
   --------------------------------------------------------------
   Order in the array determines render order in both sections.
   Move an entry up or down to change where it appears.

   TO PROMOTE a project to "Selected Work":  set featured: true
   TO DEMOTE  a project to "All Projects":   set featured: false
   ============================================================ */

window.PROJECTS = [

  /* ---------- Featured ---------- */

  {
    id: "json-api-server",
    title: "JSON API Server",
    featured: true,
    category: "backend",
    role: "Containerised Flask service",
    summary:
      "A small, well-behaved Flask API that exposes teacher and course records from a Postgres database. Designed to be cloned, `docker compose up`’d, and immediately useful.",
    bullets: [
      "Handles HTTP requests for create and view operations on relational data",
      "Returns clean, predictable JSON responses",
      "Bash + Docker scripts trim local setup down to a single command"
    ],
    stack: ["Flask", "Python", "PostgreSQL", "Docker", "BASH"],
    links: [
      { label: "GitHub", url: "https://github.com/RishabhSahuIIIT/json-api-server" }
    ],
    meta: "API design\nDX · Tooling"
  },

  {
    id: "wine-classifier",
    title: "Wine Classifier — Decision Tree",
    featured: true,
    category: "machine-learning",
    role: "Distributed evaluation with PySpark",
    summary:
      "A decision-tree classifier trained on scikit-learn’s wine dataset, then evaluated through PySpark’s model evaluators — partly to study the model, partly to learn the tooling.",
    bullets: [
      "Trained and tuned a decision-tree classifier on chemical features",
      "Distributed evaluation via PySpark for richer metrics",
      "Reached ~85% accuracy on held-out test data"
    ],
    stack: ["Python", "PySpark", "Pandas", "scikit-learn"],
    links: [
      { label: "GitHub", url: "https://github.com/RishabhSahuIIIT/wine-classifier" }
    ],
    meta: "Applied ML\nData engineering"
  },

  /* ---------- All projects (compact list) ----------
     Set featured: false (or omit) and these will show up
     in the All Projects section below the featured ones. */

  {
    id: "example-gitlab-project",
    title: "Example GitLab Project",
    featured: false,
    category: "infra/backend",
    summary:
      "Replace this with one of your real projects. The category field is great for encoding GitLab group / subgroup paths.",
    stack: ["Python", "Docker"],
    links: [
      { label: "GitLab", url: "https://gitlab.com/your-group/your-subgroup/your-project" }
    ]
  },

  {
    id: "example-multi-repo",
    title: "Another Example",
    featured: false,
    category: "web",
    summary:
      "Projects can have any number of links — GitHub, GitLab, demo URL, slides — they’ll all render as buttons.",
    stack: ["React", "Node.js", "MongoDB"],
    links: [
      { label: "GitHub", url: "https://github.com/RishabhSahuIIIT/example" },
      { label: "GitLab", url: "https://gitlab.com/example/example" }
    ]
  }

];
