import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import net from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";

const enginePort = 18779;
const peerPort = 43991;
let engineProc: ChildProcess | null = null;
let seedProc: ChildProcess | null = null;
let root = "";

type ListedFile = { index: number; size: number; name: string; path: string };
type Fixture = {
  play: { torrentPath: string; peer: string; files: ListedFile[] };
  sized: { torrentPath: string; files: ListedFile[] };
};

let fixture: Fixture;

function waitForLine(child: ChildProcess, ready: (line: string) => boolean): Promise<string> {
  return new Promise((resolve, reject) => {
    let buffer = "";
    const onData = (chunk: Buffer) => {
      buffer += chunk.toString();
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (ready(line)) {
          child.stdout?.off("data", onData);
          resolve(line);
          return;
        }
      }
    };
    child.stdout?.on("data", onData);
    child.once("exit", (code) => reject(new Error(`process exited ${code} before ready`)));
  });
}

async function engine(pathname: string, init?: RequestInit): Promise<Response> {
  return fetch(`http://127.0.0.1:${enginePort}${pathname}`, init);
}

function rawGet(pathname: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const socket = net.connect(enginePort, "127.0.0.1", () => {
      socket.write(`GET ${pathname} HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n`);
    });
    const chunks: Buffer[] = [];
    socket.setTimeout(3000);
    socket.on("data", (chunk) => chunks.push(chunk));
    socket.on("timeout", () => socket.end());
    socket.on("error", reject);
    socket.on("close", () => resolve(Buffer.concat(chunks)));
  });
}

