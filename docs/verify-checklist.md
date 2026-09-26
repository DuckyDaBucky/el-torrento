# Verification checklist

Run before calling the deployment done.

## Auth

- [ ] Owner is only the bound Clerk user id for `hasnainmn7@gmail.com`
- [ ] Viewer cannot `GET /api/admin/cluster` (403)
- [ ] Revoked user cannot `GET /api/media/:id/content` (403)
- [ ] Clerk secrets are not in the browser bundle (`NEXT_PUBLIC_*` only publishable key)

## Admin

- [ ] Overview order is 5050 · 3040a · 3040b without PVE token shows unknown, not fake CPU
- [ ] Guest shutdown on storage warns when worker is not configured

## Playback

- [ ] `npm test` passes (piece map, quality gating, 2160p rules)
- [ ] Seek past unverified pieces returns 416
- [ ] Delivery badge does not claim HDR when path unconfirmed

## Infra

- [ ] Ingest VM cannot mount library export
- [ ] Missing NFS refuses download path on VM disk (`resolveDownloadDir`)

## Backup

- [ ] `POST /api/admin/backup` creates a file under `data/backups/` (owner only)

Automated: `npm test` in `el-torrento/`.
