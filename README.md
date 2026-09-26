# El Torrento

Family streaming app and owner admin UI for the homelab. This repo is application code and contracts. Guest placement, Compose, firewall, and NFS live in `el-torrento-infra`.

Stage 1 contains documentation and configuration skeletons only. No services are deployed from this commit.

## Surfaces

- `watch.hasnain.us` — family player (Netflix-like).
- `server.hasnain.us` — owner admin (terminal look). Physical order on the overview: 5050 left, 3040a center, 3040b right.
- `media.hasnain.us` — Jellyfin’s own UI, same sign-in, not a substitute for Watch.

Sign-in is Clerk with Google. The first owner is the Clerk user bound to `hasnainmn7@gmail.com`. Family addresses are not hardcoded.

## What belongs here

Watch UI, admin UI, API, database migrations, the libtorrent progressive engine, the media worker, and tests.

## What does not

Proxmox tokens, Cloudflare tokens, tracker logins, qBittorrent passwords, or Compose for the ingest VM. See `.env.example`.
