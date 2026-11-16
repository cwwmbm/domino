#!/usr/bin/env python3
"""Domino: a local project tracker.

Run:   python3 server.py
Data:  ./data/domino.json and ./data/files/ (plain files, easy to back up).

Uses only the Python standard library. Listens on 127.0.0.1 only.
"""
import argparse
import json
import mimetypes
import os
import re
import secrets
import shutil
import sys
import threading
import time
import urllib.request
import webbrowser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, unquote, urlparse

ROOT = Path(__file__).resolve().parent
APP = ROOT / "app"
STATIC = {
    "/": ("index.html", "text/html; charset=utf-8"),
    "/index.html": ("index.html", "text/html; charset=utf-8"),
    "/app.js": ("app.js", "text/javascript; charset=utf-8"),
    "/app.css": ("app.css", "text/css; charset=utf-8"),
}
INLINE_TYPES = {"image/png", "image/jpeg", "image/gif", "image/webp", "application/pdf"}
STORED_NAME = re.compile(r"^[0-9a-f]{8}-[A-Za-z0-9._-]{1,120}$")
MAX_UPLOAD = 200 * 1024 * 1024
MAX_STATE = 100 * 1024 * 1024
KEEP_BACKUPS = 30
LOCAL_HOSTS = ("127.0.0.1", "localhost")


class Store:
    """The whole project is one JSON document with a revision number."""

    def __init__(self, data_dir):
        self.dir = Path(data_dir)
        self.files = self.dir / "files"
        self.backups = self.dir / "backups"
        self.trash = self.dir / "trash"
        self.path = self.dir / "domino.json"
        self.lock = threading.Lock()
        for folder in (self.dir, self.files, self.backups):
            folder.mkdir(parents=True, exist_ok=True)
        self.rev = 0
        self.data = {"version": 1, "nextId": 1, "tasks": []}
        self._load()

    def _read(self, path):
        doc = json.loads(path.read_text("utf-8"))
        return int(doc.get("rev", 0)), doc["data"]

    def _load(self):
        if not self.path.exists():
            return
        try:
            self.rev, self.data = self._read(self.path)
            return
        except Exception as error:  # keep the bad file, then try the backups
            bad = self.dir / ("domino.broken-%d.json" % int(time.time()))
            shutil.copy2(self.path, bad)
            print("WARNING: could not read %s (%s). A copy is at %s." % (self.path, error, bad))
        for backup in sorted(self.backups.glob("domino-*.json"), reverse=True):
            try:
                self.rev, self.data = self._read(backup)
                print("Restored the data from the backup %s." % backup.name)
                return
            except Exception:
                continue

    def _backup(self):
        """Keep one copy for each day, made before the first write of that day."""
        target = self.backups / ("domino-%s.json" % time.strftime("%Y-%m-%d"))
        if target.exists() or not self.path.exists():
            return
        shutil.copy2(self.path, target)
        for old in sorted(self.backups.glob("domino-*.json"), reverse=True)[KEEP_BACKUPS:]:
            old.unlink()

    def save(self, rev, data):
        """Write the document if the caller has the current revision. Return the new revision or None."""
        with self.lock:
            if rev != self.rev:
                return None
            self._backup()
            tmp = self.path.with_suffix(".tmp")
            with open(tmp, "w", encoding="utf-8") as handle:
                json.dump({"rev": self.rev + 1, "data": data}, handle, ensure_ascii=False, indent=1)
                handle.flush()
                os.fsync(handle.fileno())
            os.replace(tmp, self.path)
            self.rev += 1
            self.data = data
            return self.rev

    def sweep(self):
        """Move attachments that no task uses (older than one day) to the trash folder."""
        used = set()
        for task in self.data.get("tasks", []):
            for item in task.get("files", []):
                used.add(item.get("file"))
        limit = time.time() - 86400
        for path in self.files.iterdir():
            if path.is_file() and path.name not in used and path.stat().st_mtime < limit:
                self.trash.mkdir(exist_ok=True)
                shutil.move(str(path), str(self.trash / path.name))


