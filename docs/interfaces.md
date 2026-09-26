# Interfaces

## Watch (`watch.hasnain.us`)

Modern streaming UI: rows, continue watching, requests, player. Quality menu: Auto (default), Original, 2160p, 1080p, 720p, 480p. A level appears only when the source, device, encoder budget, and that user’s policy allow it. The app does not upscale.

Badges describe the stream that was actually delivered. If HDR, Dolby Vision, or advanced audio will be dropped, the player says so before playback. If a path was not verified, it does not show a success badge.

## Admin (`server.hasnain.us`)

Terminal / ASCII look. Overview panels stay in physical order:

1. Left — 5050 / `pve-5050`
2. Center — 3040a / `pve3040a`
3. Right — 3040b / `pve-3040b`

Pages: Overview, User Management, Media Management, Services (Docker first; Kubernetes labeled unavailable until a real cluster exists), MCP later.

Collectors show unknown or stale. They do not invent CPU, temperature, or viewer counts.

Everyday controls only: start and graceful shutdown of approved guests, restart approved app services, pause or resume downloads, retry a failed import or request, trigger an allowed library scan.

Not in v1: node reboot, forced power-off, guest delete, disk operations, cluster membership changes, a shell, or an open Proxmox API proxy.

## Jellyfin (`media.hasnain.us`)

Jellyfin’s own interface for people who want it. Authorization still comes from the app. It is not the family homepage.
