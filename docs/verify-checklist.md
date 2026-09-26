# Verification checklist

Run before promoting a build to the homelab apps guest.

## Automated (`el-torrento/`)

```bash
npm test
npm run build
```

Covers auth isolation, backup, quality gating (2160p), deploy validation, piece map, and cluster helpers.

## Auth

- [ ] Owner is only the bound Clerk user id for `hasnainmn7@gmail.com`
- [ ] With Clerk keys: sign-in at `/sign-in`, `/api/auth/clerk-sync` sets `et_session`
- [ ] `/admin` redirects unauthenticated users; middleware sends missing `et_session` through clerk-sync
- [ ] Without Clerk keys: dev bootstrap on `/sign-in` when `ALLOW_DEV_AUTH`
- [ ] Viewer cannot `GET /api/admin/*` (403)
- [ ] Revoked user cannot `GET /api/media/:id/content` (403)
- [ ] Clerk secrets are not in the browser bundle (`NEXT_PUBLIC_*` publishable key only)

## Admin

- [ ] Overview order is 5050 · 3040a · 3040b; missing PVE token shows unknown, not fake CPU
- [ ] Users: invite, suspend/revoke, Jellyfin/Seerr sync
- [ ] Guest power on storage/apps/ingest; storage shutdown warns
- [ ] Deploy preview stores digest; apply refuses digest mismatch or missing agent
- [ ] MCP section is read-only (no apply/shell tools)

## Playback

- [ ] Seek past unverified pieces returns 416
- [ ] Delivery badge does not claim HDR when path unconfirmed
- [ ] 2160p hidden unless `allow4k` and encoder path are true

## Infra

- [ ] Ingest VM cannot mount library export
- [ ] Missing NFS refuses download path on VM disk (`resolveDownloadDir`)
- [ ] See `el-torrento-infra/docs/storage-isolation-verified.md` and systemd mount examples

## Backup

- [ ] `POST /api/admin/backup` creates a file under `data/backups/` (owner only)
