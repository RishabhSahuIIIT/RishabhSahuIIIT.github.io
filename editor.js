/* ============================================================
   editor.js — development-time style editor
   ------------------------------------------------------------
   Referenced from index.html so it works with any static server,
   but it switches itself OFF unless the page is served from a
   local address - see the activation guard below. That keeps it
   inert in production without needing a build step.

   Note the filename deliberately avoids a leading underscore:
   GitHub Pages runs Jekyll, which ignores files starting with
   '_', so an underscored name would 404 on the deployed site.

   Right-click anywhere to open a panel for
     - switching palette stylesheets
     - editing the palette's CSS variables via colour pickers,
       with preset swatches and a recently-used row
     - adjusting text scale / density, globally or per section
   Changes preview live; Save writes site-config.json through the
   dev server (which snapshots the previous file first), and
   Revert restores the newest snapshot.
   ============================================================ */
(function () {
  'use strict';

  /* ---- activation guard -------------------------------------------------
     The tag ships inside index.html so the editor works no matter how the
     site is served (dev_server.py, python -m http.server, anything). It
     switches itself OFF unless the page is local, so it is inert in
     production. Override with ?editor=1 / ?editor=0.
     --------------------------------------------------------------------- */
  if (window.__devEditorLoaded) return;        // don't double-init if injected too
  window.__devEditorLoaded = true;

  var qs = new URLSearchParams(window.location.search);
  var forced = qs.get('editor');
  var host = window.location.hostname;
  var isLocal = host === 'localhost' || host === '127.0.0.1' ||
                host === '' || host === '::1' || /^192\.168\./.test(host);

  if (forced === '0' || (!isLocal && forced !== '1')) {
    console.log('[dev-editor] inactive on this host (' + (host || 'file://') +
                '). Add ?editor=1 to force it on.');
    return;
  }

  /* ============================================================
     Icon catalogue — the library this editor picks from.
     ------------------------------------------------------------
     Inlined rather than kept in a separate file: this whole file
     is dev-only and never reaches a visitor, so an extra file
     bought nothing but complexity. Size is irrelevant here.

     ICON_CATALOG.emoji — keyworded emoji for the picker
     ICON_CATALOG.logos — inline brand SVGs, tiered:
                            t:1 primary   (languages, major tools)
                            t:2 secondary (Flask, Scapy, PySpark…)

     Only the logos matching terms in resume.tex get copied into
     site-config.json by "sync logos" — that's what visitors load.

     Institution logos (university, employer) are deliberately NOT
     here: they're copyrighted marks, so keep them as image files
     in assets/ and point at them with the image field.
     ============================================================ */
  window.ICON_CATALOG = {
    emoji: {
    categories: [
      {
        name: 'Tech & code',
        items: [
          { e: '💻', k: 'laptop computer code programming software dev' },
          { e: '🖥', k: 'desktop monitor computer workstation' },
          { e: '⌨', k: 'keyboard typing input terminal cli shell' },
          { e: '🖱', k: 'mouse pointer click input' },
          { e: '💾', k: 'floppy disk save storage data' },
          { e: '💿', k: 'disc cd storage optical' },
          { e: '🗄', k: 'file cabinet database storage archive records' },
          { e: '🗃', k: 'card box index database records' },
          { e: '📀', k: 'dvd disc storage' },
          { e: '🧮', k: 'abacus calculation compute arithmetic algorithm' },
          { e: '⚙', k: 'gear settings engine systems config mechanism' },
          { e: '🔧', k: 'wrench tool build fix engineering' },
          { e: '🔩', k: 'bolt nut hardware systems low-level' },
          { e: '🛠', k: 'tools build toolchain engineering compiler' },
          { e: '⛏', k: 'pick mining extraction parse' },
          { e: '🔌', k: 'plug connection socket network port api' },
          { e: '🔋', k: 'battery power energy efficiency' },
          { e: '📡', k: 'satellite antenna network signal distributed grpc rpc' },
          { e: '🛰', k: 'satellite orbit distributed remote network' },
          { e: '🖧', k: 'network wired lan topology' }
        ]
      },
      {
        name: 'AI & science',
        items: [
          { e: '🤖', k: 'robot ai agent automation bot machine llm' },
          { e: '🧠', k: 'brain intelligence ai learning neural cognition ml' },
          { e: '🦾', k: 'mechanical arm robotics prosthetic manipulator' },
          { e: '🔬', k: 'microscope research science analysis lab' },
          { e: '🧪', k: 'test tube experiment research lab chemistry' },
          { e: '🧬', k: 'dna genetics science research biology' },
          { e: '⚗', k: 'alembic chemistry distill experiment' },
          { e: '🔭', k: 'telescope observation discovery research astronomy' },
          { e: '📊', k: 'bar chart data analytics statistics visualisation metrics' },
          { e: '📈', k: 'chart increasing growth trend analytics performance' },
          { e: '📉', k: 'chart decreasing decline loss trend' },
          { e: '🎲', k: 'dice random probability stochastic monte carlo sampling' },
          { e: '🧲', k: 'magnet attraction clustering knn nearest' },
          { e: '⚛', k: 'atom physics science react quantum' }
        ]
      },
      {
        name: 'Security',
        items: [
          { e: '🛡', k: 'shield security defence protection firewall ids ips' },
          { e: '🔒', k: 'lock secure encryption private closed' },
          { e: '🔓', k: 'unlock open access decrypt' },
          { e: '🔐', k: 'lock key encryption cryptography secure credentials' },
          { e: '🔑', k: 'key access credentials authentication cryptography' },
          { e: '🗝', k: 'old key access legacy secret' },
          { e: '🚨', k: 'siren alert intrusion detection warning alarm' },
          { e: '👁', k: 'eye monitoring surveillance detection observe' },
          { e: '🕵', k: 'detective investigation forensics analysis intrusion' },
          { e: '⚠', k: 'warning caution risk threat' },
          { e: '🔥', k: 'fire firewall hot critical burn' },
          { e: '🪤', k: 'trap honeypot bait intrusion' }
        ]
      },
      {
        name: 'Web & apps',
        items: [
          { e: '🌐', k: 'globe web internet www site network global' },
          { e: '🕸', k: 'web spider network graph mesh crawl' },
          { e: '📱', k: 'mobile phone app responsive ios android' },
          { e: '🖼', k: 'picture frame image ui frontend design' },
          { e: '🎨', k: 'palette design colour art frontend ui ux' },
          { e: '✨', k: 'sparkles polish new feature highlight' },
            { e: '📦', k: 'package module bundle container deploy npm' },
          { e: '🚀', k: 'rocket launch deploy ship fast performance' },
          { e: '🔗', k: 'link chain url reference connection' },
          { e: '📄', k: 'page document file text html' },
          { e: '📋', k: 'clipboard form list copy data' }
        ]
      },
      {
        name: 'Docs & writing',
        items: [
          { e: '📚', k: 'books library documentation reference research papers' },
          { e: '📖', k: 'open book reading documentation study' },
          { e: '📝', k: 'memo note writing editor text document' },
          { e: '✍', k: 'writing hand author edit compose collaborative' },
          { e: '📃', k: 'page curl document paper text' },
          { e: '🗒', k: 'notepad notes list memo' },
          { e: '🏷', k: 'label tag category classification metadata' },
          { e: '🔖', k: 'bookmark save reference citation' },
          { e: '📌', k: 'pin pinned important location marker' },
          { e: '🗂', k: 'dividers organise category index sections' }
        ]
      },
      {
        name: 'Structure & flow',
        items: [
          { e: '🌳', k: 'tree structure hierarchy parse ast branch' },
          { e: '🌲', k: 'evergreen tree structure trie hierarchy' },
          { e: '🪜', k: 'ladder steps levels stack hierarchy' },
          { e: '🧱', k: 'brick wall build blocks foundation compile' },
          { e: '🏗', k: 'construction building compile build scaffold' },
          { e: '🔀', k: 'shuffle crossing parallel concurrent branch merge' },
          { e: '🔁', k: 'repeat loop iteration cycle recurrence' },
          { e: '⏩', k: 'fast forward speed performance parallel' },
          { e: '🧵', k: 'thread threading concurrency multithreading spool' },
          { e: '⛓', k: 'chains linked list blockchain sequence dependency' },
          { e: '🧭', k: 'compass navigation routing planning direction path' },
          { e: '🗺', k: 'map planning route navigation topology' }
        ]
      },
      {
        name: 'Achievement & misc',
        items: [
          { e: '🏆', k: 'trophy award achievement win accomplishment' },
          { e: '🥇', k: 'gold medal first rank achievement' },
          { e: '🎓', k: 'graduation education degree academic university study' },
          { e: '💼', k: 'briefcase work job internship professional career' },
          { e: '🏢', k: 'office building company organisation workplace' },
          { e: '⭐', k: 'star favourite featured highlight rating' },
          { e: '🌟', k: 'glowing star featured special standout' },
          { e: '💡', k: 'bulb idea insight innovation concept' },
          { e: '🎯', k: 'target goal objective precision accuracy aim' },
          { e: '🧿', k: 'amulet protection charm eye' },
          { e: '⏱', k: 'stopwatch timing latency benchmark performance' },
          { e: '📶', k: 'signal bars strength network connectivity' }
        ]
      }
    ]
    }
    ,

    /* ---- Tech logos -------------------------------------------------------
       Paths are from Simple Icons (CC0). `c` is the brand colour, used only
       when the site is set to show logos in colour; otherwise they inherit
       currentColor and follow your palette.

       `match` lists the lowercase forms that should map to this logo, because
       resume.tex writes terms loosely — "Postgresql", "Llama 3.1/3.2",
       "GNU Flex/Lex". Matching is done on a normalised string, so case and
       punctuation don't matter.

       Terms with no entry here (Compiler Design, Multithreading, Dataflow
       Analysis…) are concepts, not products — they simply render as text,
       which is the correct outcome rather than a missing-image box.        */
    logos: [
      { n: 'Python', t: 1,      c: '#3776AB', match: ['python', 'python3', 'pymupdf'],
        d: 'M14.25.18l.9.2.73.26.59.3.45.32.34.34.25.34.16.33.1.3.04.26.02.2-.01.13V8.5l-.05.63-.13.55-.21.46-.26.38-.3.31-.33.25-.35.19-.35.14-.33.1-.3.07-.26.04-.21.02H8.77l-.69.05-.59.14-.5.22-.41.27-.33.32-.27.35-.2.36-.15.37-.1.35-.07.32-.04.27-.02.21v3.06H3.17l-.21-.03-.28-.07-.32-.12-.35-.18-.36-.26-.36-.36-.35-.46-.32-.59-.28-.73-.21-.88-.14-1.05-.05-1.23.06-1.22.16-1.04.24-.87.32-.71.36-.57.4-.44.42-.33.42-.24.4-.16.36-.1.32-.05.24-.01h.16l.06.01h8.16v-.83H6.18l-.01-2.75-.02-.37.05-.34.11-.31.17-.28.25-.26.31-.23.38-.2.44-.18.51-.15.58-.12.64-.1.71-.06.77-.04.84-.02 1.27.05zm-6.3 1.98l-.23.33-.08.41.08.41.23.34.33.22.41.09.41-.09.33-.22.23-.34.08-.41-.08-.41-.23-.33-.33-.22-.41-.09-.41.09zm13.09 3.95l.28.06.32.12.35.18.36.27.36.35.35.47.32.59.28.73.21.88.14 1.04.05 1.23-.06 1.23-.16 1.04-.24.86-.32.71-.36.57-.4.45-.42.33-.42.24-.4.16-.36.09-.32.05-.24.02-.16-.01h-8.22v.82h5.84l.01 2.76.02.36-.05.34-.11.31-.17.29-.25.25-.31.24-.38.2-.44.17-.51.15-.58.13-.64.09-.71.07-.77.04-.84.01-1.27-.04-1.07-.14-.9-.2-.73-.25-.59-.3-.45-.33-.34-.34-.25-.34-.16-.33-.1-.3-.04-.25-.02-.2.01-.13v-5.34l.05-.64.13-.54.21-.46.26-.38.3-.32.33-.24.35-.2.35-.14.33-.1.3-.06.26-.04.21-.02.13-.01h5.84l.69-.05.59-.14.5-.21.41-.28.33-.32.27-.35.2-.36.15-.36.1-.35.07-.32.04-.28.02-.21V6.07h2.09l.14.01zm-6.47 14.25l-.23.33-.08.41.08.41.23.33.33.23.41.08.41-.08.33-.23.23-.33.08-.41-.08-.41-.23-.33-.33-.23-.41-.08-.41.08z' },
      { n: 'C++', t: 1,         c: '#00599C', match: ['c++', 'cpp', 'c/c++', 'cc++'],
        d: 'M22.394 6c-.167-.29-.398-.543-.652-.69L12.926.22c-.509-.294-1.34-.294-1.848 0L2.26 5.31c-.508.293-.923 1.013-.923 1.6v10.18c0 .294.104.62.271.91.167.29.398.543.652.69l8.816 5.09c.508.293 1.34.293 1.848 0l8.816-5.09c.254-.147.485-.4.652-.69.167-.29.27-.616.27-.91V6.91c.003-.294-.1-.62-.268-.91zM12 19.11c-3.92 0-7.109-3.19-7.109-7.11 0-3.92 3.19-7.11 7.11-7.11a7.133 7.133 0 016.156 3.553l-3.076 1.78a3.567 3.567 0 00-3.08-1.78A3.56 3.56 0 008.444 12 3.56 3.56 0 0012 15.555a3.57 3.57 0 003.08-1.778l3.078 1.78A7.135 7.135 0 0112 19.109zm7.11-6.715h-.79v.79h-.79v-.79h-.79v-.79h.79v-.79h.79v.79h.79zm2.962 0h-.79v.79h-.79v-.79h-.79v-.79h.79v-.79h.79v.79h.79z' },
      { n: 'Rust', t: 1,        c: '#000000', match: ['rust'],
        d: 'M23.835 11.703l-1.008-.623a13.7 13.7 0 00-.028-.286l.866-.807a.348.348 0 00-.115-.578l-1.107-.414a8.744 8.744 0 00-.087-.276l.69-.96a.345.345 0 00-.225-.545l-1.166-.19a9.334 9.334 0 00-.14-.255l.49-1.076a.344.344 0 00-.327-.489l-1.184.041a6.79 6.79 0 00-.187-.226l.272-1.153a.347.347 0 00-.423-.417l-1.153.271a14.019 14.019 0 00-.228-.187l.041-1.184a.345.345 0 00-.489-.326l-1.076.49-.255-.141-.19-1.164A.348.348 0 0016.752.6l-.96.69a8.795 8.795 0 00-.276-.087L15.102.096a.348.348 0 00-.578-.115l-.807.867a9.331 9.331 0 00-.286-.028L12.808.135a.348.348 0 00-.588 0l-.623 1.008a13.906 13.906 0 00-.286.028L10.504.304a.348.348 0 00-.578.115l-.414 1.107-.276.087-.96-.69a.347.347 0 00-.545.226l-.19 1.164a9.135 9.135 0 00-.255.141l-1.076-.49a.347.347 0 00-.489.326l.041 1.184a7.7 7.7 0 00-.228.187L4.381 3.29a.347.347 0 00-.423.417l.271 1.153a6.19 6.19 0 00-.187.226l-1.184-.041a.348.348 0 00-.326.489l.49 1.076a9.31 9.31 0 00-.141.255l-1.165.19a.348.348 0 00-.225.545l.69.96a8.7 8.7 0 00-.087.276l-1.107.414a.348.348 0 00-.115.578l.866.807a13.703 13.703 0 00-.028.286l-1.008.623a.344.344 0 000 .588l1.008.623c.008.096.018.191.028.286l-.866.807a.348.348 0 00.115.578l1.107.414c.028.093.057.185.087.276l-.69.96a.344.344 0 00.225.545l1.165.19c.046.086.092.171.141.255l-.49 1.076a.347.347 0 00.326.489l1.184-.041c.062.077.124.153.187.226l-.271 1.153a.347.347 0 00.423.417l1.153-.271c.075.063.151.126.228.187l-.041 1.184a.345.345 0 00.489.326l1.076-.49c.084.049.169.095.255.141l.19 1.164a.348.348 0 00.545.226l.96-.69c.091.03.183.059.276.087l.414 1.107a.347.347 0 00.578.115l.807-.866c.095.011.19.02.286.028l.623 1.008a.345.345 0 00.588 0l.623-1.008c.096-.008.191-.017.286-.028l.807.866a.348.348 0 00.578-.115l.414-1.107.276-.087.96.69a.346.346 0 00.545-.226l.19-1.164c.086-.046.171-.092.255-.141l1.076.49a.347.347 0 00.489-.326l-.041-1.184c.077-.062.153-.124.228-.187l1.153.271a.347.347 0 00.423-.417l-.271-1.153c.063-.075.126-.15.187-.226l1.184.041a.344.344 0 00.326-.489l-.49-1.076c.049-.084.095-.169.141-.255l1.165-.19a.348.348 0 00.225-.545l-.69-.96.087-.276 1.107-.414a.348.348 0 00.115-.578l-.866-.807c.011-.095.02-.19.028-.286l1.008-.623a.344.344 0 000-.588zm-6.742 8.355a.714.714 0 01.299-1.396.714.714 0 01-.298 1.396zm-.342-2.314a.65.65 0 00-.772.5l-.358 1.673a8.795 8.795 0 01-3.669.79 8.798 8.798 0 01-3.744-.822l-.358-1.673a.65.65 0 00-.772-.499l-1.476.317a8.66 8.66 0 01-.764-.9h7.183c.081 0 .136-.014.136-.088v-2.541c0-.074-.055-.088-.136-.088h-2.101v-1.61h2.272c.207 0 1.109.06 1.396 1.213.09.353.288 1.504.424 1.873.135.413.683 1.238 1.268 1.238h3.572a.746.746 0 00.13-.013 8.68 8.68 0 01-.814.95zm-9.914 2.28a.714.714 0 11-.298-1.396.714.714 0 01.298 1.396zM4.727 9.415a.714.714 0 11-1.303.575.714.714 0 011.303-.575zm-.647 1.541l1.539-.684a.65.65 0 00.33-.858l-.317-.717h1.247V14.4H4.363a8.792 8.792 0 01-.285-3.444zm5.909-.478V8.816h3.11c.16 0 1.135.186 1.135.913 0 .604-.746.82-1.36.82zM19.87 12.1c0 .223-.008.445-.024.664h-.94c-.094 0-.132.062-.132.153v.43c0 1.013-.571 1.233-1.072 1.29-.477.053-1.005-.2-1.07-.49-.28-1.576-.746-1.913-1.483-2.494.915-.58 1.867-1.437 1.867-2.583 0-1.238-.849-2.018-1.427-2.401-.812-.536-1.71-.643-1.953-.643H5.354a8.795 8.795 0 014.923-2.777l1.1 1.155a.65.65 0 00.919.02l1.231-1.178a8.798 8.798 0 016.02 4.286l-.843 1.903a.652.652 0 00.33.859l1.622.72c.028.288.043.578.043.872zm-8.276-8.545a.714.714 0 11.984 1.032.714.714 0 01-.984-1.032zm7.416 5.968a.713.713 0 11.575 1.305.713.713 0 01-.575-1.305z' },
      { n: 'TypeScript', t: 1,  c: '#3178C6', match: ['typescript', 'ts'],
        d: 'M1.125 0C.502 0 0 .502 0 1.125v21.75C0 23.498.502 24 1.125 24h21.75c.623 0 1.125-.502 1.125-1.125V1.125C24 .502 23.498 0 22.875 0zm17.363 9.75c.612 0 1.154.037 1.627.111a6.38 6.38 0 011.306.34v2.458a3.95 3.95 0 00-.643-.361 5.093 5.093 0 00-.717-.26 5.453 5.453 0 00-1.426-.2c-.3 0-.573.028-.819.086a2.1 2.1 0 00-.623.242c-.17.104-.3.229-.393.374a.888.888 0 00-.14.49c0 .196.053.373.156.529.104.156.252.304.443.444s.423.276.696.41c.273.135.582.274.926.416.47.197.892.407 1.266.628.374.222.695.473.963.753.268.279.472.598.614.957.142.359.214.776.214 1.253 0 .657-.125 1.21-.373 1.656a2.981 2.981 0 01-1.012 1.085 4.339 4.339 0 01-1.487.596c-.566.12-1.163.18-1.79.18a9.916 9.916 0 01-1.84-.164 5.544 5.544 0 01-1.512-.493v-2.63a5.033 5.033 0 003.237 1.2c.333 0 .624-.03.872-.09.249-.06.456-.144.623-.25.166-.108.29-.234.373-.38a1.023 1.023 0 00-.074-1.089 2.12 2.12 0 00-.537-.5 5.597 5.597 0 00-.807-.444 27.72 27.72 0 00-1.007-.436c-.918-.383-1.602-.852-2.053-1.405-.45-.553-.676-1.222-.676-2.005 0-.614.123-1.141.369-1.582.246-.441.58-.804 1.004-1.089a4.494 4.494 0 011.47-.629 7.536 7.536 0 011.77-.201zm-15.113.188h9.563v2.166H9.506v9.646H6.789v-9.646H3.375z' },
      { n: 'React', t: 1,       c: '#61DAFB', match: ['react', 'reactjs'],
        d: 'M14.23 12.004a2.236 2.236 0 01-2.235 2.236 2.236 2.236 0 01-2.236-2.236 2.236 2.236 0 012.235-2.236 2.236 2.236 0 012.236 2.236zm2.648-10.69c-1.346 0-3.107.96-4.888 2.622-1.78-1.653-3.542-2.602-4.887-2.602-.41 0-.783.093-1.106.278-1.375.793-1.683 3.264-.973 6.365C1.98 8.917 0 10.42 0 12.004c0 1.59 1.99 3.097 5.043 4.03-.704 3.113-.39 5.588.988 6.38.32.187.69.275 1.102.275 1.345 0 3.107-.96 4.888-2.624 1.78 1.654 3.542 2.603 4.887 2.603.41 0 .783-.09 1.106-.275 1.374-.792 1.683-3.263.973-6.365C22.02 15.096 24 13.59 24 12.004c0-1.59-1.99-3.097-5.043-4.032.704-3.11.39-5.587-.988-6.38-.318-.184-.688-.277-1.092-.278zm-.005 1.09v.006c.225 0 .406.044.558.127.666.382.955 1.835.73 3.704-.054.46-.142.945-.25 1.44a23.476 23.476 0 00-3.107-.534A23.892 23.892 0 0012.769 4.7c1.592-1.48 3.087-2.292 4.105-2.295zm-9.77.02c1.012 0 2.514.808 4.11 2.28-.686.72-1.37 1.537-2.02 2.442a22.73 22.73 0 00-3.113.538 15.02 15.02 0 01-.254-1.42c-.23-1.868.054-3.32.714-3.707.19-.09.4-.127.563-.132zm4.882 3.05c.455.468.91.992 1.36 1.564-.44-.02-.89-.034-1.345-.034-.46 0-.915.01-1.36.034.44-.572.895-1.096 1.345-1.565zM12 8.1c.74 0 1.477.034 2.202.093.406.582.802 1.203 1.183 1.86.372.64.71 1.29 1.018 1.946-.308.655-.646 1.31-1.013 1.95-.38.66-.773 1.288-1.18 1.87a25.64 25.64 0 01-4.412.005 26.64 26.64 0 01-1.183-1.86c-.372-.64-.71-1.29-1.018-1.946a25.17 25.17 0 011.013-1.954c.38-.66.773-1.286 1.18-1.868A25.245 25.245 0 0112 8.098zm-3.635.254c-.24.377-.48.763-.704 1.16-.225.39-.435.782-.635 1.174-.265-.656-.49-1.31-.676-1.947.64-.15 1.315-.283 2.015-.386zm7.26 0c.695.103 1.365.23 2.006.387-.18.632-.405 1.282-.66 1.933a25.952 25.952 0 00-1.345-2.32zm3.063.675c.484.15.944.317 1.375.498 1.732.74 2.852 1.708 2.852 2.476-.005.768-1.125 1.74-2.857 2.475-.42.18-.88.342-1.355.493a23.966 23.966 0 00-1.1-2.98c.45-1.017.81-2.01 1.085-2.964zm-13.395.004c.278.96.645 1.957 1.1 2.98a23.142 23.142 0 00-1.086 2.964c-.484-.15-.944-.318-1.37-.5-1.732-.737-2.852-1.706-2.852-2.474 0-.768 1.12-1.742 2.852-2.476.42-.18.88-.342 1.356-.494zm11.678 4.28c.265.657.49 1.312.676 1.948-.64.157-1.316.29-2.016.39a25.819 25.819 0 001.341-2.338zm-9.945.02c.2.392.41.783.635 1.175.23.39.465.772.705 1.143a22.005 22.005 0 01-2.006-.386c.18-.63.406-1.282.665-1.933zM12 14.75c.46 0 .915-.01 1.36-.034-.44.572-.895 1.095-1.345 1.565-.455-.47-.91-.993-1.36-1.565.44.02.89.034 1.345.034zm-2.335 2.98c.686-.72 1.37-1.536 2.02-2.44a22.73 22.73 0 003.113-.538c.135.52.24 1.02.318 1.5.23 1.868-.054 3.32-.714 3.708-.19.09-.4.127-.563.132-1.012 0-2.514-.807-4.11-2.28z' },
      { n: 'Docker', t: 1,      c: '#2496ED', match: ['docker', 'container'],
        d: 'M13.983 11.078h2.119a.186.186 0 00.186-.185V9.006a.186.186 0 00-.186-.186h-2.119a.185.185 0 00-.185.185v1.888c0 .102.083.185.185.185m-2.954-5.43h2.118a.187.187 0 00.186-.186V3.574a.186.186 0 00-.186-.185h-2.118a.185.185 0 00-.185.185v1.888c0 .102.082.185.185.186m0 2.716h2.118a.187.187 0 00.186-.186V6.29a.186.186 0 00-.186-.185h-2.118a.185.185 0 00-.185.185v1.887c0 .102.082.185.185.186m-2.93 0h2.12a.186.186 0 00.184-.186V6.29a.185.185 0 00-.185-.185H8.1a.185.185 0 00-.185.185v1.887c0 .102.083.185.185.186m-2.964 0h2.119a.186.186 0 00.185-.186V6.29a.185.185 0 00-.185-.185H5.136a.186.186 0 00-.186.185v1.887c0 .102.084.185.186.186m5.893 2.715h2.118a.186.186 0 00.186-.185V9.006a.186.186 0 00-.186-.186h-2.118a.185.185 0 00-.185.185v1.888c0 .102.082.185.185.185m-2.93 0h2.12a.185.185 0 00.184-.185V9.006a.185.185 0 00-.184-.186h-2.12a.185.185 0 00-.184.185v1.888c0 .102.083.185.185.185m-2.964 0h2.119a.185.185 0 00.185-.185V9.006a.185.185 0 00-.184-.186h-2.12a.186.186 0 00-.186.186v1.887c0 .102.084.185.186.185m-2.92 0h2.12a.185.185 0 00.184-.185V9.006a.185.185 0 00-.184-.186h-2.12a.185.185 0 00-.184.185v1.888c0 .102.082.185.185.185M23.763 9.89c-.065-.051-.672-.51-1.954-.51-.338.001-.676.03-1.01.087-.248-1.7-1.653-2.53-1.716-2.566l-.344-.199-.226.327c-.284.438-.49.922-.612 1.43-.23.97-.09 1.882.403 2.661-.595.332-1.55.413-1.744.42H.751a.751.751 0 00-.75.748 11.376 11.376 0 00.692 4.062c.545 1.428 1.355 2.48 2.41 3.124 1.18.723 3.1 1.137 5.275 1.137a16.19 16.19 0 002.996-.271 12.481 12.481 0 003.917-1.425 10.78 10.78 0 002.676-2.185c1.259-1.428 2.008-3.02 2.565-4.437h.221c1.372 0 2.215-.549 2.68-1.009.309-.293.55-.65.707-1.046l.098-.288z' },
      { n: 'NumPy', t: 1,       c: '#013243', match: ['numpy', 'np'],
        d: 'M10.315 4.876l3.53 1.474-3.53 1.475-3.53-1.475zm-4.53 2.474l3.53 1.475v3.472l-3.53-1.474zm9.06 0v3.473l-3.53 1.474V8.825zM.755 9.324l3.53 1.475v3.472l-3.53-1.474zm19.49 0v3.473l-3.53 1.474v-3.473zm-14.96 2.474l3.53 1.475v3.472l-3.53-1.474zm10.43 0v3.473l-3.53 1.474v-3.473zM10.315 14.3l3.53 1.474-3.53 1.475-3.53-1.475z' },
      { n: 'Flask', t: 2,       c: '#000000', match: ['flask'],
        d: 'M6.383 5.541c-.09-.244-.28-.44-.52-.54a1.06 1.06 0 00-.75 0c-.24.1-.43.296-.52.54L1.06 15.86a2.68 2.68 0 002.51 3.6h16.86a2.68 2.68 0 002.51-3.6L19.41 5.54a1.06 1.06 0 00-2 0l-2.86 7.77-2.26-6.14a1.06 1.06 0 00-2 0L8.03 13.3z' },
      { n: 'LLVM', t: 1,        c: '#262D3A', match: ['llvm', 'llvm ir', 'clang'],
        d: 'M5.5 2h2v14a2 2 0 002 2h9v2h-9a4 4 0 01-4-4V2zm11 0h2v6h-2V2zm-4 0h2v6h-2V2z' },
      { n: 'Git', t: 1,         c: '#F05032', match: ['git', 'github', 'gitlab', 'version control'],
        d: 'M23.546 10.93L13.067.452a1.55 1.55 0 00-2.19 0L8.708 2.62l2.76 2.76a1.838 1.838 0 012.327 2.341l2.658 2.66a1.838 1.838 0 011.9 3.039 1.837 1.837 0 01-3.001-2.001l-2.48-2.478v6.525a1.838 1.838 0 11-2.13.336 1.838 1.838 0 01.597-.394V8.835a1.84 1.84 0 01-.999-2.412L7.626 3.7.452 10.876a1.55 1.55 0 000 2.19l10.48 10.48a1.55 1.55 0 002.19 0l10.424-10.427a1.55 1.55 0 000-2.19' },
      { n: 'Pandas', t: 2,      c: '#150458', match: ['pandas', 'dataframe'],
        d: 'M16.922 0h3.822v24h-3.822zm-4.503 12.24h3.821v5.529h-3.82zm0-8.579h3.821v5.482h-3.82zM7.915 0h3.822v24H7.915zm-4.502 14.231h3.821v5.53h-3.82zm0-8.578h3.821v5.482h-3.82z' },
      { n: 'Ollama', t: 2,      c: '#000000', match: ['ollama', 'llama', 'llama 3.1/3.2'],
        d: 'M12 2c-2.2 0-4 1.8-4 4v1.5C6.8 8.3 6 9.6 6 11v4c0 2.2 1.8 4 4 4h4c2.2 0 4-1.8 4-4v-4c0-1.4-.8-2.7-2-3.5V6c0-2.2-1.8-4-4-4zm-2 8c.6 0 1 .4 1 1s-.4 1-1 1-1-.4-1-1 .4-1 1-1zm4 0c.6 0 1 .4 1 1s-.4 1-1 1-1-.4-1-1 .4-1 1-1z' },
      { n: 'Vite', t: 2,        c: '#646CFF', match: ['vite'],
        d: 'M8.286 10.578l.512-8.657a.306.306 0 01.247-.282L17.377.006a.306.306 0 01.353.385l-1.558 5.403a.306.306 0 00.352.385l2.388-.46a.306.306 0 01.332.438l-6.79 13.55-.123.19a.294.294 0 01-.252.14c-.177 0-.35-.152-.305-.369l1.095-5.301a.306.306 0 00-.388-.355l-1.433.435a.306.306 0 01-.389-.354l.69-3.375a.306.306 0 00-.37-.36l-2.32.536a.306.306 0 01-.374-.316z' },
      { n: 'Tailwind CSS', t: 2,c: '#06B6D4', match: ['tailwind', 'tailwind css'],
        d: 'M12.001 4.8c-3.2 0-5.2 1.6-6 4.8 1.2-1.6 2.6-2.2 4.2-1.8.913.228 1.565.89 2.288 1.624C13.666 10.618 15.027 12 18.001 12c3.2 0 5.2-1.6 6-4.8-1.2 1.6-2.6 2.2-4.2 1.8-.913-.228-1.565-.89-2.288-1.624C16.337 6.182 14.976 4.8 12.001 4.8zm-6 7.2c-3.2 0-5.2 1.6-6 4.8 1.2-1.6 2.6-2.2 4.2-1.8.913.228 1.565.89 2.288 1.624 1.177 1.194 2.538 2.576 5.512 2.576 3.2 0 5.2-1.6 6-4.8-1.2 1.6-2.6 2.2-4.2 1.8-.913-.228-1.565-.89-2.288-1.624C10.337 13.382 8.976 12 6.001 12z' },
      { n: 'Chart.js', t: 2,    c: '#FF6384', match: ['chart.js', 'chartjs', 'charts'],
        d: 'M11.5 0a11.5 11.5 0 100 23 11.5 11.5 0 000-23zm0 2.2a9.3 9.3 0 019.3 9.3 9.3 9.3 0 01-9.3 9.3 9.3 9.3 0 01-9.3-9.3 9.3 9.3 0 019.3-9.3zM7 8v8h2V8H7zm3.5-2v10h2V6h-2zm3.5 4v6h2v-6h-2z' },
      { n: 'WebSocket', t: 2,   c: '#010101', match: ['websocket', 'ws', 'socket programming', 'sockets'],
        d: 'M6 4l6 8-6 8h3l6-8-6-8H6zm7 0l6 8-6 8h3l6-8-6-8h-3z' },
      { n: 'gRPC', t: 2,        c: '#244C5A', match: ['grpc', 'protocol buffers', 'protobuf'],
        d: 'M12 0L1.5 6v12L12 24l10.5-6V6L12 0zm0 2.3l8.5 4.9v9.6L12 21.7 3.5 16.8V7.2L12 2.3zm0 3.4a6.3 6.3 0 100 12.6 6.3 6.3 0 000-12.6zm0 2.1a4.2 4.2 0 110 8.4 4.2 4.2 0 010-8.4z' },
      { n: 'C', t: 1,           c: '#A8B9CC', match: ['c', 'ansi c'],
        d: 'M16.5921 9.1962s-.354-3.298-3.627-3.234c-3.2741.063-4.4552 2.1-4.4552 6.02 0 3.9181 1.3771 6.1783 4.6062 6.1783 3.2291 0 3.4763-3.4143 3.4763-3.4143l5.0942.0301s.1801 2.5111-1.7502 4.5252c-1.9302 2.014-4.3611 2.7311-7.0002 2.7311S3.4489 21.7 1.7327 17.7259C.9058 15.8107.7 13.9245.7 12.0002c0-1.9243.2058-3.8105 1.0327-5.7257C3.4489 2.3 8.9302 1.6 11.5352 1.6c2.6051 0 5.07.7171 7.0002 2.7312 1.9303 2.014 1.7502 4.5252 1.7502 4.5252z' },
      { n: 'MPI', t: 2,         c: '#005B96', match: ['mpi', 'openmpi', 'slurm', 'parallel'],
        d: 'M4 4h4v4H4V4zm6 0h4v4h-4V4zm6 0h4v4h-4V4zM4 10h4v4H4v-4zm6 0h4v4h-4v-4zm6 0h4v4h-4v-4zM4 16h4v4H4v-4zm6 0h4v4h-4v-4zm6 0h4v4h-4v-4z' },

      /* Terms that appear only in the Tools section, not in any project. */
      { n: 'Claude', t: 1,      c: '#D97757', match: ['claude', 'anthropic'],
        d: 'M12 2.4l2.9 6.1 6.7.9-4.9 4.6 1.3 6.6L12 17.5l-6 3.1 1.3-6.6L2.4 9.4l6.7-.9L12 2.4z' },
      { n: 'Perplexity', t: 1,  c: '#20808D', match: ['perplexity'],
        d: 'M12 2L3 7v10l9 5 9-5V7l-9-5zm0 2.3l6.8 3.8L12 11.9 5.2 8.1 12 4.3zM5 9.8l6 3.4v6.6l-6-3.3V9.8zm14 0v6.7l-6 3.3v-6.6l6-3.4z' },

      /* Generic illustrations for tools with no vetted brand path: a
         database cylinder, a terminal prompt, a penguin-ish disc. Original
         shapes rather than approximations of a real logo. */
      { n: 'PostgreSQL', t: 1,  c: '#4169E1', match: ['postgresql', 'postgres', 'psql'],
        d: 'M12 2c-4.4 0-8 1.3-8 3v14c0 1.7 3.6 3 8 3s8-1.3 8-3V5c0-1.7-3.6-3-8-3zm0 2c3.9 0 6 1.1 6 1s-2.1 1-6 1-6-1.1-6-1 2.1-1 6-1zm6 15c0 .5-2.1 1-6 1s-6-.5-6-1v-2.3c1.5.8 3.7 1.3 6 1.3s4.5-.5 6-1.3V19zm0-5c0 .5-2.1 1-6 1s-6-.5-6-1v-2.3c1.5.8 3.7 1.3 6 1.3s4.5-.5 6-1.3V14zm0-5c0 .5-2.1 1-6 1s-6-.5-6-1V6.7C7.5 7.5 9.7 8 12 8s4.5-.5 6-1.3V9z' },
      { n: 'MySQL', t: 1,       c: '#00758F', match: ['sql', 'mysql', 'rdbms'],
        d: 'M12 2C7.6 2 4 3.3 4 5v14c0 1.7 3.6 3 8 3s8-1.3 8-3V5c0-1.7-3.6-3-8-3zm0 2c3.9 0 6 1.1 6 1s-2.1 1-6 1-6-1.1-6-1 2.1-1 6-1zM6 8.7C7.5 9.5 9.7 10 12 10s4.5-.5 6-1.3V12c0 .5-2.1 1-6 1s-6-.5-6-1V8.7zm0 6C7.5 15.5 9.7 16 12 16s4.5-.5 6-1.3V19c0 .5-2.1 1-6 1s-6-.5-6-1v-4.3z' },
      { n: 'Linux', t: 1,       c: '#4A4A4A', match: ['linux', 'linux api', 'unix'],
        d: 'M12 2a5 5 0 00-5 5v3.2c0 .9-.3 1.7-.9 2.4L4.4 15c-.9 1.1-.6 2.7.6 3.4l.6.3A9 9 0 0012 20a9 9 0 006.4-1.3l.6-.3c1.2-.7 1.5-2.3.6-3.4l-1.7-2.4a3.6 3.6 0 01-.9-2.4V7a5 5 0 00-5-5zm-1.6 5.2a.9.9 0 110 1.8.9.9 0 010-1.8zm3.2 0a.9.9 0 110 1.8.9.9 0 010-1.8zM12 11.4l2.2 1.4-2.2 1.4-2.2-1.4L12 11.4z' },
      { n: 'GNU Bash', t: 1,    c: '#3E4A52', match: ['bash', 'gnu bash', 'shell', 'sh', 'zsh'],
        d: 'M3 4h18a1 1 0 011 1v14a1 1 0 01-1 1H3a1 1 0 01-1-1V5a1 1 0 011-1zm1 3v11h16V7H4zm2.6 2.1l1.3-1.3 3.6 3.6-3.6 3.6-1.3-1.3 2.3-2.3-2.3-2.3zM12 14.6h5v1.8h-5v-1.8z' },
      { n: 'Java', t: 1,        c: '#ED8B00', match: ['java', 'jvm'],
        d: 'M8.851 18.56s-.917.534.653.714c1.902.218 2.874.187 4.969-.211 0 0 .552.346 1.321.646-4.699 2.013-10.633-.118-6.943-1.149M8.276 15.933s-1.028.761.542.924c2.032.209 3.636.227 6.413-.308 0 0 .384.389.987.602-5.679 1.661-12.007.13-7.942-1.218M13.116 11.475c1.158 1.333-.304 2.533-.304 2.533s2.939-1.518 1.589-3.418c-1.261-1.772-2.228-2.652 3.007-5.688 0-.001-8.216 2.051-4.292 6.573M19.33 20.504s.679.559-.747.991c-2.712.822-11.288 1.069-13.669.033-.856-.373.75-.89 1.254-.998.527-.114.828-.093.828-.093-.953-.671-6.156 1.317-2.643 1.887 9.58 1.553 17.462-.7 14.977-1.82M9.292 13.21s-4.362 1.036-1.544 1.412c1.189.159 3.561.123 5.77-.062 1.806-.152 3.618-.477 3.618-.477s-.637.272-1.098.587c-4.429 1.165-12.986.623-10.522-.568 2.082-1.006 3.776-.892 3.776-.892M17.116 17.584c4.503-2.34 2.421-4.589.968-4.285-.355.074-.515.138-.515.138s.132-.207.385-.297c2.875-1.011 5.086 2.981-.928 4.562 0-.001.07-.062.09-.118M14.401 0s2.494 2.494-2.365 6.33c-3.896 3.077-.888 4.832-.001 6.836-2.274-2.053-3.943-3.858-2.824-5.539 1.644-2.469 6.197-3.665 5.19-7.627M9.734 23.924c4.322.277 10.959-.153 11.116-2.198 0 0-.302.775-3.572 1.391-3.688.694-8.239.613-10.937.168 0-.001.553.457 3.393.639' },
      /* `tile: true` means the artwork IS a filled brand-colour block with the
         glyph knocked out. Recolouring it for contrast turns the yellow
         olive-brown, which is what made this look wrong; the renderer skips
         the adjustment and outlines the tile instead. */
      { n: 'JavaScript', t: 1,  c: '#F7DF1E', tile: true, match: ['javascript', 'js', 'es6'],
        d: 'M0 0h24v24H0V0zm22.034 18.276c-.175-1.095-.888-2.015-3.003-2.873-.736-.345-1.554-.585-1.797-1.14-.091-.33-.105-.51-.046-.705.15-.646.915-.84 1.515-.66.39.12.75.42.976.9 1.034-.676 1.034-.676 1.755-1.125-.27-.42-.404-.601-.586-.78-.63-.705-1.469-1.065-2.834-1.034l-.705.089c-.676.165-1.32.525-1.71 1.005-1.14 1.291-.811 3.541.569 4.471 1.365 1.02 3.361 1.244 3.616 2.205.24 1.17-.87 1.545-1.966 1.41-.811-.18-1.26-.586-1.755-1.336l-1.83 1.051c.21.48.45.689.81 1.109 1.74 1.756 6.09 1.666 6.871-1.004.029-.09.24-.705.074-1.65l.046.067zm-8.983-7.245h-2.248c0 1.938-.009 3.864-.009 5.805 0 1.232.063 2.363-.138 2.711-.33.689-1.18.601-1.566.48-.396-.196-.597-.466-.83-.855-.063-.105-.11-.196-.127-.196l-1.825 1.125c.305.63.75 1.172 1.324 1.517.855.51 2.004.675 3.207.405.783-.226 1.458-.691 1.811-1.411.51-.93.402-2.07.397-3.346.012-2.054 0-4.109 0-6.179l.004-.056z' },
      { n: 'HTML5', t: 1,       c: '#E34F26', match: ['html5', 'html'],
        d: 'M1.5 0h21l-1.91 21.563L11.977 24l-8.564-2.438L1.5 0zm7.031 9.75l-.232-2.718 10.059.003.23-2.622L5.412 4.41l.698 8.01h9.126l-.326 3.426-2.91.804-2.955-.81-.188-2.11H6.248l.33 4.171L12 19.351l5.379-1.443.744-8.157H8.531z' },
      { n: 'CSS3', t: 1,        c: '#1572B6', match: ['css', 'css3'],
        d: 'M1.5 0h21l-1.91 21.563L11.977 24l-8.565-2.438L1.5 0zm17.09 4.413L5.41 4.41l.213 2.622 10.125.002-.255 2.716h-6.64l.24 2.573h6.182l-.366 3.523-2.91.804-2.956-.81-.188-2.11h-2.61l.29 3.855L12 19.288l5.373-1.53L18.59 4.414z' },
      { n: 'MongoDB', t: 1,     c: '#47A248', match: ['mongodb', 'mongo', 'nosql'],
        d: 'M17.193 9.555c-1.264-5.58-4.252-7.414-4.573-8.115-.28-.394-.53-.954-.735-1.44-.036.495-.055.685-.523 1.184-.723.566-4.438 3.682-4.74 10.02-.282 5.912 4.27 9.435 4.888 9.884l.07.05A73.49 73.49 0 0111.91 24h.481c.114-1.032.284-2.056.51-3.07.417-.296.604-.463.85-.693a11.342 11.342 0 003.639-8.464c.01-.814-.103-1.662-.197-2.218zm-5.336 8.195s0-8.291.275-8.29c.213 0 .49 10.695.49 10.695-.381-.045-.765-1.76-.765-2.405z' },
      { n: 'Dart', t: 1,        c: '#0175C2', match: ['dart'],
        d: 'M4.105 4.105S9.158 1.58 11.684.316a3.079 3.079 0 011.481-.315c.766.047 1.677.788 1.677.788L24 9.948v10.104h-4.895v3.947H9.789L0 14.21h.001V6.319l4.105-2.214zm.79.845v14.685l1.052-2.61.632-.947.895-1.316V6.316L4.895 4.95zm.157 15.474l4.105 2.474h9.79L9.157 14.21H4.42l.632 6.214zm5.895-6.635l4.105 4.105h4.105l-4.105-4.105h-4.105zm.632-8.316L6.316 8.42v6.316l4.105-4.105V5.473h.001z' },
      { n: 'Flutter', t: 1,     c: '#02569B', match: ['flutter'],
        d: 'M14.314 0L2.3 12 6 15.7 21.684.012h-7.357L14.314 0zm.014 11.072l-6.471 6.457 6.47 6.47H21.7l-6.46-6.468 6.46-6.46h-7.37z' },
      { n: 'Node.js', t: 1,     c: '#5FA04E', match: ['node.js', 'nodejs', 'node', 'npm'],
        d: 'M11.998 24c-.321 0-.641-.084-.922-.247l-2.936-1.737c-.438-.245-.224-.332-.08-.383.585-.203.703-.25 1.328-.604.065-.037.151-.023.218.017l2.256 1.339c.082.045.197.045.272 0l8.795-5.076c.082-.047.134-.141.134-.238V6.921c0-.099-.053-.192-.137-.242l-8.791-5.072c-.081-.047-.189-.047-.271 0L3.075 6.68c-.084.05-.139.145-.139.241v10.15c0 .097.055.189.139.235l2.409 1.392c1.307.654 2.108-.116 2.108-.89V7.787c0-.142.114-.253.256-.253h1.115c.139 0 .255.112.255.253v10.021c0 1.745-.95 2.745-2.604 2.745-.508 0-.909 0-2.026-.551L2.28 18.675c-.57-.329-.922-.945-.922-1.604V6.921c0-.659.353-1.275.922-1.603L11.076.242c.555-.313 1.294-.313 1.844 0l8.795 5.076c.57.329.924.944.924 1.603v10.15c0 .659-.354 1.273-.924 1.604l-8.795 5.078c-.28.163-.599.247-.922.247zm2.717-6.993c-3.849 0-4.653-1.766-4.653-3.246 0-.14.114-.253.255-.253h1.136c.126 0 .231.091.251.215.171 1.157.682 1.741 3.010 1.741 1.852 0 2.640-.419 2.640-1.402 0-.566-.224-.986-3.101-1.268-2.406-.238-3.894-.769-3.894-2.692 0-1.774 1.494-2.83 3.999-2.83 2.814 0 4.207.977 4.383 3.074a.256.256 0 01-.255.278h-1.141a.255.255 0 01-.249-.2c-.273-1.216-.938-1.605-2.738-1.605-2.016 0-2.251.702-2.251 1.229 0 .638.276.823 3.005 1.184 2.702.357 3.99.862 3.99 2.760 0 1.915-1.596 3.014-4.378 3.014z' },
      { n: 'Express', t: 2,     c: '#000000', match: ['express', 'expressjs'],
        d: 'M24 18.588a1.529 1.529 0 01-1.895-.72l-3.45-4.771-.5-.667-4.003 5.444a1.466 1.466 0 01-1.802.708l5.158-6.92-4.798-6.251a1.595 1.595 0 011.9.666l3.576 4.83 3.596-4.81a1.435 1.435 0 011.788-.668L21.708 7.9l-2.522 3.283a.666.666 0 000 .994L24 18.588zM.002 11.576l.42-2.075c1.154-4.103 5.858-5.81 9.094-3.27 1.895 1.489 2.368 3.597 2.275 5.973H1.116C.943 16.447 4.005 19.009 7.92 17.7a4.078 4.078 0 002.582-2.876c.207-.666.548-.78 1.174-.588a5.417 5.417 0 01-2.589 3.957 6.272 6.272 0 01-7.306-.933 6.575 6.575 0 01-1.64-3.858c0-.235-.08-.455-.134-.666A88.33 88.33 0 010 11.577zm1.127-.286h9.654c-.06-3.076-2.001-5.258-4.59-5.278-2.882-.04-4.944 2.094-5.071 5.264z' }
    ]
  };

  /* Friendly labels for the variables we know about. Anything else that
     turns up in :root is still listed, just under its raw name — the point
     is that the editor is never limited to a hardcoded subset. */
  var LABELS = {
    'bg':            'Page background',
    'bg-soft':       'Card / panel',
    'ink':           'Text',
    'ink-soft':      'Text muted',
    'muted':         'Hints',
    'accent':        'Accent',
    'accent-soft':   'Accent soft',
    'rule':          'Rules / borders',
    'live':          'Live badge',
    'filter-tech':   'Tech filter + its lines',
    'grain-opacity': 'Paper grain'
  };

  /* Variables that aren't colours — sliders or text, not colour pickers. */
  var NON_COLOR = ['mono', 'sans', 'serif', 'max', 'gutter', 'grain-svg',
                   'grain-blend', 'text-scale', 'density', 'site-max-w',
                   'line-opacity', 'topbar-h'];

  var PRESETS = [
    '#f3ede1', '#ece4d4', '#241f17', '#5c5344', '#8a5a44', '#d8ccb4',
    '#0F7B54', '#534AB7', '#185FA5', '#1D9E75', '#D85A30', '#993556',
    '#BA7517', '#5F5E5A', '#ffffff', '#0b0b0b'
  ];

  var state = {
    config: null,
    dirty: false,
    styles: [],
    recent: []
  };

  /* ---------- helpers ---------- */
  function theme() {
    return document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
  }
  function cssVar(name) {
    return getComputedStyle(document.documentElement).getPropertyValue('--' + name).trim();
  }
  function toHex(c) {
    if (!c) return '#000000';
    c = c.trim();
    if (c.charAt(0) === '#') {
      if (c.length === 4) return '#' + c[1] + c[1] + c[2] + c[2] + c[3] + c[3];
      return c.slice(0, 7);
    }
    var m = /rgba?\(([^)]+)\)/.exec(c);
    if (!m) return '#000000';
    var p = m[1].split(',').map(function (x) { return parseInt(x, 10); });
    return '#' + p.slice(0, 3).map(function (v) {
      return ('0' + Math.max(0, Math.min(255, v || 0)).toString(16)).slice(-2);
    }).join('');
  }
  function el(tag, cls, txt) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (txt !== undefined) e.textContent = txt;
    return e;
  }

  /* ---------- styles ---------- */
  var CSS = [
    '.ed-panel{position:fixed;z-index:99999;width:290px;max-height:82vh;overflow-y:auto;',
    '  background:var(--bg-soft,#fff);color:var(--ink,#111);border:1px solid var(--rule,#ccc);',
    '  border-radius:10px;box-shadow:0 14px 44px rgba(0,0,0,.28);padding:10px;',
    '  font-family:var(--mono,monospace);font-size:11.5px;display:none;}',
    '.ed-panel.open{display:block;}',
    '.ed-h{font-size:10px;letter-spacing:.09em;text-transform:uppercase;opacity:.75;',
    '  margin:12px 0 6px;cursor:pointer;user-select:none;display:flex;',
    '  align-items:center;gap:6px;padding:5px 7px;border-radius:6px;',
    '  background:var(--bg,#fff);border:1px solid var(--rule,#ddd);}',
    '.ed-h:hover{border-color:var(--accent,#8a5a44);}',
    '.ed-h::before{content:"\\25be";font-size:8px;opacity:.7;transition:transform .15s;}',
    '.ed-h.collapsed::before{transform:rotate(-90deg);}',
    '.ed-sec{margin-bottom:4px;}',
    '.ed-sec.collapsed{display:none;}',
    '.ed-h:first-child{margin-top:0;}',
    '.ed-row{display:flex;align-items:center;gap:7px;margin-bottom:5px;}',
    '.ed-row label{flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}',
    '.ed-row input[type=color]{width:26px;height:22px;padding:0;border:1px solid var(--rule,#ccc);',
    '  border-radius:4px;background:none;cursor:pointer;}',
    '.ed-hex{width:66px;font-family:inherit;font-size:10px;padding:3px 4px;',
    '  border:1px solid var(--rule,#ccc);border-radius:4px;background:transparent;',
    '  color:inherit;text-transform:lowercase;}',
    '.ed-row input[type=range]{flex:2;}',
    '.ed-row .ed-val{width:36px;text-align:right;opacity:.65;}',
    '.ed-sw{display:flex;flex-wrap:wrap;gap:3px;margin:3px 0 8px;}',
    '.ed-pick{width:20px;height:22px;border:1px solid var(--rule,#ccc);border-radius:4px;',
    '  background:transparent;color:inherit;cursor:pointer;font-size:9px;line-height:1;padding:0;}',
    '.ed-pop{display:none;margin:4px 0 8px;padding:6px;border:1px solid var(--rule,#ccc);',
    '  border-radius:6px;background:var(--bg,#fff);}',
    '.ed-pop.open{display:block;}',
    '.ed-pop-h{font-size:9px;opacity:.55;text-transform:uppercase;letter-spacing:.08em;',
    '  margin:0 0 4px;}',
    '.ed-emoji-wrap{border:1px solid var(--rule,#ccc);border-radius:6px;padding:6px;',
    '  margin:4px 0 8px;display:none;}',
    '.ed-emoji-wrap.open{display:block;}',
    '.ed-emoji-search{width:100%;font-family:inherit;font-size:11px;padding:5px;',
    '  border:1px solid var(--rule,#ccc);border-radius:5px;background:transparent;',
    '  color:inherit;margin-bottom:6px;}',
    '.ed-emoji-scroll{max-height:190px;overflow-y:auto;}',
    '.ed-emoji-grid{display:grid;grid-template-columns:repeat(8,1fr);gap:2px;margin-bottom:6px;}',
    '.ed-emoji-grid button{font-size:16px;line-height:1;padding:3px 0;border:0;border-radius:4px;',
    '  background:transparent;cursor:pointer;}',
    '.ed-emoji-grid button:hover{background:var(--bg-soft,#eee);}',
    '.ed-emoji-none{font-size:10px;opacity:.55;padding:6px 0;}',
    '.ed-sw button{width:17px;height:17px;border-radius:3px;border:1px solid rgba(0,0,0,.18);',
    '  cursor:pointer;padding:0;}',
    '.ed-btns{display:flex;gap:5px;margin-top:10px;position:sticky;bottom:0;',
    '  background:var(--bg-soft,#fff);padding-top:8px;}',
    '.ed-btns button{flex:1;font-family:inherit;font-size:11px;padding:6px 0;border-radius:6px;',
    '  border:1px solid var(--rule,#ccc);background:transparent;color:inherit;cursor:pointer;}',
    '.ed-btns button.primary{background:var(--accent,#8a5a44);color:#fff;border-color:transparent;}',
    '.ed-btns button:disabled{opacity:.4;cursor:default;}',
    '.ed-sel{width:100%;font-family:inherit;font-size:11px;padding:5px;border-radius:6px;',
    '  border:1px solid var(--rule,#ccc);background:transparent;color:inherit;}',
    '.ed-note{opacity:.55;line-height:1.45;margin-top:8px;font-size:10px;}',
    '.ed-dirty{color:var(--accent,#8a5a44);}',
    '.ed-grip{font-family:var(--mono,monospace);font-size:9.5px;letter-spacing:.08em;',
    '  text-transform:uppercase;opacity:.55;padding:2px 0 8px;cursor:move;',
    '  border-bottom:1px solid var(--rule,#ccc);margin-bottom:9px;}',
    '.ed-doc{position:fixed;z-index:99996;width:720px;max-width:94vw;min-width:340px;',
    '  background:var(--bg,#fff);border:1px solid var(--rule,#ccc);border-radius:12px;',
    '  box-shadow:0 18px 50px rgba(0,0,0,.3);display:none;overflow:hidden;resize:horizontal;}',
    '.ed-doc.open{display:block;}',
    '.ed-scope{font-size:10.5px;padding:5px 8px;margin-bottom:6px;border-radius:5px;',
    '  background:var(--accent,#8a5a44);color:#fff;}',
    '.ed-item{display:none;border:1px solid var(--accent,#8a5a44);border-radius:8px;',
    '  padding:9px;margin:0 0 12px;}',
    '.ed-item.open{display:block;}',
    '.ed-item-hd{display:flex;align-items:center;gap:6px;font-size:11px;font-weight:700;',
    '  margin-bottom:2px;}',
    '.ed-item-kind{font-size:9px;text-transform:uppercase;letter-spacing:.08em;',
    '  padding:1px 6px;border-radius:20px;background:var(--accent,#8a5a44);color:#fff;}',
    '.ed-item-close{margin-left:auto;border:0;background:none;color:inherit;cursor:pointer;',
    '  font-size:14px;line-height:1;padding:0 2px;}',
    '.ed-item-name{font-size:10px;opacity:.7;margin-bottom:8px;word-break:break-word;}',
    '.ed-thumb{width:54px;height:54px;border:1px solid var(--rule,#ccc);border-radius:8px;',
    '  display:flex;align-items:center;justify-content:center;overflow:hidden;',
    '  background:var(--bg,#fff);flex-shrink:0;}',
    '.ed-thumb img{max-width:100%;max-height:100%;object-fit:contain;}',
    '.ed-thumb .ed-thumb-msg{font-size:8.5px;opacity:.6;text-align:center;padding:3px;',
    '  line-height:1.25;}',
    '.ed-thumb-row{display:flex;gap:8px;align-items:center;margin-bottom:7px;}',
    '.ed-pvwin{position:fixed;z-index:99997;width:860px;max-width:94vw;min-width:360px;',
    '  background:var(--bg,#fff);border:1px solid var(--rule,#ccc);border-radius:12px;',
    '  box-shadow:0 18px 50px rgba(0,0,0,.3);display:none;overflow:hidden;',
    '  resize:horizontal;font-family:var(--serif,Georgia,serif);}',
    '.ed-pvwin.open{display:block;}',
    '.ed-pvwin-bar{display:flex;align-items:center;gap:8px;padding:8px 10px;',
    '  background:var(--bg-soft,#eee);border-bottom:1px solid var(--rule,#ccc);',
    '  font-family:var(--mono,monospace);font-size:10.5px;cursor:move;}',
    '.ed-pvwin-bar b{font-weight:700;letter-spacing:.06em;text-transform:uppercase;',
    '  opacity:.6;}',
    '.ed-pvwin-x{margin-left:auto;border:0;background:none;cursor:pointer;font-size:15px;',
    '  line-height:1;color:inherit;padding:0 3px;}',
    '.ed-pvwin-body{padding:26px 30px;max-height:64vh;overflow:auto;}',
    '.ed-pvwin-w{margin-left:8px;font-size:9.5px;opacity:.55;}',
    '.ed-pvwin-note{font-family:var(--mono,monospace);font-size:9.5px;opacity:.55;',
    '  padding:0 10px 9px;}',
    '.ed-preview{border:1px dashed var(--rule,#ccc);border-radius:8px;padding:9px;',
    '  margin-top:8px;background:var(--bg,#fff);}',
    '.ed-preview-hd{font-size:9px;text-transform:uppercase;letter-spacing:.08em;',
    '  opacity:.55;margin-bottom:6px;}',
    '.ed-preview-row{display:flex;align-items:center;gap:7px;font-size:13px;',
    '  font-weight:600;color:var(--ink,#111);}',
    '.ed-preview-row .pv-mark{display:inline-flex;align-items:center;justify-content:center;',
    '  flex-shrink:0;}',
    '.ed-preview-row .pv-mark img{width:100%;height:100%;object-fit:contain;}',
    '.ed-preview-alt{font-size:9px;opacity:.55;margin-top:5px;}',
    '.ed-size-row{display:flex;align-items:center;gap:6px;margin-bottom:5px;}',
    '.ed-fab{position:fixed;right:14px;bottom:14px;z-index:99998;',
    '  display:flex;align-items:center;gap:6px;padding:8px 12px;border-radius:100px;',
    '  background:var(--ink,#222);color:var(--bg,#fff);border:0;cursor:pointer;',
    '  font-family:var(--mono,monospace);font-size:11px;letter-spacing:.03em;',
    '  box-shadow:0 6px 20px rgba(0,0,0,.28);opacity:.85;}',
    '.ed-fab:hover{opacity:1;}',
    '.ed-fab .ed-dot{width:7px;height:7px;border-radius:50%;background:var(--accent,#8a5a44);}'
  ].join('');


  /* ---------- variable discovery ----------
     Walk the loaded stylesheets and collect every custom property declared
     on :root, so switching palette or adding a variable to style.css shows
     up in the editor without touching this file. */
  function discoverVars() {
    var found = [];
    for (var i = 0; i < document.styleSheets.length; i++) {
      var rules;
      try { rules = document.styleSheets[i].cssRules; }
      catch (e) { continue; }                 // cross-origin sheet, skip
      if (!rules) continue;
      for (var j = 0; j < rules.length; j++) {
        var r = rules[j];
        if (!r.style || !r.selectorText) continue;
        if (r.selectorText.indexOf(':root') < 0 && r.selectorText !== 'html') continue;
        for (var k = 0; k < r.style.length; k++) {
          var n = r.style[k];
          if (n.indexOf('--') !== 0) continue;
          var key = n.slice(2);
          if (NON_COLOR.indexOf(key) >= 0) continue;
          if (found.indexOf(key) < 0) found.push(key);
        }
      }
    }
    /* Keep only properties that currently resolve to something colour-like,
       so font stacks and lengths don't get a colour picker. */
    return found.filter(function (k) {
      var v = cssVar(k);
      return /^#|^rgb|^hsl/i.test(v);
    }).sort(function (a, b) {
      var ia = Object.keys(LABELS).indexOf(a), ib = Object.keys(LABELS).indexOf(b);
      if (ia < 0) ia = 99; if (ib < 0) ib = 99;
      return ia - ib || a.localeCompare(b);
    });
  }

  function labelFor(key) {
    return LABELS[key] || key.replace(/-/g, ' ');
  }

  /* Domains get their colour from site-config, or from a hue-rotated accent
     when unset. Listing them here is the only way to reach the connector
     lines, since those are drawn in the domain's colour. */
  function domainList() {
    var pal = window.__domainPalette || {};
    return Object.keys(pal);
  }

  /* ---------- panel ---------- */
  var panel, statusEl;

  /* Group everything after a heading into a collapsible block, so the
     panel opens as a short list of topics rather than a wall of controls.
     Run once at the end of build(), which keeps the construction code
     above free of layout bookkeeping. */
  function groupIntoSections(root) {
    var kids = Array.prototype.slice.call(root.children);
    var current = null;
    kids.forEach(function (node) {
      if (node.className === 'ed-h') {
        current = document.createElement('div');
        current.className = 'ed-sec';
        root.insertBefore(current, node.nextSibling);
        (function (head, body) {
          head.addEventListener('click', function (e) {
            e.stopPropagation();
            head.classList.toggle('collapsed');
            body.classList.toggle('collapsed');
          });
        })(node, current);
        return;
      }
      if (current && node.className !== 'ed-btns' && node.className !== 'ed-item' &&
          node.className !== 'ed-grip') {
        current.appendChild(node);
      }
    });
    /* Open the first two, collapse the rest — the common case is a quick
       colour or size tweak, not a tour of every control. */
    var heads = root.querySelectorAll('.ed-h');
    var bodies = root.querySelectorAll('.ed-sec');
    for (var i = 2; i < heads.length; i++) {
      heads[i].classList.add('collapsed');
      if (bodies[i]) bodies[i].classList.add('collapsed');
    }
  }

  function build() {
    var st = el('style'); st.textContent = CSS; document.head.appendChild(st);

    panel = el('div', 'ed-panel');
    panel.addEventListener('contextmenu', function (e) { e.stopPropagation(); });
    panel.addEventListener('click', function (e) { e.stopPropagation(); });

    /* palette */
    panel.appendChild(el('div', 'ed-h', 'Palette'));
    var sel = el('select', 'ed-sel');
    sel.id = 'ed-style';
    panel.appendChild(sel);
    sel.addEventListener('change', function () { switchStyle(sel.value); });

    /* colours — discovered from the active stylesheet.
       Light and dark keep separate override sets, so this switch changes
       BOTH the page theme and which set you're editing. */
    panel.appendChild(el('div', 'ed-h', 'Colours'));
    var themeRow = el('div', 'ed-row');
    themeRow.appendChild(el('label', null, 'Editing theme'));
    var tLight = el('button', 'ed-pick', 'day');
    var tDark  = el('button', 'ed-pick', 'night');
    tLight.style.width = 'auto'; tLight.style.padding = '3px 10px';
    tDark.style.width  = 'auto'; tDark.style.padding  = '3px 10px';
    tLight.addEventListener('click', function (e) { e.stopPropagation(); setTheme('light'); });
    tDark .addEventListener('click', function (e) { e.stopPropagation(); setTheme('dark'); });
    themeRow.appendChild(tLight); themeRow.appendChild(tDark);
    panel.appendChild(themeRow);
    var tNote = el('div', 'ed-note', '');
    tNote.id = 'ed-theme-note';
    panel.appendChild(tNote);
    var colorBox = el('div'); colorBox.id = 'ed-colors';
    panel.appendChild(colorBox);

    /* per-domain colours, which also drive the connector lines */
    panel.appendChild(el('div', 'ed-h', 'Domains + connector lines'));
    var domBox = el('div'); domBox.id = 'ed-domains';
    panel.appendChild(domBox);
    var domNote = el('div', 'ed-note',
      'Each domain\u2019s colour is used for its filter button, its chips and ' +
      'the lines drawn to matching projects.');
    panel.appendChild(domNote);

    /* line opacity */
    var lrow = el('div', 'ed-row');
    lrow.appendChild(el('label', null, 'Line strength'));
    var lr = el('input'); lr.type = 'range';
    lr.min = 0.15; lr.max = 1; lr.step = 0.01; lr.value = 0.82;
    lr.id = 'ed-lineop';
    var lout = el('span', 'ed-val', '0.82');
    lr.addEventListener('input', function () {
      lout.textContent = (+lr.value).toFixed(2);
      setVar('line-opacity', lr.value);
    });
    lrow.appendChild(lr); lrow.appendChild(lout);
    panel.appendChild(lrow);

    /* icons + images ---------------------------------------------------
       Emoji and representative images are authored in resume.tex comment
       blocks. The editor writes OVERRIDES into site-config.json instead of
       rewriting your LaTeX, so the file that feeds your PDF is never
       touched by a web UI. "Copy for resume.tex" prints the lines to paste
       in when you want to make a choice permanent. */
    /* Everything for ONE item, in one place. Right-clicking a card fills
       this in and opens it at the top of the panel, so you're not hunting
       for that item's controls among the global ones below. */
    var itemBox = el('div', 'ed-item'); itemBox.id = 'ed-item';
    panel.insertBefore(itemBox, panel.firstChild);

    panel.appendChild(el('div', 'ed-h', 'Icon / image \u2014 any item'));
    var scope = el('div', 'ed-scope'); scope.id = 'ed-scope';
    scope.style.display = 'none';
    panel.appendChild(scope);
    var mediaSel = el('select', 'ed-sel');
    mediaSel.id = 'ed-media-target';
    panel.appendChild(mediaSel);

    var mRow1 = el('div', 'ed-row');
    mRow1.appendChild(el('label', null, 'Emoji'));
    var mIcon = el('input'); mIcon.type = 'text'; mIcon.id = 'ed-media-icon';
    mIcon.placeholder = 'e.g. 🛡'; mIcon.style.width = '54px';
    mRow1.appendChild(mIcon);
    var mBrowse = el('button', 'ed-pick', 'browse');
    mBrowse.style.width = 'auto'; mBrowse.style.padding = '3px 8px';
    mBrowse.title = 'Search and pick an emoji';
    mRow1.appendChild(mBrowse);
    panel.appendChild(mRow1);

    /* Emoji browser: suggestions relevant to the selected item first, then
       the full catalogue by category, with free-text search. */
    var eWrap = el('div', 'ed-emoji-wrap'); eWrap.id = 'ed-emoji-wrap';
    var eSearch = el('input', 'ed-emoji-search');
    eSearch.type = 'text'; eSearch.id = 'ed-emoji-search';
    eSearch.placeholder = 'search emoji — try "security", "compiler"…';
    eSearch.addEventListener('input', function () { renderEmoji(eSearch.value); });
    eSearch.addEventListener('click', function (e) { e.stopPropagation(); });
    eWrap.appendChild(eSearch);
    var eScroll = el('div', 'ed-emoji-scroll'); eScroll.id = 'ed-emoji-scroll';
    eWrap.appendChild(eScroll);
    panel.appendChild(eWrap);

    mBrowse.addEventListener('click', function (e) {
      e.stopPropagation();
      var open = eWrap.classList.contains('open');
      eWrap.classList.toggle('open', !open);
      if (!open) { eSearch.value = ''; renderEmoji(''); }
    });

    var mRow2 = el('div', 'ed-row');
    mRow2.appendChild(el('label', null, 'Image file'));
    var mImg = el('input'); mImg.type = 'text'; mImg.id = 'ed-media-image';
    mImg.placeholder = 'nids.png'; mImg.style.width = '110px';
    mRow2.appendChild(mImg);
    panel.appendChild(mRow2);

    var mRow3 = el('div', 'ed-row');
    mRow3.appendChild(el('label', null, 'Alt text'));
    var mAlt = el('input'); mAlt.type = 'text'; mAlt.id = 'ed-media-alt';
    mAlt.placeholder = 'describes the image'; mAlt.style.width = '110px';
    mRow3.appendChild(mAlt);
    panel.appendChild(mRow3);

    var mSizeRow = el('div', 'ed-size-row');
    mSizeRow.appendChild(el('label', null, 'Image size'));
    var mSize = el('input'); mSize.type = 'range';
    mSize.min = 0.8; mSize.max = 4; mSize.step = 0.1; mSize.value = 1.35;
    mSize.id = 'ed-media-size';
    var mSizeOut = el('span', 'ed-val', '1.4');
    mSize.addEventListener('input', function () {
      mSizeOut.textContent = (+mSize.value).toFixed(1);
      var sel = document.getElementById('ed-media-target');
      if (!sel || !sel.value) return;
      var m = mediaStore();
      if (!m.sizes) m.sizes = {};
      m.sizes[sel.value] = +mSize.value;
      markDirty();
      /* Live preview on the page without waiting for a save. */
      document.querySelectorAll('[data-entry], [data-title]').forEach(function (row) {
        var n = row.getAttribute('data-entry') || row.getAttribute('data-title');
        if (n !== sel.value) return;
        var mark = row.querySelector('.row-mark');
        if (mark) { mark.style.width = mSize.value + 'em'; mark.style.height = mSize.value + 'em'; }
      });
    });
    mSizeRow.appendChild(mSize); mSizeRow.appendChild(mSizeOut);
    panel.appendChild(mSizeRow);

    var mBtns = el('div', 'ed-row');
    var mApply = el('button', 'ed-pick', 'apply'); mApply.style.width = 'auto';
    mApply.style.padding = '3px 9px';
    var mClear = el('button', 'ed-pick', 'hide'); mClear.style.width = 'auto';
    mClear.style.padding = '3px 9px';
    mClear.title = 'Show no icon here, even if resume.tex sets one';
    var mReset = el('button', 'ed-pick', 'reset'); mReset.style.width = 'auto';
    mReset.style.padding = '3px 9px';
    mReset.title = 'Drop the override and use the resume.tex value';
    var mCopy  = el('button', 'ed-pick', 'copy for resume.tex');
    mCopy.style.width = 'auto'; mCopy.style.padding = '3px 9px';
    mBtns.appendChild(mApply); mBtns.appendChild(mClear);
    mBtns.appendChild(mReset); mBtns.appendChild(mCopy);
    panel.appendChild(mBtns);

    mediaSel.addEventListener('change', function () {
      loadMediaFields();
      var w = document.getElementById('ed-emoji-wrap');
      if (w && w.classList.contains('open')) renderEmoji('');
    });
    mApply.addEventListener('click', function (e) { e.stopPropagation(); applyMedia(); });
    mClear.addEventListener('click', function (e) { e.stopPropagation(); hideMedia(); });
    mReset.addEventListener('click', function (e) { e.stopPropagation(); resetMedia(); });
    mCopy .addEventListener('click', function (e) { e.stopPropagation(); copyMediaSnippet(); });

    /* ---- Text: hero + about -------------------------------------
       These blocks are hand-written in index.html, so edits are stored as
       overrides in site-config.json rather than rewriting markup. */
    panel.appendChild(el('div', 'ed-h', 'Text \u2014 title & about'));

    function areaRow(label, id, rows, place) {
      panel.appendChild(el('div', 'ed-group-label', label));
      var ta = el('textarea');
      ta.id = id; ta.rows = rows || 3; ta.placeholder = place || '';
      ta.style.cssText = 'width:100%;font-family:inherit;font-size:11px;padding:6px;' +
        'border:1px solid var(--rule,#ccc);border-radius:6px;background:transparent;' +
        'color:inherit;resize:vertical;margin-bottom:6px;';
      ta.addEventListener('click', function (e) { e.stopPropagation(); });
      ta.addEventListener('input', function () {
        var t = ensureText();
        if (id === 'ed-tx-name')  t.heroName = ta.value.trim();
        if (id === 'ed-tx-lede')  t.lede = ta.value.trim();
        if (id === 'ed-tx-about') t.about = ta.value.split(/\n\s*\n/)
                                    .map(function (s) { return s.trim(); })
                                    .filter(Boolean);
        markDirty();
        applyTextLive();
      });
      panel.appendChild(ta);
      return ta;
    }
    areaRow('Name (heading)', 'ed-tx-name', 1, 'Rishabh Sahu');
    areaRow('Lede', 'ed-tx-lede', 3, 'One or two sentences under the name');
    areaRow('About (blank line between paragraphs)', 'ed-tx-about', 6, '');

    /* ---- Section titles ------------------------------------------ */
    panel.appendChild(el('div', 'ed-h', 'Section titles'));
    var TITLE_KEYS = ['About', 'Work', 'Featured', 'Projects', 'Skills',
                      'Education', 'Accomplishments', 'Contact'];
    TITLE_KEYS.forEach(function (k) {
      var row = el('div', 'ed-row');
      row.appendChild(el('label', null, k));
      var inp = el('input'); inp.type = 'text';
      inp.style.width = '104px'; inp.placeholder = k;
      inp.dataset.titleKey = k;
      inp.addEventListener('click', function (e) { e.stopPropagation(); });
      inp.addEventListener('input', function () {
        var t = ensureText();
        if (!t.sectionTitles) t.sectionTitles = {};
        if (inp.value.trim()) t.sectionTitles[k] = inp.value.trim();
        else delete t.sectionTitles[k];
        markDirty();
        document.querySelectorAll('[data-section-title="' + k + '"]').forEach(function (h) {
          h.textContent = inp.value.trim() || k;
        });
      });
      row.appendChild(inp);
      panel.appendChild(row);
    });

    /* ---- Portrait ------------------------------------------------- */
    panel.appendChild(el('div', 'ed-h', 'Portrait'));
    var poRow = el('div', 'ed-row');
    poRow.appendChild(el('label', null, 'File'));
    var poIn = el('input'); poIn.type = 'text'; poIn.id = 'ed-portrait';
    poIn.placeholder = 'me.jpg'; poIn.style.width = '96px';
    poIn.addEventListener('click', function (e) { e.stopPropagation(); });
    poIn.addEventListener('input', function () {
      mediaStore().portrait = poIn.value.trim(); markDirty();
    });
    poRow.appendChild(poIn);
    var poOn = el('button', 'ed-pick', 'show');
    poOn.style.width = 'auto'; poOn.style.padding = '3px 9px';
    poOn.addEventListener('click', function (e) {
      e.stopPropagation();
      var mm = mediaStore();
      mm.showPortrait = mm.showPortrait === false;
      markDirty(); paintMiscToggles();
      note('Portrait ' + (mm.showPortrait ? 'on' : 'off') + '. Save + reload.');
    });
    poRow.appendChild(poOn);
    panel.appendChild(poRow);
    panel._poOn = poOn;

    var poSzRow = el('div', 'ed-size-row');
    poSzRow.appendChild(el('label', null, 'Portrait size'));
    var poSz = el('input'); poSz.type = 'range';
    poSz.min = 80; poSz.max = 300; poSz.step = 4; poSz.value = 148;
    poSz.id = 'ed-portrait-size';
    var poSzOut = el('span', 'ed-val', '148px');
    poSz.addEventListener('input', function () {
      poSzOut.textContent = poSz.value + 'px';
      mediaStore().portraitSize = +poSz.value;
      var p = document.getElementById('hero-portrait');
      if (p) p.style.setProperty('--tile-w', poSz.value + 'px');
      markDirty();
    });
    poSzRow.appendChild(poSz); poSzRow.appendChild(poSzOut);
    panel.appendChild(poSzRow);

    /* ---- Global switches ------------------------------------------ */
    panel.appendChild(el('div', 'ed-h', 'Global'));
    var gRow = el('div', 'ed-row');
    var vLabel = el('div', 'ed-note', 'build v9 \u2014 if the console shows an ' +
      'older build, the browser is serving a cached file (hard-refresh).');
    panel.appendChild(vLabel);

    var noEmoji = el('button', 'ed-pick', 'remove all emojis');
    noEmoji.style.width = 'auto'; noEmoji.style.padding = '4px 10px';
    noEmoji.title = 'Suppress every emoji site-wide; images and logos stay';
    noEmoji.addEventListener('click', function (e) {
      e.stopPropagation();
      var mm = mediaStore();
      mm.noEmoji = !mm.noEmoji;
      markDirty(); paintMiscToggles();
      note(mm.noEmoji ? 'All emojis suppressed. Save + reload.'
                      : 'Emojis re-enabled. Save + reload.');
    });
    gRow.appendChild(noEmoji);

    var monoEmoji = el('button', 'ed-pick', 'uncoloured emojis');
    monoEmoji.style.width = 'auto'; monoEmoji.style.padding = '4px 10px';
    monoEmoji.title = 'Show emoji as grey glyphs instead of full colour';
    monoEmoji.addEventListener('click', function (e) {
      e.stopPropagation();
      var mm = mediaStore();
      mm.monoEmoji = !mm.monoEmoji;
      markDirty(); paintMiscToggles();
      document.querySelectorAll('.row-mark, .card-emoji').forEach(function (x) {
        x.classList.toggle('is-mono', !!mm.monoEmoji);
      });
      note(mm.monoEmoji ? 'Emoji shown uncoloured.' : 'Emoji shown in colour.');
    });
    gRow.appendChild(monoEmoji);

    var autoSh = el('button', 'ed-pick', 'auto shadow');
    autoSh.style.width = 'auto'; autoSh.style.padding = '4px 10px';
    autoSh.title = 'Scale image shadows to suit the background lightness';
    autoSh.addEventListener('click', function (e) {
      e.stopPropagation();
      var mm = mediaStore();
      mm.autoShadow = mm.autoShadow === false;
      markDirty(); paintMiscToggles();
      note('Shadow auto-adapt ' + (mm.autoShadow ? 'on' : 'off') + '. Save + reload.');
    });
    gRow.appendChild(autoSh);

    panel.appendChild(gRow);
    panel._noEmoji = noEmoji;
    panel._monoEmoji = monoEmoji;
    panel._autoSh = autoSh;

    /* ---- Nav dropdown --------------------------------------------
       Every domain the top-bar Projects menu can show, with a switch each.
       Right-clicking an entry in the menu reaches the same thing, but the
       menu closes when you click away, so a list here is the reliable
       route. */
    panel.appendChild(el('div', 'ed-h', 'Projects dropdown'));
    var navBox = el('div'); navBox.id = 'ed-navlist';
    panel.appendChild(navBox);

    /* ---- Hidden items --------------------------------------------
       Anything switched off anywhere in the editor collects here, so a
       hidden item can always be found and restored — otherwise turning
       something off is a one-way door. */
    panel.appendChild(el('div', 'ed-h', 'Hidden items'));
    var hidBox = el('div'); hidBox.id = 'ed-hidden';
    panel.appendChild(hidBox);

    /* ---- Entry visibility ----------------------------------------- */
    panel.appendChild(el('div', 'ed-h', 'Show / hide entries'));
    var entBox = el('div'); entBox.id = 'ed-entries';
    panel.appendChild(entBox);

    /* ---- Resume source ------------------------------------------- */
    panel.appendChild(el('div', 'ed-h', 'Resume source'));
    var texRow = el('div', 'ed-row');
    var htmlOpen = el('button', 'ed-pick', 'edit index.html');
    htmlOpen.style.width = 'auto'; htmlOpen.style.padding = '4px 10px';
    htmlOpen.title = 'Edit the page markup directly (backed up on every save)';
    htmlOpen.addEventListener('click', function (e) { e.stopPropagation(); openHtmlEditor(); });

    var texOpen = el('button', 'ed-pick', 'edit resume.tex');
    texOpen.style.width = 'auto'; texOpen.style.padding = '4px 10px';
    texOpen.title = 'Edit the LaTeX source directly (backed up on every save)';
    texOpen.addEventListener('click', function (e) { e.stopPropagation(); openTexEditor(); });
    texRow.appendChild(texOpen);
    texRow.appendChild(htmlOpen);
    var srcList = el('button', 'ed-pick', 'all sources\u2026');
    srcList.style.width = 'auto'; srcList.style.padding = '4px 10px';
    srcList.title = 'Every file that contributes text to the page';
    srcList.addEventListener('click', function (e) {
      e.stopPropagation();
      fetch('/__sources').then(function (r) { return r.json(); })
        .then(function (files) {
          var old = document.getElementById('ed-srclist');
          if (old) old.remove();
          var wrap = el('div', 'ed-pop open'); wrap.id = 'ed-srclist';
          wrap.appendChild(el('div', 'ed-pop-h', 'Editable sources'));
          files.forEach(function (f) {
            var b = el('button', 'ed-opt');
            b.style.cssText = 'display:block;width:100%;text-align:left;border:0;' +
              'background:transparent;color:inherit;font:inherit;font-size:10.5px;' +
              'padding:5px 6px;border-radius:4px;cursor:pointer;';
            b.innerHTML = '<b>' + f.path + '</b><br><span style="opacity:.6">' +
                          f.label + ' \u00b7 ' + Math.round(f.bytes / 1024) + ' KB</span>';
            b.addEventListener('click', function (ev) {
              ev.stopPropagation();
              openSourceEditor({ url: f.path, label: f.path, save: '/__save-source',
                                 asSource: f.path });
              wrap.remove();
            });
            wrap.appendChild(b);
          });
          texRow.parentNode.insertBefore(wrap, texRow.nextSibling);
        });
    });
    texRow.appendChild(srcList);
    var texRevert = el('button', 'ed-pick', 'revert');
    texRevert.style.width = 'auto'; texRevert.style.padding = '4px 10px';
    texRevert.title = 'Restore resume.tex from its newest backup';
    texRevert.addEventListener('click', function (e) {
      e.stopPropagation();
      fetch('/__revert-tex', { method: 'POST' }).then(function (r) { return r.json(); })
        .then(function (res) {
          note(res.ok ? 'resume.tex restored from ' + res.restored + ' — reloading…'
                      : 'revert failed: ' + (res.error || '?'));
          if (res.ok) setTimeout(function () { location.reload(); }, 800);
        });
    });
    texRow.appendChild(texRevert);
    panel.appendChild(texRow);

    /* Tech-logo toggles — brand marks on keyword chips. */
    var logoRow = el('div', 'ed-row');
    logoRow.appendChild(el('label', null, 'Tech logos'));
    var lgOn = el('button', 'ed-pick', 'on/off');
    lgOn.style.width='auto'; lgOn.style.padding='3px 9px';
    var lgCol = el('button', 'ed-pick', 'colour');
    lgCol.style.width='auto'; lgCol.style.padding='3px 9px';
    lgOn.addEventListener('click', function (e) {
      e.stopPropagation();
      var m = mediaStore();
      m.showTechLogos = m.showTechLogos === false;
      markDirty(); paintLogoToggles();
      note('Tech logos ' + (m.showTechLogos ? 'on' : 'off') + '. Save + reload.');
    });
    lgCol.addEventListener('click', function (e) {
      e.stopPropagation();
      var m = mediaStore();
      m.techLogoColor = m.techLogoColor === false;
      markDirty(); paintLogoToggles();
      note('Logos in ' + (m.techLogoColor ? 'brand colour' : 'text colour') + '. Save + reload.');
    });
    var lgMinor = el('button', 'ed-pick', 'minor');
    lgMinor.style.width='auto'; lgMinor.style.padding='3px 9px';
    lgMinor.title = 'Show or hide all secondary logos (Flask, Scapy, PySpark…)';
    lgMinor.addEventListener('click', function (e) {
      e.stopPropagation();
      var m = mediaStore();
      m.showSecondaryLogos = m.showSecondaryLogos === false;
      markDirty(); paintLogoToggles();
      note('Secondary logos ' + (m.showSecondaryLogos ? 'shown' : 'hidden') + '. Save + reload.');
    });
    logoRow.appendChild(lgOn); logoRow.appendChild(lgCol); logoRow.appendChild(lgMinor);
    panel.appendChild(logoRow);
    panel._lgOn = lgOn; panel._lgCol = lgCol; panel._lgMinor = lgMinor;

    var shRow = el('div', 'ed-size-row');
    shRow.appendChild(el('label', null, 'Logo shadow'));
    var shIn = el('input'); shIn.type = 'range';
    shIn.min = 0; shIn.max = 0.8; shIn.step = 0.02; shIn.value = 0.28;
    shIn.id = 'ed-logo-shadow';
    var shOut = el('span', 'ed-val', '0.28');
    shIn.addEventListener('input', function () {
      shOut.textContent = (+shIn.value).toFixed(2);
      mediaStore().logoShadow = +shIn.value;
      document.documentElement.style.setProperty('--logo-shadow', shIn.value);
      markDirty();
    });
    shRow.appendChild(shIn); shRow.appendChild(shOut);
    panel.appendChild(shRow);

    var syncRow = el('div', 'ed-row');
    var lgSync = el('button', 'ed-pick', 'sync logos from catalogue');
    lgSync.style.width='auto'; lgSync.style.padding='3px 9px';
    lgSync.title = 'Copy only the logos your resume actually uses into site-config.json';
    lgSync.addEventListener('click', function (e) { e.stopPropagation(); syncLogos(); });
    syncRow.appendChild(lgSync);
    panel.appendChild(syncRow);
    var syncNote = el('div', 'ed-note', ''); syncNote.id = 'ed-sync-note';
    panel.appendChild(syncNote);

    var mNote = el('div', 'ed-note',
      'Images resolve against ' + '\u201C' + 'assets/' + '\u201D' + '. Leave the image blank to use the emoji.');
    mNote.id = 'ed-media-note';
    panel.appendChild(mNote);

    /* sizes */
    panel.appendChild(el('div', 'ed-h', 'Size'));
    /* Wider ranges and clearer names: "Text" scales type, "Density"
       multiplies padding INSIDE a section, "Section gap" is the space
       between one section and the next. They were previously two sliders
       with near-identical labels and no way to reach small values. */
    addSlider(panel, 'textScale', 'Text size', 0.7, 1.8, 0.01);
    addSlider(panel, 'density',   'Inner density', 0.2, 2.0, 0.05);

    /* Gap BETWEEN sections, distinct from density (which is padding
       inside a section). */
    var gapRow = el('div', 'ed-size-row');
    gapRow.appendChild(el('label', null, 'Section gap'));
    var gap = el('input'); gap.type = 'range';
    /* 0 is a legitimate choice — sections butting together is a valid
       look — and 0.1rem steps make small adjustments possible. */
    gap.min = 0; gap.max = 12; gap.step = 0.1;
    /* Seed from the value actually in effect, so the slider agrees with
       what's on screen instead of reading 0 next to a visible gap. */
    var curGap = parseFloat(getComputedStyle(document.documentElement)
      .getPropertyValue('--block-pad-y')) || 4.5;
    gap.value = curGap;
    gap.id = 'ed-section-gap';
    var gapOut = el('span', 'ed-val', curGap.toFixed(2) + 'r');
    gap.addEventListener('input', function () {
      gapOut.textContent = (+gap.value).toFixed(2) + 'r';
      var cfg = ensure();
      if (!cfg.sizes) cfg.sizes = {};
      cfg.sizes.sectionGap = +gap.value;
      document.documentElement.style.setProperty('--block-pad-y', gap.value + 'rem');
      markDirty();
    });
    gapRow.appendChild(gap); gapRow.appendChild(gapOut);
    panel.appendChild(gapRow);

    /* per-section */
    panel.appendChild(el('div', 'ed-h', 'Per-section text'));
    ['Education', 'Internships', 'Projects', 'Skills', 'Accomplishments'].forEach(function (name) {
      addSectionSlider(panel, name);
    });

    statusEl = el('div', 'ed-note', 'No unsaved changes.');
    panel.appendChild(statusEl);

    var btns = el('div', 'ed-btns');
    var save = el('button', 'primary', 'Save');
    save.addEventListener('click', saveConfig);
    var revert = el('button', null, 'Revert');
    revert.addEventListener('click', revertConfig);
    var close = el('button', null, 'Close');
    close.addEventListener('click', hide);
    btns.appendChild(save); btns.appendChild(revert); btns.appendChild(close);
    panel.appendChild(btns);

    /* The panel itself drags by its top edge, so it can be moved clear of
       whatever you're inspecting. */
    var grip = el('div', 'ed-grip', '\u2261  style editor');
    panel.insertBefore(grip, panel.firstChild);
    document.body.appendChild(panel);
    makeDraggable(panel, grip);
    groupIntoSections(panel);

    /* A separate, draggable window rather than a strip inside the item bar:
       a featured project renders as a wide multi-column row, and squeezing
       that into a 290px panel misrepresents both the tile's position and
       the text layout — which was the whole point of previewing. */
    pvwin = el('div', 'ed-pvwin'); pvwin.id = 'ed-pvwin';
    var bar = el('div', 'ed-pvwin-bar');
    bar.appendChild(el('b', null, 'Live preview'));
    var pvName = el('span'); pvName.id = 'ed-pvwin-name';
    bar.appendChild(pvName);
    var pvW = el('span', 'ed-pvwin-w'); pvW.id = 'ed-pvwin-w';
    bar.appendChild(pvW);
    var pvx = el('button', 'ed-pvwin-x', '\u00d7');
    pvx.addEventListener('click', function (e) {
      e.stopPropagation(); pvwin.classList.remove('open');
    });
    bar.appendChild(pvx);
    pvwin.appendChild(bar);
    var pvBody = el('div', 'ed-pvwin-body'); pvBody.id = 'ed-pvwin-body';
    pvwin.appendChild(pvBody);
    pvwin.appendChild(el('div', 'ed-pvwin-note',
      'Rendered with the real page styles at the real width. Nothing is saved yet.'));
    pvwin.addEventListener('click', function (e) { e.stopPropagation(); });
    pvwin.addEventListener('contextmenu', function (e) { e.stopPropagation(); });
    document.body.appendChild(pvwin);
    makeDraggable(pvwin, bar);

    /* Visible launcher — right-click alone is undiscoverable, so the dev
       build also gets a small button. Dev-only, never shipped. */
    var fab = el('button', 'ed-fab');
    fab.innerHTML = '<span class="ed-dot"></span>style editor';
    fab.title = 'Open the style editor (or right-click anywhere)';
    fab.addEventListener('click', function (e) {
      e.stopPropagation();
      if (panel.classList.contains('open')) { hide(); return; }
      var r = fab.getBoundingClientRect();
      show(Math.max(12, r.right - 290), Math.max(12, r.top - 460));
    });
    document.body.appendChild(fab);
  }

  function addSlider(parent, key, label, min, max, step) {
    var row = el('div', 'ed-row');
    row.appendChild(el('label', null, label));
    var r = el('input'); r.type = 'range';
    r.min = min; r.max = max; r.step = step; r.value = 1;
    r.dataset.sizeKey = key;
    var out = el('span', 'ed-val', '1.00');
    r.addEventListener('input', function () {
      out.textContent = (+r.value).toFixed(2);
      setSize(key, +r.value);
    });
    row.appendChild(r); row.appendChild(out);
    parent.appendChild(row);
  }

  function addSectionSlider(parent, name) {
    var row = el('div', 'ed-row');
    row.appendChild(el('label', null, name));
    var r = el('input'); r.type = 'range';
    r.min = 0.8; r.max = 1.4; r.step = 0.01; r.value = 1;
    r.dataset.sectionKey = name;
    var out = el('span', 'ed-val', '1.00');
    r.addEventListener('input', function () {
      out.textContent = (+r.value).toFixed(2);
      setSectionSize(name, +r.value);
    });
    row.appendChild(r); row.appendChild(out);
    parent.appendChild(row);
  }


  /* ---------- populate colour rows ---------- */
  /* A colour control: free picker + its own swatch popover, so presets and
     recents are reachable for every entry rather than only the last-focused
     one. Returns a fragment holding the row and its (hidden) popover. */
  function colorRow(key, value, onPick) {
    var wrap = el('div');
    var row = el('div', 'ed-row');
    row.appendChild(el('label', null, labelFor(key)));

    var inp = el('input'); inp.type = 'color';
    inp.dataset.varKey = key;
    inp.value = toHex(value);
    inp.title = '--' + key;
    row.appendChild(inp);

    /* The hex, editable. A picker alone hides the value you'd want to copy
       into a palette file or paste from a brand guide. */
    var hex = el('input'); hex.type = 'text';
    hex.className = 'ed-hex';
    hex.value = toHex(value);
    hex.spellcheck = false;
    hex.addEventListener('click', function (e) { e.stopPropagation(); });
    hex.addEventListener('input', function () {
      var v = hex.value.trim();
      if (!/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(v)) return;
      inp.value = toHex(v);
      onPick(toHex(v));
    });
    row.appendChild(hex);

    inp.addEventListener('input', function () {
      hex.value = inp.value;
      onPick(inp.value);
    });

    var toggle = el('button', 'ed-pick', '\u25be');
    toggle.title = 'Presets and recent colours';
    row.appendChild(toggle);
    wrap.appendChild(row);

    var pop = el('div', 'ed-pop');
    function swatches(title, list) {
      if (!list.length) return;
      pop.appendChild(el('div', 'ed-pop-h', title));
      var box = el('div', 'ed-sw');
      list.forEach(function (c) {
        var b = el('button');
        b.style.background = c; b.title = c;
        b.addEventListener('click', function (e) {
          e.stopPropagation();
          inp.value = toHex(c);
          onPick(c);
          pop.classList.remove('open');
        });
        box.appendChild(b);
      });
      pop.appendChild(box);
    }
    toggle.addEventListener('click', function (e) {
      e.stopPropagation();
      var wasOpen = pop.classList.contains('open');
      panel.querySelectorAll('.ed-pop').forEach(function (p) { p.classList.remove('open'); });
      if (wasOpen) return;
      pop.innerHTML = '';
      swatches('Presets', PRESETS);
      swatches('Recent', state.recent);
      pop.classList.add('open');
    });
    wrap.appendChild(pop);
    return wrap;
  }

  function paintColors() {
    var box = document.getElementById('ed-colors');
    if (!box) return;
    box.innerHTML = '';
    discoverVars().forEach(function (key) {
      box.appendChild(colorRow(key, cssVar(key), function (v) { setVar(key, v); }));
    });
  }

  function paintDomains() {
    var box = document.getElementById('ed-domains');
    if (!box) return;
    box.innerHTML = '';
    var pal = window.__domainPalette || {};
    var names = domainList();
    if (!names.length) {
      box.appendChild(el('div', 'ed-note', 'No domains parsed yet.'));
      return;
    }
    names.forEach(function (name) {
      var cfg = ensure();
      var current = (cfg.colors.domains && cfg.colors.domains[name]) || pal[name];
      box.appendChild(colorRow(name, current, function (v) { setDomainColor(name, v); }));
    });
  }



  /* ---------- emoji picker ----------
     Suggestions come from the selected target's own vocabulary: a project's
     title, domains, leaf topics and tech keywords are matched against each
     emoji's keyword list, so picking an icon for "Network Intrusion
     Detection" surfaces the shield and siren before anything else. */
  function targetKeywords(name) {
    var words = String(name || '').toLowerCase().split(/[^a-z0-9+#]+/);
    var data = window.__resumeData;
    if (data) {
      var p = (data.projects || []).filter(function (x) { return x.title === name; })[0];
      if (p) {
        [].concat(p.domains || [], p.leaves || [], p.stack || []).forEach(function (t) {
          words = words.concat(String(t).toLowerCase().split(/[^a-z0-9+#]+/));
        });
      }
    }
    return words.filter(function (w) { return w && w.length > 2; });
  }

  /* Terms that match a large share of the catalogue tell you nothing about
     which emoji fits — "systems" and "programming" appear everywhere, so an
     unweighted score buries the distinctive match (the shield for an
     intrusion-detection project) under generic tech icons. Weight each term
     by how rare it is. */
  var _idf = null;
  function termWeight(t) {
    if (!_idf) {
      _idf = {};
      var all = allEmoji();
      all.forEach(function (i) {
        var seen = {};
        i.k.split(/\s+/).forEach(function (k) {
          if (seen[k]) return; seen[k] = 1;
          _idf[k] = (_idf[k] || 0) + 1;
        });
      });
      _idf.__total = all.length || 1;
    }
    var df = 0;
    Object.keys(_idf).forEach(function (k) {
      if (k !== '__total' && (k === t || k.indexOf(t) === 0)) df += _idf[k];
    });
    if (!df) return 1;
    return Math.max(0.25, Math.log(_idf.__total / df) + 0.4);
  }

  function scoreEmoji(item, terms) {
    if (!terms.length) return 0;
    var keys = item.k.split(/\s+/);
    var score = 0;
    terms.forEach(function (t) {
      var w = termWeight(t);
      var best = 0;
      keys.forEach(function (k) {
        if (k === t) best = Math.max(best, 3);
        else if (k.indexOf(t) === 0 || t.indexOf(k) === 0) best = Math.max(best, 2);
        else if (k.indexOf(t) >= 0) best = Math.max(best, 1);
      });
      score += best * w;                 // rare terms dominate
    });
    return score;
  }

  function allEmoji() {
    var data = (window.ICON_CATALOG || {}).emoji;
    if (!data || !data.categories) return [];
    var out = [];
    data.categories.forEach(function (c) {
      c.items.forEach(function (i) { out.push({ e: i.e, k: i.k, cat: c.name }); });
    });
    return out;
  }

  function emojiGrid(list) {
    var grid = el('div', 'ed-emoji-grid');
    list.forEach(function (i) {
      var b = el('button', null, i.e);
      b.title = i.k.split(/\s+/).slice(0, 4).join(', ');
      b.addEventListener('click', function (ev) {
        ev.stopPropagation();
        var f = document.getElementById('ed-media-icon');
        if (f) f.value = i.e;
        var w = document.getElementById('ed-emoji-wrap');
        if (w) w.classList.remove('open');
        note('Selected ' + i.e + ' — press apply to use it.');
      });
      grid.appendChild(b);
    });
    return grid;
  }

  function renderEmoji(query) {
    var box = document.getElementById('ed-emoji-scroll');
    if (!box) return;
    box.innerHTML = '';
    var all = allEmoji();
    if (!all.length) {
      box.appendChild(el('div', 'ed-emoji-none',
        'icon catalogue missing from editor.js.'));
      return;
    }

    query = (query || '').trim().toLowerCase();

    if (query) {
      var terms = query.split(/\s+/);
      var hits = all.map(function (i) { return { i: i, s: scoreEmoji(i, terms) }; })
                    .filter(function (x) { return x.s > 0; })
                    .sort(function (a, b) { return b.s - a.s; })
                    .map(function (x) { return x.i; });
      if (!hits.length) {
        box.appendChild(el('div', 'ed-emoji-none', 'nothing matches "' + query + '"'));
        return;
      }
      box.appendChild(el('div', 'ed-pop-h', hits.length + ' matches'));
      box.appendChild(emojiGrid(hits));
      return;
    }

    /* No query: relevant-to-this-item first, then everything by category. */
    var sel = document.getElementById('ed-media-target');
    var name = sel ? sel.value : '';
    var terms = targetKeywords(name);
    var scored = all.map(function (i) { return { i: i, s: scoreEmoji(i, terms) }; })
                    .filter(function (x) { return x.s > 0; })
                    .sort(function (a, b) { return b.s - a.s; })
                    .slice(0, 16)
                    .map(function (x) { return x.i; });

    if (scored.length) {
      box.appendChild(el('div', 'ed-pop-h', 'Suggested for ' + name));
      box.appendChild(emojiGrid(scored));
    }
    ((window.ICON_CATALOG || {}).emoji || {categories:[]}).categories.forEach(function (c) {
      box.appendChild(el('div', 'ed-pop-h', c.name));
      box.appendChild(emojiGrid(c.items));
    });
  }

  /* ---------- icon / image editing ----------
     Targets are the five sections plus every parsed project. Values are
     stored in site-config.json under media.icons / media.images /
     media.alts, keyed by name, and applied on top of whatever resume.tex
     declares — so the LaTeX stays the canonical source and nothing here
     can corrupt it. */
  function mediaTargets() {
    var out = [{ type: 'section', name: 'Education' },
               { type: 'section', name: 'Internships' },
               { type: 'section', name: 'Projects' },
               { type: 'section', name: 'Skills' },
               { type: 'section', name: 'Accomplishments' }];
    var data = window.__resumeData;
    if (!data) return out;

    /* Individual entries, not just the section headings — a university or
       employer logo belongs on its own row, which needs a per-entry target.
       Names are the parsed institution / role strings, so they key the same
       way project titles do. */
    (data.education || []).forEach(function (e) {
      var n = e.institution || e.title;
      if (n) out.push({ type: 'education', name: n });
    });
    (data.internships || []).forEach(function (e) {
      var n = e.role || e.title;
      if (n) out.push({ type: 'internship', name: n });
    });
    (data.projects || []).forEach(function (p) {
      out.push({ type: 'project', name: p.title });
    });
    return out;
  }

  function fillMediaTargets() {
    var sel = document.getElementById('ed-media-target');
    if (!sel) return;
    sel.innerHTML = '';
    mediaTargets().forEach(function (t) {
      var PREFIX = { section: '\u00a7 ', education: '\u2014 edu: ',
                     internship: '\u2014 work: ', project: '\u00b7 ' };
      var o = el('option', null, (PREFIX[t.type] || '\u00b7 ') + t.name);
      o.value = t.name;
      sel.appendChild(o);
    });
    loadMediaFields();
  }

  function mediaStore() {
    var cfg = ensure();
    if (!cfg.media) cfg.media = {};
    if (!cfg.media.icons)  cfg.media.icons  = {};
    if (!cfg.media.images) cfg.media.images = {};
    if (!cfg.media.alts)   cfg.media.alts   = {};
    if (!cfg.media.sizes)  cfg.media.sizes  = {};
    if (!cfg.media.tileSizes) cfg.media.tileSizes = {};
    return cfg.media;
  }

  /* What resume.tex declared, so the fields show the effective value
     rather than looking empty when the LaTeX already sets an icon. */
  function baseMedia(name) {
    var data = window.__resumeData;
    if (!data) return {};
    var sm = (data.sectionMeta || {})[name];
    if (sm) return sm.attrs || {};
    var p = (data.projects || []).filter(function (x) { return x.title === name; })[0];
    if (p) return { icon: p.icon, image: p.image, alt: p.alt };
    /* Education / internship rows carry nothing from resume.tex today, so
       whatever the editor stores IS the value. */
    return {};
  }

  function loadMediaFields() {
    var sel = document.getElementById('ed-media-target');
    if (!sel || !sel.value) return;
    var name = sel.value, m = mediaStore(), base = baseMedia(name);
    var i = document.getElementById('ed-media-icon');
    var g = document.getElementById('ed-media-image');
    var a = document.getElementById('ed-media-alt');
    if (i) i.value = m.icons[name]  !== undefined ? m.icons[name]  : (base.icon  || '');
    if (g) g.value = m.images[name] !== undefined ? m.images[name] : (base.image || '');
    if (a) a.value = m.alts[name]   !== undefined ? m.alts[name]   : (base.alt   || '');
    var sz = document.getElementById('ed-media-size');
    if (sz) {
      var v = (m.sizes || {})[name];
      sz.value = v || 1.35;
      if (sz.nextSibling) sz.nextSibling.textContent = (+sz.value).toFixed(1);
    }
  }

  /* Three distinct intents, which an earlier version conflated:

       apply  - store exactly what the fields show. A blank field stores an
                explicit empty string, which HIDES the icon even when
                resume.tex declares one.
       hide   - shortcut for "explicitly nothing here".
       reset  - delete the override entirely, so the resume.tex value
                applies again.

     Deleting an override is NOT the same as removing an icon: if the LaTeX
     sets an icon, dropping the override just restores it. */
  function applyMedia() {
    var sel = document.getElementById('ed-media-target');
    if (!sel || !sel.value) return;
    var name = sel.value, m = mediaStore();
    m.icons[name]  = (document.getElementById('ed-media-icon')  || {}).value || '';
    m.images[name] = (document.getElementById('ed-media-image') || {}).value || '';
    m.alts[name]   = (document.getElementById('ed-media-alt')   || {}).value || '';
    markDirty();
    var base = baseMedia(name);
    var hiding = !m.icons[name] && !m.images[name] && (base.icon || base.image);
    note(hiding
      ? 'Hiding the icon on "' + name + '" (resume.tex sets one). Save + reload.'
      : 'Applied to "' + name + '". Save, then reload to see it render.');
  }

  function hideMedia() {
    var sel = document.getElementById('ed-media-target');
    if (!sel || !sel.value) return;
    var name = sel.value, m = mediaStore();
    m.icons[name] = ''; m.images[name] = '';        // explicit "nothing"
    ['ed-media-icon', 'ed-media-image'].forEach(function (id) {
      var f = document.getElementById(id); if (f) f.value = '';
    });
    markDirty();
    note('"' + name + '" will show no icon. Save, then reload.');
  }

  function resetMedia() {
    var sel = document.getElementById('ed-media-target');
    if (!sel || !sel.value) return;
    var name = sel.value, m = mediaStore();
    delete m.icons[name]; delete m.images[name]; delete m.alts[name];
    loadMediaFields();                              // show the resume.tex value
    markDirty();
    var base = baseMedia(name);
    note((base.icon || base.image)
      ? 'Override cleared — resume.tex value (' + (base.icon || base.image) + ') applies again.'
      : 'Override cleared — resume.tex sets nothing for "' + name + '".');
  }

  /* Print the exact comment-block lines, so a choice made here can be
     promoted into resume.tex and become canonical. */
  function copyMediaSnippet() {
    var sel = document.getElementById('ed-media-target');
    if (!sel || !sel.value) return;
    var name = sel.value;
    var icon  = (document.getElementById('ed-media-icon')  || {}).value || '';
    var image = (document.getElementById('ed-media-image') || {}).value || '';
    var alt   = (document.getElementById('ed-media-alt')   || {}).value || '';
    var lines = ['\\begin{comment}'];
    if (icon)  lines.push('icon: ' + icon);
    if (image) lines.push('image: ' + image);
    if (alt)   lines.push('alt: ' + alt);
    lines.push('\\end{comment}');
    var snippet = lines.join('\n');
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(snippet).then(function () {
        note('Copied — paste above \\section*{' + name + '} in resume.tex');
      }, function () { console.log(snippet); note('Copy blocked; snippet logged to console.'); });
    } else {
      console.log(snippet);
      note('Clipboard unavailable; snippet logged to console.');
    }
  }

  function note(msg) {
    var n = document.getElementById('ed-media-note');
    if (n) n.textContent = msg;
  }

  /* Switch the page theme and re-read every colour, so the panel always
     reflects the set being edited. Overrides are stored per theme, so day
     and night are managed independently. */
  function setTheme(t) {
    /* Drive the page's own toggle: it switches the theme-light/theme-dark
       CLASS the stylesheets key off, keeps data-theme in step, and clears
       the other theme's inline variable overrides (applySiteConfig).
       Setting data-theme alone left the page painted in the old palette
       while edits silently went into the other set — day and night looked
       like one shared palette. */
    var btn = document.getElementById(t === 'dark' ? 'btn-night' : 'btn-day');
    if (btn) {
      btn.click();
    } else {
      var root = document.documentElement;
      root.classList.remove('theme-light', 'theme-dark');
      root.classList.add('theme-' + t);
      root.setAttribute('data-theme', t);
      try { localStorage.setItem('rs-theme', t); } catch (e) {}
    }
    setTimeout(syncEditorToTheme, 60);
  }

  /* After the page theme changes — via the editor's day/night buttons OR
     the site's own toggle — re-apply unsaved colour edits for the now
     current theme (they exist only in state.config) and repaint the panel
     so the swatches show the set actually being edited. */
  function syncEditorToTheme() {
    var t = theme();
    var colors = ((state.config || {}).colors || {});
    /* Unsaved edits from the other theme leave inline variables the page's
       own switch can't know about (it only clears keys in the SAVED
       config). Clear every key of the other set, then apply this set —
       keys present in both come straight back with this theme's value. */
    var stale = colors[t === 'dark' ? 'light' : 'dark'] || {};
    Object.keys(stale).forEach(function (k) {
      if (k.charAt(0) === '_') return;
      document.documentElement.style.removeProperty('--' + k);
    });
    var themed = colors[t] || {};
    Object.keys(themed).forEach(function (k) {
      if (k.charAt(0) === '_') return;
      document.documentElement.style.setProperty('--' + k, themed[k]);
    });
    paintColors();
    paintThemeState();
  }

  function paintThemeState() {
    var cur = theme();
    var n = document.getElementById('ed-theme-note');
    if (n) {
      var cfg = state.config || {};
      var setFor = function (k) {
        var o = ((cfg.colors || {})[k]) || {};
        return Object.keys(o).filter(function (x) { return x.charAt(0) !== '_'; }).length;
      };
      n.textContent = 'Editing ' + (cur === 'dark' ? 'night' : 'day') +
        '. Overrides — day: ' + setFor('light') + ', night: ' + setFor('dark') + '.';
    }
    panel.querySelectorAll('.ed-pick').forEach(function (b) {
      if (b.textContent === 'day' || b.textContent === 'night') {
        var on = (b.textContent === 'night') === (cur === 'dark');
        b.style.background = on ? 'var(--accent)' : 'transparent';
        b.style.color = on ? '#fff' : 'inherit';
      }
    });
  }

  /* Copy ONLY the logos whose terms appear in resume.tex into
     site-config.json. Visitors download that file anyway, so the selected
     subset costs no extra request — and the full catalogue stays out of
     their browser entirely. */
  function normTerm(s) {
    return String(s || '').toLowerCase().replace(/[\s._/-]+/g, '').trim();
  }
  function syncLogos() {
    var cat = (window.ICON_CATALOG || {}).logos;
    var out = document.getElementById('ed-sync-note');
    if (!cat) { if (out) out.textContent = 'icon catalogue unavailable.'; return; }

    var data = window.__resumeData;
    if (!data) { if (out) out.textContent = 'resume not parsed yet.'; return; }

    /* Scan BOTH project tech chips and the Tools section — a term like Git
       or MongoDB may appear only in skills, and would otherwise never get a
       logo even though the catalogue has one. */
    var terms = {};
    (data.projects || []).forEach(function (p) {
      (p.stack || []).forEach(function (t) { terms[normTerm(t)] = true; });
    });
    (data.skills || []).forEach(function (s) {
      (s.items || []).forEach(function (t) {
        terms[normTerm(t)] = true;
        // "C/C++" and "Linux Shell" are compound labels — index the parts too
        String(t).split(/[\/,&]+/).forEach(function (part) {
          if (part.trim()) terms[normTerm(part)] = true;
        });
      });
    });

    var picked = cat.filter(function (l) {
      if (terms[normTerm(l.n)]) return true;
      return (l.match || []).some(function (m) { return terms[normTerm(m)]; });
    }).map(function (l) {
      return { n: l.n, t: l.t, c: l.c, d: l.d, match: l.match };
    });

    ensure().logos = picked;
    markDirty();
    var bytes = JSON.stringify(picked).length;
    var prim = picked.filter(function (l) { return l.t === 1; }).length;
    if (out) {
      out.textContent = picked.length + ' logos matched (' + prim + ' primary, ' +
        (picked.length - prim) + ' secondary) \u2014 ' + Math.round(bytes / 1024) +
        ' KB into site-config.json. Save to write.';
    }
  }

  function paintMiscToggles() {
    var m = (state.config && state.config.media) || {};
    if (panel._noEmoji) {
      var on = m.noEmoji === true;
      panel._noEmoji.style.background = on ? 'var(--accent)' : 'transparent';
      panel._noEmoji.style.color = on ? '#fff' : 'inherit';
    }
    if (panel._monoEmoji) {
      var mo = m.monoEmoji === true;
      panel._monoEmoji.style.background = mo ? 'var(--accent)' : 'transparent';
      panel._monoEmoji.style.color = mo ? '#fff' : 'inherit';
    }
    if (panel._autoSh) {
      var au = m.autoShadow !== false;
      panel._autoSh.style.background = au ? 'var(--accent)' : 'transparent';
      panel._autoSh.style.color = au ? '#fff' : 'inherit';
    }
    if (panel._poOn) {
      var p = m.showPortrait !== false && !!m.portrait;
      panel._poOn.style.background = p ? 'var(--accent)' : 'transparent';
      panel._poOn.style.color = p ? '#fff' : 'inherit';
    }
  }

  /* One toggle per entry, so anything can be hidden from the site without
     deleting it from resume.tex. */
  /* Every hidden thing, whatever hid it, with a one-click restore. */
  /* One row per domain: click to toggle its presence in the top-bar menu. */
  function paintNavList() {
    var box = document.getElementById('ed-navlist');
    if (!box) return;
    box.innerHTML = '';
    var d = window.__resumeData;
    if (!d || !d.projects) {
      box.appendChild(el('div', 'ed-note', 'waiting for resume\u2026'));
      return;
    }
    var f = filtersStore();
    if (!f.hiddenNav) f.hiddenNav = {};

    var seen = {}, domains = [];
    d.projects.forEach(function (p) {
      (p.domains || []).forEach(function (dom) {
        if (!seen[dom]) { seen[dom] = 1; domains.push(dom); }
      });
    });
    domains.sort();

    box.appendChild(el('div', 'ed-note',
      'Entries come from the topics: lines in resume.tex. Hiding one ' +
      'affects the menu only \u2014 the filter rail has its own switch.'));

    domains.forEach(function (dom) {
      var key = 'domain:' + dom;
      var b = el('button');
      b.style.cssText = 'width:100%;margin-bottom:3px;font-size:10.5px;text-align:left;' +
        'padding:4px 8px;border:1px solid var(--rule);border-radius:6px;' +
        'background:transparent;color:inherit;cursor:pointer;';
      function paint() {
        var off = f.hiddenNav[key] === true;
        b.textContent = (off ? '\u2717  ' : '\u2713  ') + dom;
        b.style.opacity = off ? '0.45' : '1';
      }
      b.addEventListener('click', function (e) {
        e.stopPropagation();
        f.hiddenNav[key] = !f.hiddenNav[key];
        if (!f.hiddenNav[key]) delete f.hiddenNav[key];
        markDirty(); paint();
        document.querySelectorAll('.nav-sub-link').forEach(function (a) {
          if (a.getAttribute('data-filter-domain') === dom) {
            a.style.display = f.hiddenNav[key] ? 'none' : '';
          }
        });
      });
      paint();
      box.appendChild(b);
    });
  }

  function paintHiddenList() {
    var box = document.getElementById('ed-hidden');
    if (!box) return;
    box.innerHTML = '';
    var m = mediaStore();
    var rows = [];
    Object.keys(m.hiddenEntries || {}).forEach(function (n) {
      if (m.hiddenEntries[n]) rows.push({ name: n, kind: 'entry' });
    });
    Object.keys(m.hiddenCards || {}).forEach(function (n) {
      if (m.hiddenCards[n]) rows.push({ name: n, kind: 'card' });
    });
    if (!rows.length) {
      box.appendChild(el('div', 'ed-note', 'Nothing hidden.'));
      return;
    }
    box.appendChild(el('div', 'ed-note', rows.length + ' hidden \u2014 click to restore'));
    rows.forEach(function (r) {
      var b = el('button');
      b.style.cssText = 'width:100%;margin-bottom:3px;font-size:10.5px;text-align:left;' +
        'padding:4px 8px;border:1px dashed var(--rule);border-radius:6px;' +
        'background:transparent;color:inherit;cursor:pointer;opacity:.75;';
      b.textContent = '\u21ba  ' + r.name + '  (' + r.kind + ')';
      b.addEventListener('click', function (e) {
        e.stopPropagation();
        if (r.kind === 'entry') delete m.hiddenEntries[r.name];
        else delete m.hiddenCards[r.name];
        markDirty();
        document.querySelectorAll('[data-entry], [data-title]').forEach(function (el2) {
          var nm = el2.getAttribute('data-entry') || el2.getAttribute('data-title');
          if (nm === r.name) el2.style.display = '';
        });
        paintHiddenList();
        paintEntryToggles();
        note('Restored "' + r.name + '". Save to keep it.');
      });
      box.appendChild(b);
    });
  }

  function paintEntryToggles() {
    var box = document.getElementById('ed-entries');
    if (!box) return;
    box.innerHTML = '';
    var d = window.__resumeData;
    if (!d) { box.appendChild(el('div', 'ed-note', 'waiting for resume…')); return; }
    var m = mediaStore();
    if (!m.hiddenEntries) m.hiddenEntries = {};

    function group(label, names) {
      if (!names.length) return;
      box.appendChild(el('div', 'ed-group-label', label));
      names.forEach(function (n) {
        var b = el('button', 'ed-btn');
        b.style.cssText = 'width:100%;margin-bottom:3px;font-size:10.5px;text-align:left;' +
          'padding:4px 8px;border:1px solid var(--rule);border-radius:6px;' +
          'background:transparent;color:inherit;cursor:pointer;';
        function paint() {
          var off = m.hiddenEntries[n] === true;
          b.textContent = (off ? '\u2717 ' : '\u2713 ') + n;
          b.style.opacity = off ? '0.45' : '1';
        }
        b.addEventListener('click', function (e) {
          e.stopPropagation();
          m.hiddenEntries[n] = !m.hiddenEntries[n];
          markDirty(); paint(); paintHiddenList();
          document.querySelectorAll('[data-entry], [data-title]').forEach(function (el2) {
            var nm = el2.getAttribute('data-entry') || el2.getAttribute('data-title');
            if (nm === n) el2.style.display = m.hiddenEntries[n] ? 'none' : '';
          });
        });
        paint();
        box.appendChild(b);
      });
    }
    group('Education', (d.education || []).map(function (e) { return e.institution || e.title; }));
    group('Internships', (d.internships || []).map(function (e) { return e.title; }));
    group('Projects', (d.projects || []).map(function (p) { return p.title; }));
  }

  function paintLogoToggles() {
    var m = (state.config && state.config.media) || {};
    if (panel._lgOn) {
      var on = m.showTechLogos !== false;
      panel._lgOn.style.background = on ? 'var(--accent)' : 'transparent';
      panel._lgOn.style.color = on ? '#fff' : 'inherit';
    }
    if (panel._lgCol) {
      var col = m.techLogoColor !== false;
      panel._lgCol.style.background = col ? 'var(--accent)' : 'transparent';
      panel._lgCol.style.color = col ? '#fff' : 'inherit';
    }
    if (panel._lgMinor) {
      var mi = m.showSecondaryLogos !== false;
      panel._lgMinor.style.background = mi ? 'var(--accent)' : 'transparent';
      panel._lgMinor.style.color = mi ? '#fff' : 'inherit';
    }
  }

  function ensureText() {
    var cfg = ensure();
    if (!cfg.text) cfg.text = {};
    return cfg.text;
  }

  /* Push text edits to the live page so you see them before saving. */
  function applyTextLive() {
    var t = (state.config && state.config.text) || {};
    if (t.heroName) {
      var h1 = document.querySelector('h1');
      if (h1) {
        var parts = String(t.heroName).split(/\s+/);
        var last = parts.length > 1 ? parts.pop() : '';
        h1.innerHTML = parts.join(' ') +
          (last ? '<br><span class="italic">' + last + '</span>' : '');
      }
    }
    if (t.lede !== undefined) {
      var l = document.getElementById('hero-lede');
      if (l) l.textContent = t.lede;
    }
    if (Array.isArray(t.about)) {
      var box = document.getElementById('about-copy');
      if (box) {
        box.querySelectorAll('p').forEach(function (p) { p.remove(); });
        t.about.forEach(function (para) {
          var p = document.createElement('p');
          p.textContent = para;
          box.appendChild(p);
        });
      }
    }
    if (Array.isArray(t.meta) && t.meta.length) {
      var mbox = document.querySelector('[data-entry="Meta lines"]') ||
                 document.getElementById('hero-meta');
      if (mbox) {
        mbox.innerHTML = '';
        t.meta.forEach(function (s) {
          var sp = document.createElement('span');
          sp.textContent = s;
          mbox.appendChild(sp);
        });
      }
    }
    if (Array.isArray(t.corner) && t.corner.length) {
      var cbox = document.querySelector('[data-entry="Availability"]') ||
                 document.querySelector('#hero .corner, .hero .corner, .corner');
      if (cbox) {
        cbox.textContent = t.corner[0];
        if (t.corner.length > 1) {
          cbox.appendChild(document.createElement('br'));
          var bb = document.createElement('b');
          t.corner.slice(1).forEach(function (s, i) {
            if (i) bb.appendChild(document.createElement('br'));
            bb.appendChild(document.createTextNode(s));
          });
          cbox.appendChild(bb);
        }
      }
    }
  }

  /* A full-window LaTeX editor. resume.tex generates the PDF, so the
     server refuses obviously-broken content and snapshots every save. */
  function openTexEditor(findText) {
    openSourceEditor({
      url: 'assets/resume.tex',
      label: 'assets/resume.tex',
      save: '/__save-tex',
      find: findText
    });
  }

  function openHtmlEditor(findText) {
    openSourceEditor({
      url: 'index.html',
      label: 'index.html',
      save: '/__save-html',
      find: findText
    });
  }

  /* One editor for both source files. `find` scrolls to and selects the
     first occurrence of that text, which is what makes "edit this item"
     land somewhere useful instead of at line 1 of a 700-line file. */
  var docwin = null;

  /* Source editing gets its own window so it can sit beside the preview
     rather than replacing it — you usually want to see both. */
  function openSourceEditor(opts) {
    if (!docwin) {
      docwin = el('div', 'ed-doc');
      var dbar = el('div', 'ed-pvwin-bar');
      dbar.appendChild(el('b', null, 'Source'));
      var dname = el('span'); dname.id = 'ed-doc-name';
      dbar.appendChild(dname);
      var dx = el('button', 'ed-pvwin-x', '\u00d7');
      dx.addEventListener('click', function (e) {
        e.stopPropagation(); docwin.classList.remove('open');
      });
      dbar.appendChild(dx);
      docwin.appendChild(dbar);
      var dbody = el('div', 'ed-pvwin-body'); dbody.id = 'ed-doc-body';
      docwin.appendChild(dbody);
      docwin.addEventListener('click', function (e) { e.stopPropagation(); });
      docwin.addEventListener('contextmenu', function (e) { e.stopPropagation(); });
      document.body.appendChild(docwin);
      makeDraggable(docwin, dbar);
    }
    var body = document.getElementById('ed-doc-body');
    var label = document.getElementById('ed-doc-name');
    if (label) label.textContent = opts.label;
    body.innerHTML = '';

    var ta = el('textarea');
    ta.style.cssText = 'width:100%;height:52vh;font-family:var(--mono,monospace);' +
      'font-size:11.5px;line-height:1.5;padding:10px;border:1px solid var(--rule,#ccc);' +
      'border-radius:8px;background:var(--bg-soft,#fafafa);color:inherit;resize:vertical;';
    ta.value = 'loading…';
    ta.addEventListener('click', function (e) { e.stopPropagation(); });
    body.appendChild(ta);

    var bar = el('div', 'ed-row');
    bar.style.marginTop = '10px';
    var stat = el('span', 'ed-note', '');
    var save = el('button', 'ed-pick', 'save ' + opts.label);
    save.style.width = 'auto'; save.style.padding = '5px 12px';
    save.addEventListener('click', function (e) {
      e.stopPropagation();
      stat.textContent = 'saving…';
      fetch(opts.save, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(opts.asSource
          ? { path: opts.asSource, text: ta.value }
          : { text: ta.value })
      }).then(function (r) { return r.json(); }).then(function (res) {
        stat.textContent = res.ok
          ? 'Saved. Backup: ' + (res.backup || 'none') + '. Reload to re-parse.'
          : 'NOT saved — ' + (res.error || 'unknown');
      });
    });
    bar.appendChild(save);
    bar.appendChild(stat);
    body.appendChild(bar);

    fetch(opts.url, { cache: 'no-store' })
      .then(function (r) { return r.text(); })
      .then(function (t) {
        ta.value = t;
        if (!opts.find) return;
        /* Scroll to the entry. Try the whole string, then progressively
           shorter prefixes — a title in the LaTeX often carries markup the
           parsed name doesn't have. */
        var probes = [opts.find, opts.find.split(' ').slice(0, 4).join(' '),
                      opts.find.split(' ').slice(0, 2).join(' ')];
        for (var i = 0; i < probes.length; i++) {
          var at = t.indexOf(probes[i]);
          if (at < 0) continue;
          ta.focus();
          ta.setSelectionRange(at, at + probes[i].length);
          /* Approximate the scroll position from the line number. */
          var line = t.slice(0, at).split('\n').length;
          ta.scrollTop = Math.max(0, (line - 6) * 17);
          stat.textContent = 'jumped to line ' + line;
          return;
        }
        stat.textContent = 'could not locate "' + opts.find + '" in this file';
      })
      .catch(function () { ta.value = '(could not load ' + opts.url + ')'; });

    docwin.classList.add('open');
    if (!docwin.style.left) { docwin.style.left = '60px'; docwin.style.top = '120px'; }
  }

  /* ---------- mutations ---------- */
  function ensure() {
    if (!state.config) {
      state.config = { colors: { light: {}, dark: {}, recent: [] },
                       sizes: {}, sections: {}, media: {} };
      /* Baseline the skeleton too: if the config fetch never completed,
         only keys the user actually edits should reach the disk file. */
      state.baseline = JSON.parse(JSON.stringify(state.config));
    }
    if (!state.config.colors) state.config.colors = { light: {}, dark: {}, recent: [], domains: {} };
    if (!state.config.colors.domains) state.config.colors.domains = {};
    if (!state.config.colors[theme()]) state.config.colors[theme()] = {};
    if (!state.config.sizes)    state.config.sizes = {};
    if (!state.config.logos)    state.config.logos = [];
    if (!state.config.text)     state.config.text = {};
    if (!state.config.sections) state.config.sections = {};
    return state.config;
  }

  /* Generic CSS-variable setter — used by every discovered colour and by
     the non-colour ones like line opacity. */
  function setVar(key, value) {
    var cfg = ensure();
    cfg.colors[theme()][key] = value;
    document.documentElement.style.setProperty('--' + key, value);
    if (/^#/.test(value)) pushRecent(value);
    markDirty();
  }

  /* Domain colours live outside the light/dark split: a domain's hue should
     be the same in both themes, only the surrounding page changes. */
  function setDomainColor(name, value) {
    var cfg = ensure();
    if (!cfg.colors.domains) cfg.colors.domains = {};
    cfg.colors.domains[name] = value;
    if (window.__domainPalette) window.__domainPalette[name] = value;
    pushRecent(value);
    markDirty();
    repaintDomainUsage(name, value);
  }

  /* Re-tint everything already on the page that uses this domain's colour,
     so the change is visible without a reload: filter buttons, chips,
     card edges and the connector lines. */
  function repaintDomainUsage(name, value) {
    document.querySelectorAll('.pf-btn[data-type="domain"][data-val="' + name + '"]')
      .forEach(function (b) {
        if (b.style.background && b.style.background !== 'var(--bg-soft)') {
          b.style.background = value; b.style.borderColor = value;
        }
      });
    document.querySelectorAll('.pc-topic').forEach(function (c) {
      if (c.textContent.trim() === name) {
        c.style.background = value + '22';
        c.style.color = value;
      }
    });
    if (window.__pfRedraw) window.__pfRedraw();
  }

  function applySwatch(c) {
    /* Apply a preset to whichever colour input was focused last, else accent */
    var target = panel.querySelector('input[type=color]:focus') ||
                 panel.querySelector('input[data-var-key="accent"]');
    if (!target) return;
    target.value = c;
    setVar(target.dataset.varKey, c);
  }
  function pushRecent(c) {
    var i = state.recent.indexOf(c);
    if (i >= 0) state.recent.splice(i, 1);
    state.recent.unshift(c);
    state.recent = state.recent.slice(0, 16);
    ensure().colors.recent = state.recent;
    paintRecent();
  }
  function paintRecent() {
    var box = document.getElementById('ed-recent');
    if (!box) return;
    box.innerHTML = '';
    state.recent.forEach(function (c) {
      var b = el('button'); b.style.background = c; b.title = c;
      b.addEventListener('click', function () { applySwatch(c); });
      box.appendChild(b);
    });
  }
  function setSize(key, val) {
    ensure().sizes[key] = val;
    document.documentElement.style.setProperty(
      key === 'textScale' ? '--text-scale' : '--density', String(val));
    markDirty();
  }
  function setSectionSize(name, val) {
    var cfg = ensure();
    if (!cfg.sections[name]) cfg.sections[name] = {};
    cfg.sections[name].textScale = val;
    var MAP = { 'Education': 'education', 'Internships': 'work', 'Projects': 'projects-all',
                'Skills': 'skills', 'Accomplishments': 'accomplishments' };
    var target = document.getElementById(MAP[name]);
    if (target) target.style.setProperty('--text-scale', String(val));
    markDirty();
  }
  function markDirty() {
    state.dirty = true;
    if (statusEl) {
      statusEl.className = 'ed-note ed-dirty';
      statusEl.textContent = 'Unsaved changes — Save writes site-config.json.';
    }
  }

  /* ---------- palette switching ---------- */
  function switchStyle(name) {
    var link = document.getElementById('main-style') ||
               document.querySelector('link[rel=stylesheet]');
    if (!link) return;
    var href = (name === 'default') ? 'style.css' : 'style-' + name + '.css';

    /* Recover rather than render unstyled if the file isn't there. */
    link.onerror = function () {
      if (statusEl) {
        statusEl.className = 'ed-note ed-dirty';
        statusEl.textContent = href + ' not found — reverted to style.css';
      }
      try { localStorage.removeItem('rs-style'); } catch (e) {}
      link.href = 'style.css';
    };
    link.href = href;

    /* Persist, so a reload doesn't silently snap back to a different
       palette than the one shown in this dropdown. */
    try {
      if (name === 'default') localStorage.removeItem('rs-style');
      else localStorage.setItem('rs-style', name);
    } catch (e) {}

    setTimeout(syncFromComputed, 120);   // let the new sheet apply
  }
  function syncFromComputed() {
    paintColors();
    paintDomains();
  }

  /* ---------- persistence ---------- */
  /* Apply onto `disk` only the keys that changed between `base` (the
     snapshot taken when this tab loaded the config) and `edited` (the
     current in-memory state). Everything this tab did NOT touch keeps its
     on-disk value. Without this, Save wrote the whole stale snapshot and
     silently erased any change made outside the tab — another tab, a hand
     edit, a script — since the page was loaded. Arrays are replaced
     atomically; a key deleted in this tab is deleted on disk. */
  function mergeEdits(disk, base, edited) {
    var keys = {};
    Object.keys(base || {}).forEach(function (k) { keys[k] = 1; });
    Object.keys(edited || {}).forEach(function (k) { keys[k] = 1; });
    Object.keys(keys).forEach(function (k) {
      var b = (base || {})[k], e = (edited || {})[k];
      if (JSON.stringify(b) === JSON.stringify(e)) return;   // untouched here
      if (!(k in (edited || {}))) { delete disk[k]; return; }
      var isObj = function (x) {
        return x && typeof x === 'object' && !Array.isArray(x);
      };
      if (isObj(e) && isObj(disk[k])) {
        mergeEdits(disk[k], isObj(b) ? b : {}, e);
      } else {
        disk[k] = e;
      }
    });
    return disk;
  }

  function saveConfig() {
    var cfg = ensure();
    /* Re-read the file first so edits land on what's there NOW, not on
       what was there when this tab loaded. */
    fetch('site-config.json', { cache: 'no-store' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .catch(function () { return null; })
      .then(function (disk) {
        var body = (disk && state.baseline)
          ? mergeEdits(disk, state.baseline, cfg)
          : cfg;
        return fetch('/__save-config', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body)
        });
      })
      .then(function (r) { return r.json(); })
      .then(function (res) {
        state.dirty = false;
        statusEl.className = 'ed-note';
        statusEl.textContent = res.ok
          ? 'Saved. Backup: ' + (res.backup || 'none')
          : 'Save failed: ' + (res.error || 'unknown');
      })
      .catch(function (e) {
        statusEl.className = 'ed-note ed-dirty';
        statusEl.textContent = 'Save failed: ' + e.message;
      });
  }
  function revertConfig() {
    fetch('/__revert-config', { method: 'POST' })
      .then(function (r) { return r.json(); })
      .then(function (res) {
        statusEl.className = 'ed-note';
        statusEl.textContent = res.ok
          ? 'Reverted to ' + res.restored + '. Reloading…'
          : 'Revert failed: ' + (res.error || 'no backups');
        if (res.ok) setTimeout(function () { location.reload(); }, 700);
      });
  }

  function loadConfig() {
    fetch('site-config.json', { cache: 'no-store' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (j) {
        if (!j) return;
        state.config = j;
        /* Snapshot for diff-on-save: keys that don't differ from this
           baseline are left alone on disk (see mergeEdits). */
        state.baseline = JSON.parse(JSON.stringify(j));
        state.recent = (j.colors && j.colors.recent) || [];
        paintRecent();

        /* Re-apply saved colour overrides for the active theme so the panel
           and the page agree on what's currently set. */
        var themed = (j.colors && j.colors[theme()]) || {};
        Object.keys(themed).forEach(function (k) {
          if (k.charAt(0) === '_') return;
          document.documentElement.style.setProperty('--' + k, themed[k]);
        });
        var sh = (j.media || {}).logoShadow;
        var shEl = document.getElementById('ed-logo-shadow');
        if (shEl && sh !== undefined && sh !== null) {
          shEl.value = sh;
          if (shEl.nextSibling) shEl.nextSibling.textContent = (+sh).toFixed(2);
          document.documentElement.style.setProperty('--logo-shadow', String(sh));
        }
        var lo = themed['line-opacity'];
        var lr = document.getElementById('ed-lineop');
        if (lr && lo) { lr.value = lo; lr.nextSibling.textContent = (+lo).toFixed(2); }
        var t = j.text || {};
        var nEl = document.getElementById('ed-tx-name');
        var lEl = document.getElementById('ed-tx-lede');
        var aEl = document.getElementById('ed-tx-about');
        if (nEl && t.heroName) nEl.value = t.heroName;
        if (lEl && t.lede) lEl.value = t.lede;
        if (aEl && Array.isArray(t.about)) aEl.value = t.about.join('\n\n');
        paintColors();
        paintDomains();
        fillMediaTargets();
        paintThemeState();
        paintLogoToggles();
        paintMiscToggles();
        paintEntryToggles();
        paintHiddenList();
        paintNavList();
        var st = j.text && j.text.sectionTitles;
        if (st) panel.querySelectorAll('[data-title-key]').forEach(function (i) {
          if (st[i.dataset.titleKey]) i.value = st[i.dataset.titleKey];
        });
        var mm = j.media || {};
        var pI = document.getElementById('ed-portrait');
        if (pI && mm.portrait) pI.value = mm.portrait;
        var pS = document.getElementById('ed-portrait-size');
        if (pS && mm.portraitSize) { pS.value = mm.portraitSize;
          if (pS.nextSibling) pS.nextSibling.textContent = mm.portraitSize + 'px'; }
        var s = j.sizes || {};
        var g = document.getElementById('ed-section-gap');
        if (g && s.sectionGap !== undefined) {
          g.value = s.sectionGap;
          if (g.nextSibling) g.nextSibling.textContent = (+s.sectionGap).toFixed(2) + 'r';
          document.documentElement.style.setProperty('--block-pad-y', s.sectionGap + 'rem');
        }
        panel.querySelectorAll('input[data-size-key]').forEach(function (r) {
          var v = s[r.dataset.sizeKey];
          if (v) { r.value = v; r.nextSibling.textContent = (+v).toFixed(2); }
        });
      })
      .catch(function () {});
  }

  function loadStyles() {
    fetch('/__styles').then(function (r) { return r.json(); })
      .then(function (list) {
        state.styles = list || [];
        var sel = document.getElementById('ed-style');
        sel.innerHTML = '';
        var d = el('option', null, 'default (style.css)'); d.value = 'default';
        sel.appendChild(d);
        state.styles.forEach(function (n) {
          var o = el('option', null, n); o.value = n; sel.appendChild(o);
        });
        try {
          var cur = localStorage.getItem('rs-style');
          if (cur && state.styles.indexOf(cur) >= 0) sel.value = cur;
        } catch (e) {}
      })
      .catch(function () {});
  }

  /* Walk up from the clicked element to whatever named entity it belongs
     to — a project card, an education row, an internship, or a section. */
  function targetNameFromEvent(node) {
    for (var el = node; el && el !== document.body; el = el.parentNode) {
      if (!el.getAttribute) continue;
      /* Filter buttons carry their group and value as data attributes;
         the "+ N more" expander has no data-val and falls through. */
      if (el.classList && el.classList.contains('pf-btn') &&
          el.dataset && el.dataset.val) {
        return { name: el.dataset.val, kind: 'filter', ftype: el.dataset.type };
      }
      var t = el.getAttribute('data-title');            // project cards
      if (t) return { name: t, kind: 'project' };
      var m = el.getAttribute('data-entry');            // rows, cards, intro regions
      if (m) {
        /* Top-bar dropdown entries are tagged "Nav: <domain>" so they can be
           edited where they appear, rather than only via the filter rail. */
        if (m.indexOf('Nav: ') === 0) {
          return { name: m.slice(5), kind: 'nav' };
        }
        if (m === 'Title' || m === 'Tagline' || m === 'About' ||
            m === 'Meta lines' || m === 'Availability') {
          return { name: m, kind: 'intro' };
        }
        /* A tools-card span also carries data-entry; treat it as its own
           kind so the panel offers card-specific controls. */
        for (var c = el; c && c !== document.body; c = c.parentNode) {
          if (c.classList && c.classList.contains('skills-cluster')) {
            return { name: m, kind: 'card' };
          }
        }
        var kind = 'project';
        if (el.classList && el.classList.contains('timeline-row')) {
          kind = 'education';
        } else {
          /* Walk up rather than relying on closest(), which isn't available
             everywhere and can't be emulated in tests. */
          for (var a = el; a && a !== document.body; a = a.parentNode) {
            if (a.id === 'work') { kind = 'internship'; break; }
            if (a.id === 'education') { kind = 'education'; break; }
          }
        }
        return { name: m, kind: kind };
      }
      if (el.classList && el.classList.contains('block') && el.id) {
        var SEC = { 'education': 'Education', 'work': 'Internships',
                    'projects-all': 'Projects', 'skills': 'Skills',
                    'accomplishments': 'Accomplishments' };
        if (SEC[el.id]) return { name: SEC[el.id], kind: 'section' };
      }
    }
    return null;
  }

  function focusMediaTarget(name) {
    var sel = document.getElementById('ed-media-target');
    if (!sel) return;
    var found = false;
    for (var i = 0; i < sel.children.length; i++) {
      if (sel.children[i].value === name) { sel.value = name; found = true; break; }
    }
    if (!found) return;
    loadMediaFields();
    var lbl = document.getElementById('ed-scope');
    if (lbl) {
      lbl.textContent = 'Editing: ' + name;
      lbl.style.display = 'block';
    }
    if (sel.scrollIntoView) sel.scrollIntoView({ block: 'nearest' });
  }


  var pvwin = null;

  /* Drag by the title bar. Kept deliberately small — no resize handles,
     no persistence; it's a preview, not a workspace. */
  function makeDraggable(win, handle) {
    var ox = 0, oy = 0, dragging = false;
    handle.addEventListener('mousedown', function (e) {
      dragging = true;
      ox = e.clientX - win.offsetLeft;
      oy = e.clientY - win.offsetTop;
      win.dataset.moved = '1';
      e.preventDefault();
      e.stopPropagation();
    });
    document.addEventListener('mousemove', function (e) {
      if (!dragging) return;
      win.style.left = Math.max(4, e.clientX - ox) + 'px';
      win.style.top  = Math.max(4, e.clientY - oy) + 'px';
    });
    document.addEventListener('mouseup', function () { dragging = false; });
  }

  /* Rebuild the preview body as a faithful copy of the real entry: the
     same classes the page uses, so it inherits the same CSS and shows the
     tile in its true position rather than an approximation. */
  function renderPreviewWindow(name, kind) {
    if (!pvwin) return;
    var body = document.getElementById('ed-pvwin-body');
    var label = document.getElementById('ed-pvwin-name');
    if (!body) return;
    if (label) label.textContent = name;

    var m = mediaStore();
    var dir = (state.config && state.config.media && state.config.media.imageDir) || 'assets/';
    var file = m.images[name] !== undefined ? m.images[name] : (baseMedia(name).image || '');
    var emo  = m.icons[name]  !== undefined ? m.icons[name]  : (baseMedia(name).icon  || '');
    var alt  = m.alts[name]   !== undefined ? m.alts[name]   : (baseMedia(name).alt   || name);
    var tpx  = (m.tileSizes || {})[name] || 84;
    var esz  = (m.sizes || {})[name] || 1.35;

    function esc(s) {
      return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
        .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }
    var tile = file
      ? '<div class="entry-tile" style="width:' + tpx + 'px"><img src="' +
        esc(dir + file) + '" alt="' + esc(alt) + '"></div>'
      : '';
    var mark = (!file && emo)
      ? '<span class="row-mark" style="width:' + esz + 'em;height:' + esz +
        'em;font-size:' + (esz * 0.75) + 'em">' + esc(emo) + '</span>'
      : '';

    var data = window.__resumeData || {};
    var html;

    if (kind === 'education') {
      var e = (data.education || []).filter(function (x) {
        return (x.institution || x.title) === name; })[0] || {};
      html = '<div class="timeline-row' + (tile ? ' has-tile' : '') + '">' + tile +
             '<div class="when">' + esc(e.dates || '') + '</div>' +
             '<div class="what">' + mark + esc(name) +
               (e.degree ? '<small>' + esc(e.degree) + '</small>' : '') + '</div>' +
             '<div class="score">' + esc(e.score || '') + '</div></div>';
    } else if (kind === 'project' || kind === 'internship') {
      var p = (data.projects || []).filter(function (x) { return x.title === name; })[0] ||
              (data.internships || []).filter(function (x) { return x.title === name; })[0] || {};
      var bullets = (p.bullets || []).slice(0, 2)
        .map(function (b) { return '<li>' + esc(b) + '</li>'; }).join('');
      html = '<article class="work-item">' +
               '<span class="idx">01 / ' + (kind === 'internship' ? 'Intern' : 'Project') + '</span>' +
               '<div><h3>' + mark + esc(name) + '</h3>' +
                 (p.description ? '<p class="project-description">' + esc(p.description) + '</p>' : '') +
                 (bullets ? '<ul>' + bullets + '</ul>' : '') +
               '</div>' +
               '<div class="meta-right">' + tile + '</div>' +
             '</article>';
    } else if (kind === 'intro') {
      var t = (state.config && state.config.text) || {};
      var d2 = window.__resumeData || {};
      var intro = d2.intro || {};
      if (name === 'Title') {
        var nm = t.heroName || 'Rishabh Sahu';
        var bits = nm.split(/\s+/);
        var lastw = bits.length > 1 ? bits.pop() : '';
        html = '<h1 style="margin:0">' + esc(bits.join(' ')) +
               (lastw ? '<br><span class="italic">' + esc(lastw) + '</span>' : '') + '</h1>';
      } else if (name === 'Tagline') {
        html = '<p class="lede" style="margin:0">' +
               esc(t.lede || intro.tagline || '') + '</p>';
      } else if (name === 'Meta lines') {
        var mlines = Array.isArray(t.meta) && t.meta.length ? t.meta
          : Array.prototype.map.call(
              (document.getElementById('hero-meta') || {children: []}).children,
              function (s) { return s.textContent; });
        html = '<div class="meta">' +
               mlines.map(function (s) { return '<span>' + esc(s) + '</span>'; }).join('') +
               '</div>';
      } else if (name === 'Availability') {
        var clines = Array.isArray(t.corner) && t.corner.length ? t.corner
          : String((document.querySelector('#hero .corner, .hero .corner, .corner') ||
                    {innerText: ''}).innerText || '')
              .split(/\n/).map(function (s) { return s.trim(); }).filter(Boolean);
        html = '<div class="corner" style="position:static">' + esc(clines[0] || '') +
               (clines.length > 1
                 ? '<br><b>' + clines.slice(1).map(esc).join('<br>') + '</b>' : '') +
               '</div>';
      } else {
        var paras = Array.isArray(t.about) && t.about.length ? t.about : (intro.about || []);
        html = '<div class="about-grid"><div></div>' +
               paras.map(function (p) { return '<p>' + esc(p) + '</p>'; }).join('') +
               '</div>';
      }
    } else {
      html = '<div class="section-head"><h2>' + mark + esc(name) + '</h2></div>' + tile;
    }
    body.innerHTML = html;
    pvwin.classList.add('open');
    if (!pvwin.style.left) {
      pvwin.style.left = '24px';
      pvwin.style.top  = '80px';
    }
    /* Report the render width, since a featured project's layout depends on
       it — the point of the window is judging real proportions. Drag the
       bottom-right corner to resize. */
    var wEl = document.getElementById('ed-pvwin-w');
    if (wEl) {
      var px = pvwin.getBoundingClientRect().width;
      wEl.textContent = Math.round(px) + 'px wide \u2014 drag corner to resize';
    }
  }

  /* Which section an item belongs to, and everything else in it. */
  function sectionOfName(name) {
    var d = window.__resumeData || {};
    if ((d.education || []).some(function (e) { return (e.institution || e.title) === name; }))
      return 'Education';
    if ((d.internships || []).some(function (e) { return e.title === name; }))
      return 'Internships';
    if ((d.projects || []).some(function (p) { return p.title === name; }))
      return 'Projects';
    return '';
  }
  function namesInSection(sec) {
    var d = window.__resumeData || {};
    if (sec === 'Education')
      return (d.education || []).map(function (e) { return e.institution || e.title; });
    if (sec === 'Internships')
      return (d.internships || []).map(function (e) { return e.title; });
    if (sec === 'Projects')
      return (d.projects || []).map(function (p) { return p.title; });
    return [];
  }

  /* ---------- per-item panel ----------
     Builds a self-contained editor for whichever item was right-clicked:
     its emoji, image, alt text, mark size, and — for projects — its
     featured flag and domain colour. Everything that applies to that one
     item, and nothing that doesn't. */
  /* A dropdown entry edits one thing: whether it appears in the menu.
     Its text comes from the topics: lines in resume.tex, so there's
     nothing else here to change without editing that. */
  function openNavPanel(domain) {
    var box = document.getElementById('ed-item');
    if (!box) return;
    box.innerHTML = '';
    box.dataset.name = domain;

    var hd = el('div', 'ed-item-hd');
    hd.appendChild(el('span', 'ed-item-kind', 'nav entry'));
    hd.appendChild(el('span', null, 'Projects dropdown'));
    var close = el('button', 'ed-item-close', '\u00d7');
    close.addEventListener('click', function (e) {
      e.stopPropagation(); box.classList.remove('open');
    });
    hd.appendChild(close);
    box.appendChild(hd);
    box.appendChild(el('div', 'ed-item-name', domain));

    var f = filtersStore();
    if (!f.hiddenNav) f.hiddenNav = {};
    var key = 'domain:' + domain;

    var row = el('div', 'ed-row');
    row.appendChild(el('label', null, 'In dropdown'));
    var btn = el('button', 'ed-pick', '');
    btn.style.width = 'auto'; btn.style.padding = '3px 12px';
    function paint() {
      var off = f.hiddenNav[key] === true;
      btn.textContent = off ? 'hidden' : 'shown';
      btn.style.background = off ? 'transparent' : 'var(--accent)';
      btn.style.color = off ? 'inherit' : '#fff';
    }
    btn.addEventListener('click', function (e) {
      e.stopPropagation();
      f.hiddenNav[key] = !f.hiddenNav[key];
      if (!f.hiddenNav[key]) delete f.hiddenNav[key];
      markDirty(); paint(); paintNavList();
      document.querySelectorAll('.nav-sub-link').forEach(function (a) {
        if (a.getAttribute('data-filter-domain') === domain) {
          a.style.display = f.hiddenNav[key] ? 'none' : '';
        }
      });
    });
    paint();
    row.appendChild(btn);
    box.appendChild(row);

    box.appendChild(el('div', 'ed-note',
      'Source: assets/resume.tex \u2014 the topics: line of every project in ' +
      'this domain. The dropdown, the filter rail and the chips on each card ' +
      'all derive from it, so renaming a domain means editing those lines.'));

    var srcRow = el('div', 'ed-row');
    var openTex = el('button', 'ed-pick', 'find in resume.tex');
    openTex.style.width = 'auto'; openTex.style.padding = '3px 9px';
    openTex.addEventListener('click', function (e) {
      e.stopPropagation(); openTexEditor(domain);
    });
    srcRow.appendChild(openTex);
    box.appendChild(srcRow);

    box.appendChild(el('div', 'ed-note',
      'Hiding affects the menu only \u2014 projects and their chips stay. ' +
      'The filter rail has its own separate switch.'));

    box.classList.add('open');
    if (box.scrollIntoView) box.scrollIntoView({ block: 'nearest' });
  }

  function openItemPanel(name, kind) {
    var box = document.getElementById('ed-item');
    if (!box || !name) return;
    box.innerHTML = '';
    box.dataset.name = name;

    var KIND = { project: 'project', education: 'education',
                 internship: 'internship', section: 'section',
                 card: 'tool card', intro: 'page text' };
    var hd = el('div', 'ed-item-hd');
    hd.appendChild(el('span', 'ed-item-kind', KIND[kind] || 'item'));
    hd.appendChild(el('span', null, 'Edit this item'));
    var close = el('button', 'ed-item-close', '\u00d7');
    close.title = 'Close';
    close.addEventListener('click', function (e) {
      e.stopPropagation(); box.classList.remove('open');
    });
    hd.appendChild(close);
    box.appendChild(hd);
    box.appendChild(el('div', 'ed-item-name', name));

    var m = mediaStore(), base = baseMedia(name);
    var cur = {
      icon:  m.icons[name]  !== undefined ? m.icons[name]  : (base.icon  || ''),
      image: m.images[name] !== undefined ? m.images[name] : (base.image || ''),
      alt:   m.alts[name]   !== undefined ? m.alts[name]   : (base.alt   || ''),
      size:  (m.sizes || {})[name] || 1.35
    };

    function textRow(label, value, place, onInput) {
      var row = el('div', 'ed-row');
      row.appendChild(el('label', null, label));
      var inp = el('input'); inp.type = 'text'; inp.value = value || '';
      inp.placeholder = place || ''; inp.style.width = '108px';
      inp.addEventListener('click', function (e) { e.stopPropagation(); });
      inp.addEventListener('input', function () { onInput(inp.value); });
      row.appendChild(inp);
      box.appendChild(row);
      return inp;
    }

    var iconIn = textRow('Emoji', cur.icon, 'e.g. \ud83d\udee1',
      function (v) { m.icons[name] = v; markDirty(); updatePreview(); });

    var browseRow = el('div', 'ed-row');
    var browse = el('button', 'ed-pick', 'browse emoji');
    browse.style.width = 'auto'; browse.style.padding = '3px 9px';
    browse.addEventListener('click', function (e) {
      e.stopPropagation();
      var sel = document.getElementById('ed-media-target');
      if (sel) { sel.value = name; loadMediaFields(); }
      var w = document.getElementById('ed-emoji-wrap');
      if (w) { w.classList.add('open'); renderEmoji(''); w.scrollIntoView({ block: 'nearest' }); }
    });
    browseRow.appendChild(browse);
    box.appendChild(browseRow);

    /* Image field + a fetch button that actually loads the file and shows
       it, so a typo or a missing file is obvious here rather than after a
       save-and-reload cycle. */
    var imgIn = textRow('Image file', cur.image, 'iiit.png',
      function (v) { m.images[name] = v; markDirty(); });

    var thumbRow = el('div', 'ed-thumb-row');
    var thumb = el('div', 'ed-thumb');
    var pickBtn = el('button', 'ed-pick', 'choose\u2026');
    pickBtn.style.width = 'auto'; pickBtn.style.padding = '3px 9px';
    pickBtn.title = 'Pick from the files in assets/';
    pickBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      /* A browser can't read a directory, and a file <input> would hand
         back a sandboxed blob rather than a path the site can reference.
         So ask the dev server what's actually in assets/ and offer that. */
      fetch('/__images').then(function (r) { return r.json(); })
        .then(function (files) {
          var panelWrap = document.getElementById('ed-filepick');
          if (panelWrap) panelWrap.remove();
          var wrap = el('div', 'ed-pop open');
          wrap.id = 'ed-filepick';
          if (!files.length) {
            wrap.appendChild(el('div', 'ed-note',
              'No images in assets/ yet. Drop a file there, then press ' +
              'choose again. Paths are relative to assets/.'));
          } else {
            wrap.appendChild(el('div', 'ed-pop-h', files.length + ' in assets/'));
            files.forEach(function (f) {
              var b = el('button', 'ed-opt');
              b.style.cssText = 'display:block;width:100%;text-align:left;border:0;' +
                'background:transparent;color:inherit;font:inherit;font-size:10.5px;' +
                'padding:4px 6px;border-radius:4px;cursor:pointer;';
              b.textContent = f;
              b.addEventListener('click', function (ev) {
                ev.stopPropagation();
                imgIn.value = f;
                m.images[name] = f;
                markDirty();
                showThumb(f);
                wrap.remove();
              });
              wrap.appendChild(b);
            });
          }
          thumbRow.parentNode.insertBefore(wrap, thumbRow.nextSibling);
        });
    });

    var fetchBtn = el('button', 'ed-pick', 'preview');
    fetchBtn.style.width = 'auto'; fetchBtn.style.padding = '3px 9px';
    fetchBtn.title = 'Load the file and show it before applying';
    function showThumb(file) {
      thumb.innerHTML = '';
      if (!file) {
        var none = el('div', 'ed-thumb-msg', 'no image');
        thumb.appendChild(none); updatePreview(); return;
      }
      var dir = (state.config && state.config.media && state.config.media.imageDir) || 'assets/';
      var img = el('img');
      img.src = dir + file;
      img.alt = '';
      img.addEventListener('error', function () {
        thumb.innerHTML = '';
        thumb.appendChild(el('div', 'ed-thumb-msg', 'not found: ' + dir + file));
      });
      img.addEventListener('load', updatePreview);
      thumb.appendChild(img);
      if (box._tsRow) box._tsRow.style.display = 'flex';
    }
    fetchBtn.addEventListener('click', function (e) {
      e.stopPropagation(); showThumb(imgIn.value.trim());
    });
    thumbRow.appendChild(thumb);
    thumbRow.appendChild(pickBtn);
    thumbRow.appendChild(fetchBtn);
    box.appendChild(thumbRow);

    var altIn = textRow('Alt text', cur.alt, 'describes it',
      function (v) { m.alts[name] = v; markDirty(); updatePreview(); });

    /* Mark size, with live preview on the page. */
    var szRow = el('div', 'ed-size-row');
    szRow.appendChild(el('label', null, 'Mark size'));
    var sz = el('input'); sz.type = 'range';
    sz.min = 0.8; sz.max = 4; sz.step = 0.1; sz.value = cur.size;
    var szOut = el('span', 'ed-val', (+cur.size).toFixed(1));
    sz.addEventListener('input', function () {
      szOut.textContent = (+sz.value).toFixed(1);
      if (!m.sizes) m.sizes = {};
      m.sizes[name] = +sz.value;
      markDirty();
      document.querySelectorAll('[data-entry], [data-title]').forEach(function (row) {
        var n = row.getAttribute('data-entry') || row.getAttribute('data-title');
        if (n !== name) return;
        var mark = row.querySelector('.row-mark');
        if (mark) { mark.style.width = sz.value + 'em'; mark.style.height = sz.value + 'em'; }
      });
      updatePreview();
    });
    szRow.appendChild(sz); szRow.appendChild(szOut);
    box.appendChild(szRow);

    /* Tile size is in pixels and independent of the emoji size: an image
       renders as a block beside the entry, not as a glyph in the text, so
       sizing it in em against the text would be the wrong unit. */
    var tsRow = el('div', 'ed-size-row');
    tsRow.appendChild(el('label', null, 'Tile size'));
    var ts = el('input'); ts.type = 'range';
    ts.min = 40; ts.max = 200; ts.step = 4;
    ts.value = (m.tileSizes || {})[name] || 84;
    var tsOut = el('span', 'ed-val', ts.value + 'px');
    ts.addEventListener('input', function () {
      tsOut.textContent = ts.value + 'px';
      if (!m.tileSizes) m.tileSizes = {};
      m.tileSizes[name] = +ts.value;
      markDirty();
      document.querySelectorAll('[data-entry], [data-title]').forEach(function (row) {
        var n = row.getAttribute('data-entry') || row.getAttribute('data-title');
        if (n !== name) return;
        var t = row.querySelector('.entry-tile');
        if (t) t.style.width = ts.value + 'px';
      });
      updatePreview();
    });
    tsRow.appendChild(ts); tsRow.appendChild(tsOut);
    box.appendChild(tsRow);
    box._tsRow = tsRow;

    /* One size for the whole section. Mixed sizes within Education or
       Projects is what makes a set of crests look assorted rather than
       deliberate, and setting each one by hand is tedious. */
    var sec = sectionOfName(name);
    if (sec) {
      var applyRow = el('div', 'ed-row');
      var applyAll = el('button', 'ed-pick', 'apply size to all in ' + sec);
      applyAll.style.width = 'auto'; applyAll.style.padding = '3px 9px';
      applyAll.title = 'Give every item in this section the same tile and mark size';
      applyAll.addEventListener('click', function (e) {
        e.stopPropagation();
        var mm = mediaStore();
        if (!mm.sectionTiles) mm.sectionTiles = {};
        mm.sectionTiles[sec] = +ts.value;
        if (!mm.sizes) mm.sizes = {};
        /* Clear per-item overrides in this section so the section value is
           what actually applies — otherwise the button would appear to do
           nothing on items that already have one. */
        var cleared = 0;
        namesInSection(sec).forEach(function (n) {
          if (mm.tileSizes && mm.tileSizes[n] !== undefined) { delete mm.tileSizes[n]; cleared++; }
          mm.sizes[n] = +sz.value;
        });
        markDirty();
        note(sec + ': tiles set to ' + ts.value + 'px, marks to ' +
             (+sz.value).toFixed(1) + 'em' +
             (cleared ? ' (' + cleared + ' per-item override' + (cleared > 1 ? 's' : '') + ' cleared)' : '') +
             '. Save + reload.');
      });
      applyRow.appendChild(applyAll);
      box.appendChild(applyRow);
    }

    /* Intro regions edit prose, not marks — so the panel swaps to the
       matching text field rather than showing icon controls that don't
       apply. */
    if (kind === 'intro') {
      var t = ensureText();
      var introRow = el('div', 'ed-row');
      introRow.style.display = 'block';
      var ta = el('textarea');
      ta.rows = name === 'About' ? 8
              : name === 'Title' ? 1
              : (name === 'Meta lines' || name === 'Availability') ? 3 : 4;
      ta.style.cssText = 'width:100%;font-family:inherit;font-size:11.5px;padding:7px;' +
        'border:1px solid var(--rule,#ccc);border-radius:6px;background:transparent;' +
        'color:inherit;resize:vertical;';
      ta.value = name === 'Title' ? (t.heroName || '')
               : name === 'Tagline' ? (t.lede || '')
               : name === 'Meta lines'
                 ? (Array.isArray(t.meta) ? t.meta.join('\n')
                    : Array.prototype.map.call(
                        (document.getElementById('hero-meta') || {children: []}).children,
                        function (s) { return s.textContent; }).join('\n'))
               : name === 'Availability'
                 ? (Array.isArray(t.corner) && t.corner.length ? t.corner.join('\n')
                    : String((document.querySelector('#hero .corner, .hero .corner, .corner') ||
                              {innerText: ''}).innerText || '')
                        .split(/\n/).map(function (s) { return s.trim(); })
                        .filter(Boolean).join('\n'))
               : (Array.isArray(t.about) ? t.about.join('\n\n') : '');
      ta.placeholder = name === 'About' ? 'Blank line between paragraphs'
                     : name === 'Meta lines' ? 'One line each'
                     : name === 'Availability'
                       ? 'One line each; lines after the first render bold' : '';
      ta.addEventListener('click', function (e) { e.stopPropagation(); });
      ta.addEventListener('input', function () {
        if (name === 'Title')   t.heroName = ta.value.trim();
        if (name === 'Tagline') t.lede = ta.value.trim();
        if (name === 'About')   t.about = ta.value.split(/\n\s*\n/)
                                  .map(function (s) { return s.trim(); }).filter(Boolean);
        if (name === 'Meta lines') t.meta = ta.value.split(/\n/)
                                  .map(function (s) { return s.trim(); }).filter(Boolean);
        if (name === 'Availability') t.corner = ta.value.split(/\n/)
                                  .map(function (s) { return s.trim(); }).filter(Boolean);
        markDirty();
        applyTextLive();
        /* mirror the global fields so the two never disagree */
        var map = { Title: 'ed-tx-name', Tagline: 'ed-tx-lede', About: 'ed-tx-about' };
        var g = document.getElementById(map[name]);
        if (g) g.value = ta.value;
      });
      introRow.appendChild(ta);
      box.appendChild(introRow);

      var introNote = el('div', 'ed-note',
        name === 'Title'
          ? 'Blank uses the name from resume.tex.'
          : (name === 'Meta lines' || name === 'Availability')
            ? 'These lines are written in index.html; anything typed here ' +
              'overrides them from site-config.json.'
            : 'Blank falls back to the ' +
              (name === 'Tagline' ? 'tagline:' : 'about:') +
              ' block at the top of resume.tex.');
      box.appendChild(introNote);
    }

    /* Tools cards: choose which mark this card shows. Accepts a catalogue
       logo name, a literal emoji, or blank to suppress it entirely. */
    if (kind === 'card') {
      var m2 = mediaStore();
      if (!m2.cardLogos) m2.cardLogos = {};
      var clRow = el('div', 'ed-row');
      clRow.appendChild(el('label', null, 'Card mark'));
      var clIn = el('input'); clIn.type = 'text'; clIn.style.width = '104px';
      clIn.placeholder = 'logo name or emoji';
      clIn.value = m2.cardLogos[name] !== undefined ? m2.cardLogos[name] : '';
      clIn.addEventListener('click', function (e) { e.stopPropagation(); });
      clIn.addEventListener('input', function () {
        m2.cardLogos[name] = clIn.value.trim();
        markDirty();
      });
      clRow.appendChild(clIn);
      box.appendChild(clRow);

      var clHint = el('div', 'ed-note',
        'Try a catalogue name (Python, Docker, Claude…), an emoji, or leave ' +
        'blank to hide the mark. Clear the field and press reset to fall back ' +
        'to automatic matching.');
      box.appendChild(clHint);

      /* Hide a single tool without editing resume.tex — useful for
         trimming a long list down to what you want on the page. */
      var hideRow = el('div', 'ed-row');
      hideRow.appendChild(el('label', null, 'Show card'));
      var hideBtn = el('button', 'ed-pick', '');
      hideBtn.style.width = 'auto'; hideBtn.style.padding = '3px 12px';
      if (!m2.hiddenCards) m2.hiddenCards = {};
      function paintHide() {
        var off = m2.hiddenCards[name] === true;
        hideBtn.textContent = off ? 'hidden' : 'shown';
        hideBtn.style.background = off ? 'transparent' : 'var(--accent)';
        hideBtn.style.color = off ? 'inherit' : '#fff';
      }
      hideBtn.addEventListener('click', function (e) {
        e.stopPropagation();
        m2.hiddenCards[name] = !m2.hiddenCards[name];
        markDirty(); paintHide(); paintHiddenList();
        document.querySelectorAll('.skills-cluster .tags span[data-entry]').forEach(function (s) {
          if (s.getAttribute('data-entry') === name) {
            s.style.display = m2.hiddenCards[name] ? 'none' : '';
          }
        });
      });
      paintHide();
      hideRow.appendChild(hideBtn);
      box.appendChild(hideRow);

      var clDrop = el('div', 'ed-row');
      var clPick = el('button', 'ed-pick', 'list logo names');
      clPick.style.width = 'auto'; clPick.style.padding = '3px 9px';
      clPick.addEventListener('click', function (e) {
        e.stopPropagation();
        var names = (state.config.logos || []).map(function (l) { return l.n; });
        note('Available: ' + names.join(', '));
      });
      clDrop.appendChild(clPick);
      box.appendChild(clDrop);
    }

    /* Tile backing colour, per item or for the whole section. Useful when a
       logo is a dark PNG with no transparency. */
    var tbRow = el('div', 'ed-row');
    tbRow.appendChild(el('label', null, 'Tile background'));
    var tbIn = el('input'); tbIn.type = 'color';
    var mm3 = mediaStore();
    if (!mm3.tileBg) mm3.tileBg = {};
    tbIn.value = toHex(mm3.tileBg[name] || '#00000000' );
    tbIn.addEventListener('input', function () {
      mm3.tileBg[name] = tbIn.value;
      markDirty();
      document.querySelectorAll('[data-entry], [data-title]').forEach(function (row) {
        var n = row.getAttribute('data-entry') || row.getAttribute('data-title');
        if (n !== name) return;
        var t = row.querySelector('.entry-tile');
        if (t) { t.style.background = tbIn.value; t.style.padding = '8px'; }
      });
    });
    tbRow.appendChild(tbIn);
    var tbClear = el('button', 'ed-pick', 'none');
    tbClear.style.width = 'auto'; tbClear.style.padding = '3px 8px';
    tbClear.addEventListener('click', function (e) {
      e.stopPropagation();
      delete mm3.tileBg[name];
      markDirty();
      document.querySelectorAll('[data-entry], [data-title]').forEach(function (row) {
        var n = row.getAttribute('data-entry') || row.getAttribute('data-title');
        if (n !== name) return;
        var t = row.querySelector('.entry-tile');
        if (t) { t.style.background = ''; t.style.padding = ''; }
      });
      note('Tile background cleared for "' + name + '".');
    });
    tbRow.appendChild(tbClear);
    box.appendChild(tbRow);

    /* Say where this item actually comes from before offering to open it —
       some entries live in resume.tex, some in index.html, and guessing
       wrong wastes a round trip. */
    var SRC = {
      intro:      { file: 'resume.tex', where: 'top comment block (tagline: / about:)' },
      card:       { file: 'resume.tex', where: '\\section*{Skills} item list' },
      education:  { file: 'resume.tex', where: '\\section*{Education}' },
      internship: { file: 'resume.tex', where: '\\section*{Internships}' },
      project:    { file: 'resume.tex', where: '\\subsection*{' + name + '}' },
      section:    { file: 'index.html',  where: 'the <h2> for this section' }
    };
    /* Meta lines and the availability corner are hand-written in
       index.html \u2014 resume.tex has no counterpart for them. */
    var heroHtml = kind === 'intro' &&
                   (name === 'Meta lines' || name === 'Availability');
    var origin = heroHtml
      ? { file: 'index.html', where: 'the hero block' }
      : (SRC[kind] || SRC.project);
    var srcNote = el('div', 'ed-note',
      'Source: ' + origin.file + ' \u2014 ' + origin.where);
    box.appendChild(srcNote);

    var srcRow = el('div', 'ed-row');
    var openTex = el('button', 'ed-pick', 'edit in resume.tex');
    openTex.style.width = 'auto'; openTex.style.padding = '3px 9px';
    openTex.title = 'Open resume.tex scrolled to this entry';
    openTex.addEventListener('click', function (e) {
      e.stopPropagation();
      /* Search for the structural marker where one exists, since the bare
         name may appear in several places. */
      var probe = kind === 'project' ? '\\subsection*{' + name
                : kind === 'intro'   ? (name === 'About' ? 'about:' : 'tagline:')
                : name;
      openTexEditor(probe);
    });
    srcRow.appendChild(openTex);
    var openHtml = el('button', 'ed-pick', 'edit index.html');
    openHtml.style.width = 'auto'; openHtml.style.padding = '3px 9px';
    openHtml.title = 'Open index.html scrolled to this text';
    openHtml.addEventListener('click', function (e) {
      e.stopPropagation(); openHtmlEditor(name);
    });
    srcRow.appendChild(openHtml);
    box.appendChild(srcRow);

    /* Project-only: featured flag and the colour of its first domain. */
    if (kind === 'project') {
      var proj = ((window.__resumeData || {}).projects || [])
        .filter(function (p) { return p.title === name; })[0];
      if (proj) {
        var fRow = el('div', 'ed-row');
        fRow.appendChild(el('label', null, 'Featured'));
        var fBtn = el('button', 'ed-pick', proj.featured ? 'yes' : 'no');
        fBtn.style.width = 'auto'; fBtn.style.padding = '3px 12px';
        fBtn.style.background = proj.featured ? 'var(--accent)' : 'transparent';
        fBtn.style.color = proj.featured ? '#fff' : 'inherit';
        fBtn.title = 'Set in resume.tex — this shows the current value';
        fBtn.addEventListener('click', function (e) {
          e.stopPropagation();
          note('Featured is authored in resume.tex (featured: true) so the ' +
               'PDF and site agree. Use "copy for resume.tex" below.');
        });
        fRow.appendChild(fBtn);
        box.appendChild(fRow);

        var dom = (proj.domains || [])[0];
        if (dom) {
          box.appendChild(colorRow(dom,
            (ensure().colors.domains || {})[dom] || (window.__domainPalette || {})[dom] || '#888',
            function (v) { setDomainColor(dom, v); }));
        }
      }
    }

    /* Preview lives in its own window, not inside this 290px panel: a
       featured project is a wide multi-column row, and cramming it in here
       would misrepresent exactly what you're trying to check. */
    var pvRow2 = el('div', 'ed-row');
    var pvBtn = el('button', 'ed-pick', 'open preview window');
    pvBtn.style.width = 'auto'; pvBtn.style.padding = '4px 10px';
    pvBtn.title = 'See this entry rendered at real width, with real styles';
    pvBtn.addEventListener('click', function (e) {
      e.stopPropagation(); renderPreviewWindow(name, kind);
    });
    pvRow2.appendChild(pvBtn);
    box.appendChild(pvRow2);

    /* Keep the window in step while sliders and fields change. */
    function updatePreview() {
      if (box._tsRow) {
        var f = m.images[name] !== undefined ? m.images[name] : cur.image;
        box._tsRow.style.display = f ? 'flex' : 'none';
      }
      if (pvwin && pvwin.classList.contains('open')) renderPreviewWindow(name, kind);
    }

    /* Actions, same semantics as the global block. */
    var act = el('div', 'ed-row');
    function actBtn(label, title, fn) {
      var b = el('button', 'ed-pick', label);
      b.style.width = 'auto'; b.style.padding = '3px 9px'; b.title = title;
      b.addEventListener('click', function (e) { e.stopPropagation(); fn(); });
      act.appendChild(b);
    }
    actBtn('hide', 'Show no mark on this item at all', function () {
      m.icons[name] = ''; m.images[name] = '';
      markDirty(); openItemPanel(name, kind);
      note('"' + name + '" will show no mark. Save + reload.');
    });
    actBtn('reset', 'Drop overrides for this item', function () {
      delete m.icons[name]; delete m.images[name];
      delete m.alts[name]; if (m.sizes) delete m.sizes[name];
      markDirty(); openItemPanel(name, kind);
      note('Overrides cleared for "' + name + '".');
    });
    actBtn('copy tex', 'Copy the resume.tex comment block for this item', function () {
      var sel = document.getElementById('ed-media-target');
      if (sel) { sel.value = name; loadMediaFields(); }
      copyMediaSnippet();
    });
    box.appendChild(act);

    var hint = el('div', 'ed-note',
      'Changes preview live. Press Save at the bottom to write them.');
    box.appendChild(hint);

    showThumb(cur.image);
    updatePreview();

    box.classList.add('open');
    if (box.scrollIntoView) box.scrollIntoView({ block: 'nearest' });
  }

  function filtersStore() {
    var cfg = ensure();
    if (!cfg.filters) cfg.filters = {};
    if (!cfg.filters.hidden) cfg.filters.hidden = {};
    return cfg.filters;
  }

  /* Right-clicking a filter button offers to drop it from the rail.
     Hidden terms live in filters.hidden (site-config), keyed "type:value".
     The panel also lists everything currently hidden so a term can be
     brought back — its button is gone, so it can't be right-clicked. */
  function openFilterPanel(type, val) {
    var box = document.getElementById('ed-item');
    if (!box || !val) return;
    box.innerHTML = '';
    box.dataset.name = type + ':' + val;

    var hd = el('div', 'ed-item-hd');
    hd.appendChild(el('span', 'ed-item-kind', (type || 'tech') + ' filter'));
    hd.appendChild(el('span', null, 'Edit this item'));
    var close = el('button', 'ed-item-close', '×');
    close.title = 'Close';
    close.addEventListener('click', function (e) {
      e.stopPropagation(); box.classList.remove('open');
    });
    hd.appendChild(close);
    box.appendChild(hd);
    box.appendChild(el('div', 'ed-item-name', val));

    var f = filtersStore();
    var key = type + ':' + val;

    /* Hide/show the live buttons immediately; the rail rebuilds without
       hidden terms on the next load anyway. */
    function liveApply(ty, v, off) {
      document.querySelectorAll('.pf-btn').forEach(function (b) {
        if (b.dataset.type === ty && b.dataset.val === v) {
          b.style.display = off ? 'none' : '';
        }
      });
      document.querySelectorAll('.pf-dd').forEach(function (dd) {
        if (dd.dataset.group !== ty) return;
        dd.querySelectorAll('.pf-opt').forEach(function (o) {
          if (o.dataset.val === v) o.style.display = off ? 'none' : '';
        });
      });
    }

    /* Two independent switches. The rail is a working tool — you may want
       to filter by a domain you've deliberately kept out of the top-bar
       menu — so hiding from one doesn't hide from the other. */
    if (type === 'domain') {
      if (!f.hiddenNav) f.hiddenNav = {};
      var navRow = el('div', 'ed-row');
      navRow.appendChild(el('label', null, 'In nav dropdown'));
      var navBtn = el('button', 'ed-pick', '');
      navBtn.style.width = 'auto'; navBtn.style.padding = '3px 12px';
      navBtn.title = 'Show or hide this domain in the top-bar Projects menu';
      function paintNav() {
        var off = f.hiddenNav[key] === true;
        navBtn.textContent = off ? 'hidden' : 'shown';
        navBtn.style.background = off ? 'transparent' : 'var(--accent)';
        navBtn.style.color = off ? 'inherit' : '#fff';
      }
      navBtn.addEventListener('click', function (e) {
        e.stopPropagation();
        f.hiddenNav[key] = !f.hiddenNav[key];
        if (!f.hiddenNav[key]) delete f.hiddenNav[key];
        markDirty(); paintNav();
        /* Live-hide the matching sub-link so the change is visible now. */
        document.querySelectorAll('.nav-sub-link').forEach(function (a) {
          if (a.getAttribute('data-filter-domain') === val) {
            a.style.display = f.hiddenNav[key] ? 'none' : '';
          }
        });
        note('"' + val + '" ' + (f.hiddenNav[key] ? 'hidden from' : 'shown in') +
             ' the nav dropdown. Save + reload.');
      });
      paintNav();
      navRow.appendChild(navBtn);
      box.appendChild(navRow);
    }

    var row = el('div', 'ed-row');
    row.appendChild(el('label', null, 'In filter rail'));
    var btn = el('button', 'ed-pick', '');
    btn.style.width = 'auto'; btn.style.padding = '3px 12px';
    function paint() {
      var off = f.hidden[key] === true;
      btn.textContent = off ? 'hidden' : 'shown';
      btn.style.background = off ? 'transparent' : 'var(--accent)';
      btn.style.color = off ? 'inherit' : '#fff';
    }
    btn.addEventListener('click', function (e) {
      e.stopPropagation();
      if (f.hidden[key]) delete f.hidden[key]; else f.hidden[key] = true;
      paint(); liveApply(type, val, f.hidden[key] === true);
      renderHiddenChips(); markDirty();
    });
    paint();
    row.appendChild(btn);
    box.appendChild(row);

    box.appendChild(el('div', 'ed-note',
      'Hiding drops this button from the filter rail and the narrow-screen ' +
      'dropdown. Project cards and their tags are untouched.'));

    var chipsHd = el('div', 'ed-note', '');
    box.appendChild(chipsHd);
    var chipsRow = el('div', 'ed-row');
    chipsRow.style.display = 'block';
    box.appendChild(chipsRow);
    function renderHiddenChips() {
      chipsRow.innerHTML = '';
      var keys = Object.keys(f.hidden).filter(function (k) { return f.hidden[k]; });
      chipsHd.textContent = keys.length
        ? 'Hidden filters — click one to bring it back:'
        : 'No filters are hidden.';
      keys.forEach(function (k) {
        var c = el('button', 'ed-pick', k.replace(':', ': '));
        c.style.width = 'auto'; c.style.padding = '2px 8px';
        c.style.margin = '2px 4px 2px 0';
        c.addEventListener('click', function (e) {
          e.stopPropagation();
          delete f.hidden[k];
          var i = k.indexOf(':');
          liveApply(k.slice(0, i), k.slice(i + 1), false);
          if (k === key) paint();
          renderHiddenChips(); markDirty();
        });
        chipsRow.appendChild(c);
      });
    }
    renderHiddenChips();

    var hint = el('div', 'ed-note',
      'Changes preview live. Press Save at the bottom to write them.');
    box.appendChild(hint);

    box.classList.add('open');
    if (box.scrollIntoView) box.scrollIntoView({ block: 'nearest' });
  }

  /* ---------- show / hide ---------- */
  function show(x, y) {
    panel.classList.add('open');
    /* Once dragged, stay where the user put it rather than jumping back to
       the cursor on every right-click. */
    if (!panel.dataset.moved) {
      var w = 290, h = Math.min(panel.scrollHeight, window.innerHeight * 0.82);
      panel.style.left = Math.min(x, window.innerWidth  - w - 12) + 'px';
      panel.style.top  = Math.min(y, window.innerHeight - h  - 12) + 'px';
    }
    syncFromComputed();
  }
  function hide() { panel.classList.remove('open'); }

  function init() {
    build();
    paintColors();      // populate immediately; loadConfig refreshes later
    paintDomains();
    paintThemeState();
    paintLogoToggles();
    paintNavList();
    loadStyles();
    loadConfig();
    fillMediaTargets();

    /* The resume parses asynchronously, so the call above sees only the
       section headings — individual projects, education rows and
       internships don't exist yet. Refill when script.js signals it has
       rendered, and poll as a fallback in case that event fired before
       this listener was bound. */
    document.addEventListener('portfolio:rendered', function () {
      fillMediaTargets();
      paintDomains();
      paintEntryToggles();
      paintHiddenList();
      paintNavList();
    });
    (function waitForData(tries) {
      if (window.__resumeData) { fillMediaTargets(); paintDomains(); return; }
      if (tries > 40) return;
      setTimeout(function () { waitForData(tries + 1); }, 150);
    })(0);
    /* Right-click ON an item scopes the panel to that item: the media
       target is pre-selected and the panel scrolls straight to it, so you
       aren't hunting through a dropdown of two dozen entries. */
    /* The site's own sun/moon toggle changes the theme underneath the
       editor; follow it so the panel always edits the visible set. */
    ['btn-day', 'btn-night'].forEach(function (id) {
      var b = document.getElementById(id);
      if (b) b.addEventListener('click', function () {
        setTimeout(syncEditorToTheme, 60);
      });
    });
    document.addEventListener('contextmenu', function (e) {
      e.preventDefault();
      var hit = targetNameFromEvent(e.target);
      show(e.clientX, e.clientY);
      if (hit && hit.kind === 'filter') {
        openFilterPanel(hit.ftype, hit.name);
      } else if (hit && hit.kind === 'nav') {
        openNavPanel(hit.name);
      } else if (hit) {
        focusMediaTarget(hit.name);
        openItemPanel(hit.name, hit.kind);
        renderPreviewWindow(hit.name, hit.kind);
      } else {
        var box = document.getElementById('ed-item');
        if (box) box.classList.remove('open');
      }
    });
    document.addEventListener('click', hide);
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') hide();
    });
    console.log('[dev-editor] v11 ready — click the "style editor" button ' +
                '(bottom-right), or right-click any project / education row / ' +
                'internship to edit that item directly.');
    console.log('[dev-editor] media targets loaded:',
                (document.getElementById('ed-media-target') || {children: []}).children.length);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
