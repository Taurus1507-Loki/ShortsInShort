# Deploying ShortsInShort

The app ships as **one Docker image** with two roles:

| Role | Command | What it does |
|---|---|---|
| API + web app | `node dist/server.js` (default) | Serves `/api` and the built web app on the same origin, port 5000 |
| Worker | `node dist/worker.js` | Renders videos, voiceovers and voice clones. Scale it by running more workers |

The image includes FFmpeg, Inter and Noto fonts (Latin, Devanagari, Telugu, Tamil), Remotion's headless Chrome and a prebuilt Motion Explainer bundle. The first render needs no downloads or bundling.

## Option A: one VPS with Docker Compose (simplest)

Suggested size: 4 vCPU / 8 GB RAM to start (rendering is CPU-heavy), for example Hetzner, DigitalOcean or AWS Lightsail in Mumbai or Singapore.

1. Point your domain's DNS A record at the server.
2. Install Docker, then clone the repo.
3. Create the production config:
   ```bash
   cp deploy/.env.production.example deploy/.env.production
   ```
   Fill it in with freshly generated secrets.
4. Start the stack:
   ```bash
   DOMAIN=app.example.com APP_VERSION=$(git rev-parse --short HEAD) docker compose -f docker-compose.prod.yml up -d --build
   ```
5. Create the first super admin. Register in the app, verify your email, then run:
   ```bash
   docker compose -f docker-compose.prod.yml exec api node dist/scripts/createAdmin.js you@example.com super_admin
   ```

Caddy gets and renews HTTPS certificates automatically.

To update the app:
```bash
git pull && docker compose -f docker-compose.prod.yml up -d --build
```

On shutdown the API finishes open requests. The worker stops a running job, and the job is retried automatically once its lease expires (a few minutes), so updates are safe but can delay a render in progress.

## Option B: managed containers

Any platform that runs Docker images works (Railway, Render, Fly.io, Google Cloud Run + a VM for workers, AWS ECS):
- **Web service:** the image with its default command, port 5000, health check `GET /api/health`.
- **Worker service:** the same image with the command `node dist/worker.js`, no public port, at least 2 GB RAM.
- **MongoDB Atlas** (replica set, automatic backups) and **Cloudflare R2** for media (`STORAGE_DRIVER=s3`). Workers on separate machines share nothing except these two.

## Health checks and monitoring

| Endpoint | Meaning | Use it for |
|---|---|---|
| `GET /api/health/live` | The process is up | Container restarts (the image's `HEALTHCHECK`) |
| `GET /api/health` | 503 unless MongoDB is connected; includes `version` | Load balancer readiness and uptime monitoring |

- **Uptime:** add `https://<domain>/api/health` to an external monitor (UptimeRobot, Better Stack) with email or WhatsApp alerts.
- **Logs:** JSON lines on stdout (pino), each with a request ID that is also returned in the `x-request-id` header. Secrets and signed URLs are never logged. Ship them with your platform's log drain, or with `docker compose logs`.
- **Product health:** the admin console (`/app/admin`) warns about failed payment webhooks and job failure rates above 10%.

## Backups

- **Atlas:** turn on continuous backups (point-in-time restore).
- **Bundled MongoDB:** the `backup` service writes a compressed dump every 24 h to the `backups` volume and keeps 14 days (`BACKUP_KEEP_DAYS`).
  - Also copy the dumps off the server, for example with a nightly `rclone copy` of the volume to an R2 bucket.
  - Restore from a dump:
    ```bash
    docker compose -f docker-compose.prod.yml exec backup mongorestore --uri "mongodb://mongo:27017/?replicaSet=rs0" --gzip --archive=/backups/<file> --drop
    ```
  - Test a restore before launch, and then every quarter.
- **Media:** R2 is durable. Turn on object versioning if you want protection against deleting things by mistake. With local storage, back up the `media` volume too.

## Security defaults in production
- `NODE_ENV=production` refuses to start without SMTP, or with a non-https `APP_URL`.
- Cookies are `Secure`, and the web app is served with a strict Content Security Policy:
  - Only its own scripts, plus Razorpay Checkout and Google Fonts.
  - The inline theme script is allowed by hash.
  - The page can't be framed.
- `TRUST_PROXY=1` is set behind Caddy or a load balancer, so rate limits and the audit log see real client IPs.
- See [SECURITY_AUDIT.md](SECURITY_AUDIT.md) for the remaining launch items.
