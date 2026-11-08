# Launch checklist (Phase 7)

Items that must be done before ShortsInShort goes live. Add to this list as phases complete.

## Email
- [ ] Replace the Gmail SMTP used for local testing with a transactional email provider
      (Resend, Brevo or Amazon SES) on your own domain (e.g. `no-reply@yourdomain.com`).
- [ ] Add SPF, DKIM and DMARC DNS records so emails don't land in spam.
- [ ] Update `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS`, `EMAIL_FROM` in the
      production environment and run `npm --prefix server run email:test -- you@yourdomain.com`.
- [ ] Revoke the Gmail App Password used during development.

## Configuration
- [ ] `APP_URL` set to the real domain (verification/reset links use it).
- [ ] Strong, unique `JWT_ACCESS_SECRET`; secrets stored in the host's secret manager, not files.
- [ ] `STORAGE_DRIVER=s3` with Cloudflare R2/S3 credentials, verified end to end.
- [ ] Distro FFmpeg/FFprobe via `FFMPEG_PATH` / `FFPROBE_PATH`; workers run separately (`WORKER_MODE=off` + `npm run worker`).
- [ ] MongoDB replica set (e.g. Atlas) with backups; Redis for rate limits / queue.

## Legal
- [ ] Policies in `client/src/pages/legal/` reviewed by a lawyer; grievance officer details added.
- [ ] Remotion Company License purchased if the company has more than 3 people (needed for Motion Explainer).