class Handler(BaseHTTPRequestHandler):
    server_version = "Domino/1"
    protocol_version = "HTTP/1.1"
    store = None

    def log_message(self, *args):
        pass

    def _local(self):
        """Refuse requests that do not come from a page of this server."""
        host = (self.headers.get("Host") or "").rsplit(":", 1)[0]
        if host not in LOCAL_HOSTS:
            return False
        origin = self.headers.get("Origin")
        if origin and urlparse(origin).hostname not in LOCAL_HOSTS:
            return False
        return True

    def _send(self, code, body=b"", ctype="application/json", headers=None):
        if isinstance(body, (dict, list)):
            body = json.dumps(body).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("X-Content-Type-Options", "nosniff")
        merged = {"Cache-Control": "no-store"}
        merged.update(headers or {})
        for key, value in merged.items():
            self.send_header(key, value)
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(body)

    def _body(self, limit):
        length = int(self.headers.get("Content-Length") or 0)
        if length > limit:
            self.close_connection = True
            return None
        return self.rfile.read(length)

    def do_GET(self):
        if not self._local():
            return self._send(403, {"error": "forbidden"})
        path = urlparse(self.path).path
        if path in STATIC:
            name, ctype = STATIC[path]
            return self._send(200, (APP / name).read_bytes(), ctype)
        if path == "/api/ping":
            return self._send(200, {"app": "domino"})
        if path == "/api/rev":
            return self._send(200, {"rev": self.store.rev})
        if path == "/api/state":
            return self._send(200, {"rev": self.store.rev, "data": self.store.data})
        if path.startswith("/files/"):
            return self._file(unquote(path[len("/files/"):]))
        self._send(404, {"error": "not found"})

    do_HEAD = do_GET

    def _file(self, stored):
        target = self.store.files / stored
        if not STORED_NAME.match(stored) or not target.is_file():
            return self._send(404, {"error": "not found"})
        ctype = mimetypes.guess_type(stored)[0] or "application/octet-stream"
        mode = "inline" if ctype in INLINE_TYPES else "attachment"
        self._send(200, target.read_bytes(), ctype, {
            "Content-Disposition": '%s; filename="%s"' % (mode, stored[9:]),
            "Cache-Control": "private, max-age=31536000, immutable",
        })

    def do_POST(self):
        if not self._local():
            return self._send(403, {"error": "forbidden"})
        url = urlparse(self.path)
        if url.path == "/api/state":
            return self._save_state()
        if url.path == "/api/files":
            return self._save_file(parse_qs(url.query).get("name", ["file"])[0])
        self._send(404, {"error": "not found"})

    do_PUT = do_POST

    def _save_state(self):
        raw = self._body(MAX_STATE)
        if raw is None:
            return self._send(413, {"error": "too large"})
        try:
            doc = json.loads(raw.decode("utf-8"))
            rev, data = int(doc["rev"]), doc["data"]
            if not isinstance(data, dict) or not isinstance(data.get("tasks"), list):
                raise ValueError("bad document")
        except Exception:
            return self._send(400, {"error": "bad request"})
        new_rev = self.store.save(rev, data)
        if new_rev is None:
            return self._send(409, {"rev": self.store.rev})
        self._send(200, {"rev": new_rev})

    def _save_file(self, name):
        raw = self._body(MAX_UPLOAD)
        if raw is None:
            return self._send(413, {"error": "too large"})
        safe = re.sub(r"[^A-Za-z0-9._-]+", "_", os.path.basename(name)).strip("._") or "file"
        if len(safe) > 100:
            stem, ext = os.path.splitext(safe)
            safe = stem[: 100 - len(ext)] + ext
        stored = "%s-%s" % (secrets.token_hex(4), safe)
        (self.store.files / stored).write_bytes(raw)
        self._send(200, {
            "file": stored,
            "name": name,
            "size": len(raw),
            "type": mimetypes.guess_type(safe)[0] or "application/octet-stream",
        })


def is_domino(port):
    """True if a Domino server already listens on this port."""
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    try:
        with opener.open("http://127.0.0.1:%d/api/ping" % port, timeout=1) as reply:
            return json.load(reply).get("app") == "domino"
    except Exception:
        return False


def main():
    parser = argparse.ArgumentParser(description="Domino: a local project tracker.")
    parser.add_argument("--port", type=int, default=4777)
    parser.add_argument("--data", default=str(ROOT / "data"), help="folder for the project data")
    parser.add_argument("--no-open", action="store_true", help="do not open the browser")
    args = parser.parse_args()

    server = None
    port = args.port
    for port in range(args.port, args.port + 20):
        try:
            server = ThreadingHTTPServer(("127.0.0.1", port), Handler)
            break
        except OSError:
            if is_domino(port):
                url = "http://127.0.0.1:%d/" % port
                print("Domino is already in operation at %s" % url)
                if not args.no_open:
                    webbrowser.open(url)
                return 0
    if server is None:
        print("No free port found from %d to %d." % (args.port, args.port + 19))
        return 1

    Handler.store = Store(args.data)
    Handler.store.sweep()
    server.daemon_threads = True
    url = "http://127.0.0.1:%d/" % port
    print("Domino is in operation at %s" % url)
    print("Data folder: %s" % Handler.store.dir)
    print("Press Ctrl+C to stop.")
    if not args.no_open:
        threading.Timer(0.4, webbrowser.open, [url]).start()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopped.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
