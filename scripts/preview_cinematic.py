#!/usr/bin/env python3
"""Run the local Normandy cinematic preview."""
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import argparse

ROOT = Path(__file__).resolve().parents[1] / 'dist'


class Server(ThreadingHTTPServer):
    request_queue_size = 128
    daemon_threads = True


class Handler(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()

    def do_GET(self):
        if self.path == '/':
            self.send_response(302)
            self.send_header('Location', '/cinematic/')
            self.end_headers()
            return
        super().do_GET()


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--port', type=int, default=8792)
    args = parser.parse_args()
    print(f'Normandy preview: http://127.0.0.1:{args.port}/cinematic/', flush=True)
    Server(('127.0.0.1', args.port), partial(Handler, directory=str(ROOT))).serve_forever()
