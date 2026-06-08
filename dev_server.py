#!/usr/bin/env python3
"""
dev-server.py - local HTTP server with interactive style switching.

Run from the portfolio folder (alongside index.html):

    python3 dev-server.py            # default port 8000
    python3 dev-server.py 8080       # custom port

Commands typed into the terminal while the server is running:

    style <name>        load style-<name>.css from this folder
                         e.g. 'style aegean-clay'
    style <path>        load any CSS file at the given path
                         e.g. 'style ../experiments/sunset.css'
                              'style /tmp/scratch.css'
    style default       reset - serve the actual style.css again
    list                show built-in style-*.css files in this folder
    help                show command help
    quit  (or exit, q)  stop the server

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
import http.server
import os
import shlex
import socketserver
import sys
import threading

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
ROOT = os.path.abspath(os.getcwd())

# Mutable state shared between request handler and command loop.
# `None` means "serve the real style.css unchanged".
state = {'style_override': None}


class DevHandler(http.server.SimpleHTTPRequestHandler):
    """SimpleHTTPRequestHandler that:
       - intercepts /style.css to serve a swapped file when one is set
       - disables HTTP caching for every response so a normal refresh
         always picks up changes (no need to hard-reload)"""

    def do_GET(self):
        if self.path.split('?')[0] == '/style.css' and state['style_override']:
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
  style <name>     load style-<name>.css from this folder
                    e.g.  style aegean-clay
                          style forest-green
  style <path>     load any CSS file at the given path
                    e.g.  style /tmp/experimental.css
                          style ../other-project/main.css
  style default    reset - serve the actual style.css again
  list             list built-in style-*.css files in this folder
  help             show this help
  quit             stop the server (also: exit, q, Ctrl+C, Ctrl+D)
"""


def command_loop():
    print()
    print("Type 'help' for commands. The browser refresh (Cmd/Ctrl+R)")
    print("picks up changes - HTTP caching is disabled.")
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
    try:
        httpd = socketserver.TCPServer(("", PORT), DevHandler)
    except OSError as e:
        print(f"! could not bind to port {PORT}: {e}")
        print(f"  try a different port:  python3 dev-server.py <port>")
        sys.exit(1)

    thread = threading.Thread(target=command_loop, daemon=True)
    thread.start()
    print(f"dev server: http://localhost:{PORT}/")
    print(f"serving:    {ROOT}")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nbye.")


if __name__ == '__main__':
    main()
