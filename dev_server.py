#!/usr/bin/env python3
"""
dev_server.py - local HTTP server with interactive style switching.

Run from the portfolio folder (alongside index.html):

    python3 dev_server.py            # default port 8000
    python3 dev_server.py 8080       # custom port

Commands typed into the terminal while the server is running:

    palettes            rebuild the style-*.css variants from style.css
    style <name>        load style-<name>.css from this folder
                         e.g. 'style aegean-clay'
    style <path>        load any CSS file at the given path
                         e.g. 'style ../experiments/sunset.css'
                              'style /tmp/scratch.css'
    style default       reset - serve the actual style.css again
    list                show built-in style-*.css files in this folder
    preview             print the device-preview URL
    compare [folder]    print the stylesheet-comparison URL
    devices             list device sizes offered by the preview page
    help                show command help
    quit  (or exit, q)  stop the server

Comparing stylesheets
---------------------
Open http://localhost:<port>/compare to see the site drawn with several
stylesheets at once, side by side. Add every .css file in a folder of the
site (altStyles/, say), or pick files or a whole folder from anywhere on
the computer. Each view renders at a real device width and is scaled to
fit; scrolling one scrolls the others to the same content. Click a sheet's
name to focus on it alone (arrow keys step through the others at the same
spot); Esc goes back to the grid.

Device preview
--------------
Open http://localhost:<port>/preview to see the real site inside a
resizable device frame - iPhone SE, iPhone 15 Pro, Pixel 8, iPad mini,
iPad Pro, laptop and desktop widths, with a rotate button. It loads the
actual pages in an iframe, so whatever you're editing is what you see;
it just constrains the viewport so you can check mobile layout from a
laptop without touching a phone.

How it works
------------
When you change the style via CLI, the server starts returning the
chosen file's contents in response to requests for /style.css. Your
actual style.css on disk is never touched. Caching is disabled so a
normal page refresh (Cmd/Ctrl+R) picks up the new styles every time.

This is independent of the in-browser controls, which both still work:
  - ?style=<name>      URL parameter (per-tab, persists in localStorage)
  - setStyle('<name>') in DevTools console (per-tab, persists)
Those swap which file the browser asks for. The CLI command swaps
what the SERVER returns for /style.css - so it affects every tab
that loads /style.css without an explicit ?style= override.
"""
import glob
import html as _html
import math
import http.server
import json
import os
import shlex
import re
import socketserver
import sys
import threading
import urllib.parse

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
ROOT = os.path.abspath(os.getcwd())

# Mutable state shared between request handler and command loop.
# `None` means "serve the real style.css unchanged".
state = {'style_override': None, 'screen': None, 'editor': True}


def detect_monitors():
    """Best-effort attempt at the monitor's make/model. Platform-specific and
    genuinely unreliable — many displays report a generic string, and laptop
    panels often report nothing useful at all. Never fails the server; on any
    error it just returns an empty list with the reason.

    Sources tried:
      macOS   — system_profiler SPDisplaysDataType
      Windows — wmic desktopmonitor / powershell WmiMonitorID
      Linux   — xrandr --query, then /sys/class/drm EDID names
    """
    import subprocess
    import platform

    def run(cmd, timeout=4):
        try:
            out = subprocess.run(cmd, capture_output=True, text=True,
                                 timeout=timeout, shell=isinstance(cmd, str))
            return out.stdout if out.returncode == 0 else ''
        except Exception:
            return ''

    system = platform.system()
    names, source = [], None

    try:
        if system == 'Darwin':
            source = 'system_profiler SPDisplaysDataType'
            txt = run(['system_profiler', 'SPDisplaysDataType'])
            for line in txt.splitlines():
                s = line.strip()
                # display names appear as "    <Name>:" nested under Displays
                if s.endswith(':') and not s.startswith('Displays') and ' ' not in s[:1]:
                    cand = s[:-1].strip()
                    if cand and cand.lower() not in ('graphics/displays', 'displays'):
                        names.append(cand)

        elif system == 'Windows':
            source = 'powershell WmiMonitorID'
            ps = (
                "Get-CimInstance -Namespace root\\wmi -ClassName WmiMonitorID | "
                "ForEach-Object { "
                "($_.UserFriendlyName | Where-Object {$_ -ne 0} | "
                "ForEach-Object {[char]$_}) -join '' }"
            )
            txt = run(['powershell', '-NoProfile', '-Command', ps])
            names = [l.strip() for l in txt.splitlines() if l.strip()]
            if not names:
                source = 'wmic desktopmonitor'
                txt = run(['wmic', 'desktopmonitor', 'get', 'Name'])
                names = [l.strip() for l in txt.splitlines()[1:] if l.strip()]

        elif system == 'Linux':
            source = 'xrandr --query'
            txt = run(['xrandr', '--query'])
            for line in txt.splitlines():
                if ' connected' in line:
                    names.append(line.split()[0])
            if not names:
                source = '/sys/class/drm'
                import glob
                import os
                for p in glob.glob('/sys/class/drm/card*-*'):
                    st = os.path.join(p, 'status')
                    try:
                        if open(st).read().strip() == 'connected':
                            names.append(os.path.basename(p).split('-', 1)[-1])
                    except Exception:
                        pass
    except Exception as e:
        return {'names': [], 'source': source, 'reason': f'{e.__class__.__name__}: {e}'}

    # de-dupe, preserve order
    seen, uniq = set(), []
    for n in names:
        if n and n not in seen:
            seen.add(n)
            uniq.append(n)
    return {'names': uniq, 'source': source,
            'reason': None if uniq else 'no display names reported'}


def detect_screen():
    """Best-effort read of the LOCAL display, for the preview page's auto-fit.

    Uses tkinter, which is stdlib. The root window is created withdrawn (never
    mapped to the screen) and destroyed immediately, so nothing appears — but
    if the environment has no display at all (headless, SSH without X) the
    call raises and we degrade silently to browser-side measurement.

    Physical size (mm) comes from the display's EDID and is often a 96-DPI
    placeholder rather than the truth, so it's reported as a hint only and
    never used for true-to-life scaling. Real physical sizing needs the
    calibration step in the preview page.

    Returns a dict, or None when detection isn't possible.
    """
    try:
        import tkinter
    except Exception as e:
        return {'ok': False, 'reason': f'tkinter unavailable ({e.__class__.__name__})'}

    root = None
    try:
        root = tkinter.Tk()
        root.withdraw()          # never map the window
        root.update_idletasks()  # ensure geometry is populated
        info = {
            'ok': True,
            'px_w': root.winfo_screenwidth(),
            'px_h': root.winfo_screenheight(),
            'mm_w': root.winfo_screenmmwidth(),
            'mm_h': root.winfo_screenmmheight(),
        }
        info['monitors'] = detect_monitors()
        import platform as _pf
        info['platform'] = f"{_pf.system()} {_pf.release()}".strip()
        if info['mm_w']:
            info['dpi_x'] = round(info['px_w'] / (info['mm_w'] / 25.4), 1)
        return info
    except Exception as e:
        return {'ok': False, 'reason': f'{e.__class__.__name__}: {e}'}
    finally:
        if root is not None:
            try:
                root.destroy()
            except Exception:
                pass


def log_screen(info):
    """Print what was detected and, importantly, where it came from."""
    print("display detection:")
    if not info or not info.get('ok'):
        reason = (info or {}).get('reason', 'unknown')
        print(f"  server-side : unavailable — {reason}")
        print( "  browser     : will measure its own viewport (authoritative)")
        return
    if info.get('platform'):
        print(f"  platform    : {info['platform']}")
    mon = info.get('monitors') or {}
    if mon.get('names'):
        print(f"  monitor(s)  : {', '.join(mon['names'])}  "
              f"[source: {mon.get('source')} — best effort, names are often generic]")
    else:
        print(f"  monitor(s)  : not identified"
              + (f" — {mon.get('reason')}" if mon.get('reason') else "")
              + (f"  [tried: {mon.get('source')}]" if mon.get('source') else ""))
    print(f"  server-side : {info['px_w']} x {info['px_h']} px  "
          f"[source: tkinter on this machine]")
    if info.get('mm_w'):
        print(f"                {info['mm_w']} x {info['mm_h']} mm "
              f"(~{info.get('dpi_x')} dpi)  [source: EDID — often a 96-dpi "
              f"placeholder, treat as a hint]")
    else:
        print( "                physical size not reported by the display")
    print( "  browser     : measures its own viewport on load (authoritative "
           "for layout)")
    print( "                note: if you browse from a DIFFERENT machine than "
           "this server,")
    print( "                the server-side numbers above describe the SERVER's "
           "display, not yours.")

# Device presets for the /preview device-frame page.
# id, label, css width, css height, physical screen width in INCHES.
# The physical width is what makes true 1:1 rendering possible: a phone packs
# ~160 css px per inch, not the 96 css px per inch a desktop monitor assumes,
# so scaling by monitor-dpi alone would render phone frames far too large.
DEVICES = [
    ("iphone-se",   "iPhone SE",        375,  667, 2.31),
    ("iphone-pro",  "iPhone 15 Pro",    393,  852, 2.51),
    ("pixel",       "Pixel 8",          412,  915, 2.66),
    ("ipad-mini",   "iPad mini",        768, 1024, 5.30),
    ("ipad-pro",    "iPad Pro 11\"",    834, 1194, 6.83),
    ("laptop",      "Laptop",          1280,  800, 12.30),
    ("desktop",     "Desktop",         1600,  900, 20.90),
]

PREVIEW_HTML = """<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Device preview — portfolio</title>
<style>
  *{box-sizing:border-box}
  body{margin:0;background:#2a2620;color:#efe7d8;
       font:13px ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;}
  header{position:sticky;top:0;z-index:10;background:#191510;
         padding:10px 14px;display:flex;gap:6px;align-items:center;flex-wrap:wrap;
         border-bottom:1px solid #3a3226;}
  header b{font-size:11px;letter-spacing:.08em;color:#a99a80;margin-right:4px;}
  button{font:inherit;font-size:11px;padding:5px 11px;border-radius:20px;
         border:1px solid #4a4032;background:transparent;color:#d8ccb4;cursor:pointer;}
  button.on{background:#efe7d8;color:#191510;border-color:#efe7d8;}
  .sp{flex:1}
  .readout{padding:8px 14px;background:#141009;border-bottom:1px solid #3a3226;
           font-size:11px;color:#a99a80;line-height:1.6;}
  .readout .k{color:#d8ccb4;}
  .readout .warn{color:#d9a441;}
  .stage{display:flex;justify-content:center;padding:26px 14px 40px;overflow:auto;}
  .scaler{transform-origin:top center;transition:transform .2s;}
  .frame{background:#0d0b08;border-radius:26px;padding:12px;
         box-shadow:0 18px 50px rgba(0,0,0,.45);transition:width .25s,height .25s;}
  .frame.flat{border-radius:10px;padding:8px;}
  .notch{height:18px;display:flex;align-items:center;justify-content:center;}
  .notch::after{content:"";width:54px;height:4px;border-radius:3px;background:#3a3226;}
  .frame.flat .notch{display:none;}
  iframe{border:0;display:block;background:#fff;border-radius:14px;width:100%;height:100%;}
  .frame.flat iframe{border-radius:4px;}
  /* calibration */
  .cal{display:none;padding:14px;background:#141009;border-bottom:1px solid #3a3226;}
  .cal.open{display:block;}
  .cal p{margin:0 0 10px;font-size:11px;color:#a99a80;line-height:1.6;max-width:60ch;}
  .card{height:54px;border:2px solid #d9a441;border-radius:8px;background:#201c14;
        display:flex;align-items:center;justify-content:center;color:#d9a441;
        font-size:10px;margin-bottom:10px;}
  input[type=range]{width:min(420px,80%);}
</style>
</head>
<body>
  <header>
    <b>DEVICE</b>
    __BUTTONS__
    <span class="sp"></span>
    <button id="rot" title="Swap width and height">rotate</button>
    <button id="fit" class="on" title="Scale the frame to fit your window">auto-fit</button>
    <button id="real" title="Render at true physical size (needs calibration)">1:1 size</button>
    <button id="calbtn" title="Calibrate your screen DPI">calibrate</button>
    <button id="reload">reload</button>
  </header>

  <div class="readout" id="readout"></div>

  <div class="cal" id="cal">
    <p>Drag until the box below is exactly as wide as a real credit/debit card
       (85.6&nbsp;mm — the ID-1 standard, identical worldwide). Hold one against
       the screen. This is the only way to learn your monitor's true DPI: no
       browser or OS API reports physical size reliably.</p>
    <div class="card" id="calcard">85.6 mm — match a real card</div>
    <input type="range" id="calrange" min="200" max="900" value="340">
    <div style="margin-top:8px;">
      <button id="calsave">save</button>
      <button id="calclear">reset</button>
      <span id="calout" style="margin-left:10px;color:#a99a80;font-size:11px;"></span>
    </div>
  </div>

  <div class="stage">
    <div class="scaler" id="scaler">
      <div class="frame" id="frame">
        <div class="notch"></div>
        <iframe id="view" src="/" title="Site preview"></iframe>
      </div>
    </div>
  </div>

<script>
  var DEVICES = __DEVICES__;
  var SERVER  = __SERVER__;          /* screen info detected by dev_server.py */

  var cur = DEVICES[0], rotated = false, autofit = true, realsize = false;
  var frame  = document.getElementById('frame');
  var scaler = document.getElementById('scaler');
  var view   = document.getElementById('view');
  var out    = document.getElementById('readout');

  function dpi() {
    var v = null;
    try { v = parseFloat(localStorage.getItem('rs-preview-dpi')); } catch (e) {}
    return (v && isFinite(v) && v > 20) ? v : null;
  }

  function apply() {
    var w = rotated ? cur.h : cur.w;
    var h = rotated ? cur.w : cur.h;
    frame.style.width  = w + 'px';
    frame.style.height = (h + 30) + 'px';
    frame.classList.toggle('flat', w >= 1024);

    var scale = 1, mode = 'actual CSS pixels';
    var d = dpi();

    if (realsize && d && cur['in']) {
      /* True 1:1. The frame is `w` css px wide and the real device is
         cur['in'] inches wide, so the device packs (w / cur['in']) css px
         per inch. Your monitor shows `d` px per inch. Scaling by the ratio
         makes the frame occupy the same physical width as the real device.
         Using 96/d instead would ignore the device's own pixel density and
         render phone frames roughly 1.7x too large. */
      var devicePpi = w / cur['in'];
      scale = d / devicePpi;
      mode = 'true 1:1 — ' + cur['in'] + '" wide on a ' + d.toFixed(0) + ' dpi screen';
    } else if (autofit) {
      var availW = window.innerWidth  - 40;
      var availH = window.innerHeight - document.querySelector('header').offsetHeight
                   - out.offsetHeight - 70;
      scale = Math.min(1, availW / (w + 24), availH / (h + 54));
      mode = scale < 1 ? 'auto-fit ' + Math.round(scale * 100) + '%' : 'actual CSS pixels';
    }
    scaler.style.transform = 'scale(' + scale + ')';

    document.querySelectorAll('[data-id]').forEach(function (b) {
      b.classList.toggle('on', b.dataset.id === cur.id);
    });
    document.getElementById('fit').classList.toggle('on', autofit && !realsize);
    document.getElementById('real').classList.toggle('on', realsize);

    /* readout — always say where each number came from */
    var lines = [];
    lines.push('<span class="k">frame</span> ' + cur.name + ' — ' + w + ' x ' + h +
               ' css px' + (cur['in'] ? ' (' + cur['in'] + '" wide, ' + Math.round(w / cur['in']) + ' css-px/in)' : '') +
               ' &nbsp;·&nbsp; <span class="k">shown at</span> ' + mode);
    lines.push('<span class="k">your browser</span> viewport ' + window.innerWidth + ' x ' +
               window.innerHeight + ' css px, devicePixelRatio ' +
               (window.devicePixelRatio || 1) + ' &nbsp;[measured in this browser]');
    if (SERVER && SERVER.ok) {
      lines.push('<span class="k">server machine</span> ' + SERVER.px_w + ' x ' + SERVER.px_h +
                 ' px' + (SERVER.dpi_x ? ', EDID ~' + SERVER.dpi_x + ' dpi' : '') +
                 ' &nbsp;[reported by tkinter on the machine running dev_server.py]');
    } else {
      lines.push('<span class="k">server machine</span> not detected' +
                 (SERVER && SERVER.reason ? ' — ' + SERVER.reason : '') +
                 ' &nbsp;[browser measurement is authoritative]');
    }
    if (realsize && !d) {
      lines.push('<span class="warn">1:1 needs calibration — click “calibrate” first.</span>');
    }
    if (!d) {
      lines.push('<span class="k">dpi</span> not calibrated — physical sizing unavailable ' +
                 '(no API reports true screen size)');
    }
    out.innerHTML = lines.join('<br>');
  }

  document.querySelectorAll('[data-id]').forEach(function (b) {
    b.addEventListener('click', function () {
      cur = DEVICES.filter(function (d) { return d.id === b.dataset.id; })[0];
      rotated = false; apply();
    });
  });
  document.getElementById('rot').addEventListener('click', function () { rotated = !rotated; apply(); });
  document.getElementById('fit').addEventListener('click', function () {
    autofit = !autofit; if (autofit) realsize = false; apply();
  });
  document.getElementById('real').addEventListener('click', function () {
    realsize = !realsize; if (realsize) autofit = false;
    if (realsize && !dpi()) document.getElementById('cal').classList.add('open');
    apply();
  });
  document.getElementById('reload').addEventListener('click', function () { view.src = view.src; });

  /* ---- calibration ---- */
  var cal = document.getElementById('cal'), card = document.getElementById('calcard'),
      range = document.getElementById('calrange'), calout = document.getElementById('calout');
  document.getElementById('calbtn').addEventListener('click', function () { cal.classList.toggle('open'); });
  function calPreview() {
    var px = +range.value;
    card.style.width = px + 'px';
    calout.textContent = px + ' px across 85.6 mm → ' + (px / (85.6 / 25.4)).toFixed(1) + ' dpi';
  }
  range.addEventListener('input', calPreview);
  document.getElementById('calsave').addEventListener('click', function () {
    var d = (+range.value) / (85.6 / 25.4);
    try { localStorage.setItem('rs-preview-dpi', String(d)); } catch (e) {}
    cal.classList.remove('open'); apply();
  });
  document.getElementById('calclear').addEventListener('click', function () {
    try { localStorage.removeItem('rs-preview-dpi'); } catch (e) {}
    realsize = false; autofit = true; apply();
  });

  window.addEventListener('resize', apply);
  calPreview();
  apply();
</script>
</body>
</html>
"""


