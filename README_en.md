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
> This repository supports development mode only. The development machine runs Next.js, workers, watchdog, and Bull Board through `npm run dev`; use `npm run dev:full` only when explicit route warmup is needed. MySQL, Redis, MinIO, and ComfyUI use the existing services on `192.168.0.112`; the development machine does not run or manage Docker.

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
- Network access to `192.168.0.112`

### Initialize

```bash
git clone https://github.com/lihumzsan/waoowaoo.git
cd waoowaoo
cp .env.example .env
npm install
npm run dev
```

Edit `.env` for AI provider settings as needed. `.env.example` already contains the remote infrastructure endpoints. After startup, open:

- App: [http://localhost:3000](http://localhost:3000)
- Bull Board: [http://localhost:3010/admin/queues](http://localhost:3010/admin/queues)

### Remote Development Services

| Service | Address |
| --- | --- |
| MySQL | `192.168.0.112:13306` |
| Redis | `192.168.0.112:16379` |
| MinIO API | `http://192.168.0.112:19000` |
| MinIO Console | `http://192.168.0.112:19001` |
| ComfyUI | `http://192.168.0.112:8878` |

Configure the ComfyUI service URL in Settings with the address above. The repository has no local infrastructure fallback and does not manage remote containers.

> [!WARNING]
> `192.168.0.112` is an active shared development environment. Do not run schema pushes, rebuilds, or other destructive database operations against it from this repository.

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
