#!/usr/bin/env python3
"""Plain-HTTP -> HTTPS JSON-RPC proxy.

Runs on the macOS host (native arm64 OpenSSL). The amd64 ethexe binary in Docker
talks to this over plain HTTP (http://host.docker.internal:8545), avoiding the
Rosetta rustls/ring "cannot decrypt peer's message" bug on the TLS hop.
"""
import sys
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

UPSTREAM = sys.argv[1] if len(sys.argv) > 1 else "https://hoodi-reth-rpc.gear-tech.io"
PORT = int(sys.argv[2]) if len(sys.argv) > 2 else 8545


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def _forward(self, body: bytes):
        req = urllib.request.Request(
            UPSTREAM, data=body, method="POST",
            headers={"Content-Type": "application/json", "User-Agent": "curl/8.0", "Accept": "*/*"},
        )
        try:
            with urllib.request.urlopen(req, timeout=120) as resp:
                data = resp.read()
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(data)))
                self.end_headers()
                self.wfile.write(data)
        except Exception as e:  # noqa
            msg = str(e).encode()
            self.send_response(502)
            self.send_header("Content-Length", str(len(msg)))
            self.end_headers()
            self.wfile.write(msg)

    def do_POST(self):
        length = int(self.headers.get("Content-Length", 0))
        body = self.rfile.read(length) if length else b""
        try:
            import json as _j; m=_j.loads(body).get('method')  # method-log
            sys.stderr.write(f'[rpc] {m}\n'); sys.stderr.flush()
        except Exception: pass
        self._forward(body)

    def do_GET(self):
        self.send_response(200)
        self.send_header("Content-Length", "2")
        self.end_headers()
        self.wfile.write(b"ok")

    def log_message(self, *a):  # quiet
        pass


if __name__ == "__main__":
    print(f"[rpc-proxy] http://0.0.0.0:{PORT} -> {UPSTREAM}", flush=True)
    ThreadingHTTPServer(("0.0.0.0", PORT), Handler).serve_forever()
