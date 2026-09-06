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
curl -O https://raw.githubusercontent.com/saturndec/waoowaoo/main/scripts/temporal/worker-rollout.sh
cp .env.example .env

# Edit .env: generate a distinct random value for every blank secret. Keep
# MYSQL_PASSWORD in sync with DATABASE_URL and COMPOSE_DATABASE_URL (URL-encode special characters).
# Local development uses the bundled Docker MinIO; no external object storage is required.
# TEMPORAL_WORKER_BLUE_IMAGE and TEMPORAL_WORKER_GREEN_IMAGE must both be full
# repository@sha256:<64-hex-digest> references. They may initially use the same image.
# APP_IMAGE must use that same digest; do not retain the all-zero placeholder.
# TEMPORAL_WORKER_BLUE_BUILD_ID must be a unique, non-local release identity.

# Establish the first Current Version through the rollout entry, then start Web.
chmod 0755 worker-rollout.sh
sh ./worker-rollout.sh bootstrap blue
docker compose up -d
```

Web and Temporal Worker containers use the same immutable application image but
run as separate processes and failure domains. Production Worker slots only
pull that digest and never build from a local context. Web never hosts Workflows,
and a Worker never accepts HTTP traffic. Worker slots use a dedicated Compose
profile, so an ordinary `docker compose up` cannot create, replace, or stop them.

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
`set-current-version`, migrates legacy continuous Schedulers that were incorrectly
pinned, and verifies that the previous Current Worker is still running:

```bash
curl -o temporal-worker-rollout.sh \
  https://raw.githubusercontent.com/saturndec/waoowaoo/<same-release-tag>/scripts/temporal/worker-rollout.sh
chmod 0755 temporal-worker-rollout.sh
sh ./temporal-worker-rollout.sh promote green
```

If production uses a non-default env file, Compose file set, or project name,
bind every rollout command to that same project with Compose's standard
environment variables:

```bash
COMPOSE_ENV_FILES=<production-env> \
COMPOSE_FILE=docker-compose.yml:<production-overlay> \
COMPOSE_PROJECT_NAME=<production-project> \
sh ./temporal-worker-rollout.sh status
```

Only then point `APP_IMAGE` at the new immutable Web image and update Web with a
normal `docker compose up -d`; that command does not manage the Worker profile.
Keep the old blue Worker running. Check its drainage state with:

```bash
sh ./temporal-worker-rollout.sh status
```

After the old build reports `drainageStatus: drained`, set
`TEMPORAL_WORKER_BLUE_REPLICAS=0` in `.env` and run:

```bash
sh ./temporal-worker-rollout.sh retire blue
```

Swap blue and green on the next release. `retire` rejects the Current Version,
a build that still owns a running Workflow, an undrained version, or a slot whose
desired replica count is not persistently zero.

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
sh scripts/temporal/worker-rollout.sh bootstrap blue
docker compose up -d
```

To update:
```bash
git pull
# Follow the blue/green Worker procedure above. Never replace the only Worker
# with docker compose down/up.
```

### Method 3: Local Development (Recommended)

```bash
git clone https://github.com/saturndec/waoowaoo.git
cd waoowaoo

# Copy the configuration before the first install.
cp .env.example .env
# Configure MySQL, Redis, MinIO, Temporal, authentication, the Codex Runtime,
# ComfyUI endpoints, and the host FFMPEG_BINARY_DIR.

npm install

# Run only for first-time initialization or an intentional schema sync.
npm run db:push

# Docker starts MySQL, Redis, MinIO, and Temporal infrastructure.
# Next.js and the Temporal Worker run on the Windows host.
npm run dev
```

---

Visit [http://localhost:13000](http://localhost:13000) (Method 1 & 2) or [http://localhost:3000](http://localhost:3000) (Method 3) to get started!

> Methods 1 and 2 initialize the database and the local MinIO bucket on first container launch.

> [!WARNING]
> When running the app directly, do not skip `npm run db:push`. It synchronizes the Prisma schema before the application and workers start.
>
> If `project_assistant_threads` or `project_assistant_thread_archives` still has
> `messagesJson`, or the normalized message tables do not yet have non-null `byteLength`,
> stop Web and the Temporal worker, take a backup, then run
> `npm run db:assistant-messages:preflight`, `npm run db:assistant-messages:apply`, and
> `npm run db:assistant-messages:verify` in that order. The cutover rejects active Turns and
> invalid or oversize legacy messages, and resumes from its recorded phase. `db:push` fails
> closed until the cutover is complete; never replace it with `--accept-data-loss`.
>
> Local development uses the single MinIO instance started by the infrastructure stack.
> Set `S3_ENDPOINT` and `S3_UPLOAD_ENDPOINT` to that same reachable HTTP or HTTPS
> endpoint. Startup creates a missing `S3_BUCKET`; there is no second storage backend
> or local-directory fallback.

> [!TIP]
> **If you experience lag**: HTTP mode may limit browser connections. Install [Caddy](https://caddyserver.com/docs/install) for HTTPS:
> ```bash
> caddy run --config Caddyfile
> ```
> Then visit [https://localhost:1443](https://localhost:1443)

---

## 🔧 API Configuration

No external AI API key is required for local use. Text, conversations, planning,
context compaction, and search use the Codex App Server signed in by the current
Windows user. Image generation and editing use the Codex image provider. Video,
music, sound effects, TTS, and voiceover use the local ComfyUI instance. Settings
only expose capabilities inside those two provider boundaries.

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
