# Verify checklist

Run before promoting a build to the homelab apps guest.

## Automated (repo root `el-torrento/`)

```bash
npm test
npm run build
```

Includes auth isolation, backup, quality gating (2160p), deploy validation, and cluster helpers.

## Identity

- [ ] With Clerk keys: Google sign-in at `/sign-in`, redirect through `/api/auth/clerk-sync`, `et_session` cookie set.
- [ ] `/admin` redirects unauthenticated Clerk users to sign-in; without `et_session`, clerk-sync runs first.
- [ ] Without Clerk keys: dev bootstrap on `/sign-in` still binds owner locally (`ALLOW_DEV_AUTH`).

## Users

- [ ] Owner can issue invite, suspend, revoke, and sync Jellyfin/Seerr from Admin → Users.
- [ ] Viewer cannot call `/api/admin/*` (403).

## Playback

- [ ] Signal check player shows honest badge (confirmed vs transcode vs not confirmed).
- [ ] 2160p profile hidden unless `allow4k` and encoder path are true for the title.

## Services

- [ ] Guest power buttons only on storage/apps/ingest; storage shutdown shows warning.
- [ ] Deploy preview stores digest; apply refuses digest mismatch or missing agent.

## MCP

- [ ] Admin → MCP lists tools read-only; no apply/shell tools exposed.

## Backup

- [ ] Owner POST `/api/admin/backup` writes timestamped file under `data/backups/`.

## Infra (cluster)

- [ ] NFS isolation documented in `el-torrento-infra/docs/storage-isolation-verified.md`.
- [ ] systemd mount examples present for playback and ingest guests.
