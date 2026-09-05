# Deploy

End-to-end deployment of tgshop to a single VPS using Docker Compose and
Caddy for automatic HTTPS. Assumes Ubuntu 22.04/24.04; adapt package manager
commands for other distros.

## 1. Provision the VPS

- Minimum: 2 vCPU / 4GB RAM / 40GB SSD for a small-to-medium shop (Postgres +
  Redis + 5 Node apps + Caddy all on one box). Scale worker/miniapp/admin
  replicas or move Postgres/Redis to managed services if you outgrow this.
- Point DNS `A`/`AAAA` records at the VPS for:
  - `api.<domain>` (bot: webhook + Mini App API + `/internal/*`)
  - `miniapp.<domain>` (Mini App frontend)
  - `<domain>` and `www.<domain>` (landing page)
  - `admin.<domain>` (admin panel)

## 2. Install Docker

```bash
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker "$USER"
# log out/in for the group change to apply
```

## 3. Clone and configure

```bash
sudo mkdir -p /opt/tgshop && sudo chown "$USER" /opt/tgshop
git clone <your-fork-url> /opt/tgshop && cd /opt/tgshop
cp .env.example .env
./scripts/gen-keys.sh >> .env
```

Edit `.env`:

- `DOMAIN=<your domain>` — used by `Caddyfile`/`docker-compose.yml` for
  subdomain routing and Let's Encrypt.
- `WEBHOOK_URL=https://api.<domain>` — the BASE url only. The bot appends
  `/webhook/telegram/<WEBHOOK_SECRET>` itself, and `scripts/setup-webhook.sh`
  builds the identical URL. Putting a path here produces a doubled path and a
  bot that silently receives no updates.
- `NEXT_PUBLIC_API_URL=https://api.<domain>`
- `MINIAPP_URL=https://miniapp.<domain>`, `LANDING_URL=https://<domain>`,
  `ADMIN_URL=https://admin.<domain>`
- Fill in `BOT_TOKEN`, `ADMIN_IDS`, `CRYPTOBOT_*`, `TRON_*` per the root
  `README.md`'s setup walkthrough.
- Set a real, strong `POSTGRES_PASSWORD` (referenced by
  `docker-compose.yml`; not in `.env.example` by default — add it).

**Back up `.env` somewhere outside this VPS immediately after filling in
`ENCRYPTION_KEY`.** Losing it makes every encrypted `StockItem.payloadEnc`
and `Order.deliveredPayloadEnc` row permanently unrecoverable.

## 4. First boot: migrate + seed, then bring up the stack

```bash
docker compose up -d postgres redis
docker compose run --rm bot pnpm --filter @tgshop/db exec prisma migrate deploy
docker compose run --rm bot pnpm --filter @tgshop/db exec prisma db seed
docker compose up -d
```

`docker compose up -d` builds and starts `bot`, `worker`, `miniapp`,
`landing`, `admin`, and `caddy`. Caddy automatically requests Let's Encrypt
certificates for each subdomain on first request — make sure ports 80/443
are open in your firewall/security group before this step, since ACME
HTTP-01 challenge validation needs them.

```bash
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw allow OpenSSH
sudo ufw enable
```

## 5. Register the Telegram webhook

```bash
./scripts/setup-webhook.sh set
./scripts/setup-webhook.sh info
```

Confirm `getWebhookInfo` shows your `api.<domain>/webhook/telegram/<secret>` URL with
no `last_error_message`.

## 6. Verify

- `curl -I https://api.<domain>/health` — should not connection-refuse (Fastify is up).
- `curl -H "Authorization: Bearer $SERVICE_TOKEN" https://api.<domain>/metrics` —
  should return Prometheus metrics; the endpoint requires the service token and
  must not be exposed anonymously.
- Open `https://miniapp.<domain>` — should load the Mini App shell (best
  tested from inside Telegram via the bot's menu button, since Telegram
  WebApp APIs are unavailable in a plain browser).
- Open `https://<domain>` — landing page.
- Open `https://admin.<domain>` — admin login (see `docs/ADMIN.md`).
- `docker compose logs -f bot worker` — confirm no crash loops.

## 7. Ongoing operations

### Backups

```bash
# Add to crontab -e (as the deploy user):
15 3 * * * cd /opt/tgshop && ./scripts/backup-postgres.sh >> /var/log/tgshop-backup.log 2>&1
```

Consider also copying `./backups/*.sql.gz` off-box nightly (rsync/rclone to
S3-compatible storage) — the rotation in `backup-postgres.sh` only protects
against disk growth, not VPS-level disasters.

### Updating to a new version

```bash
cd /opt/tgshop
git fetch --tags
git checkout v1.2.0   # or: git pull origin main
docker compose build
docker compose run --rm bot pnpm --filter @tgshop/db exec prisma migrate deploy
docker compose up -d
```

Or, if using the images published by `.github/workflows/release.yml`
(`ghcr.io/<org>/<repo>/<app>:v1.2.0`), point `docker-compose.yml`'s `image:`
at the tagged image instead of building locally, then `docker compose pull
&& docker compose up -d`.

### Scaling

```bash
docker compose up -d --scale worker=3 --scale miniapp=2 --scale admin=2
```

`bot` should stay at a single replica (webhook processing + grammY session
state is not horizontally shared in this setup). `worker`, `miniapp`,
`landing`, `admin` are all safe to scale; put them behind Caddy's built-in
load balancing by listing multiple upstreams if you scale beyond what
Compose's service DNS round-robin handles well.

### Rolling back

```bash
git checkout <previous-tag>
docker compose build
docker compose up -d
```

Database rollbacks are not automatic — `prisma migrate deploy` only applies
forward migrations. If a migration must be reverted, write and apply a new
forward migration that undoes it, or restore from a pre-migration backup via
`./scripts/restore-postgres.sh`.

### Disaster recovery

```bash
docker compose stop bot worker
./scripts/restore-postgres.sh ./backups/tgshop_2026-08-05_031500.sql.gz
docker compose up -d
```

See `./scripts/restore-postgres.sh`'s header comment for the full restore
semantics (it drops and recreates the `public` schema — destructive by
design, confirms before proceeding unless `--yes` is passed).
