#!/usr/bin/env python3
"""Isolated libtorrent engine.

Serves verified piece bytes only. A range inside the file that is not
downloaded yet is not 416: callers prioritize, wait, then read. 416 is
reserved for ranges that do not overlap the file.
"""

from __future__ import annotations

import argparse
import json
import os
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

import libtorrent as lt

LOCK = threading.Lock()
SESSIONS: dict[str, lt.session] = {}
HANDLES: dict[str, lt.torrent_handle] = {}
SAVE_PATHS: dict[str, Path] = {}
TOKEN = ""


def pump_all() -> None:
    with LOCK:
        for session in SESSIONS.values():
            session.pop_alerts()


def pump_forever() -> None:
    while True:
        pump_all()
        time.sleep(0.2)


def session_for(key: str, port: int = 0) -> lt.session:
    existing = SESSIONS.get(key)
    if existing is not None:
        return existing
    listen = f"127.0.0.1:{port}" if port else "127.0.0.1:0"
    session = lt.session(
        {
            "listen_interfaces": listen,
            "enable_dht": False,
            "enable_upnp": False,
            "enable_natpmp": False,
            "enable_lsd": False,
            "alert_mask": 0,
        }
    )
    SESSIONS[key] = session
    return session


def file_on_disk(handle: lt.torrent_handle, save: Path) -> Path:
    info = handle.torrent_file()
    return save / info.name()


def meta(torrent_id: str) -> dict:
    handle = HANDLES[torrent_id]
    info = handle.torrent_file()
    count = info.num_pieces()
    have = [index for index in range(count) if handle.have_piece(index)]
    path = file_on_disk(handle, SAVE_PATHS[torrent_id])
    return {
        "id": torrent_id,
        "fileSize": info.total_size(),
        "pieceSize": info.piece_length(),
        "pieceCount": count,
        "have": have,
        "filePath": str(path),
        "complete": len(have) == count and count > 0,
    }


def contiguous_end(handle: lt.torrent_handle, start: int, end: int) -> int | None:
    info = handle.torrent_file()
    file_size = info.total_size()
    piece_len = info.piece_length()
    if file_size <= 0 or start >= file_size or end < start or start < 0:
        return None
    last = min(end, file_size - 1)
    verified_end = start - 1
    pos = start
    while pos <= last:
        index = pos // piece_len
        if not handle.have_piece(index):
            break
        piece_last = min(file_size - 1, (index + 1) * piece_len - 1)
        verified_end = min(last, piece_last)
        pos = verified_end + 1
    return verified_end


