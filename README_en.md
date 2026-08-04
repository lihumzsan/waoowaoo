<p align="center">
  <img src="public/banner.png" alt="waoowaoo" width="600">
</p>

<h1 align="center">waoowaoo AI Video Studio</h1>

<p align="center">
  An AI-powered tool for creating short drama / comic videos — automatically generates storyboards, characters, and scenes from novel text, then assembles them into complete videos.
</p>

<p align="center">
  <a href="README.md">中文文档</a> · <a href="https://www.waoowaoo.com/">Join Waitlist</a> · <a href="https://github.com/saturndec/waoowaoo/issues">Report Bug</a>
</p>

> [!IMPORTANT]
> **Beta Notice**: This project is currently in its early beta stage. As it is currently a solo-developed project, some bugs and imperfections are to be expected. We are iterating rapidly — please stay tuned for frequent updates! We are committed to rolling out a massive roadmap of new features and optimizations, with the ultimate goal of becoming the top-tier solution in the industry. Your feedback and feature requests are highly welcome!

---

## ✨ Features

- 🎬 **AI Script Analysis** — Parse novels, extract characters, scenes & plot automatically
- 🎨 **Character & Scene Generation** — Consistent AI-generated character and scene images
- 📽️ **Storyboard Video** — Auto-generate shots and compose into complete videos
- 🎙️ **AI Voiceover** — Multi-character voice synthesis
- 🌐 **Bilingual UI** — Chinese / English, switch in the top-right corner

---

## 🚀 Quick Start

