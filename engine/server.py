#!/usr/bin/env python3
"""Isolated libtorrent engine.

Serves hash-checked piece bytes for one selected file. A range that sits
inside that file but is not verified yet is not HTTP 416. 416 is only for a
range that misses the file. Once a 206 status line has been written, later
failures close the connection and do not append an error body.
"""

from __future__ import annotations

import argparse
import hashlib
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
SELECTED: dict[str, int] = {}
DEADLINES: dict[str, list[dict[str, int]]] = {}
REJECTED: dict[str, set[int]] = {}
TOKEN = ""
PLAYHEAD_DEADLINE_MS = 500
HARD_READ_CAP = 4 * 1024 * 1024


def max_read() -> int:
    try:
        raw = int(os.environ.get("ENGINE_MAX_READ_BYTES", "1048576"))
    except ValueError:
        raw = 1048576
    return max(1024, min(raw, HARD_READ_CAP))


def pump_all() -> None:
    with LOCK:
        for session in SESSIONS.values():
            session.pop_alerts()


def pump_forever() -> None:
    while True:
        pump_all()
        time.sleep(0.2)


def session_for(key: str) -> lt.session:
    existing = SESSIONS.get(key)
    if existing is not None:
        return existing
    session = lt.session(
        {
            "listen_interfaces": "127.0.0.1:0",
            "enable_dht": False,
            "enable_upnp": False,
            "enable_natpmp": False,
            "enable_lsd": False,
            "alert_mask": 0,
        }
    )
    SESSIONS[key] = session
    return session


def is_pad(files: lt.file_storage, index: int) -> bool:
    return bool(int(files.file_flags(index)) & int(lt.file_flags_t.flag_pad_file))


def real_files(info: lt.torrent_info) -> list[int]:
    files = info.files()
    return [index for index in range(info.num_files()) if not is_pad(files, index)]


def choose_file(info: lt.torrent_info, requested: object) -> int:
    files = info.files()
    choices = real_files(info)
    if not choices:
        raise ValueError("fileIndex is not a file in this torrent.")
    if requested is None:
        return max(choices, key=lambda index: files.file_size(index))
    try:
        index = int(requested)
    except (TypeError, ValueError) as exc:
        raise ValueError("fileIndex is not a file in this torrent.") from exc
    if index not in choices:
        raise ValueError("fileIndex is not a file in this torrent.")
    return index


def file_priorities_for(info: lt.torrent_info, file_index: int) -> list[int]:
    files = info.files()
    priorities: list[int] = []
    for index in range(info.num_files()):
        if is_pad(files, index) or index != file_index:
            priorities.append(0)
        else:
            priorities.append(4)
    return priorities


def settle_file_priorities(session: lt.session, handle: lt.torrent_handle, expected: list[int]) -> None:
    deadline = time.time() + 2
    while time.time() < deadline:
        session.pop_alerts()
        current = [int(item) for item in handle.get_file_priorities()]
        if current == expected:
            return
        time.sleep(0.02)


def safe_join(save: Path, relative: str) -> Path:
    root = save.resolve()
    path = (root / relative).resolve()
    if path != root and root not in path.parents:
        raise ValueError("file path escapes the save directory")
    return path


def selected_path(info: lt.torrent_info, save: Path, file_index: int) -> Path:
    return safe_join(save, info.files().file_path(file_index))


def piece_span(info: lt.torrent_info, file_index: int) -> tuple[int, int]:
    files = info.files()
    size = files.file_size(file_index)
    if size <= 0:
        return 0, -1
    piece_len = info.piece_length()
    start = files.file_offset(file_index)
    first = start // piece_len
    last = (start + size - 1) // piece_len
    return int(first), int(last)


def piece_verified(torrent_id: str, handle: lt.torrent_handle, index: int) -> bool:
    if index in REJECTED.get(torrent_id, set()):
        return False
    return bool(handle.have_piece(index))


def reject_piece(torrent_id: str, index: int) -> None:
    REJECTED.setdefault(torrent_id, set()).add(index)