def pieces_for(handle: lt.torrent_handle, start: int, end: int) -> list[int]:
    info = handle.torrent_file()
    file_size = info.total_size()
    piece_len = info.piece_length()
    if start >= file_size or end < start:
        return []
    last = min(end, file_size - 1)
    return list(range(start // piece_len, last // piece_len + 1))


def prioritize(handle: lt.torrent_handle, pieces: list[int], level: int = 7) -> None:
    for index in pieces:
        handle.piece_priority(index, level)


def read_verified(torrent_id: str, start: int, end: int) -> tuple[int, bytes, int]:
    handle = HANDLES[torrent_id]
    info = handle.torrent_file()
    file_size = info.total_size()
    if start < 0 or end < start or start >= file_size:
        return 416, b"", file_size
    verified_end = contiguous_end(handle, start, end)
    if verified_end is None or verified_end < start:
        return 409, b"", file_size
    path = file_on_disk(handle, SAVE_PATHS[torrent_id])
    with path.open("rb") as handle_io:
        handle_io.seek(start)
        data = handle_io.read(verified_end - start + 1)
    if len(data) != verified_end - start + 1:
        return 409, b"", file_size
    return 200, data, verified_end


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, fmt: str, *args) -> None:
        return

    def _authorized(self) -> bool:
        if not TOKEN:
            return True
        header = self.headers.get("Authorization", "")
        return header == f"Bearer {TOKEN}"

    def _json(self, status: int, payload: dict) -> None:
        body = json.dumps(payload).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _read_json(self) -> dict:
        length = int(self.headers.get("Content-Length", "0") or "0")
        if length <= 0:
            return {}
        return json.loads(self.rfile.read(length).decode())

    def do_GET(self) -> None:  # noqa: N802
        if not self._authorized():
            self._json(401, {"error": "Engine token rejected."})
            return
        parsed = urlparse(self.path)
        if parsed.path == "/health":
            self._json(200, {"ok": True})
            return
        parts = [part for part in parsed.path.split("/") if part]
        if len(parts) == 3 and parts[0] == "v1" and parts[1] == "torrents":
            torrent_id = parts[2]
            with LOCK:
                if torrent_id not in HANDLES:
                    self._json(404, {"error": "Torrent not found."})
                    return
                self._json(200, meta(torrent_id))
            return
        if len(parts) == 4 and parts[0] == "v1" and parts[3] == "bytes":
            torrent_id = parts[2]
            query = parse_qs(parsed.query)
            try:
                start = int(query.get("start", ["0"])[0])
                end = int(query.get("end", ["-1"])[0])
            except ValueError:
                self._json(416, {"error": "Could not read that range."})
                return
            with LOCK:
                if torrent_id not in HANDLES:
                    self._json(404, {"error": "Torrent not found."})
                    return
                status, data, verified_end = read_verified(torrent_id, start, end)
                file_size = HANDLES[torrent_id].torrent_file().total_size()
            if status == 416:
                self._json(416, {"error": "Range is outside the file."})
                return
            if status != 200:
                self._json(409, {"error": "Those pieces are not verified yet."})
                return
            self.send_response(200)
            self.send_header("Content-Type", "application/octet-stream")
            self.send_header("Content-Length", str(len(data)))
            self.send_header("X-Verified-End", str(verified_end))
            self.send_header("Content-Range", f"bytes {start}-{verified_end}/{file_size}")
            self.end_headers()
            self.wfile.write(data)
            return
        self._json(404, {"error": "Not found."})

    def do_POST(self) -> None:  # noqa: N802
        if not self._authorized():
            self._json(401, {"error": "Engine token rejected."})
            return
        parsed = urlparse(self.path)
        parts = [part for part in parsed.path.split("/") if part]
        body = self._read_json()
        if parsed.path == "/v1/torrents":
            torrent_id = str(body.get("id") or "")
            torrent_path = str(body.get("torrentPath") or "")
            save_path = str(body.get("savePath") or "")
            if not torrent_id or not torrent_path or not save_path:
                self._json(400, {"error": "id, torrentPath, and savePath are required."})
                return
            info = lt.torrent_info(torrent_path)
            save = Path(save_path)
            save.mkdir(parents=True, exist_ok=True)
            with LOCK:
                session = session_for("download")
                flags = lt.torrent_flags.paused
                handle = session.add_torrent({"ti": info, "save_path": str(save), "flags": flags})
                priorities = body.get("priorities")
                if isinstance(priorities, list):
                    for index, level in enumerate(priorities):
                        handle.piece_priority(index, int(level))
                peer = str(body.get("peer") or "")
                if peer:
                    host, port = peer.rsplit(":", 1)
                    handle.connect_peer((host, int(port)))
                handle.resume()
                HANDLES[torrent_id] = handle
                SAVE_PATHS[torrent_id] = save
                payload = meta(torrent_id)
            self._json(201, payload)
            return
        if len(parts) == 4 and parts[0] == "v1" and parts[3] == "priority":
            torrent_id = parts[2]
            pieces = [int(item) for item in body.get("pieces") or []]
            level = int(body.get("level") or 7)
            with LOCK:
                if torrent_id not in HANDLES:
                    self._json(404, {"error": "Torrent not found."})
                    return
                prioritize(HANDLES[torrent_id], pieces, level)
            self._json(200, {"ok": True, "pieces": pieces, "level": level})
            return
        if len(parts) == 4 and parts[0] == "v1" and parts[3] == "wait":
            torrent_id = parts[2]
            start = int(body.get("start") or 0)
            end = int(body.get("end") or 0)
            timeout_ms = int(body.get("timeoutMs") or 8000)
            with LOCK:
                if torrent_id not in HANDLES:
                    self._json(404, {"error": "Torrent not found."})
                    return
                handle = HANDLES[torrent_id]
                file_size = handle.torrent_file().total_size()
                if start < 0 or end < start or start >= file_size:
                    self._json(416, {"error": "Range is outside the file.", "fileSize": file_size})
                    return
                prioritize(handle, pieces_for(handle, start, end), 7)
            deadline = time.time() + max(0, timeout_ms) / 1000
            verified_end = start - 1
            while True:
                with LOCK:
                    verified_end = contiguous_end(HANDLES[torrent_id], start, end)
                    session = SESSIONS.get("download")
                    if session is not None:
                        session.pop_alerts()
                if verified_end is not None and verified_end >= start:
                    self._json(
                        200,
                        {
                            "ready": True,
                            "verifiedStart": start,
                            "verifiedEnd": verified_end,
                            "fileSize": file_size,
                        },
                    )
                    return
                if time.time() >= deadline:
                    self._json(
                        200,
                        {
                            "ready": False,
                            "verifiedStart": start,
                            "verifiedEnd": start - 1,
                            "fileSize": file_size,
                        },
                    )
                    return
                time.sleep(0.05)
            return
        self._json(404, {"error": "Not found."})


def main() -> None:
    global TOKEN
    parser = argparse.ArgumentParser()
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8741)
    parser.add_argument("--token", default="")
    args = parser.parse_args()
    TOKEN = args.token or os.environ.get("ENGINE_TOKEN", "")
    threading.Thread(target=pump_forever, daemon=True).start()
    server = ThreadingHTTPServer((args.host, args.port), Handler)
    print(f"engine listening on {args.host}:{args.port}", flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
