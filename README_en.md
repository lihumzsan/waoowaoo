<p align="center">
  <img src="public/banner.png" alt="waoowaoo" width="600">
</p>

<h1 align="center">waoowaoo AI Video Studio</h1>

<p align="center">
  An AI-powered tool that turns novel text into storyboards, characters, scenes, voiceovers, and complete short-form videos.
</p>

<p align="center">
  <a href="README.md">中文文档</a> · <a href="https://www.waoowaoo.com/">Join Waitlist</a> · <a href="https://github.com/saturndec/waoowaoo/issues">Report Bug</a>
</p>

> [!IMPORTANT]
> This repository currently supports development mode only. Next.js, workers, watchdog, Bull Board, and warmup run on the host through `npm run dev`. Docker Compose provides local MySQL, Redis, and MinIO only; it does not build or deploy the application.

## ✨ Features

- 🎬 **AI Script Analysis** — Parse novels and extract characters, scenes, and plot
- 🎨 **Character and Scene Generation** — Generate consistent visual assets
- 📽️ **Storyboard Video** — Generate shots and compose complete videos
- 🎙️ **AI Voiceover** — Multi-character voice synthesis
- 🌐 **Bilingual UI** — Chinese and English interfaces

## 🚀 Development Setup

### Prerequisites

- Node.js >= 18.18.0
- npm >= 9.0.0
- Docker Desktop, only when running MySQL, Redis, and MinIO locally

### Initialize

```bash
git clone https://github.com/lihumzsan/waoowaoo.git
cd waoowaoo
cp .env.example .env
npm install
npm run infra:up
npx prisma db push
npm run dev
```

Edit `.env` as needed for development and AI provider settings. After startup, open:

- App: [http://localhost:3000](http://localhost:3000)
- Bull Board: [http://localhost:3010/admin/queues](http://localhost:3010/admin/queues)
- MinIO Console: [http://localhost:19001](http://localhost:19001)

> [!WARNING]
> Run `npx prisma db push` before the first startup. Otherwise the database tables will not exist.

### Infrastructure Commands

```bash
# Start MySQL, Redis, and MinIO and wait for health checks
npm run infra:up

# Show service status
npm run infra:status

# Follow infrastructure logs
npm run infra:logs

# Stop services without deleting data volumes
npm run infra:down
```

Do not run `docker compose down -v`; it deletes local development data volumes.

If you already use local or remote MySQL, Redis, and MinIO services, skip `npm run infra:up` and configure their addresses in `.env`.

## 🧪 Verification

```bash
npm run lint:all
npm run typecheck
npm run test:all
npm run build
```

## 🎛️ ComfyUI Workflows

Built-in workflows live under `src/lib/providers/comfyui/workflows`. They are used by default. Set an absolute `COMFYUI_WORKFLOW_ROOT` path in `.env` only when reusing an external workflow directory.

## 🔧 API Configuration

After startup, configure AI provider API keys in Settings. The UI includes provider-specific guidance. Official provider APIs are recommended.

## 📦 Tech Stack

- **Framework**: Next.js 15 + React 19
- **Database**: MySQL + Prisma ORM
- **Queue**: Redis + BullMQ
- **Object Storage**: MinIO / S3 Compatible
- **Styling**: Tailwind CSS v4
- **Auth**: NextAuth.js

## 📦 Preview

![4f7b913264f7f26438c12560340e958c67fa833a](https://github.com/user-attachments/assets/fa0e9c57-9ea0-4df3-893e-b76c4c9d304b)
![67509361cbe6809d2496a550de5733b9f99a9702](https://github.com/user-attachments/assets/f2fb6a64-5ba8-4896-a064-be0ded213e42)
![466e13c8fd1fc799d8f588c367ebfa24e1e99bf7](https://github.com/user-attachments/assets/09bbff39-e535-4c67-80a9-69421c3b05ee)
![c067c197c20b0f1de456357c49cdf0b0973c9b31](https://github.com/user-attachments/assets/688e3147-6e95-43b0-b9e7-dd9af40db8a0)

## 🤝 Contributing

Use Issues to report bugs or suggest features. Pull requests are welcome for maintainer review.

**Made with ❤️ by waoowaoo team**