def load_piece(info: lt.torrent_info, save: Path, index: int) -> bytes | None:
    piece_len = info.piece_length()
    total = info.total_size()
    start = index * piece_len
    end = min(total, start + piece_len)
    files = info.files()
    out = bytearray()
    for file_index in range(info.num_files()):
        offset = files.file_offset(file_index)
        size = files.file_size(file_index)
        file_end = offset + size
        if file_end <= start or offset >= end:
            continue
        take_from = max(start, offset)
        take_to = min(end, file_end)
        length = take_to - take_from
        if is_pad(files, file_index):
            out.extend(b"\x00" * length)
            continue
        try:
            path = safe_join(save, files.file_path(file_index))
            with path.open("rb") as handle:
                handle.seek(take_from - offset)
                chunk = handle.read(length)
        except OSError:
            return None
        if len(chunk) != length:
            return None
        out.extend(chunk)
    if len(out) != end - start:
        return None
    return bytes(out)


def hash_ok(info: lt.torrent_info, save: Path, index: int) -> bool:
    data = load_piece(info, save, index)
    if data is None:
        return False
    expected = bytes(info.hash_for_piece(index))
    if not expected:
        return False
    return hashlib.sha1(data).digest() == expected


def meta(torrent_id: str) -> dict:
    handle = HANDLES[torrent_id]
    info = handle.torrent_file()
    file_index = SELECTED[torrent_id]
    files = info.files()
    first, last = piece_span(info, file_index)
    have = [index for index in range(first, last + 1) if piece_verified(torrent_id, handle, index)]
    span = 0 if last < first else last - first + 1
    path = selected_path(info, SAVE_PATHS[torrent_id], file_index)
    return {
        "id": torrent_id,
        "fileIndex": file_index,
        "fileSize": files.file_size(file_index),
        "pieceSize": info.piece_length(),
        "pieceCount": span,
        "have": have,
        "filePath": str(path),
        "complete": span > 0 and len(have) == span,
        "paused": bool(handle.status().paused),
        "deadlines": DEADLINES.get(torrent_id, []),
    }


def file_size_of(torrent_id: str) -> int:
    handle = HANDLES[torrent_id]
    return handle.torrent_file().files().file_size(SELECTED[torrent_id])


def normalize_range(file_size: int, start: int, end: int) -> tuple[int, int, int]:
    """Return (status, start, end). Status 0 means the range overlaps the file."""
    if start < 0 or end < start:
        return 400, 0, 0
    if file_size <= 0 or start >= file_size:
        return 416, 0, 0
    capped = min(end, file_size - 1, start + max_read() - 1)
    return 0, start, capped


def pieces_for(torrent_id: str, start: int, end: int) -> list[int]:
    handle = HANDLES[torrent_id]
    info = handle.torrent_file()
    file_index = SELECTED[torrent_id]
    offset = info.files().file_offset(file_index)
    piece_len = info.piece_length()
    first = (offset + start) // piece_len
    last = (offset + end) // piece_len
    return list(range(int(first), int(last) + 1))


def contiguous_end(torrent_id: str, start: int, end: int) -> int | None:
    handle = HANDLES[torrent_id]
    info = handle.torrent_file()
    file_index = SELECTED[torrent_id]
    file_size = info.files().file_size(file_index)
    if file_size <= 0 or start >= file_size or end < start or start < 0:
        return None
    last = min(end, file_size - 1)
    offset = info.files().file_offset(file_index)
    piece_len = info.piece_length()
    verified_end = start - 1
    pos = start
    while pos <= last:
        index = (offset + pos) // piece_len
        if not piece_verified(torrent_id, handle, int(index)):
            break
        piece_last = min(info.total_size() - 1, (index + 1) * piece_len - 1)
        file_last = min(file_size - 1, piece_last - offset)
        verified_end = min(last, file_last)
        pos = verified_end + 1
    return verified_end


def arm_playhead(torrent_id: str, pieces: list[int], level: int) -> None:
    handle = HANDLES[torrent_id]
    handle.clear_piece_deadlines()
    piece_count = handle.torrent_file().num_pieces()
    chosen = [int(index) for index in pieces if 0 <= int(index) < piece_count][:256]
    if level <= 0:
        DEADLINES[torrent_id] = []
        for index in chosen:
            handle.piece_priority(index, 0)
            handle.reset_piece_deadline(index)
        return
    armed: list[dict[str, int]] = []
    for order, index in enumerate(chosen):
        handle.piece_priority(index, int(level))
        deadline_ms = order * PLAYHEAD_DEADLINE_MS
        handle.set_piece_deadline(index, deadline_ms, lt.deadline_flags_t.alert_when_available)
        armed.append({"piece": index, "ms": deadline_ms})
    DEADLINES[torrent_id] = armed