describe("engine streaming", { timeout: 120000 }, () => {
  before(async () => {
    root = await mkdtemp(path.join(tmpdir(), "el-torrento-engine-"));
    const script = path.join(root, "seed.py");
    await writeFile(
      script,
      `
import json, os, time
from pathlib import Path
import libtorrent as lt

root = Path(${JSON.stringify(root)})
peer_port = ${peerPort}

def build(folder: Path, piece: int):
    storage = lt.file_storage()
    lt.add_files(storage, str(folder))
    creator = lt.create_torrent(storage, piece)
    lt.set_piece_hashes(creator, str(folder.parent))
    torrent = folder.parent / (folder.name + ".torrent")
    torrent.write_bytes(lt.bencode(creator.generate()))
    info = lt.torrent_info(str(torrent))
    files = info.files()
    listed = []
    for index in range(info.num_files()):
        if int(files.file_flags(index)) & int(lt.file_flags_t.flag_pad_file):
            continue
        listed.append({
            "index": index,
            "size": files.file_size(index),
            "name": files.file_name(index),
            "path": str(folder / files.file_name(index)),
        })
    return str(torrent), listed, info

pack = root / "pack"
pack.mkdir()
(pack / "feature.bin").write_bytes(b"F" * 40000)
(pack / "extra.bin").write_bytes(bytes([index % 251 for index in range(18000)]))
play_torrent, play_files, play_info = build(pack, 16 * 1024)

sized = root / "sized"
sized.mkdir()
(sized / "short.bin").write_bytes(b"s" * 1000)
(sized / "long.bin").write_bytes(b"L" * 5000)
sized_torrent, sized_files, _ = build(sized, 16 * 1024)

session = lt.session({
    "listen_interfaces": f"127.0.0.1:{peer_port}",
    "enable_dht": False,
    "enable_upnp": False,
    "enable_natpmp": False,
    "enable_lsd": False,
})
session.add_torrent({"ti": play_info, "save_path": str(root), "flags": lt.torrent_flags.seed_mode})
print(json.dumps({
    "play": {"torrentPath": play_torrent, "peer": f"127.0.0.1:{peer_port}", "files": play_files},
    "sized": {"torrentPath": sized_torrent, "files": sized_files},
}), flush=True)
while True:
    session.pop_alerts()
    time.sleep(0.2)
`,
    );

    engineProc = spawn("python3", ["engine/server.py", "--port", String(enginePort)], {
      cwd: process.cwd(),
      env: { ...process.env, ENGINE_MAX_READ_BYTES: "1024", ENGINE_ALLOW_FAULT: "1" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    engineProc.stderr?.on("data", (chunk: Buffer) => {
      const text = chunk.toString();
      if (/Error|Traceback|Exception/.test(text)) process.stderr.write(text);
    });
    await waitForLine(engineProc, (line) => line.includes("listening"));
    seedProc = spawn("python3", [script], { stdio: ["ignore", "pipe", "pipe"] });
    seedProc.stderr?.on("data", (chunk: Buffer) => {
      const text = chunk.toString();
      if (/Error|Traceback|Exception/.test(text)) process.stderr.write(text);
    });
    const line = await waitForLine(seedProc, (row) => row.startsWith("{"));
    fixture = JSON.parse(line) as Fixture;
  });

  after(async () => {
    seedProc?.kill("SIGTERM");
    engineProc?.kill("SIGTERM");
    if (root) await rm(root, { recursive: true, force: true });
  });

  it("selects one file, deadlines the playhead, and answers 416 only outside that file", async () => {
    const long = fixture.sized.files.find((file) => file.name === "long.bin");
    assert.ok(long);
    const added = await engine("/v1/torrents", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: "sized",
        torrentPath: fixture.sized.torrentPath,
        savePath: path.join(root, "sized-down"),
      }),
    });
    assert.equal(added.status, 201);
    const meta = (await added.json()) as { fileSize: number; fileIndex: number; have: number[] };
    assert.equal(meta.fileSize, long.size);
    assert.equal(meta.fileIndex, long.index);
    assert.deepEqual(meta.have, []);

    const outside = await engine(`/v1/torrents/sized/bytes?start=${long.size}&end=${long.size + 10}`);
    assert.equal(outside.status, 416);
    const bad = await engine("/v1/torrents/sized/bytes?start=-1&end=10");
    assert.equal(bad.status, 400);
    const missing = await engine("/v1/torrents/sized/bytes?start=0&end=100");
    assert.equal(missing.status, 409);
    assert.notEqual(missing.status, 416);

    const waiting = await engine("/v1/torrents/sized/wait", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ start: 0, end: 100, timeoutMs: 200 }),
    });
    assert.equal(waiting.status, 200);
    const waited = (await waiting.json()) as { ready: boolean };
    assert.equal(waited.ready, false);
    const missed = await engine("/v1/torrents/sized/wait", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ start: long.size, end: long.size + 5, timeoutMs: 200 }),
    });
    assert.equal(missed.status, 416);

    const priority = await engine("/v1/torrents/sized/priority", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pieces: [0, 1], level: 7 }),
    });
    assert.equal(priority.status, 200);
    const armed = (await priority.json()) as { deadlines: { piece: number; ms: number }[] };
    assert.deepEqual(armed.deadlines, [
      { piece: 0, ms: 0 },
      { piece: 1, ms: 500 },
    ]);

    const cancelled = await engine("/v1/torrents/sized/cancel", { method: "POST" });
    assert.equal(cancelled.status, 200);
    const paused = (await cancelled.json()) as { paused: boolean; deadlines?: unknown };
    assert.equal(paused.paused, true);
    const status = (await (await engine("/v1/torrents/sized")).json()) as { paused: boolean; deadlines: unknown[] };
    assert.equal(status.paused, true);
    assert.deepEqual(status.deadlines, []);
    const resumed = await engine("/v1/torrents/sized/resume", { method: "POST" });
    assert.equal(resumed.status, 200);
    assert.equal(((await resumed.json()) as { paused: boolean }).paused, false);
  });

  it("reads a bounded hash-checked window and does not append an error after 206", async () => {
    const extra = fixture.play.files.find((file) => file.name === "extra.bin");
    const feature = fixture.play.files.find((file) => file.name === "feature.bin");
    assert.ok(extra && feature);
    assert.ok(extra.size < feature.size);
    const added = await engine("/v1/torrents", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: "selected",
        torrentPath: fixture.play.torrentPath,
        savePath: path.join(root, "download"),
        peer: fixture.play.peer,
        fileIndex: extra.index,
      }),
    });
    assert.equal(added.status, 201);
    const created = (await added.json()) as { fileSize: number; fileIndex: number };
    assert.equal(created.fileSize, extra.size);
    assert.equal(created.fileIndex, extra.index);

    await engine("/v1/torrents/selected/priority", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pieces: Array.from({ length: 16 }, (_, index) => index), level: 7 }),
    });

    const expected = await readFile(extra.path);
    const deadline = Date.now() + 20000;
    let headBody = Buffer.alloc(0);
    let ready = false;
    while (Date.now() < deadline && !ready) {
      const head = await engine("/v1/torrents/selected/bytes?start=0&end=199");
      headBody = Buffer.from(await head.arrayBuffer());
      ready = head.status === 206 && headBody.equals(expected.subarray(0, 200));
      if (!ready) await new Promise((resolve) => setTimeout(resolve, 80));
    }
    assert.equal(ready, true);

    const bounded = await engine(`/v1/torrents/selected/bytes?start=0&end=${extra.size - 1}`);
    assert.equal(bounded.status, 206);
    const boundedBody = Buffer.from(await bounded.arrayBuffer());
    assert.equal(boundedBody.length, 1024);
    assert.equal(bounded.headers.get("content-range"), `bytes 0-1023/${extra.size}`);
    assert.ok(boundedBody.equals(expected.subarray(0, 1024)));

    const raw = await rawGet("/v1/torrents/selected/bytes?start=0&end=100&fault=after-headers");
    const text = raw.toString("utf8");
    assert.equal(text.split("HTTP/1.1").length - 1, 1);
    assert.match(text, /206/);
    assert.equal(text.includes("{"), false);

    const status = (await (await engine("/v1/torrents/selected")).json()) as { filePath: string; have: number[] };
    const stored = await readFile(status.filePath);
    stored[10] ^= 0xff;
    await writeFile(status.filePath, stored);
    const corrupt = await engine("/v1/torrents/selected/bytes?start=0&end=100");
    assert.equal(corrupt.status, 409);
    const corruptBody = (await corrupt.json()) as { error: string };
    assert.match(corruptBody.error, /not verified/i);
    const after = (await (await engine("/v1/torrents/selected")).json()) as { have: number[] };
    assert.equal(after.have.includes(status.have[0] ?? -1), false);
  });
});
