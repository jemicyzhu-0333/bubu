"""Loopback diagnostic server, replacing only the production HTML entry script."""
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import argparse
import os

parser = argparse.ArgumentParser()
parser.add_argument('--port', type=int, default=8791)
args = parser.parse_args()
root = Path(__file__).resolve().parents[2]
os.chdir(root)

class Handler(SimpleHTTPRequestHandler):
    def do_GET(self):
        if self.path.split('?')[0] == '/src/renderer/context-review.html':
            html = (root / 'src/renderer/pet.html').read_text()
            html = html.replace('../surfaces/pet/entry.mjs', '../../tools/context-emphasis-review/page.mjs')
            data = html.encode()
            self.send_response(200)
            self.send_header('Content-Type', 'text/html; charset=utf-8')
            self.send_header('Content-Length', str(len(data)))
            self.end_headers()
            self.wfile.write(data)
            return
        super().do_GET()

ThreadingHTTPServer(('127.0.0.1', args.port), Handler).serve_forever()