def wait_paused(session: lt.session, handle: lt.torrent_handle, want: bool) -> bool:
    deadline = time.time() + 2
    while time.time() < deadline:
        session.pop_alerts()
        current = bool(handle.status().paused)
        if current == want:
            return current
        time.sleep(0.02)
    return bool(handle.status().paused)


def read_verified(torrent_id: str, start: int, end: int) -> tuple[int, bytes, int, int]:
    with LOCK:
        if torrent_id not in HANDLES:
            return 404, b"", 0, 0
        file_size = file_size_of(torrent_id)
        status, start, end = normalize_range(file_size, start, end)
        if status:
            return status, b"", start, file_size
        verified_end = contiguous_end(torrent_id, start, end)
        if verified_end is None or verified_end < start:
            return 409, b"", start, file_size
        handle = HANDLES[torrent_id]
        info = handle.torrent_file()
        save = SAVE_PATHS[torrent_id]
        file_index = SELECTED[torrent_id]
        piece_indexes = pieces_for(torrent_id, start, verified_end)
    try:
        for index in piece_indexes:
            if not hash_ok(info, save, index):
                with LOCK:
                    reject_piece(torrent_id, index)
                return 409, b"", start, file_size
        path = selected_path(info, save, file_index)
        with path.open("rb") as handle_io:
            handle_io.seek(start)
            data = handle_io.read(verified_end - start + 1)
    except OSError:
        return 409, b"", start, file_size
    if len(data) != verified_end - start + 1:
        return 409, b"", start, file_size
    return 200, data, verified_end, file_size


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, fmt: str, *args) -> None:
        return

    def send_response(self, code: int, message: str | None = None) -> None:
        super().send_response(code, message)
        self.started = True

    def _authorized(self) -> bool:
        if not TOKEN:
            return True
        header = self.headers.get("Authorization", "")
        return header == f"Bearer {TOKEN}"

    def _json(self, status: int, payload: dict) -> None:
        if getattr(self, "started", False):
            self.close_connection = True
            return
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

    def _guard(self, method) -> None:
        self.started = False
        try:
            method()
        except Exception:
            if self.started:
                self.close_connection = True
                return
            self._json(500, {"error": "Engine request failed."})

    def do_GET(self) -> None:  # noqa: N802
        self._guard(self._get)

    def do_POST(self) -> None:  # noqa: N802
        self._guard(self._post)

    def _get(self) -> None:
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
                payload = meta(torrent_id)
            self._json(200, payload)
            return
        if len(parts) == 4 and parts[0] == "v1" and parts[3] == "bytes":
            self._bytes(parts[2], parse_qs(parsed.query))
            return
        self._json(404, {"error": "Not found."})

    def _bytes(self, torrent_id: str, query: dict[str, list[str]]) -> None:
        try:
            start = int(query.get("start", ["0"])[0])
            end = int(query.get("end", ["-1"])[0])
        except ValueError:
            self._json(400, {"error": "Could not read that range."})
            return
        status, data, verified_end, file_size = read_verified(torrent_id, start, end)
        if status == 404:
            self._json(404, {"error": "Torrent not found."})
            return
        if status == 416:
            self._json(416, {"error": "Range is outside the file."})
            return
        if status == 400:
            self._json(400, {"error": "Could not read that range."})
            return
        if status != 200:
            self._json(409, {"error": "Those pieces are not verified yet."})
            return
        self.send_response(206)
        self.send_header("Content-Type", "application/octet-stream")
        self.send_header("Accept-Ranges", "bytes")
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Content-Range", f"bytes {start}-{verified_end}/{file_size}")
        self.send_header("X-Verified-End", str(verified_end))
        self.end_headers()
        if os.environ.get("ENGINE_ALLOW_FAULT") == "1" and query.get("fault", [""])[0] == "after-headers":
            raise RuntimeError("fault after headers")
        try:
            self.wfile.write(data)
        except OSError:
            self.close_connection = True

    def _post(self) -> None:
        if not self._authorized():
            self._json(401, {"error": "Engine token rejected."})
            return
        parsed = urlparse(self.path)
        parts = [part for part in parsed.path.split("/") if part]
        try:
            body = self._read_json()
        except json.JSONDecodeError:
            self._json(400, {"error": "Could not read that request."})
            return
        if parsed.path == "/v1/torrents":
            self._add(body)
            return
        if len(parts) == 4 and parts[0] == "v1" and parts[3] == "priority":
            self._priority(parts[2], body)
            return
        if len(parts) == 4 and parts[0] == "v1" and parts[3] == "wait":
            self._wait(parts[2], body)
            return
        if len(parts) == 4 and parts[0] == "v1" and parts[3] == "cancel":
            self._cancel(parts[2])
            return
        if len(parts) == 4 and parts[0] == "v1" and parts[3] == "resume":
            self._resume(parts[2])
            return
        self._json(404, {"error": "Not found."})

    def _add(self, body: dict) -> None:
        torrent_id = str(body.get("id") or "")
        torrent_path = str(body.get("torrentPath") or "")
        save_path = str(body.get("savePath") or "")
        if not torrent_id or not torrent_path or not save_path:
            self._json(400, {"error": "id, torrentPath, and savePath are required."})
            return
        try:
            info = lt.torrent_info(torrent_path)
            file_index = choose_file(info, body.get("fileIndex"))
        except ValueError as exc:
            self._json(400, {"error": str(exc)})
            return
        except Exception:
            self._json(400, {"error": "Could not open that torrent."})
            return
        save = Path(save_path)
        save.mkdir(parents=True, exist_ok=True)
        with LOCK:
            session = session_for("download")
            handle = session.add_torrent(
                {"ti": info, "save_path": str(save), "flags": lt.torrent_flags.paused}
            )
            if body.get("fileIndex") is not None or len(real_files(info)) > 1:
                expected = file_priorities_for(info, file_index)
                handle.prioritize_files(expected)
                settle_file_priorities(session, handle, expected)
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
            SELECTED[torrent_id] = file_index
            DEADLINES.setdefault(torrent_id, [])
            payload = meta(torrent_id)
        self._json(201, payload)

    def _priority(self, torrent_id: str, body: dict) -> None:
        try:
            pieces = [int(item) for item in body.get("pieces") or []]
            level = int(body.get("level") or 7)
        except (TypeError, ValueError):
            self._json(400, {"error": "Could not read that request."})
            return
        with LOCK:
            if torrent_id not in HANDLES:
                self._json(404, {"error": "Torrent not found."})
                return
            arm_playhead(torrent_id, pieces, level)
            armed = list(DEADLINES.get(torrent_id, []))
        self._json(200, {"ok": True, "pieces": pieces, "level": level, "deadlines": armed})

    def _wait(self, torrent_id: str, body: dict) -> None:
        try:
            start = int(body.get("start") or 0)
            end = int(body.get("end") or 0)
            timeout_ms = int(body.get("timeoutMs") or 8000)
        except (TypeError, ValueError):
            self._json(400, {"error": "Could not read that range."})
            return
        with LOCK:
            if torrent_id not in HANDLES:
                self._json(404, {"error": "Torrent not found."})
                return
            file_size = file_size_of(torrent_id)
            status, start, end = normalize_range(file_size, start, end)
            if status == 416:
                self._json(416, {"error": "Range is outside the file.", "fileSize": file_size})
                return
            if status == 400:
                self._json(400, {"error": "Could not read that range."})
                return
            arm_playhead(torrent_id, pieces_for(torrent_id, start, end), 7)
            session = SESSIONS.get("download")
        deadline = time.time() + max(0, timeout_ms) / 1000
        while True:
            with LOCK:
                verified_end = contiguous_end(torrent_id, start, end)
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

    def _cancel(self, torrent_id: str) -> None:
        with LOCK:
            if torrent_id not in HANDLES:
                self._json(404, {"error": "Torrent not found."})
                return
            handle = HANDLES[torrent_id]
            handle.clear_piece_deadlines()
            DEADLINES[torrent_id] = []
            handle.pause()
            session = SESSIONS.get("download")
            paused = wait_paused(session, handle, True) if session is not None else bool(handle.status().paused)
        self._json(200, {"ok": True, "paused": paused})

    def _resume(self, torrent_id: str) -> None:
        with LOCK:
            if torrent_id not in HANDLES:
                self._json(404, {"error": "Torrent not found."})
                return
            handle = HANDLES[torrent_id]
            handle.resume()
            session = SESSIONS.get("download")
            paused = wait_paused(session, handle, False) if session is not None else bool(handle.status().paused)
        self._json(200, {"ok": True, "paused": paused})


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