def build_preview_page():
    import json
    buttons = "\n    ".join(
        '<button data-id="{}">{} · {}</button>'.format(d[0], d[1], d[2])
        for d in DEVICES
    )
    devices = json.dumps([
        {"id": d[0], "name": d[1], "w": d[2], "h": d[3], "in": d[4]} for d in DEVICES
    ])
    server = json.dumps(state.get('screen') or {'ok': False, 'reason': 'not probed'})
    return (PREVIEW_HTML
            .replace("__BUTTONS__", buttons)
            .replace("__DEVICES__", devices)
            .replace("__SERVER__", server))


# ============================================================
# Stylesheet comparison  (/compare)
# ------------------------------------------------------------
# Several copies of the site side by side, each drawn with a different
# stylesheet. Sheets come from a folder inside the site (listed by the
# server), or from anywhere on the computer through the browser's file or
# folder picker; picked files are sent here and kept in memory only, so
# the server never reads outside the site folder.
#
# Each view is index.html served at /__compare-view with its stylesheet
# link pointed at /__compare-sheet.css. Both live at the site root so that
# relative addresses inside a sheet (fonts/...) resolve exactly as they do
# for style.css. The link is moved below theme-init.js, which would
# otherwise swap it for a saved ?style= preference, and the editor is left
# out.
# ============================================================

COMPARE_UPLOADS = {}                          # id -> {'name', 'css', 'size'}
COMPARE_UPLOAD_MAX = 5 * 1024 * 1024          # one sheet
COMPARE_UPLOAD_TOTAL = 40 * 1024 * 1024       # all picked sheets together
_COMPARE_SKIP_DIRS = {'node_modules', '__pycache__', 'fonts'}


def _css_identity(text):
    """(fingerprint, palette) for a stylesheet's text.

    fingerprint: identical files get the same one, whatever their line
    endings or trailing spaces. palette: "<theme-id>:<theme-hash>" from the
    identity line the palette generator writes, so two copies of the same
    palette match even when one is an older build; None when absent."""
    import hashlib
    norm = '\n'.join(l.rstrip() for l in text.replace('\r\n', '\n').split('\n')).strip()
    fp = hashlib.sha1(norm.encode('utf-8')).hexdigest()[:12]
    m = re.search(r'--theme-id:\s*"([^"]+)";\s*--theme-hash:\s*"([^"]+)"', text[:2000])
    return fp, (m.group(1) + ':' + m.group(2)) if m else None


def compare_dirs():
    """Folders inside the site that hold .css files, with a count each."""
    out = []
    for dirpath, dirnames, filenames in os.walk(ROOT):
        dirnames[:] = sorted(d for d in dirnames
                             if not d.startswith('.') and d not in _COMPARE_SKIP_DIRS)
        rel = os.path.relpath(dirpath, ROOT)
        if rel != '.' and rel.count(os.sep) >= 3:
            dirnames[:] = []
        n = sum(1 for f in filenames if f.lower().endswith('.css'))
        if n:
            out.append({'dir': '' if rel == '.' else rel.replace(os.sep, '/'), 'count': n})
    return out


def compare_sheets(rel):
    """The .css files in one folder of the site, style.css first."""
    ok, full = _safe_path(rel or '.')
    if not ok or not os.path.isdir(full):
        return None
    out = []
    for f in os.listdir(full):
        p = os.path.join(full, f)
        if f.lower().endswith('.css') and os.path.isfile(p):
            try:
                fp, pal = _css_identity(open(p, encoding='utf-8', errors='replace').read())
            except OSError:
                continue
            out.append({'path': os.path.relpath(p, ROOT).replace(os.sep, '/'),
                        'name': f, 'bytes': os.path.getsize(p),
                        'hash': fp, 'palette': pal,
                        'mtime': int(os.path.getmtime(p))})
    out.sort(key=lambda x: (x['name'] != 'style.css', x['name'].lower()))
    return out


def compare_sheet_path(rel):
    """Absolute path of a .css file inside the site, or None."""
    ok, full = _safe_path(rel or '')
    if ok and full.lower().endswith('.css') and os.path.isfile(full):
        return full
    return None


def compare_store(name, css):
    """Keep a picked sheet in memory; return (id, palette). The id is the
    sheet's fingerprint, so a picked copy of a site file matches it."""
    data = css.encode('utf-8')
    if len(data) > COMPARE_UPLOAD_MAX:
        raise ValueError(f'{name} is over {COMPARE_UPLOAD_MAX // (1024 * 1024)} MB')
    uid, pal = _css_identity(css)
    COMPARE_UPLOADS.pop(uid, None)
    COMPARE_UPLOADS[uid] = {'name': name, 'css': css, 'size': len(data)}
    while (sum(v['size'] for v in COMPARE_UPLOADS.values()) > COMPARE_UPLOAD_TOTAL
           and len(COMPARE_UPLOADS) > 1):
        COMPARE_UPLOADS.pop(next(iter(COMPARE_UPLOADS)))      # oldest first
    return uid, pal


def build_compare_view(query):
    """index.html drawn with one chosen sheet, or None if the sheet is unknown."""
    q = urllib.parse.parse_qs(query)
    f = (q.get('f') or [''])[0]
    u = (q.get('u') or [''])[0]
    if f and compare_sheet_path(f):
        href = '/__compare-sheet.css?f=' + urllib.parse.quote(f)
    elif u and u in COMPARE_UPLOADS:
        href = '/__compare-sheet.css?u=' + urllib.parse.quote(u)
    else:
        return None
    idx = os.path.join(ROOT, 'index.html')
    if not os.path.exists(idx):
        return None
    page = open(idx, encoding='utf-8').read()
    page = page.replace("s.src = 'editor.js';", "return;")
    link = (re.search(r'<link\b[^>]*\bid=["\']main-style["\'][^>]*>', page) or
            re.search(r'<link\b[^>]*\brel=["\']stylesheet["\'][^>]*>', page))
    if link:
        page = page[:link.start()] + page[link.end():]
    tag = '<link id="main-style" rel="stylesheet" href="%s">' % _html.escape(href, quote=True)
    init = re.search(r'<script\b[^>]*theme-init\.js[^>]*>\s*</script>', page)
    if init:
        page = page[:init.end()] + '\n  ' + tag + page[init.end():]
    else:
        page = page.replace('</head>', '  ' + tag + '\n</head>', 1)
    return page


