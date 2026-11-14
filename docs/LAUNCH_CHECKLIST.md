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

## Google sign-in
- [ ] In Google Cloud Console → Credentials, add the production origin (`https://yourdomain.com`) and
      redirect URI (`https://yourdomain.com/api/auth/google/callback`) to the OAuth client.
- [ ] Publish the OAuth consent screen (Testing → In production) so any Google user can sign in.

## Legal
- [ ] Policies in `client/src/pages/legal/` reviewed by a lawyer; grievance officer details added.
- [ ] Remotion Company License purchased if the company has more than 3 people (needed for Motion Explainer).

## Avatar Studio (Phase 3) — live checks once keys are added
- [ ] `SARVAM_API_KEY`: English, Hindi, Telugu, Tamil, Marathi voiceovers; samples play; word timings via Deepgram look right in captions.
- [ ] Sarvam voice cloning (beta): clone + withdraw end to end (check the clone response field).
- [ ] (Optional) ElevenLabs as a second provider.
- [ ] `HEYGEN_API_KEY`: presenter list, one full-frame and one cut-out render, background field name, keying quality, timing.
- [ ] Confirm presenter pricing (currently 5 credits / 30 s) against HeyGen's real price.

## Motion Explainer (Phase 4.3)
- [ ] Remotion Company License if the team is more than 3 people (required for commercial use).
- [ ] Production render workers: Chrome Headless Shell installed (or allow Remotion to download it), fonts-noto
      for Indic scripts, `MOTION_CONCURRENCY` tuned, ideally a separate worker pool for motion renders.
- [ ] Prebuild the compositions (`MOTION_BUNDLE_DIR`) instead of bundling on first render.
- [ ] Measure render time/cost per 30 s and confirm the 2 credits / 30 s price.

## Payments (Phase 5)
- [ ] Razorpay test-mode run-through (packs, subscribe, renew via test webhook, cancel, upgrade/downgrade) — see docs/PHASE5.md.
- [ ] Webhook on the public HTTPS domain with payment.captured, payment.failed, order.paid, subscription.*; auto-capture on.
- [ ] Seller GST details (`BILLING_*`) filled; CA review of SAC code, GST-inclusive pricing and invoice layout.
- [ ] Final plan and credit-pack prices (currently business assumptions).
- [ ] Live Razorpay keys only after the test run passes.

## Admin & security (Phase 6) — see docs/SECURITY_AUDIT.md
- [ ] Create the production super admin with `npm run seed:admin -- <email> super_admin` (verified email first).
- [ ] Redis-backed rate limiters so limits hold across instances.
- [ ] Wrap credit charge + job enqueue in a MongoDB transaction (replica set).
- [ ] CSP for the SPA on the static host (self, Razorpay checkout, Google sign-in, media origin).
- [ ] Fresh JWT/cookie secrets; never reuse `legacy/server/.env.example` values.
- [ ] Post-launch: TOTP 2FA for admins; Dependabot/Renovate.

