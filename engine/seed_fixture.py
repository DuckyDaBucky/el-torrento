#!/usr/bin/env python3
"""Seed a locally generated MPEG-TS torrent. The file is ours to distribute."""

from __future__ import annotations

import argparse
import json
import subprocess
import time
from pathlib import Path

import libtorrent as lt


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--dir", required=True)
    parser.add_argument("--port", type=int, default=43901)
    parser.add_argument("--seconds", type=int, default=4)
    args = parser.parse_args()
    root = Path(args.dir)
    media_dir = root / "seed"
    media_dir.mkdir(parents=True, exist_ok=True)
    clip = media_dir / "clip.ts"
    subprocess.check_call(
        [
            "ffmpeg",
            "-y",
            "-hide_banner",
            "-loglevel",
            "error",
            "-f",
            "lavfi",
            "-i",
            "testsrc=size=1280x720:rate=24",
            "-f",
            "lavfi",
            "-i",
            "sine=frequency=440",
            "-t",
            str(args.seconds),
            "-c:v",
            "libx264",
            "-pix_fmt",
            "yuv420p",
            "-c:a",
            "aac",
            "-f",
            "mpegts",
            str(clip),
        ]
    )
    storage = lt.file_storage()
    lt.add_files(storage, str(clip))
    creator = lt.create_torrent(storage, 32 * 1024)
    lt.set_piece_hashes(creator, str(media_dir))
    torrent_path = root / "clip.torrent"
    torrent_path.write_bytes(lt.bencode(creator.generate()))
    info = lt.torrent_info(str(torrent_path))
    session = lt.session(
        {
            "listen_interfaces": f"127.0.0.1:{args.port}",
            "enable_dht": False,
            "enable_upnp": False,
            "enable_natpmp": False,
            "enable_lsd": False,
        }
    )
    session.add_torrent(
        {
            "ti": info,
            "save_path": str(media_dir),
            "flags": lt.torrent_flags.seed_mode,
        }
    )
    print(
        json.dumps(
            {
                "torrentPath": str(torrent_path),
                "seedDir": str(media_dir),
                "fileSize": info.total_size(),
                "pieceSize": info.piece_length(),
                "pieceCount": info.num_pieces(),
                "durationSec": args.seconds,
                "peer": f"127.0.0.1:{args.port}",
                "height": 720,
            }
        ),
        flush=True,
    )
    while True:
        session.pop_alerts()
        time.sleep(0.3)


if __name__ == "__main__":
    main()