**Prerequisites**: Install [Docker Desktop](https://docs.docker.com/get-docker/)

### Method 1: Pull Pre-built Image (Easiest)

No repository checkout is required. The Compose file contains the Temporal
database, schema, and namespace bootstrap commands; it has no bind mount to a
host-side repository script:

```bash
# Download docker-compose.yml
curl -O https://raw.githubusercontent.com/saturndec/waoowaoo/main/docker-compose.yml
curl -O https://raw.githubusercontent.com/saturndec/waoowaoo/main/.env.example
cp .env.example .env

# Edit .env: generate a distinct random value for every blank secret. Keep
# MYSQL_PASSWORD in sync with DATABASE_URL and COMPOSE_DATABASE_URL (URL-encode special characters).
# Also configure a pre-created S3-compatible bucket reachable over public HTTPS.
# TEMPORAL_WORKER_BLUE_IMAGE and TEMPORAL_WORKER_GREEN_IMAGE must both be full
# repository@sha256:<64-hex-digest> references. They may initially use the same image.
# APP_IMAGE must use that same digest; do not retain the all-zero placeholder.
# TEMPORAL_WORKER_BLUE_BUILD_ID must be a unique, non-local release identity.

# Start all services
docker compose up -d
```

Web and Temporal Worker containers use the same immutable application image but
run as separate processes and failure domains. Production Worker slots only
pull that digest and never build from a local context. Web never hosts Workflows,
and a Worker never accepts HTTP traffic.

> [!WARNING]
> Do not replace the only Worker with `docker compose down/up`, and never use
> `down -v` as an upgrade. Workflows pinned to the old release need that old
> Worker until Temporal proves the version is drained.

### Blue/green Temporal Worker upgrade

The first install uses the blue slot. For the next release, configure the idle
green slot in `.env`:

```bash
TEMPORAL_WORKER_GREEN_IMAGE=<repository@sha256:64-hex-digest>
TEMPORAL_WORKER_GREEN_BUILD_ID=<new-unique-build-id>
TEMPORAL_WORKER_GREEN_REPLICAS=1
```

Download the rollout guard from the same release and promote the candidate. It
rejects a selected Current slot or mutable image before starting any candidate
container, waits for every task queue poller, calls Temporal
`set-current-version`, and verifies that the previous Current Worker is still running:

```bash
curl -o temporal-worker-rollout.sh \
  https://raw.githubusercontent.com/saturndec/waoowaoo/<same-release-tag>/scripts/temporal/worker-rollout.sh
chmod 0755 temporal-worker-rollout.sh
sh ./temporal-worker-rollout.sh promote green
```

Only then point `APP_IMAGE` at the new immutable Web image. Keep the old blue
Worker running. Check its drainage state with:

```bash
sh ./temporal-worker-rollout.sh status
```

After the old build reports `drainageStatus: drained`, set
`TEMPORAL_WORKER_BLUE_REPLICAS=0` in `.env` and run:

```bash
sh ./temporal-worker-rollout.sh retire blue
```

Swap blue and green on the next release. `retire` rejects the Current Version,
an undrained version, or a slot whose desired replica count is not persistently
zero.

### Method 2: Clone, Build, and Publish an Immutable Image

```bash
git clone https://github.com/saturndec/waoowaoo.git
cd waoowaoo
cp .env.example .env
# Build locally, push to a registry you control, and resolve the pushed digest.
docker build -t <registry>/<repository>:<release-tag> .
docker push <registry>/<repository>:<release-tag>

# Set APP_IMAGE, TEMPORAL_WORKER_BLUE_IMAGE, and TEMPORAL_WORKER_GREEN_IMAGE to
# the same <registry>/<repository>@sha256:<64-hex-digest>. Production Compose
# only pulls that release image; it does not build Web or Worker from context.
# Fill the remaining .env secrets as described above.
docker compose up -d
```

To update:
```bash
git pull
# Follow the blue/green Worker procedure above. Never replace the only Worker
# with docker compose down/up.
```

### Method 3: Local Development (For Developers)

```bash
git clone https://github.com/saturndec/waoowaoo.git
cd waoowaoo

# Copy environment config (must be done before npm install)
cp .env.example .env
# ⚠️ Configure database, Redis, Temporal, external S3-compatible storage,
# authentication, and encryption. MYSQL_PASSWORD must match both database URLs.

npm install

# Push the Prisma schema
npm run db:push

# Start MySQL, Redis, the Temporal Server/namespace, Web, and a local explicitly
# unversioned Worker. This does not start the production blue/green Workers.
npm run dev
```

To debug the official Cloud product surface locally, copy `.env.cloud.example` to
`.env.cloud.local` and run `npm run dev:cloud`. It uses the same local open-source
Temporal service and does not require a Temporal Cloud account, TLS, or an API key.

---

Visit [http://localhost:13000](http://localhost:13000) (Method 1 & 2) or [http://localhost:3000](http://localhost:3000) (Method 3) to get started!

> Methods 1 and 2 initialize the database on first container launch; the external storage configuration and pre-created bucket are still required.

> [!WARNING]
> When running the app directly, do not skip `npm run db:push`. It synchronizes the Prisma schema before the application and workers start.
>
> Pre-create the object-storage bucket and grant the configured credentials permission to check
> the bucket and read, write, and delete objects. `S3_ENDPOINT` must be an HTTPS endpoint reachable
> by external AI providers. Local development uses a development bucket too, so no ngrok,
> cloudflared, local-file storage, or Docker MinIO is required. AWS S3, Cloudflare R2, Tencent COS,
> and Alibaba OSS share the same `S3_*` configuration. GCS requires its XML API and HMAC credentials.
> Azure Blob does not implement S3 and is not directly supported.
>
> Before the one-time B+ cutover, stop the old Web, Bull worker, and Outbox
> dispatcher, back up the database, and run `npm run db:bplus-cutover-preflight`.
> Proceed only when every reported blocker is zero, then review and execute
> `npm run db:bplus-cutover-apply`. This is the only apply entry: it runs the
> immutable base followed by the additive migration for a legacy database, or
> only the additive migration when the base is already complete. The DDL is not
> transactional; never replace it with `db:push --accept-data-loss`. A partial
> base fails closed and must be restored from backup rather than rerun.

> [!TIP]
> **If you experience lag**: HTTP mode may limit browser connections. Install [Caddy](https://caddyserver.com/docs/install) for HTTPS:
> ```bash
> caddy run --config Caddyfile
> ```
> Then visit [https://localhost:1443](https://localhost:1443)

---

## 🔧 API Configuration

After launching, go to **Settings** to configure your AI service API keys. A built-in guide is provided.

> 💡 **Note**: Currently only official provider APIs are recommended. Third-party compatible formats (OpenAI Compatible) are not yet fully supported and will be improved in future releases.

---

## 📦 Tech Stack

- **Framework**: Next.js 15 + React 19
- **Database**: MySQL + Prisma ORM
- **Durable orchestration**: Temporal Worker Deployments + MySQL persistence
- **Ephemeral transport/cache**: Redis
- **Styling**: Tailwind CSS v4
- **Auth**: NextAuth.js

---

## 📦 Preview

![4f7b913264f7f26438c12560340e958c67fa833a](https://github.com/user-attachments/assets/fa0e9c57-9ea0-4df3-893e-b76c4c9d304b)
![67509361cbe6809d2496a550de5733b9f99a9702](https://github.com/user-attachments/assets/f2fb6a64-5ba8-4896-a064-be0ded213e42)
![466e13c8fd1fc799d8f588c367ebfa24e1e99bf7](https://github.com/user-attachments/assets/09bbff39-e535-4c67-80a9-69421c3b05ee)
![c067c197c20b0f1de456357c49cdf0b0973c9b31](https://github.com/user-attachments/assets/688e3147-6e95-43b0-b9e7-dd9af40db8a0)

---

## 🤝 Contributing

This project is maintained by the core team. You're welcome to contribute by:

- 🐛 Filing [Issues](https://github.com/saturndec/waoowaoo/issues) — report bugs
- 💡 Filing [Issues](https://github.com/saturndec/waoowaoo/issues) — propose features
- 🔧 Submitting Pull Requests as references — we review every PR carefully for ideas, but the team implements fixes internally rather than merging external PRs directly

---

**Made with ❤️ by waoowaoo team**

## Star History

[![Star History Chart](https://api.star-history.com/svg?repos=saturndec/waoowaoo&type=date&legend=top-left)](https://www.star-history.com/#saturndec/waoowaoo&type=date&legend=top-left)