COMPARE_HTML = r"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Compare stylesheets — portfolio</title>
<style>
  *{box-sizing:border-box}
  body{margin:0;background:#2a2620;color:#efe7d8;
       font:13px ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;}
  header{position:sticky;top:0;z-index:20;background:#191510;
         border-bottom:1px solid #3a3226;padding:8px 14px;
         display:flex;flex-direction:column;gap:7px;}
  .row{display:flex;gap:6px;align-items:center;flex-wrap:wrap;}
  .row b{font-size:11px;letter-spacing:.08em;color:#a99a80;margin:0 2px 0 10px;}
  .row b:first-child{margin-left:0;}
  button,select{font:inherit;font-size:11px;padding:5px 11px;border-radius:20px;
         border:1px solid #4a4032;background:transparent;color:#d8ccb4;cursor:pointer;}
  select{border-radius:6px;background:#191510;padding:4px 6px;}
  button.on{background:#efe7d8;color:#191510;border-color:#efe7d8;}
  button:focus-visible,select:focus-visible,a:focus-visible{outline:2px solid #d9a441;outline-offset:2px;}
  button:disabled{opacity:.4;cursor:default;}
  .sp{flex:1;}
  .note{font-size:11px;color:#a99a80;}
  .chips{display:flex;gap:6px;flex-wrap:wrap;align-items:center;}
  .chip{display:inline-flex;align-items:center;border-radius:20px;border:1px solid #4a4032;}
  .chip button{border:0;border-radius:20px;}
  .chip .nm{padding:4px 4px 4px 11px;color:#efe7d8;}
  .chip .nm small{color:#a99a80;}
  .chip.off{border-style:dashed;}
  .chip.off .nm{color:#7d715e;text-decoration:line-through;}
  .chip .x{padding:4px 9px 4px 5px;color:#a99a80;}
  .chip .cp{font-size:10px;color:#a99a80;border:1px solid #4a4032;border-radius:10px;padding:0 6px;margin-left:2px;cursor:help;}
  .chip.dup{border-style:dotted;}
  .focusbar{display:none;}
  body.focusing .focusbar{display:flex;}
  body.focusing .gridonly{display:none;}
  .focusbar .cur{color:#efe7d8;font-size:12px;margin:0 6px;}
  main{padding:12px 14px 40px;}
  #grid{display:grid;gap:14px;align-items:start;}
  #grid.focus{display:block;}
  #grid.focus .pane:not(.is-focus){display:none;}
  .pane{background:#141009;border:1px solid #3a3226;border-radius:8px;overflow:hidden;min-width:0;}
  #grid.focus .pane{margin:0 auto;}
  .pane-hd{display:flex;align-items:center;gap:4px;padding:5px 6px 5px 4px;border-bottom:1px solid #3a3226;}
  .pane-hd .nm{flex:1;min-width:0;text-align:left;border:0;border-radius:6px;padding:3px 8px;
         white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:#efe7d8;font-size:12px;}
  .pane-hd .nm small{color:#a99a80;font-size:11px;}
  .pane-hd .nm:hover{background:#221d16;}
  .pane-hd a,.pane-hd button.sm{font-size:11px;color:#d8ccb4;text-decoration:none;
         border:1px solid #4a4032;border-radius:20px;padding:3px 9px;white-space:nowrap;}
  .pane-bd{position:relative;overflow:hidden;background:#141009;}
  .pane-bd iframe{position:absolute;top:0;left:0;border:0;display:block;
         transform-origin:0 0;background:#fff;}
  .pane-st{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;
         background:#141009;color:#a99a80;font-size:11px;text-align:center;padding:10px;}
  .pane.ready .pane-st{display:none;}
  .empty{color:#a99a80;line-height:1.8;max-width:72ch;padding:30px 4px;}
  .empty b{color:#efe7d8;}
  .drop{outline:2px dashed #d9a441;outline-offset:-8px;}
</style>
</head>
<body>
  <header>
    <div class="row gridonly">
      <b>SHEETS</b>
      <select id="dir" title="Folders inside the site that hold .css files"></select>
      <button id="addDir" title="Add every .css file in the chosen folder">add folder</button>
      <button id="pickFiles" title="Choose .css files from anywhere on this computer">pick files…</button>
      <button id="pickDir" title="Choose a folder on this computer; every .css file in it is added">pick a folder…</button>
      <button id="clear">clear</button>
      <button id="copies" hidden title="Sheets that are the same file, or the same palette, as one already shown">copies</button>
      <span class="sp"></span>
      <span class="note" id="count"></span>
      <input type="file" id="fp" accept=".css,text/css" multiple hidden>
      <input type="file" id="dp" webkitdirectory multiple hidden>
    </div>
    <div class="row">
      <b>WIDTH</b>
      <span id="widths"></span>
      <b class="gridonly">COLUMNS</b>
      <span id="cols" class="gridonly"></span>
      <b>THEME</b>
      <button data-theme="light">light</button>
      <button data-theme="dark">dark</button>
      <b>GO TO</b>
      <select id="section"><option value="">section…</option></select>
      <button id="sync" title="Scrolling one view scrolls the others to the same place">sync scroll</button>
      <button id="reload" title="Reload every view (picks up edits to the sheets)">reload</button>
    </div>
    <div class="row focusbar">
      <b>FOCUS</b>
      <button id="prev" title="Previous sheet (←)">‹ prev</button>
      <span class="cur" id="cur"></span>
      <button id="next" title="Next sheet (→)">next ›</button>
      <span class="sp"></span>
      <button id="back" title="Back to the side-by-side grid (Esc)">back to grid</button>
    </div>
    <div class="chips gridonly" id="chips"></div>
  </header>

  <main>
    <div id="grid"></div>
    <div class="empty" id="empty" hidden>
      No stylesheets yet. Choose a folder above and press <b>add folder</b>,
      <b>pick files…</b> from anywhere on this computer, or drop .css files
      onto this page. Each sheet opens as its own copy of the site, side by side.
      Click a sheet's name to focus on it alone; <b>Esc</b> comes back.
    </div>
  </main>

<script>
(function () {
  'use strict';
  var DEV = {
    desktop: { w: 1440, h: 900,  label: 'desktop 1440' },
    laptop:  { w: 1280, h: 800,  label: 'laptop 1280' },
    tablet:  { w: 820,  h: 1180, label: 'tablet 820' },
    phone:   { w: 390,  h: 844,  label: 'phone 390' }
  };
  var KEY = 'rs-compare';
  var S = { width: 'desktop', cols: 'auto', theme: 'light', sync: true, copies: false };
  /* {key, name, sub, f | u, h, palette, shown, dupOf} in display order.
     dupOf: the key of an earlier sheet that is the same file (same
     fingerprint) or the same palette (same theme id and colour hash, e.g. a
     generated sheet and its copy in altStyles/). Copies stay in the list
     but are not drawn unless "copies" is switched on. */
  var sheets = [];
  var panes = {};           /* key -> pane */
  var focusKey = null;
  var anchor = null;        /* where the views are: {id, frac} or {y} */
  var $ = function (id) { return document.getElementById(id); };
  var grid = $('grid');

  /* ---- saved settings: sizes, theme, and the sheets taken from folders
     (picked files live in the server's memory only, so they are not kept) */
  function save() {
    try {
      localStorage.setItem(KEY, JSON.stringify({
        S: S,
        sheets: sheets.filter(function (s) { return s.f; })
                      .map(function (s) { return { f: s.f, shown: s.shown }; })
      }));
    } catch (e) {}
  }
  function restore() {
    try {
      var o = JSON.parse(localStorage.getItem(KEY) || 'null');
      if (o && o.S) Object.keys(S).forEach(function (k) { if (k in o.S) S[k] = o.S[k]; });
      return o;
    } catch (e) { return null; }
  }

  function api(url, opts) {
    return fetch(url, opts).then(function (r) {
      if (!r.ok) return r.text().then(function (t) { throw new Error(t || r.status); });
      return r.json();
    });
  }
  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function nameParts(path) {
    var i = path.lastIndexOf('/');
    return { name: path.slice(i + 1), sub: i >= 0 ? path.slice(0, i + 1) : '' };
  }

  /* ---- adding sheets ---- */
  function addSheet(s) {
    if (sheets.some(function (x) { return x.key === s.key; })) return;
    s.shown = s.shown !== false;
    sheets.push(s);
  }
  function addListed(item, shown) {
    var p = nameParts(item.path);
    addSheet({ key: 'f:' + item.path, f: item.path, name: p.name, sub: p.sub,
               h: item.hash, palette: item.palette, shown: shown });
  }
  function addFolder(dir) {
    return api('/__compare/sheets?dir=' + encodeURIComponent(dir)).then(function (list) {
      list.forEach(function (s) { addListed(s); });
      refresh();
    }).catch(function (e) { alert('Could not read that folder: ' + e.message); });
  }
  /* Saved paths come back with their folder's listing, so each one has its
     fingerprint again (and files deleted since are skipped). */
  function restoreSheets(list) {
    var dirs = {};
    list.forEach(function (s) { dirs[nameParts(s.f).sub.replace(/\/$/, '')] = 1; });
    var info = {};
    return Promise.all(Object.keys(dirs).map(function (d) {
      return api('/__compare/sheets?dir=' + encodeURIComponent(d)).then(function (rows) {
        rows.forEach(function (r) { info[r.path] = r; });
      }).catch(function () {});
    })).then(function () {
      list.forEach(function (s) { if (info[s.f]) addListed(info[s.f], s.shown); });
      refresh();
    });
  }
  function isDup(s) { return !!s.dupOf && !S.copies; }
  function isVisible(s) { return s.shown && !isDup(s); }
  function markCopies() {
    var byHash = {}, byPal = {};
    sheets.forEach(function (s) {
      s.dupOf = (s.h && byHash[s.h]) || (s.palette && byPal[s.palette]) || null;
      if (!s.dupOf) {
        if (s.h) byHash[s.h] = s.key;
        if (s.palette) byPal[s.palette] = s.key;
      }
    });
  }
  function addFiles(files, from) {
    var css = Array.prototype.filter.call(files, function (f) { return /\.css$/i.test(f.name); });
    if (!css.length) { alert('No .css files there.'); return; }
    var jobs = css.map(function (f) {
      return f.text().then(function (text) {
        return api('/__compare/upload', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: f.name, css: text })
        }).then(function (r) {
          var rel = f.webkitRelativePath || '';
          var sub = rel ? rel.slice(0, rel.length - f.name.length) : from;
          addSheet({ key: 'u:' + r.id, u: r.id, name: f.name, sub: sub,
                     h: r.hash, palette: r.palette });
        });
      }).catch(function (e) { alert(f.name + ': ' + e.message); });
    });
    Promise.all(jobs).then(refresh);
  }

  /* ---- panes ---- */
  function viewUrl(s) {
    return '/__compare-view?' + (s.f ? 'f=' + encodeURIComponent(s.f) : 'u=' + s.u) + '&editor=0';
  }
  function makePane(s) {
    var el = document.createElement('div');
    el.className = 'pane';
    el.innerHTML =
      '<div class="pane-hd">' +
        '<button class="nm" title="' + esc(s.sub + s.name) + ': focus on this sheet alone">' + esc(s.name) +
          (s.sub ? ' <small>' + esc(s.sub) + '</small>' : '') + '</button>' +
        '<a href="' + viewUrl(s) + '" target="_blank" rel="noopener" title="Open this view in its own tab">open ↗</a>' +
        '<button class="sm hide" title="Hide this sheet (it stays in the list above)">hide</button>' +
      '</div>' +
      '<div class="pane-bd"><div class="pane-st">loading…</div>' +
        '<iframe title="' + esc(s.name) + '"></iframe></div>';
    var p = { key: s.key, sheet: s, el: el, body: el.querySelector('.pane-bd'),
              frame: el.querySelector('iframe'), ready: false, lock: 0 };
    el.querySelector('.nm').addEventListener('click', function () {
      focusKey === s.key ? exitFocus() : enterFocus(s.key);
    });
    el.querySelector('.hide').addEventListener('click', function () {
      s.shown = false; if (focusKey === s.key) exitFocus(); refresh();
    });
    p.frame.addEventListener('load', function () { hook(p); });
    p.frame.src = viewUrl(s);
    grid.appendChild(el);
    return p;
  }
  function dropPane(key) {
    var p = panes[key];
    if (!p) return;
    p.el.remove();
    delete panes[key];
  }

  /* After a view loads: theme, scroll sync, keys, and land where the
     others are once the page has finished building itself. */
  function hook(p) {
    var w;
    try { w = p.frame.contentWindow; if (!w.document.body) return; } catch (e) { return; }
    p.ready = false;
    var t0 = Date.now();
    (function wait() {
      var built = w.__resumeData || Date.now() - t0 > 6000;
      if (!built) { setTimeout(wait, 80); return; }
      setTimeout(function () {
        p.ready = true;
        p.el.classList.add('ready');
        applyTheme(p);
        fillSections(w.document);
        if (anchor) placeSoon(p, anchor);
      }, 120);
    })();
    var raf = 0;
    w.addEventListener('scroll', function () {
      if (raf) return;
      raf = requestAnimationFrame(function () { raf = 0; onScroll(p); });
    }, { passive: true });
    w.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && focusKey) exitFocus();
    });
  }

  /* ---- where a view is, by section, so sheets with different spacing
     still line up on the same content ---- */
  /* Layout position, ignoring transforms: sections slide up as they are
     revealed, so their on-screen box is briefly 24px off. */
  function absTop(el) {
    var y = 0;
    while (el) { y += el.offsetTop; el = el.offsetParent; }
    return y;
  }
  function sectionsOf(d) {
    return Array.prototype.slice.call(d.querySelectorAll('section[id], footer'));
  }
  function where(p) {
    try {
      var w = p.frame.contentWindow, d = w.document, y = w.scrollY, best = null;
      sectionsOf(d).forEach(function (s) {
        if (!s.offsetHeight) return;
        var top = absTop(s);
        if (top <= y + 2) best = { s: s, top: top };
      });
      if (!best) return { y: y };
      return { id: best.s.id || '#footer', frac: (y - best.top) / Math.max(1, best.s.offsetHeight) };
    } catch (e) { return null; }
  }
  function place(p, pos) {
    if (!p.ready || !pos) return;
    try {
      var w = p.frame.contentWindow, d = w.document, y = pos.y || 0;
      if (pos.id) {
        var s = pos.id === '#footer' ? d.querySelector('footer') : d.getElementById(pos.id);
        if (s) {
          y = absTop(s) + (pos.frac || 0) * s.offsetHeight;
          if (pos.jump) {
            var bar = d.querySelector('.topbar');
            if (bar && /sticky|fixed/.test(w.getComputedStyle(bar).position)) y -= bar.offsetHeight;
          }
        }
      }
      p.lock = performance.now() + 150;
      w.scrollTo({ top: Math.max(0, y), behavior: 'instant' });
    } catch (e) {}
  }
  /* A view that has just been shown or resized may still be settling
     (its page re-lays itself out on resize), so place it again shortly. */
  function placeSoon(p, pos) {
    if (!pos) return;
    requestAnimationFrame(function () { place(p, pos); });
    setTimeout(function () { place(p, pos); }, 180);
    setTimeout(function () { place(p, pos); }, 500);
  }
  function onScroll(p) {
    if (performance.now() < p.lock) return;
    var pos = where(p);
    if (!pos) return;
    anchor = pos;
    if (!S.sync) return;
    eachShown(function (q) { if (q !== p) place(q, pos); });
  }
  function eachShown(fn) {
    sheets.forEach(function (s) {
      var p = panes[s.key];
      if (p && isVisible(s) && (!focusKey || s.key === focusKey)) fn(p);
    });
  }

  /* ---- section menu, from the first view that finishes ---- */
  var sectionsFilled = false;
  function fillSections(d) {
    if (sectionsFilled) return;
    var sel = $('section');
    sectionsOf(d).forEach(function (s) {
      if (!s.id || !s.offsetHeight) return;
      var t = s.querySelector('[data-section-title]');
      var label = s.id === 'hero' ? 'top' :
        (t ? t.getAttribute('data-section-title') : s.id.replace(/-/g, ' '));
      var o = document.createElement('option');
      o.value = s.id; o.textContent = label.toLowerCase();
      sel.appendChild(o);
    });
    sectionsFilled = true;
  }

  /* ---- theme: press the page's own day/night buttons, so each view runs
     its normal theme code (palette, colour overrides, course colours) ---- */
  function applyTheme(p) {
    try {
      var d = p.frame.contentWindow.document;
      var b = d.getElementById(S.theme === 'dark' ? 'btn-night' : 'btn-day');
      if (b && !b.classList.contains('active')) b.click();
    } catch (e) {}
  }

  /* ---- sizing: each view renders at a real device width and is scaled
     down to fit its column, the same way a browser zooms out ---- */
  function layout() {
    var dv = DEV[S.width] || DEV.desktop;
    var gw = grid.clientWidth;
    var shown = sheets.filter(function (s) { return isVisible(s) && panes[s.key]; });
    $('empty').hidden = sheets.length > 0;
    if (focusKey && panes[focusKey]) {
      var p = panes[focusKey];
      var head = p.el.querySelector('.pane-hd').offsetHeight;
      var avH = window.innerHeight - document.querySelector('header').offsetHeight - head - 40;
      var sc = Math.min(1, gw / dv.w);
      var bh = Math.max(240, avH);
      p.el.style.width = Math.round(dv.w * sc) + 'px';
      size(p, dv.w, bh / sc, sc, bh);
      return;
    }
    var cols;
    if (S.cols === 'auto') {
      var minW = S.width === 'phone' ? 230 : S.width === 'tablet' ? 300 : 400;
      cols = Math.max(1, Math.min(shown.length || 1, Math.floor((gw + 14) / (minW + 14))));
    } else {
      cols = +S.cols;
    }
    grid.style.gridTemplateColumns = 'repeat(' + cols + ', minmax(0, 1fr))';
    /* Scale from the width the column really got, so the view fills it
       exactly instead of leaving a sliver at the edge. */
    var first = shown.length && panes[shown[0].key];
    var pw = first ? first.body.clientWidth : (gw - 14 * (cols - 1)) / cols - 2;
    var s = pw / dv.w;
    sheets.forEach(function (sh, i) {
      var q = panes[sh.key];
      if (!q) return;
      q.el.style.width = '';
      q.el.style.order = i;
      size(q, dv.w, dv.h, s, dv.h * s);
    });
  }
  function size(p, w, h, s, bh) {
    p.body.style.height = Math.round(bh) + 'px';
    p.frame.style.width = w + 'px';
    p.frame.style.height = Math.round(h) + 'px';
    p.frame.style.transform = 'scale(' + s + ')';
  }

  /* ---- focus: one sheet fills the page, at the same spot ---- */
  function enterFocus(key) {
    var from = focusKey ? panes[focusKey] : panes[key];
    var pos = (from && from.ready && where(from)) || anchor;
    focusKey = key;
    grid.classList.add('focus');
    Object.keys(panes).forEach(function (k) { panes[k].el.classList.toggle('is-focus', k === key); });
    document.body.classList.add('focusing');
    var visible = sheets.filter(isVisible);
    var i = visible.findIndex(function (s) { return s.key === key; });
    var s = visible[i];
    $('cur').textContent = s.name + '  (' + (i + 1) + ' of ' + visible.length + ')';
    $('prev').disabled = $('next').disabled = visible.length < 2;
    layout();
    window.scrollTo(0, 0);
    anchor = pos;
    placeSoon(panes[key], pos);
  }
  function step(d) {
    var visible = sheets.filter(isVisible);
    if (visible.length < 2 || !focusKey) return;
    var i = visible.findIndex(function (s) { return s.key === focusKey; });
    enterFocus(visible[(i + d + visible.length) % visible.length].key);
  }
  function exitFocus() {
    if (!focusKey) return;
    var p = panes[focusKey], pos = (p && where(p)) || anchor;
    focusKey = null;
    grid.classList.remove('focus');
    Object.keys(panes).forEach(function (k) { panes[k].el.classList.remove('is-focus'); });
    document.body.classList.remove('focusing');
    layout();
    anchor = pos;
    eachShown(function (q) { placeSoon(q, pos); });
  }

  /* ---- the sheet list ---- */
  function refresh() {
    markCopies();
    if (focusKey && !sheets.some(function (s) { return s.key === focusKey && isVisible(s); })) exitFocus();
    sheets.forEach(function (s) {
      if (isVisible(s) && !panes[s.key]) panes[s.key] = makePane(s);
      if (!isVisible(s) && panes[s.key]) dropPane(s.key);
    });
    Object.keys(panes).forEach(function (k) {
      if (!sheets.some(function (s) { return s.key === k; })) dropPane(k);
    });
    var box = $('chips');
    box.innerHTML = '';
    var copiesOf = {};
    sheets.forEach(function (s) {
      if (s.dupOf) (copiesOf[s.dupOf] = copiesOf[s.dupOf] || []).push(s.sub + s.name);
    });
    sheets.forEach(function (s, i) {
      if (isDup(s)) return;
      var c = document.createElement('span');
      var cp = copiesOf[s.key] || [];
      c.className = 'chip' + (s.shown ? '' : ' off') + (s.dupOf ? ' dup' : '');
      c.innerHTML = '<button class="nm" title="' + (s.shown ? 'Hide' : 'Show') + ' this sheet' +
          (s.dupOf ? ' (a copy of one already listed)' : '') + '">' +
        esc(s.name) + (s.sub ? ' <small>' + esc(s.sub) + '</small>' : '') +
        (s.dupOf ? ' <small>copy</small>' : '') + '</button>' +
        (cp.length && !S.copies ? '<span class="cp" title="Also here, not shown: ' + esc(cp.join(', ')) + '">+' + cp.length + '</span>' : '') +
        '<button class="x" title="Remove from the comparison" aria-label="Remove ' + esc(s.name) + '">×</button>';
      c.querySelector('.nm').addEventListener('click', function () { s.shown = !s.shown; refresh(); });
      c.querySelector('.x').addEventListener('click', function () { sheets.splice(i, 1); refresh(); });
      box.appendChild(c);
    });
    var unique = sheets.filter(function (s) { return !s.dupOf; });
    var dups = sheets.length - unique.length;
    var n = sheets.filter(isVisible).length;
    $('count').textContent = sheets.length
      ? n + ' shown of ' + unique.length + ' unique' + (dups ? ' · ' + dups + (dups === 1 ? ' copy' : ' copies') + (S.copies ? ' included' : ' hidden') : '')
      : '';
    $('copies').hidden = !dups;
    $('copies').textContent = S.copies ? 'hide copies' : 'show copies';
    paintControls();
    layout();
    save();
  }

  function paintControls() {
    Array.prototype.forEach.call(document.querySelectorAll('#widths button'), function (b) {
      b.classList.toggle('on', b.dataset.w === S.width);
    });
    Array.prototype.forEach.call(document.querySelectorAll('#cols button'), function (b) {
      b.classList.toggle('on', b.dataset.c === String(S.cols));
    });
    Array.prototype.forEach.call(document.querySelectorAll('[data-theme]'), function (b) {
      b.classList.toggle('on', b.dataset.theme === S.theme);
    });
    $('sync').classList.toggle('on', !!S.sync);
    $('copies').classList.toggle('on', !!S.copies);
  }

  /* ---- controls ---- */
  Object.keys(DEV).forEach(function (k) {
    var b = document.createElement('button');
    b.textContent = DEV[k].label; b.dataset.w = k;
    b.addEventListener('click', function () {
      S.width = k; paintControls(); layout(); save();
      eachShown(function (q) { placeSoon(q, anchor); });
    });
    $('widths').appendChild(b);
  });
  ['auto', '1', '2', '3', '4', '5', '6'].forEach(function (c) {
    var b = document.createElement('button');
    b.textContent = c; b.dataset.c = c;
    b.addEventListener('click', function () { S.cols = c; paintControls(); layout(); save(); });
    $('cols').appendChild(b);
  });
  Array.prototype.forEach.call(document.querySelectorAll('[data-theme]'), function (b) {
    b.addEventListener('click', function () {
      S.theme = b.dataset.theme; paintControls(); save();
      Object.keys(panes).forEach(function (k) { applyTheme(panes[k]); });
    });
  });
  $('sync').addEventListener('click', function () { S.sync = !S.sync; paintControls(); save(); });
  $('section').addEventListener('change', function () {
    var id = this.value;
    if (!id) return;
    anchor = { id: id, frac: 0, jump: true };
    eachShown(function (q) { placeSoon(q, anchor); });
    this.value = '';
  });
  $('reload').addEventListener('click', function () {
    Object.keys(panes).forEach(function (k) {
      var p = panes[k]; p.ready = false; p.el.classList.remove('ready');
      p.frame.src = viewUrl(p.sheet);
    });
  });
  $('addDir').addEventListener('click', function () { addFolder($('dir').value); });
  $('pickFiles').addEventListener('click', function () { $('fp').click(); });
  $('pickDir').addEventListener('click', function () { $('dp').click(); });
  $('fp').addEventListener('change', function () { addFiles(this.files, 'picked'); this.value = ''; });
  $('dp').addEventListener('change', function () { addFiles(this.files, 'picked'); this.value = ''; });
  $('clear').addEventListener('click', function () { exitFocus(); sheets = []; refresh(); });
  $('copies').addEventListener('click', function () { S.copies = !S.copies; refresh(); });
  $('prev').addEventListener('click', function () { step(-1); });
  $('next').addEventListener('click', function () { step(1); });
  $('back').addEventListener('click', exitFocus);
  document.addEventListener('keydown', function (e) {
    if (/^(INPUT|SELECT|TEXTAREA)$/.test((e.target || {}).tagName || '')) return;
    if (e.key === 'Escape') exitFocus();
    if (focusKey && e.key === 'ArrowLeft') step(-1);
    if (focusKey && e.key === 'ArrowRight') step(1);
  });
  /* Drop .css files straight onto the page. */
  document.addEventListener('dragover', function (e) { e.preventDefault(); document.body.classList.add('drop'); });
  document.addEventListener('dragleave', function (e) { if (!e.relatedTarget) document.body.classList.remove('drop'); });
  document.addEventListener('drop', function (e) {
    e.preventDefault(); document.body.classList.remove('drop');
    if (e.dataTransfer && e.dataTransfer.files.length) addFiles(e.dataTransfer.files, 'dropped');
  });
  var rt = 0;
  window.addEventListener('resize', function () { clearTimeout(rt); rt = setTimeout(layout, 120); });

  /* ---- start: ?dir=<folder> loads that folder; otherwise the last set;
     otherwise every sheet next to index.html ---- */
  var saved = restore();
  var want = new URLSearchParams(location.search).get('dir');
  api('/__compare/dirs').then(function (dirs) {
    var sel = $('dir');
    dirs.forEach(function (d) {
      var o = document.createElement('option');
      o.value = d.dir;
      o.textContent = (d.dir || '(site folder)') + '  ·  ' + d.count + ' sheet' + (d.count === 1 ? '' : 's');
      sel.appendChild(o);
    });
    if (want !== null) sel.value = want;
    else if (dirs.some(function (d) { return d.dir === 'altStyles'; })) sel.value = 'altStyles';
  }).catch(function () {});
  if (want !== null) {
    addFolder(want);
  } else if (saved && saved.sheets && saved.sheets.length) {
    restoreSheets(saved.sheets);
  } else {
    /* First visit: the sheets next to index.html, plus altStyles/ when the
       site keeps its alternatives there. */
    addFolder('').then(function () {
      return api('/__compare/dirs').then(function (dirs) {
        if (dirs.some(function (d) { return d.dir === 'altStyles'; })) return addFolder('altStyles');
      });
    }).catch(function () {});
  }
  paintControls();
})();
</script>
</body>
</html>
"""



CONFIG_FILE  = 'site-config.json'
BACKUP_DIR   = '.site-config-backups'



FETCH_MAX_BYTES = 15 * 1024 * 1024


def fetch_remote_file(url, name=None, folder='assets'):
    """Download an image or PDF from a link into the assets folder.

    Used by the editor's "fetch into assets" button for course certificates,
    so the site can show the file from its own folder instead of depending on
    someone else's server each time a visitor opens it.

    Returns (ok, info): info is {'file', 'bytes', 'kind'} or an error string.
    Only http(s) links are followed, the size is capped, and the file type is
    decided from the bytes themselves, never from the link or the server's
    say-so, so a web page (or anything else) can't be saved as "a.pdf".
    """
    import re
    import urllib.request
    import urllib.parse
    url = str(url or '').strip()
    if not re.match(r'^https?://', url, re.I):
        return False, 'only http:// and https:// links can be fetched'
    try:
        req = urllib.request.Request(url, headers={
            'User-Agent': 'Mozilla/5.0 (portfolio dev server)',
            'Accept': 'image/*,application/pdf,*/*;q=0.5'})
        with urllib.request.urlopen(req, timeout=25) as r:
            ctype = (r.headers.get('Content-Type') or '').split(';')[0].strip().lower()
            data = r.read(FETCH_MAX_BYTES + 1)
    except Exception as e:
        return False, f'could not download: {e.__class__.__name__}: {e}'
    if len(data) > FETCH_MAX_BYTES:
        return False, f'file is larger than {FETCH_MAX_BYTES // (1024 * 1024)} MB'
    head = data[:16]
    if head.startswith(b'%PDF'):
        ext = 'pdf'
    elif head.startswith(b'\x89PNG\r\n\x1a\n'):
        ext = 'png'
    elif head.startswith(b'\xff\xd8\xff'):
        ext = 'jpg'
    elif head[:6] in (b'GIF87a', b'GIF89a'):
        ext = 'gif'
    elif head[:4] == b'RIFF' and data[8:12] == b'WEBP':
        ext = 'webp'
    elif ctype == 'image/svg+xml' and b'<svg' in data[:2048].lower():
        ext = 'svg'
    else:
        what = ctype or 'an unrecognised type'
        return False, (f'that link returned {what}, not an image or a PDF. '
                       'If it is a web page, use it as the Link instead.')
    base = str(name or '').strip() or os.path.basename(urllib.parse.urlparse(url).path)
    base = re.sub(r'\.[A-Za-z0-9]{2,5}$', '', base)
    base = re.sub(r'[^A-Za-z0-9]+', '-', base).strip('-').lower()[:60] or 'certificate'
    fname = f'cert-{base}.{ext}'
    ok, dest = _safe_path(os.path.join(folder, fname))
    if not ok:
        return False, 'refusing to write outside the site folder'
    try:
        os.makedirs(os.path.dirname(dest), exist_ok=True)
        with open(dest, 'wb') as f:
            f.write(data)
    except Exception as e:
        return False, f'could not save: {e.__class__.__name__}: {e}'
    return True, {'file': fname, 'bytes': len(data), 'kind': ext}


def check_embeddable(url):
    """Ask a web page whether it allows being shown inside another site.

    A page refuses through one of two response headers: X-Frame-Options, or
    a Content-Security-Policy with a frame-ancestors rule. A browser enforces
    them silently (the frame just stays blank) and a script on the page can't
    see them, which is why the editor asks this server to look instead.

    Returns (ok, info): info is {'embeddable': True/False, 'reason': str},
    or an error string when the page could not be reached at all.
    """
    import re
    import urllib.request
    import urllib.error
    url = str(url or '').strip()
    if not re.match(r'^https?://', url, re.I):
        return False, 'only http:// and https:// links can be checked'
    req = urllib.request.Request(url, headers={
        'User-Agent': 'Mozilla/5.0 (portfolio dev server)', 'Accept': 'text/html,*/*;q=0.5'})
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            headers, status = r.headers, r.status
    except urllib.error.HTTPError as e:
        headers, status = e.headers, e.code          # refusals still carry the headers
    except Exception as e:
        return False, f'could not reach the page: {e.__class__.__name__}: {e}'
    xfo = (headers.get('X-Frame-Options') or '').strip().lower()
    csp = '; '.join(headers.get_all('Content-Security-Policy') or [])
    m = re.search(r'frame-ancestors\s+([^;]*)', csp, re.I)
    if m:
        allowed = m.group(1).split()
        if '*' in allowed or 'https:' in allowed:
            return True, {'embeddable': True, 'reason': 'its frame-ancestors rule allows any site'}
        return True, {'embeddable': False,
                      'reason': 'it only allows itself or named sites to show it '
                                f'(frame-ancestors {" ".join(allowed) or "none"})'}
    if xfo:
        return True, {'embeddable': False, 'reason': f'it sends X-Frame-Options: {xfo}'}
    if status >= 400:
        return True, {'embeddable': False, 'reason': f'the page answered with an error (HTTP {status})'}
    return True, {'embeddable': True, 'reason': 'no header forbids it'}


def _safe_path(rel):
    """Resolve a user-typed path inside ROOT.

    Returns (ok, absolute_path). ok is False when the path escapes the
    served folder — this is a dev server, but it still shouldn't hand out
    arbitrary files just because someone typed '../../.ssh/id_rsa'.
    """
    full = os.path.abspath(os.path.join(ROOT, os.path.expanduser(rel)))
    root = os.path.abspath(ROOT)
    return (full == root or full.startswith(root + os.sep)), full



TEX_BACKUP_DIR = '.resume-backups'


def read_resume():
    """Return the raw LaTeX source, or None."""
    p = os.path.join(ROOT, 'assets', 'resume.tex')
    if not os.path.exists(p):
        return None
    return open(p, encoding='utf-8').read()


def save_resume(text):
    """Write resume.tex, snapshotting the previous version first.

    This is the file that generates the PDF, so a bad write matters more
    than a bad site-config. Every save is backed up, and the incoming text
    is sanity-checked for the document skeleton before it replaces
    anything — an empty or truncated POST should not be able to destroy a
    resume.
    """
    import datetime
    import shutil
    if not isinstance(text, str) or len(text) < 200:
        return False, 'refused: content too short to be a resume'
    if '\\begin{document}' not in text or '\\end{document}' not in text:
        return False, 'refused: missing \\begin{document} / \\end{document}'

    target = os.path.join(ROOT, 'assets', 'resume.tex')
    try:
        if os.path.exists(target):
            bdir = os.path.join(ROOT, TEX_BACKUP_DIR)
            os.makedirs(bdir, exist_ok=True)
            stamp = datetime.datetime.now().strftime('%Y%m%d-%H%M%S')
            name = f'resume.{stamp}.tex'
            shutil.copy2(target, os.path.join(bdir, name))
        else:
            name = None
        with open(target, 'w', encoding='utf-8') as f:
            f.write(text)
        return True, name
    except Exception as e:
        return False, f'{e.__class__.__name__}: {e}'


def revert_resume():
    """Restore resume.tex from the most recent snapshot."""
    import shutil
    bdir = os.path.join(ROOT, TEX_BACKUP_DIR)
    if not os.path.isdir(bdir):
        return False, 'no backups directory'
    snaps = sorted(glob.glob(os.path.join(bdir, 'resume.*.tex')))
    if not snaps:
        return False, 'no backups found'
    try:
        shutil.copy2(snaps[-1], os.path.join(ROOT, 'assets', 'resume.tex'))
        return True, os.path.basename(snaps[-1])
    except Exception as e:
        return False, f'{e.__class__.__name__}: {e}'



HTML_BACKUP_DIR = '.html-backups'


def save_index(text):
    """Write index.html, snapshotting first.

    Same reasoning as save_resume: this is a source file, so an empty or
    truncated POST must not be able to replace it.
    """
    import datetime
    import shutil
    if not isinstance(text, str) or len(text) < 300:
        return False, 'refused: content too short to be index.html'
    low = text.lower()
    if '<html' not in low or '</html>' not in low or '<body' not in low:
        return False, 'refused: missing <html> / <body> structure'
    if 'script.js' not in text:
        return False, 'refused: script.js reference missing — the page would render empty'

    target = os.path.join(ROOT, 'index.html')
    try:
        bdir = os.path.join(ROOT, HTML_BACKUP_DIR)
        os.makedirs(bdir, exist_ok=True)
        stamp = datetime.datetime.now().strftime('%Y%m%d-%H%M%S')
        name = f'index.{stamp}.html'
        shutil.copy2(target, os.path.join(bdir, name))
        with open(target, 'w', encoding='utf-8') as f:
            f.write(text)
        return True, name
    except Exception as e:
        return False, f'{e.__class__.__name__}: {e}'


def revert_index():
    import shutil
    bdir = os.path.join(ROOT, HTML_BACKUP_DIR)
    if not os.path.isdir(bdir):
        return False, 'no backups directory'
    snaps = sorted(glob.glob(os.path.join(bdir, 'index.*.html')))
    if not snaps:
        return False, 'no backups found'
    try:
        shutil.copy2(snaps[-1], os.path.join(ROOT, 'index.html'))
        return True, os.path.basename(snaps[-1])
    except Exception as e:
        return False, f'{e.__class__.__name__}: {e}'


def _save_with_backup(full, tag):
    """Snapshot a file into .source-backups/ before it is overwritten."""
    import datetime
    import shutil
    try:
        bdir = os.path.join(ROOT, '.source-backups')
        os.makedirs(bdir, exist_ok=True)
        stamp = datetime.datetime.now().strftime('%Y%m%d-%H%M%S')
        name = f'{tag}.{stamp}.bak'
        if os.path.exists(full):
            shutil.copy2(full, os.path.join(bdir, name))
        return True, name
    except Exception as e:
        return False, f'{e.__class__.__name__}: {e}'


def list_style_names():
    """Short names of the style-*.css files sitting next to index.html."""
    out = []
    for p in sorted(glob.glob(os.path.join(ROOT, 'style-*.css'))):
        stem = os.path.splitext(os.path.basename(p))[0]
        out.append(stem[len('style-'):])
    return out


def save_config(payload):
    """Write site-config.json, snapshotting the previous version first.

    Returns (ok, backup_name_or_error). Backups are timestamped and kept
    indefinitely - they're small, and losing a colour scheme you liked is
    more annoying than a few stray files.
    """
    import datetime
    import shutil
    target = os.path.join(ROOT, CONFIG_FILE)
    backup_name = None
    try:
        if os.path.exists(target):
            bdir = os.path.join(ROOT, BACKUP_DIR)
            os.makedirs(bdir, exist_ok=True)
            stamp = datetime.datetime.now().strftime('%Y%m%d-%H%M%S')
            backup_name = f'site-config.{stamp}.json'
            shutil.copy2(target, os.path.join(bdir, backup_name))
        with open(target, 'w', encoding='utf-8') as f:
            json.dump(payload, f, indent=2, ensure_ascii=False)
            f.write('\n')
        return True, backup_name
    except Exception as e:
        return False, f'{e.__class__.__name__}: {e}'


def revert_config():
    """Restore site-config.json from the most recent snapshot."""
    import shutil
    bdir = os.path.join(ROOT, BACKUP_DIR)
    if not os.path.isdir(bdir):
        return False, 'no backups directory'
    snaps = sorted(glob.glob(os.path.join(bdir, 'site-config.*.json')))
    if not snaps:
        return False, 'no backups found'
    newest = snaps[-1]
    try:
        shutil.copy2(newest, os.path.join(ROOT, CONFIG_FILE))
        return True, os.path.basename(newest)
    except Exception as e:
        return False, f'{e.__class__.__name__}: {e}'



# ============================================================
# Palette generation (ported from the old generate-palettes.js)
# ------------------------------------------------------------
# Rebuilds the four style-*.css variants from style.css by
# replacing its "1. Tokens" section with recomputed colour
# tokens, leaving everything after "2. Reset & base" untouched.
#
# NOTE ON ROUNDING: JavaScript's Math.round rounds .5 upward,
# while Python's round() uses banker's rounding (.5 to even).
# Using round() here would silently shift some channels by one,
# so _js_round reproduces the JS behaviour exactly and the
# output stays byte-identical to the old Node script.
# ============================================================

def _js_round(x):
    return math.floor(x + 0.5)


def _hex_to_hsl(hex_str):
    h = hex_str.lstrip('#')
    r = int(h[0:2], 16) / 255
    g = int(h[2:4], 16) / 255
    b = int(h[4:6], 16) / 255
    mx, mn = max(r, g, b), min(r, g, b)
    l = (mx + mn) / 2
    if mx == mn:
        hh = 0.0
        s = 0.0
    else:
        d = mx - mn
        s = d / (2 - mx - mn) if l > 0.5 else d / (mx + mn)
        if mx == r:
            hh = (g - b) / d + (6 if g < b else 0)
        elif mx == g:
            hh = (b - r) / d + 2
        else:
            hh = (r - g) / d + 4
        hh /= 6
    return hh * 360, s * 100, l * 100


def _hsl_to_hex(h, s, l):
    h = ((h % 360) + 360) % 360 / 360
    s = s / 100
    l = max(0, min(100, l)) / 100
    if s == 0:
        r = g = b = l
    else:
        def hue2rgb(p, q, t):
            if t < 0:
                t += 1
            if t > 1:
                t -= 1
            if t < 1 / 6:
                return p + (q - p) * 6 * t
            if t < 1 / 2:
                return q
            if t < 2 / 3:
                return p + (q - p) * (2 / 3 - t) * 6
            return p
        q = l * (1 + s) if l < 0.5 else l + s - l * s
        p = 2 * l - q
        r = hue2rgb(p, q, h + 1 / 3)
        g = hue2rgb(p, q, h)
        b = hue2rgb(p, q, h - 1 / 3)
    return '#' + ''.join('%02x' % _js_round(c * 255) for c in (r, g, b))


def _shift(hex_str, delta):
    h, s, l = _hex_to_hsl(hex_str)
    return _hsl_to_hex(h, s, l + delta)


def _shift_sat(hex_str, ldelta, sdelta=0):
    h, s, l = _hex_to_hsl(hex_str)
    return _hsl_to_hex(h, max(0, s + sdelta), l + ldelta)


PALETTES = {
    'rust-cream': {
        'name': 'Rust on cream',
        'light': {'bg': '#f3ede1', 'ink': '#18130d', 'accent': '#b54520', 'rule': '#c9bda4', 'muted': '#847562'},
        'dark':  {'bg': '#16111f', 'ink': '#e9e3f2', 'accent': '#b98cf0', 'rule': '#37304a', 'muted': '#8d84a3'},
    },
    'aegean-clay': {
        'name': 'Aegean clay',
        'light': {'bg': '#edebe3', 'ink': '#0f1d2e', 'accent': '#c47c4e', 'rule': '#cdc8b8', 'muted': '#787569'},
        'dark':  {'bg': '#0a121e', 'ink': '#dce3eb', 'accent': '#e8a36b', 'rule': '#293549', 'muted': '#7e8693'},
    },
    'forest-green': {
        'name': 'Forest green',
        'light': {'bg': '#eaeee5', 'ink': '#142817', 'accent': '#b97d4a', 'rule': '#c0c8b5', 'muted': '#6a7660'},
        'dark':  {'bg': '#0d1d14', 'ink': '#d8dcd3', 'accent': '#d09762', 'rule': '#233129', 'muted': '#7a8e7e'},
    },
    'day-night': {
        'name': 'Day & Night',
        'light': {'bg': '#f5e8d0', 'ink': '#1f1208', 'accent': '#d96a1a', 'rule': '#dcc8a4', 'muted': '#8a7858'},
        'dark':  {'bg': '#0c1538', 'ink': '#dce0ee', 'accent': '#e6c069', 'rule': '#283154', 'muted': '#828aa6'},
    },
    'ink-vermilion': {
        'name': 'Ink & vermilion',
        'light': {'bg': '#f4f1ea', 'ink': '#1a1814', 'accent': '#b8400c', 'rule': '#d3ccbd', 'muted': '#756d5f'},
        'dark':  {'bg': '#121315', 'ink': '#e8e6e1', 'accent': '#f48c55', 'rule': '#2e3036', 'muted': '#8f929a'},
    },
    'nordic-frost': {
        'name': 'Nordic frost',
        'light': {'bg': '#eef1f4', 'ink': '#16212c', 'accent': '#2a6493', 'rule': '#cbd3dc', 'muted': '#626d79'},
        'dark':  {'bg': '#0d141c', 'ink': '#dde5ec', 'accent': '#7fb6e3', 'rule': '#24313e', 'muted': '#828e9a'},
    },
    'olive-sand': {
        'name': 'Olive & sand',
        'light': {'bg': '#f1ede0', 'ink': '#22241a', 'accent': '#56651d', 'rule': '#d2ccb4', 'muted': '#6f6d5a'},
        'dark':  {'bg': '#13150e', 'ink': '#e3e4d6', 'accent': '#b9c66c', 'rule': '#2c2f22', 'muted': '#8c8e7a'},
    },
    'rose-plum': {
        'name': 'Rose & plum',
        'light': {'bg': '#f7eff0', 'ink': '#2a1620', 'accent': '#9c2d53', 'rule': '#dfcbd1', 'muted': '#785f6a'},
        'dark':  {'bg': '#170f14', 'ink': '#f1e3e9', 'accent': '#ec8fb3', 'rule': '#36242e', 'muted': '#9a828e'},
    },
    'graphite-cobalt': {
        'name': 'Graphite & cobalt',
        'light': {'bg': '#f2f2ef', 'ink': '#151515', 'accent': '#2c4bc7', 'rule': '#d3d3cd', 'muted': '#676763'},
        'dark':  {'bg': '#101113', 'ink': '#e7e7e7', 'accent': '#93a6ff', 'rule': '#2b2d32', 'muted': '#8d8f95'},
    },
    # ---- Three that leave the cream-and-copper family behind ----------
    # The palettes above mostly share a pale warm page and a brown or orange
    # accent. These take hues none of them use: teal, violet with mint, and
    # sky with berry (wine by night). Each has a tinted page in light mode
    # and a coloured, not just darkened, page in dark mode.
    'aqua-lagoon': {
        'name': 'Aqua lagoon',
        'light': {'bg': '#cdeee9', 'ink': '#06272a', 'accent': '#00827a', 'rule': '#9fd0c9', 'muted': '#4c6e6b'},
        'dark':  {'bg': '#03302e', 'ink': '#d5f3f0', 'accent': '#3fe0cf', 'rule': '#1a4f4b', 'muted': '#7fa9a5'},
    },
    'ultraviolet-mint': {
        'name': 'Ultraviolet & mint',
        'light': {'bg': '#e9e0fd', 'ink': '#1c1240', 'accent': '#6b1fd6', 'rule': '#cfc0f3', 'muted': '#6b618e'},
        'dark':  {'bg': '#250a35', 'ink': '#f2e8ff', 'accent': '#5ff0b9', 'rule': '#48275c', 'muted': '#a691b9'},
    },
    'sky-berry': {
        'name': 'Sky & berry',
        'light': {'bg': '#dbeafc', 'ink': '#0b1d3a', 'accent': '#a3158f', 'rule': '#b9cfea', 'muted': '#55657d'},
        'dark':  {'bg': '#260a10', 'ink': '#fbecee', 'accent': '#8cc8ff', 'rule': '#4a222a', 'muted': '#ad8f95'},
    },
}

RECIPES = [
    {'id': 'rust-cream',   'palette': 'rust-cream',   'light': -26, 'dark': 7,
     'dl': '-26 (much muted)', 'dd': '+7 (default lift)'},
    {'id': 'aegean-clay',  'palette': 'aegean-clay',  'light': -7,  'dark': 11,
     'dl': '-7 (default mute)', 'dd': '+11 (more lifted)'},
    {'id': 'forest-green', 'palette': 'forest-green', 'light': -7,  'dark': 11,
     'dl': '-7 (default mute)', 'dd': '+11 (more lifted)'},
    {'id': 'day-night',    'palette': 'day-night',    'light': -24, 'dark': 11,
     'dl': '-24 (warm dusk)',   'dd': '+11 (more lifted)'},
    {'id': 'ink-vermilion',   'palette': 'ink-vermilion',   'light': -4, 'dark': 9,
     'dl': '-4 (paper)',  'dd': '+9 (charcoal lift)'},
    {'id': 'nordic-frost',    'palette': 'nordic-frost',    'light': -4, 'dark': 9,
     'dl': '-4 (frost)',  'dd': '+9 (slate lift)'},
    {'id': 'olive-sand',      'palette': 'olive-sand',      'light': -4, 'dark': 9,
     'dl': '-4 (sand)',   'dd': '+9 (moss lift)'},
    {'id': 'rose-plum',       'palette': 'rose-plum',       'light': -4, 'dark': 9,
     'dl': '-4 (blush)',  'dd': '+9 (plum lift)'},
    {'id': 'graphite-cobalt', 'palette': 'graphite-cobalt', 'light': -4, 'dark': 9,
     'dl': '-4 (paper)',  'dd': '+9 (graphite lift)'},
    {'id': 'aqua-lagoon',      'palette': 'aqua-lagoon',      'light': -2, 'dark': 3,
     'dl': '-2 (pool water)', 'dd': '+3 (deep lagoon)'},
    {'id': 'ultraviolet-mint', 'palette': 'ultraviolet-mint', 'light': -2, 'dark': 4,
     'dl': '-2 (lilac)',  'dd': '+4 (deep violet)'},
    {'id': 'sky-berry',        'palette': 'sky-berry',        'light': -2, 'dark': 4,
     'dl': '-2 (sky)',    'dd': '+4 (wine)'},
]

_LIGHT_GRAIN = ("""--grain-svg: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg'"""
                """ width='180' height='180'><filter id='n'><feTurbulence type='fractalNoise'"""
                """ baseFrequency='0.9' numOctaves='2' stitchTiles='stitch'/><feColorMatrix"""
                """ values='0 0 0 0 0.05  0 0 0 0 0.04  0 0 0 0 0.02  0 0 0 0.08 0'/></filter>"""
                """<rect width='100%25' height='100%25' filter='url(%23n)'/></svg>");\n"""
                """    --grain-blend: multiply;\n    --grain-opacity: 0.35;""")

_DARK_GRAIN = ("""--grain-svg: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg'"""
               """ width='180' height='180'><filter id='n'><feTurbulence type='fractalNoise'"""
               """ baseFrequency='0.9' numOctaves='2' stitchTiles='stitch'/><feColorMatrix"""
               """ values='0 0 0 0 0.95  0 0 0 0 0.92  0 0 0 0 0.85  0 0 0 0.05 0'/></filter>"""
               """<rect width='100%25' height='100%25' filter='url(%23n)'/></svg>");\n"""
               """    --grain-blend: screen;\n    --grain-opacity: 0.5;""")


def _derive_light(base, offset):
    return {
        'bg': _shift(base['bg'], offset),
        'bgSoft': _shift(base['bg'], offset - 4),
        'rule': _shift(base['rule'], offset),
        'ink': base['ink'],
        'inkSoft': _shift(base['ink'], 20),
        'muted': base['muted'],
        'accent': base['accent'],
        'accentSoft': _shift_sat(base['accent'], 15, -10),
    }


def _derive_dark(base, offset):
    return {
        'bg': _shift(base['bg'], offset),
        'bgSoft': _shift(base['bg'], offset + 4),
        'rule': _shift(base['rule'], offset),
        'ink': base['ink'],
        'inkSoft': _shift(base['ink'], -18),
        'muted': base['muted'],
        'accent': base['accent'],
        'accentSoft': _shift_sat(base['accent'], 10, -5),
    }



# ---- Contrast enforcement -------------------------------------------------
# A recipe's offset moves the background; accent and muted text weren't moved
# with it, so some light themes ended up with accent text near 1.7:1. After
# deriving a theme, nudge each foreground's lightness (hue untouched) away
# from the background until it passes, and lift cards until they separate.
import colorsys as _cs

def _lum(h):
    h = h.lstrip('#'); r, g, b = [int(h[i:i+2], 16) / 255 for i in (0, 2, 4)]
    f = lambda x: x / 12.92 if x <= 0.03928 else ((x + 0.055) / 1.055) ** 2.4
    return .2126 * f(r) + .7152 * f(g) + .0722 * f(b)

def _ct(a, b):
    la, lb = _lum(a), _lum(b)
    return (max(la, lb) + .05) / (min(la, lb) + .05)

def _hls(h):
    h = h.lstrip('#'); return _cs.rgb_to_hls(*[int(h[i:i+2], 16) / 255 for i in (0, 2, 4)])

def _hex(hh, l, ss):
    return '#%02x%02x%02x' % tuple(round(v * 255) for v in _cs.hls_to_rgb(hh, max(0, min(1, l)), ss))

def _ensure(fg, bgs, target, darken):
    """Move fg's lightness until it reaches `target` against every colour in bgs."""
    hh, l, ss = _hls(fg)
    for _ in range(120):
        c = _hex(hh, l, ss)
        if all(_ct(c, b) >= target for b in bgs):
            return c
        l += -0.006 if darken else 0.006
    return _hex(hh, l, ss)

def _separate(bg, soft, target, darken):
    """Move the card colour away from the page until it visibly separates."""
    hh, l, ss = _hls(soft)
    for _ in range(80):
        c = _hex(hh, l, ss)
        if _ct(c, bg) >= target:
            return c
        l += -0.004 if darken else 0.004
    return _hex(hh, l, ss)

def _enforce(c, light):
    c = dict(c)
    c['bgSoft']  = _separate(c['bg'], c['bgSoft'], 1.08 if light else 1.15, darken=light)
    both = [c['bg'], c['bgSoft']]
    c['ink']        = _ensure(c['ink'], both, 12.0, darken=light)
    c['inkSoft']    = _ensure(c['inkSoft'], both, 7.0, darken=light)
    c['muted']      = _ensure(c['muted'], both, 4.6, darken=light)
    c['accent']     = _ensure(c['accent'], both, 4.6, darken=light)
    c['accentSoft'] = _ensure(c['accentSoft'], both, 3.2, darken=light)
    c['rule']       = _separate(c['bg'], c['rule'], 1.35, darken=light)
    return c

def _vars_block(c):
    return (f"--bg:         {c['bg']};\n"
            f"    --bg-soft:    {c['bgSoft']};\n"
            f"    --ink:        {c['ink']};\n"
            f"    --ink-soft:   {c['inkSoft']};\n"
            f"    --muted:      {c['muted']};\n"
            f"    --rule:       {c['rule']};\n"
            f"    --accent:     {c['accent']};\n"
            f"    --accent-soft:{c['accentSoft']};")


def _token_block(name, loff, doff, light, dark):
    lv, dv = _vars_block(light), _vars_block(dark)
    lsign = '+' if loff >= 0 else ''
    dsign = '+' if doff >= 0 else ''
    return f""":root {{
  /* ---- Palette: {name} ---- */
  /* Light mode (default) — bg/bg-soft/rule shifted {lsign}{loff}% lightness */
  {lv}

  {_LIGHT_GRAIN}

  /* System font stacks — no external fonts */
  --serif: ui-serif, "Iowan Old Style", "Apple Garamond", Baskerville, "Times New Roman", "Source Serif Pro", Georgia, serif;
  --sans:  system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI Variable", "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
  --mono:  ui-monospace, "SF Mono", "Cascadia Mono", "Source Code Pro", Menlo, Consolas, "DejaVu Sans Mono", monospace;

  --max: 1240px;
  --gutter: clamp(20px, 4vw, 56px);

  color-scheme: light;
}}

/* Dark mode — applies when OS prefers dark UNLESS the user has
   manually picked light via the in-page toggle (which adds .theme-light).
   bg/bg-soft/rule shifted {dsign}{doff}% lightness. */
@media (prefers-color-scheme: dark) {{
  :root:not(.theme-light) {{
    {dv}
    {_DARK_GRAIN}
    color-scheme: dark;
  }}
}}

/* User-forced dark mode (toggle button in the top bar). Always wins,
   regardless of the OS preference. */
:root.theme-dark {{
  {dv}
  {_DARK_GRAIN}
  color-scheme: dark;
}}"""



# ---- Stylesheet identity -----------------------------------------------
# Every stylesheet carries an id and a hash of its colour tokens, both as a
# comment (for people) and as CSS variables (read by the page and editor).
# Colour overrides in site-config.json are stored per stylesheet id, so an
# edit made under one theme never leaks into another; the hash lets the
# editor notice when a stylesheet's defaults changed after overrides were
# saved against it.
import hashlib as _hl

def _theme_hash(token_text):
    return _hl.sha1(token_text.encode('utf-8')).hexdigest()[:8]

def _identity_block(theme_id, h):
    return (f"/* theme-id: {theme_id}   hash: {h}\n"
            f"   site-config.json keys colour overrides by this id. */\n"
            f":root {{ --theme-id: \"{theme_id}\"; --theme-hash: \"{h}\"; }}\n\n")

_ID_RE = None
def _stamp_base(base_path):
    """Write/refresh the identity block at the top of style.css itself."""
    import re
    s = open(base_path, encoding='utf-8').read()
    t0 = s.find('/* ---------- 1. Tokens ----------')
    r0 = s.find('/* ---------- 2. Reset & base ----------')
    if t0 == -1 or r0 == -1:
        return
    h = _theme_hash(s[t0:r0])
    s = re.sub(r'\A/\* theme-id: [^\n]*\n[^\n]*\*/\n:root \{ --theme-id:[^\n]*\n\n', '', s)
    s = _identity_block('default', h) + s
    open(base_path, 'w', encoding='utf-8').write(s)

def generate_palettes(verbose=True):
    """Rebuild every style-<id>.css from style.css. Returns a list of names."""
    base_path = os.path.join(ROOT, 'style.css')
    if not os.path.exists(base_path):
        if verbose:
            print("  ! style.css not found")
        return []
    _stamp_base(base_path)
    base = open(base_path, encoding='utf-8').read()

    t_start = base.find('/* ---------- 1. Tokens ----------')
    r_start = base.find('/* ---------- 2. Reset & base ----------')
    if t_start == -1 or r_start == -1:
        if verbose:
            print("  ! could not find the Tokens / Reset markers in style.css")
        return []
    rest = base[r_start:]

    written = []
    for rec in RECIPES:
        pal = PALETTES[rec['palette']]
        light = _enforce(_derive_light(pal['light'], rec['light']), light=True)
        dark = _enforce(_derive_dark(pal['dark'], rec['dark']), light=False)
        banner = (f"""/* ============================================================
   Rishabh Sahu — Portfolio styles
   --------------------------------------------------------------
   Palette: {pal['name']}
     Light mode offset: {rec['dl']}
     Dark  mode offset: {rec['dd']}
   One of several palette variants. To swap palettes,
   rename one of style-*.css to style.css.
   ============================================================ */

/* ---------- 1. Tokens ---------- */
""")
        tokens = _token_block(pal['name'], rec['light'], rec['dark'], light, dark)
        out = _identity_block(rec['id'], _theme_hash(tokens)) + banner + tokens + '\n\n\n' + rest
        name = f"style-{rec['id']}.css"
        with open(os.path.join(ROOT, name), 'w', encoding='utf-8') as f:
            f.write(out)
        written.append(name)
        if verbose:
            print(f"  ok {name}  ({pal['name']})")
            print(f"     light bg {pal['light']['bg']} -> {light['bg']}")
            print(f"     dark  bg {pal['dark']['bg']}  -> {dark['bg']}")
    return written


class DevHandler(http.server.SimpleHTTPRequestHandler):
    """SimpleHTTPRequestHandler that:
       - intercepts /style.css to serve a swapped file when one is set
       - disables HTTP caching for every response so a normal refresh
         always picks up changes (no need to hard-reload)"""

    def do_GET(self):
        path = self.path.split('?')[0]

        if path in ('/live', '/live/', '/visitor', '/clean'):
            # A visitor's-eye view: identical HTML with the editor loader
            # stripped, so you can check what a real user sees without the
            # panel, its button, or its keyboard bindings.
            f = os.path.join(ROOT, 'index.html')
            if os.path.exists(f):
                html = open(f, encoding='utf-8').read()
                html = html.replace("s.src = 'editor.js';", "return;")
                data = html.encode('utf-8')
                self.send_response(200)
                self.send_header('Content-Type', 'text/html; charset=utf-8')
                self.send_header('Content-Length', str(len(data)))
                self.end_headers()
                self.wfile.write(data)
                return

        if path in ('/preview', '/preview/', '/preview.html'):
            page = build_preview_page().encode('utf-8')
            self.send_response(200)
            self.send_header('Content-Type', 'text/html; charset=utf-8')
            self.send_header('Content-Length', str(len(page)))
            self.end_headers()
            self.wfile.write(page)
            return

        if path == '/__images':
            # Everything under assets/ that looks like an image, so the
            # editor can offer a real list instead of asking you to type a
            # filename blind.
            out = []
            adir = os.path.join(ROOT, 'assets')
            exts = ('.png', '.jpg', '.jpeg', '.webp', '.svg', '.gif', '.avif')
            for dirpath, dirnames, filenames in os.walk(adir):
                dirnames[:] = [d for d in dirnames if not d.startswith('.')]
                for f in sorted(filenames):
                    if f.lower().endswith(exts):
                        rel = os.path.relpath(os.path.join(dirpath, f), adir)
                        out.append(rel.replace(os.sep, '/'))
            self._send_json(out)
            return

        if path == '/__sources':
            # Every file that contributes text to the page, so the editor can
            # offer "edit the source of this" for anything on screen.
            out = []
            for rel, label in (('assets/resume.tex', 'Resume content'),
                               ('index.html',        'Page markup & static copy'),
                               ('projects.js',       'Per-project display overrides'),
                               ('site-config.json',  'Visual settings & text overrides')):
                p = os.path.join(ROOT, rel)
                if os.path.exists(p):
                    out.append({'path': rel, 'label': label,
                                'bytes': os.path.getsize(p)})
            self._send_json(out)
            return

        if path == '/__styles':
            self._send_json(list_style_names())
            return

        if path in ('/compare', '/compare/', '/compare.html'):
            self._send_bytes(COMPARE_HTML.encode('utf-8'), 'text/html; charset=utf-8')
            return

        if path == '/__compare/dirs':
            self._send_json(compare_dirs())
            return

        if path == '/__compare/sheets':
            q = urllib.parse.parse_qs(urllib.parse.urlsplit(self.path).query)
            out = compare_sheets((q.get('dir') or [''])[0])
            if out is None:
                self.send_error(404, 'No such folder inside the site')
            else:
                self._send_json(out)
            return

        if path == '/__compare-view':
            page = build_compare_view(urllib.parse.urlsplit(self.path).query)
            if page is None:
                self.send_error(404, 'Stylesheet not found (picked files are '
                                     'forgotten when the server restarts)')
            else:
                self._send_bytes(page.encode('utf-8'), 'text/html; charset=utf-8')
            return

        if path == '/__compare-sheet.css':
            q = urllib.parse.parse_qs(urllib.parse.urlsplit(self.path).query)
            f, u = (q.get('f') or [''])[0], (q.get('u') or [''])[0]
            if f:
                full = compare_sheet_path(f)
                data = open(full, 'rb').read() if full else None
            else:
                rec = COMPARE_UPLOADS.get(u)
                data = rec['css'].encode('utf-8') if rec else None
            if data is None:
                self.send_error(404, 'Stylesheet not found')
            else:
                self._send_bytes(data, 'text/css; charset=utf-8')
            return

        # Inject the dev-only editor into the served HTML. The file on disk
        # is untouched, so nothing ships to production.
        if state.get('editor', True) and path in ('/', '/index.html'):
            f = os.path.join(ROOT, 'index.html')
            if os.path.exists(f):
                html = open(f, encoding='utf-8').read()
                if 'editor.js' not in html:
                    html = html.replace('</body>',
                        '  <script src="/editor.js"></script>\n</body>')
                data = html.encode('utf-8')
                self.send_response(200)
                self.send_header('Content-Type', 'text/html; charset=utf-8')
                self.send_header('Content-Length', str(len(data)))
                self.end_headers()
                self.wfile.write(data)
                return

        if path == '/style.css' and state['style_override']:
            target = state['style_override']
            try:
                with open(target, 'rb') as f:
                    content = f.read()
            except OSError as e:
                self.send_error(404, f"Style file not found: {target} ({e})")
                return
            self.send_response(200)
            self.send_header('Content-Type', 'text/css; charset=utf-8')
            self.send_header('Content-Length', str(len(content)))
            self.end_headers()
            self.wfile.write(content)
            return
        super().do_GET()

    def do_POST(self):
        path = self.path.split('?')[0]

        if path == '/__compare/upload':
            try:
                length = int(self.headers.get('Content-Length') or 0)
                if length > COMPARE_UPLOAD_MAX * 2:
                    raise ValueError('too large')
                p = json.loads(self.rfile.read(length) or b'{}')
                uid, pal = compare_store(str(p.get('name') or 'sheet.css'), str(p.get('css') or ''))
            except Exception as e:
                self.send_error(400, f'Could not take that sheet: {e}')
                return
            self._send_json({'id': uid, 'hash': uid, 'palette': pal})
            return

        if path == '/__save-config':
            try:
                length = int(self.headers.get('Content-Length') or 0)
                payload = json.loads(self.rfile.read(length) or b'{}')
            except Exception as e:
                self._send_json({'ok': False, 'error': f'bad payload: {e}'})
                return
            ok, info = save_config(payload)
            if ok:
                print(f"\n  [editor] site-config.json saved"
                      + (f" (backup: {info})" if info else ""))
            else:
                print(f"\n  [editor] save FAILED: {info}")
            self._send_json({'ok': ok,
                             'backup': info if ok else None,
                             'error': None if ok else info})
            return

        if path == '/__perf':
            try:
                length = int(self.headers.get('Content-Length') or 0)
                p = json.loads(self.rfile.read(length) or b'{}')
            except Exception:
                self._send_json({'ok': False})
                return

            def kb(n):
                return f"{n / 1024:.1f} KB"

            print()
            print("  page load ------------------------------------------")
            if p.get('firstPaint'):
                print(f"    first paint      {p['firstPaint']:>6} ms")
            if p.get('domContentLoaded'):
                print(f"    DOM ready        {p['domContentLoaded']:>6} ms")
            if p.get('loadComplete'):
                print(f"    load complete    {p['loadComplete']:>6} ms")
            if p.get('renderDone'):
                print(f"    content rendered {p['renderDone']:>6} ms")
            print(f"    transferred      {kb(p.get('bytes', 0)):>9}"
                  f"  across {p.get('resources', 0)} requests")
            bt = p.get('byType') or {}
            if bt:
                parts = sorted(bt.items(), key=lambda kv: -kv[1])
                detail = "  ".join(f"{k} {kb(v)}" for k, v in parts[:6])
                print(f"    by type          {detail}")
            print("  ----------------------------------------------------")
            print("dev> ", end="", flush=True)
            self._send_json({'ok': True})
            return

        if path == '/__fetch-file':
            try:
                length = int(self.headers.get('Content-Length') or 0)
                body = json.loads(self.rfile.read(length) or b'{}')
            except Exception as e:
                self._send_json({'ok': False, 'error': f'bad payload: {e}'})
                return
            ok, info = fetch_remote_file(body.get('url'), body.get('name'),
                                         (body.get('folder') or 'assets').strip('/'))
            print("\n  [editor] fetch " +
                  (f"saved {info['file']} ({info['bytes']} bytes)" if ok else f"failed - {info}"))
            print("dev> ", end="", flush=True)
            out = {'ok': ok, 'error': None if ok else info}
            if ok:
                out.update(info)
            self._send_json(out)
            return

        if path == '/__frame-check':
            try:
                length = int(self.headers.get('Content-Length') or 0)
                body = json.loads(self.rfile.read(length) or b'{}')
            except Exception as e:
                self._send_json({'ok': False, 'error': f'bad payload: {e}'})
                return
            ok, info = check_embeddable(body.get('url'))
            out = {'ok': ok, 'error': None if ok else info}
            if ok:
                out.update(info)
            self._send_json(out)
            return

        if path == '/__save-tex':
            try:
                length = int(self.headers.get('Content-Length') or 0)
                body = json.loads(self.rfile.read(length) or b'{}')
            except Exception as e:
                self._send_json({'ok': False, 'error': f'bad payload: {e}'})
                return
            ok, info = save_resume(body.get('text'))
            print(f"\n  [editor] resume.tex " +
                  (f"saved (backup: {info})" if ok else f"NOT saved - {info}"))
            print("dev> ", end="", flush=True)
            self._send_json({'ok': ok, 'backup': info if ok else None,
                             'error': None if ok else info})
            return

        if path == '/__save-source':
            try:
                length = int(self.headers.get('Content-Length') or 0)
                body = json.loads(self.rfile.read(length) or b'{}')
            except Exception as e:
                self._send_json({'ok': False, 'error': f'bad payload: {e}'})
                return
            rel = (body.get('path') or '').strip()
            ok_path, full = _safe_path(rel)
            allowed = ('assets/resume.tex', 'index.html', 'projects.js', 'site-config.json')
            if not ok_path or rel not in allowed:
                self._send_json({'ok': False,
                                 'error': f'not an editable source: {rel}'})
                return
            text = body.get('text')
            if not isinstance(text, str) or len(text) < 20:
                self._send_json({'ok': False, 'error': 'refused: content too short'})
                return
            if rel == 'site-config.json':
                try:
                    json.loads(text)
                except Exception as e:
                    self._send_json({'ok': False, 'error': f'invalid JSON: {e}'})
                    return
            ok, info = _save_with_backup(full, rel.replace('/', '_'))
            if ok:
                with open(full, 'w', encoding='utf-8') as f:
                    f.write(text)
            print(f"\n  [editor] {rel} " +
                  (f"saved (backup: {info})" if ok else f"NOT saved - {info}"))
            print("dev> ", end="", flush=True)
            self._send_json({'ok': ok, 'backup': info if ok else None,
                             'error': None if ok else info})
            return

        if path == '/__save-html':
            try:
                length = int(self.headers.get('Content-Length') or 0)
                body = json.loads(self.rfile.read(length) or b'{}')
            except Exception as e:
                self._send_json({'ok': False, 'error': f'bad payload: {e}'})
                return
            ok, info = save_index(body.get('text'))
            print(f"\n  [editor] index.html " +
                  (f"saved (backup: {info})" if ok else f"NOT saved - {info}"))
            print("dev> ", end="", flush=True)
            self._send_json({'ok': ok, 'backup': info if ok else None,
                             'error': None if ok else info})
            return

        if path == '/__revert-html':
            ok, info = revert_index()
            print(f"\n  [editor] index.html revert: " +
                  (f"restored {info}" if ok else f"failed - {info}"))
            print("dev> ", end="", flush=True)
            self._send_json({'ok': ok, 'restored': info if ok else None,
                             'error': None if ok else info})
            return

        if path == '/__revert-tex':
            ok, info = revert_resume()
            print(f"\n  [editor] resume.tex revert: " +
                  (f"restored {info}" if ok else f"failed - {info}"))
            print("dev> ", end="", flush=True)
            self._send_json({'ok': ok, 'restored': info if ok else None,
                             'error': None if ok else info})
            return

        if path == '/__revert-config':
            ok, info = revert_config()
            print(f"\n  [editor] revert: " + (f"restored {info}" if ok else f"failed - {info}"))
            self._send_json({'ok': ok,
                             'restored': info if ok else None,
                             'error': None if ok else info})
            return

        self.send_error(404, 'Unknown endpoint')

    def _send_json(self, obj):
        data = json.dumps(obj).encode('utf-8')
        self.send_response(200)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def _send_bytes(self, data, ctype):
        self.send_response(200)
        self.send_header('Content-Type', ctype)
        self.send_header('Content-Length', str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def end_headers(self):
        # Aggressive no-cache for everything (dev mode)
        self.send_header('Cache-Control', 'no-cache, no-store, must-revalidate')
        self.send_header('Pragma', 'no-cache')
        self.send_header('Expires', '0')
        super().end_headers()

    def log_message(self, fmt, *args):
        # Quiet request logging so the command prompt stays usable.
        # Comment this method out to see request logs.
        pass


def list_palettes():
    out = []
    for f in sorted(os.listdir(ROOT)):
        if f.startswith('style-') and f.endswith('.css'):
            name = f[len('style-'):-len('.css')]
            out.append((name, f))
    return out


def resolve_style(arg):
    """Try to resolve `arg` to a CSS file. Returns:
       - 'reset' if arg == 'default'
       - absolute path if a file was found
       - None if nothing matched"""
    if arg == 'default':
        return 'reset'
    candidate = os.path.join(ROOT, f'style-{arg}.css')
    if os.path.isfile(candidate):
        return candidate
    if os.path.isfile(arg):
        return os.path.abspath(arg)
    return None


HELP_TEXT = """Commands:

  -- files (confined to the served folder) --
  ls [path]        list a directory, or show one file's size  (alias: dir)
  cat <file>       print a file with line numbers (first 400 lines)
  head <file> [n]  first n lines (default 40)
  tail <file> [n]  last n lines (default 40)
  tree [depth]     folder tree, default depth 2
  find <text>      find files whose name contains <text>
  pwd              print the folder being served

  -- styling --
  style <name>     load style-<name>.css from this folder
                    e.g.  style aegean-clay
                          style forest-green
  style <path>     load any CSS file at the given path
                    e.g.  style /tmp/experimental.css
                          style ../other-project/main.css
  style default    reset - serve the actual style.css again
  list             list built-in style-*.css files in this folder

  -- preview --
  preview          print the device-preview URL (phone/tablet/desktop frames)
  live             print the visitor-view URL (identical page, no editor)
  compare [folder] print the compare URL: stylesheets side by side
                    e.g.  compare altStyles
  devices          list the device sizes available in the preview page

  -- diagnostics --
  screen           re-probe this machine's display and report what was found
  palettes         rebuild every style-*.css from style.css
  revert-tex       restore assets/resume.tex from its newest backup
  revert-html      restore index.html from its newest backup

  -- editor / config --
  editor on|off    enable/disable the right-click style editor (default: on)
  config           show the current site-config.json values
  revert           restore site-config.json from the newest backup
  help             show this help
  quit             stop the server (also: exit, q, Ctrl+C, Ctrl+D)
"""



# ============================================================
# Tab completion for the dev> prompt
# ------------------------------------------------------------
# readline is stdlib but its availability varies (absent on some
# Windows Pythons), so every use is guarded — the prompt must
# still work without it.
# ============================================================

COMMANDS = [
    'ls', 'dir', 'cat', 'head', 'tail', 'tree', 'find', 'pwd',
    'style', 'list', 'palettes', 'live',
    'editor', 'config', 'revert', 'revert-tex', 'revert-html',
    'preview', 'devices', 'screen', 'compare',
    'help', 'quit', 'exit', 'q',
]


def _completion_candidates(text, line):
    """What could follow what's been typed so far."""
    parts = line.lstrip().split()
    # completing the command itself
    if not parts or (len(parts) == 1 and not line.endswith(' ')):
        return [c for c in COMMANDS if c.startswith(text)]

    cmd = parts[0]
    if cmd == 'style':
        opts = ['default'] + list_style_names()
        return [o for o in opts if o.startswith(text)]
    if cmd == 'editor':
        return [o for o in ('on', 'off') if o.startswith(text)]

    # path-taking commands complete against the served folder
    if cmd in ('ls', 'dir', 'cat', 'head', 'tail', 'find', 'tree'):
        base, _, frag = text.rpartition('/')
        d = os.path.join(ROOT, base) if base else ROOT
        try:
            names = os.listdir(d)
        except Exception:
            return []
        out = []
        for n in sorted(names):
            if n.startswith('.') and not frag.startswith('.'):
                continue
            if not n.startswith(frag):
                continue
            full = os.path.join(d, n)
            out.append((base + '/' if base else '') + n + ('/' if os.path.isdir(full) else ''))
        return out
    return []


def setup_completion():
    """Wire tab completion into input(). Returns True if it took."""
    try:
        import readline
    except Exception:
        return False

    def completer(text, state):
        try:
            line = readline.get_line_buffer()
            matches = _completion_candidates(text, line)
            return matches[state] if state < len(matches) else None
        except Exception:
            return None

    readline.set_completer(completer)
    readline.set_completer_delims(' \t\n')
    # libedit (macOS system Python) uses a different binding syntax
    if 'libedit' in getattr(readline, '__doc__', '') or '':
        readline.parse_and_bind('bind ^I rl_complete')
    else:
        readline.parse_and_bind('tab: complete')
    return True


def command_loop():
    has_tab = setup_completion()
    print()
    print("  " + "-" * 56)
    print("  Type 'help' to list all commands." +
          ("  Tab completes commands, paths and style names."
           if has_tab else "  (tab completion unavailable here)"))
    print("  Style editor: click the button at the bottom-right of the page,")
    print("  or right-click anywhere on it.")
    print("  Browser refresh (Cmd/Ctrl+R) picks up changes - caching is off.")
    print("  " + "-" * 56)
    while True:
        try:
            raw = input('dev> ')
        except (EOFError, KeyboardInterrupt):
            print()
            os._exit(0)
        cmd = raw.strip()
        if not cmd:
            continue

        try:
            parts = shlex.split(cmd)
        except ValueError as e:
            print(f"  ! could not parse command: {e}")
            continue
        action = parts[0].lower()

        if action in ('quit', 'exit', 'q'):
            print("bye.")
            os._exit(0)

        if action in ('help', '?'):
            print(HELP_TEXT)
            continue

        if action == 'list':
            palettes = list_palettes()
            if not palettes:
                print("  (no style-*.css files found in this folder)")
            else:
                active = state['style_override']
                active_name = os.path.basename(active) if active else None
                for name, fn in palettes:
                    mark = ' (active)' if fn == active_name else ''
                    print(f"  {name:18s}  ->  {fn}{mark}")
            continue

        if action == 'preview':
            print(f"  device preview: http://localhost:{PORT}/preview")
            print("  frames: " + ", ".join(f"{d[1]} ({d[2]}x{d[3]})" for d in DEVICES[:4]) + " …")
            continue

        if action == 'editor':
            if len(parts) > 1 and parts[1].lower() in ('on', 'off'):
                state['editor'] = (parts[1].lower() == 'on')
            print(f"  right-click editor: {'on' if state['editor'] else 'off'}")
            continue

        if action == 'config':
            p = os.path.join(ROOT, CONFIG_FILE)
            if not os.path.exists(p):
                print(f"  no {CONFIG_FILE} yet - save once from the editor")
            else:
                try:
                    cfg = json.load(open(p, encoding='utf-8'))
                    sizes = cfg.get('sizes', {})
                    cols = cfg.get('colors', {})
                    print(f"  sizes    : textScale={sizes.get('textScale')} "
                          f"density={sizes.get('density')}")
                    for th in ('light', 'dark'):
                        ov = {k: v for k, v in (cols.get(th) or {}).items()
                              if not k.startswith('_')}
                        print(f"  {th:9s}: {len(ov)} colour override(s)"
                              + (f" - {', '.join(list(ov)[:6])}" if ov else ""))
                    secs = cfg.get('sections', {})
                    n = sum(1 for v in secs.values()
                            if isinstance(v, dict) and v.get('textScale'))
                    print(f"  sections : {n} with a text-scale override")
                except Exception as e:
                    print(f"  ! could not read {CONFIG_FILE}: {e}")
            continue

        if action == 'revert-html':
            ok, info = revert_index()
            print("  " + (f"restored {info}" if ok else f"failed - {info}"))
            continue

        if action == 'revert-tex':
            ok, info = revert_resume()
            print("  " + (f"restored {info}" if ok else f"failed - {info}"))
            continue

        if action == 'revert':
            ok, info = revert_config()
            print("  " + (f"restored {info}" if ok else f"revert failed - {info}"))
            continue


        # ---- filesystem helpers -------------------------------------
        # Confined to the served folder: paths are resolved and rejected
        # if they escape ROOT, so a stray '../..' can't read your home
        # directory from what is, after all, a web server.
        if action in ('ls', 'dir', 'll'):
            target = parts[1] if len(parts) > 1 else '.'
            ok, full = _safe_path(target)
            if not ok:
                print(f"  ! outside the served folder: {target}")
                continue
            if not os.path.exists(full):
                print(f"  ! no such path: {target}")
                continue
            if os.path.isfile(full):
                print(f"  {os.path.basename(full):32s} {os.path.getsize(full):>9,} bytes")
                continue
            entries = sorted(os.listdir(full))
            if not entries:
                print("  (empty)")
                continue
            for name in entries:
                p = os.path.join(full, name)
                if os.path.isdir(p):
                    n = len(os.listdir(p))
                    print(f"  {name + '/':32s} {n:>9} item{'s' if n != 1 else ''}")
                else:
                    print(f"  {name:32s} {os.path.getsize(p):>9,} bytes")
            continue

        if action in ('cat', 'head', 'tail'):
            if len(parts) < 2:
                print(f"  usage: {action} <file> [lines]")
                continue
            ok, full = _safe_path(parts[1])
            if not ok:
                print(f"  ! outside the served folder: {parts[1]}")
                continue
            if not os.path.isfile(full):
                print(f"  ! not a file: {parts[1]}")
                continue
            n = 40
            if len(parts) > 2:
                try:
                    n = int(parts[2])
                except ValueError:
                    pass
            try:
                with open(full, encoding='utf-8', errors='replace') as f:
                    lines = f.read().splitlines()
            except Exception as e:
                print(f"  ! could not read: {e}")
                continue
            if action == 'cat':
                show, note = lines[:400], (' (first 400 of %d lines)' % len(lines)
                                           if len(lines) > 400 else '')
            elif action == 'head':
                show, note = lines[:n], f' (first {min(n, len(lines))} of {len(lines)})'
            else:
                show, note = lines[-n:], f' (last {min(n, len(lines))} of {len(lines)})'
            print(f"  --- {parts[1]}{note} ---")
            width = len(str(len(lines)))
            start = (len(lines) - len(show) + 1) if action == 'tail' else 1
            for i, line in enumerate(show, start):
                print(f"  {str(i).rjust(width)}  {line}")
            continue

        if action == 'pwd':
            print(f"  {ROOT}")
            continue

        if action == 'tree':
            depth_limit = 2
            if len(parts) > 1:
                try:
                    depth_limit = int(parts[1])
                except ValueError:
                    pass
            skip = {'__pycache__', '.git', '.site-config-backups'}
            for dirpath, dirnames, filenames in os.walk(ROOT):
                rel = os.path.relpath(dirpath, ROOT)
                depth = 0 if rel == '.' else rel.count(os.sep) + 1
                dirnames[:] = [d for d in sorted(dirnames) if d not in skip]
                if depth > depth_limit:
                    dirnames[:] = []
                    continue
                indent = '  ' + '    ' * depth
                if rel != '.':
                    print(f"{indent}{os.path.basename(dirpath)}/")
                for f in sorted(filenames):
                    print(f"{indent}{'    ' if rel != '.' else ''}{f}")
            continue

        if action == 'find':
            if len(parts) < 2:
                print("  usage: find <substring>")
                continue
            needle = parts[1].lower()
            hits = 0
            for dirpath, dirnames, filenames in os.walk(ROOT):
                dirnames[:] = [d for d in dirnames
                               if d not in ('__pycache__', '.git', '.site-config-backups')]
                for f in filenames:
                    if needle in f.lower():
                        print(f"  {os.path.relpath(os.path.join(dirpath, f), ROOT)}")
                        hits += 1
            if not hits:
                print(f"  nothing matching '{parts[1]}'")
            continue

        if action == 'palettes':
            print("  rebuilding style-*.css from style.css ...")
            names = generate_palettes()
            if names:
                print(f"  done - {len(names)} palettes written")
            continue

        if action == 'screen':
            state['screen'] = detect_screen()
            log_screen(state['screen'])
            continue

        if action == 'compare':
            url = f"http://localhost:{PORT}/compare"
            if len(parts) > 1:
                ok, full = _safe_path(parts[1])
                if not ok or not os.path.isdir(full):
                    print(f"  ! not a folder inside the site: {parts[1]}")
                    continue
                rel = os.path.relpath(full, ROOT).replace(os.sep, '/')
                url += '?dir=' + urllib.parse.quote('' if rel == '.' else rel)
            print(f"  compare stylesheets: {url}")
            print("  pick a folder or files there; click a sheet's name to focus on it.")
            continue

        if action in ('live', 'visitor'):
            print(f"  visitor view: http://localhost:{PORT}/live")
            print("  identical HTML with the editor loader stripped.")
            continue

        if action == 'devices':
            for d in DEVICES:
                print(f"  {d[1]:16s} {d[2]:>5} x {d[3]:<5} css px   ({d[4]}\" wide, "
                      f"{d[2]/d[4]:.0f} css-px/in)")
            continue

        if action == 'style':
            if len(parts) < 2:
                print("  usage: style <name|path> | style default")
                continue
            # Allow paths with spaces — rejoin from parts[1:]
            target = ' '.join(parts[1:])
            resolved = resolve_style(target)
            if resolved == 'reset':
                state['style_override'] = None
                print("  reset - serving style.css unchanged. Refresh the page.")
            elif resolved:
                state['style_override'] = resolved
                shown = (os.path.relpath(resolved, ROOT)
                         if resolved.startswith(ROOT) else resolved)
                print(f"  now serving '{shown}' as /style.css. Refresh the page.")
            else:
                tried = [os.path.join(ROOT, f'style-{target}.css'), target]
                print("  ! couldn't find a file. tried:")
                for t in tried:
                    print(f"      {t}")
            continue

        print(f"  ! unknown command: {action} (type 'help')")


def main():
    socketserver.TCPServer.allow_reuse_address = True

    class _Server(socketserver.ThreadingMixIn, socketserver.TCPServer):
        # Threads, so a compare page with a dozen views loading at once
        # doesn't queue every file behind every other.
        daemon_threads = True

    try:
        httpd = _Server(("", PORT), DevHandler)
    except OSError as e:
        print(f"! could not bind to port {PORT}: {e}")
        print(f"  try a different port:  python3 dev_server.py <port>")
        sys.exit(1)

    thread = threading.Thread(target=command_loop, daemon=True)
    thread.start()
    state['screen'] = detect_screen()
    log_screen(state['screen'])
    print()
    # Tell the user up front whether the editor will actually load, since a
    # missing tag or file is otherwise silent.
    _idx = os.path.join(ROOT, 'index.html')
    _ed  = os.path.join(ROOT, 'editor.js')
    _has_tag = os.path.exists(_idx) and 'editor.js' in open(_idx, encoding='utf-8').read()
    if os.path.exists(_ed) and _has_tag:
        print("style editor: ON - button appears bottom-right, or right-click the page")
    elif not os.path.exists(_ed):
        print("style editor: OFF - editor.js is missing from this folder")
    else:
        print("style editor: OFF - index.html has no <script src=\"editor.js\"> tag")
    print()
    print(f"dev server: http://localhost:{PORT}/")
    print(f"preview:    http://localhost:{PORT}/preview   (phone / tablet / desktop frames)")
    print(f"visitor:    http://localhost:{PORT}/live      (no editor - what a real user sees)")
    print(f"compare:    http://localhost:{PORT}/compare   (stylesheets side by side)")
    print(f"serving:    {ROOT}")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nbye.")


if __name__ == '__main__':
    main()
