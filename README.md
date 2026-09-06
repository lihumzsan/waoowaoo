<p align="center">
  <a href="https://www.waoowaoo.com/">
    <img src="images/cta-banner.png" alt="🚀 探索 AI 影视的下一代创作流 | 立即加入 waoowaoo 在线网页版内测候补" width="800">
  </a>
</p>

<p align="center">
  <img src="public/banner.png" alt="waoowaoo" width="600">
</p>

<h1 align="center">waoowaoo AI 影视 Studio</h1>

<p align="center">
  一款基于 AI 技术的短剧/漫画视频制作工具，支持从小说文本自动生成分镜、角色、场景，并制作成完整视频。
</p>

<p align="center">
  <a href="README_en.md">English</a> · <a href="https://www.waoowaoo.com/">加入内测候补</a> · <a href="https://github.com/saturndec/waoowaoo/issues">反馈问题</a>
</p>

> [!IMPORTANT]
> ⚠️ **测试版声明**：本项目目前处于测试初期阶段，由于暂时只有我一个人开发，存在部分 bug 和不完善之处。我们正在快速迭代更新中，**欢迎进群反馈问题和需求，及时关注项目更新！目前更新会非常频繁，后续会增加大量新功能以及优化效果，我们的目标是成为行业最强AI工具！**

<img src="https://github.com/user-attachments/assets/2b3fc495-9812-493a-8dbc-5bec4757df31" width="30%">

---
## ✨ 功能特性

- 🎬 **AI 剧本分析** — 自动解析小说，提取角色、场景、剧情
- 🎨 **角色 & 场景生成** — AI 生成一致性人物和场景图片
- 📽️ **分镜视频制作** — 自动生成分镜头并合成视频
- 🌐 **多语言支持** — 中文 / 英文界面，右上角一键切换

---

## 🚀 快速开始

**前提条件**：安装 [Docker Desktop](https://docs.docker.com/get-docker/)

### 方式一：拉取预构建镜像（最简单）

无需克隆仓库。Compose 已内置 Temporal 数据库、schema 和 namespace 初始化逻辑，
启动时不依赖宿主机上的仓库脚本：

```bash
# 下载 docker-compose.yml
curl -O https://raw.githubusercontent.com/saturndec/waoowaoo/main/docker-compose.yml
curl -O https://raw.githubusercontent.com/saturndec/waoowaoo/main/.env.example
curl -O https://raw.githubusercontent.com/saturndec/waoowaoo/main/scripts/temporal/worker-rollout.sh
cp .env.example .env

# 编辑 .env：为所有空白密钥生成独立随机值，并让 MYSQL_PASSWORD、
# DATABASE_URL 与 COMPOSE_DATABASE_URL 中的密码保持一致（URL 中需编码特殊字符）。
# 本机开发默认使用 Docker MinIO；无需外部对象存储。
# TEMPORAL_WORKER_BLUE_IMAGE 和 TEMPORAL_WORKER_GREEN_IMAGE 都必须填写完整的
# repository@sha256:<64位digest>；首次安装可以先让两个 slot 指向同一镜像。
# APP_IMAGE 必须指向同一个digest，不能保留 .env.example 中的全零占位值。
# TEMPORAL_WORKER_BLUE_BUILD_ID 必须是该发布唯一、非 local 的 identity。

# 首次只通过 rollout 入口启动 blue Worker 并建立 Current Version；随后启动 Web。
chmod 0755 worker-rollout.sh
sh ./worker-rollout.sh bootstrap blue
docker compose up -d
```

Web 与 Temporal Worker 使用同一个不可变应用镜像，但运行在独立容器中。正式 Worker
slot只拉取上述digest，不从本地`build: context`构建。Web 进程不会托管 Workflow；Worker
进程也不接受 HTTP 流量。Worker slot 使用独立 Compose profile，普通
`docker compose up` 不会创建、替换或停止它们。

> [!WARNING]
> 下面的 `down/up` 或直接替换唯一 Worker 会让仍然 PINNED 到旧版本的 Workflow 停止。
> 升级必须使用下一节的蓝绿流程；不得先停止旧 Worker，也不得使用 `down -v` 删除数据。

### Temporal Worker 蓝绿升级

首次安装默认使用 blue slot。下一次发布在 `.env` 中配置未运行的 green slot：

```bash
TEMPORAL_WORKER_GREEN_IMAGE=<repository@sha256:64-hex-digest>
TEMPORAL_WORKER_GREEN_BUILD_ID=<new-unique-build-id>
TEMPORAL_WORKER_GREEN_REPLICAS=1
```

下载同版本的 rollout 守卫并提升候选版本。命令会先在启动任何候选容器之前拒绝选中
Current slot 或可变镜像，再等待新 Worker 注册全部 task queue，调用 Temporal
`set-current-version`，迁移历史上被错误 pinned 的持续 Scheduler，并确认旧 Current Worker
仍在运行：

```bash
curl -o temporal-worker-rollout.sh \
  https://raw.githubusercontent.com/saturndec/waoowaoo/<same-release-tag>/scripts/temporal/worker-rollout.sh
chmod 0755 temporal-worker-rollout.sh
sh ./temporal-worker-rollout.sh promote green
```

若生产环境不使用默认 `.env`、Compose 文件或 project name，所有 rollout 命令必须通过
Compose 标准环境变量绑定到同一项目，例如：

```bash
COMPOSE_ENV_FILES=<production-env> \
COMPOSE_FILE=docker-compose.yml:<production-overlay> \
COMPOSE_PROJECT_NAME=<production-project> \
sh ./temporal-worker-rollout.sh status
```

随后才把 `APP_IMAGE` 改为新不可变镜像并用普通 `docker compose up -d` 更新 Web；该命令
不会管理 Worker profile。旧 blue Worker 必须继续运行，直到：

```bash
sh ./temporal-worker-rollout.sh status
```

显示旧 build 的 `drainageStatus` 为 `drained`。这可能持续到最长 Workflow 自然完成；
不得按固定时间猜测。确认 drained 后，先在 `.env` 设置
`TEMPORAL_WORKER_BLUE_REPLICAS=0`，再执行：

```bash
sh ./temporal-worker-rollout.sh retire blue
```

下一次发布交换 blue/green。`retire` 会拒绝 Current Version、仍绑定运行中 Workflow、未
drained 的版本以及未在 `.env` 持久设为 0 的 slot，因此旧 pinned Worker 不会被普通更新误删。

### 方式二：克隆仓库 + 构建并发布不可变镜像

```bash
git clone https://github.com/saturndec/waoowaoo.git
cd waoowaoo
cp .env.example .env
# 本地构建后推送到你控制的 registry，再从 registry 查询实际 sha256 digest。
docker build -t <registry>/<repository>:<release-tag> .
docker push <registry>/<repository>:<release-tag>

# 不要把可变 tag 交给 Compose。把 APP_IMAGE、TEMPORAL_WORKER_BLUE_IMAGE、
# TEMPORAL_WORKER_GREEN_IMAGE 全部设为
# 同一个 <registry>/<repository>@sha256:<64位digest>；inactive slot 首次也必须填写。
# 按上面的说明补齐其他 .env 密钥。正式 Compose 只 pull，不从 context 构建。
sh scripts/temporal/worker-rollout.sh bootstrap blue
docker compose up -d
```

更新版本：
```bash
git pull
# 按“Temporal Worker 蓝绿升级”先 promote 未运行的 slot，旧 slot drained 后再 retire。
# 不要执行 docker compose down 来替换 Worker。
```

### 方式三：本地开发模式（推荐）

```bash
git clone https://github.com/saturndec/waoowaoo.git
cd waoowaoo

# 首次安装前复制配置。
cp .env.example .env
# 编辑 .env：配置 MySQL、Redis、MinIO、Temporal、认证、Codex Runtime、
# ComfyUI 端点以及本机 FFMPEG_BINARY_DIR。

npm install

# 只在首次初始化或明确需要同步 schema 时执行。
npm run db:push

# Docker 启动 MySQL、Redis、MinIO 和 Temporal 基础设施；
# Next.js 与 Temporal Worker 在 Windows 宿主机运行。
npm run dev
```

---

访问 [http://localhost:13000](http://localhost:13000)（方式一、二）或 [http://localhost:3000](http://localhost:3000)（方式三）开始使用！

> 方式一、二会在容器首次启动时初始化数据库；外部对象存储配置和预建桶仍必须提前准备。

> [!WARNING]
> 首次本地初始化不要跳过 `npm run db:push`。如果旧库仍有未规范化的 Assistant
> 消息，先停止 Web 与 Temporal Worker、完成备份，再依次运行
> `npm run db:assistant-messages:preflight`、`npm run db:assistant-messages:apply` 和
> `npm run db:assistant-messages:verify`；切勿使用 `--accept-data-loss` 绕过守卫。
>
> 本地对象存储只使用基础设施栈启动的 MinIO。`S3_ENDPOINT` 与
> `S3_UPLOAD_ENDPOINT` 应指向同一个可达的 HTTP 或 HTTPS endpoint；启动时会创建
> 缺失的 `S3_BUCKET`，不存在第二存储后端或本地目录 fallback。

> [!TIP]
> **如果遇到网页卡顿**：HTTP 模式下浏览器可能限制并发连接。可安装 [Caddy](https://caddyserver.com/docs/install) 启用 HTTPS：
> ```bash
> caddy run --config Caddyfile
> ```
> 然后访问 [https://localhost:1443](https://localhost:1443)

---

## 🔧 API 配置

本地运行不需要外部 AI API Key。文字、对话、规划、上下文压缩和搜索由当前 Windows
用户已登录的 Codex App Server 提供，图片生成与编辑走 Codex 图片 Provider；视频、音乐、
环境音效、TTS 和配音统一走本机 ComfyUI。设置中心只展示这两个边界内的可用能力。

---

## 📦 技术栈

- **框架**: Next.js 15 + React 19
- **数据库**: MySQL + Prisma ORM
- **持久执行**: Temporal（Thread 协调与长期 Task）
- **即时传输与缓存**: Redis（不承担生命周期正确性）
- **样式**: Tailwind CSS v4
- **认证**: NextAuth.js

---

## 📦 页面功能预览

![4f7b913264f7f26438c12560340e958c67fa833a](https://github.com/user-attachments/assets/fa0e9c57-9ea0-4df3-893e-b76c4c9d304b)
![67509361cbe6809d2496a550de5733b9f99a9702](https://github.com/user-attachments/assets/f2fb6a64-5ba8-4896-a064-be0ded213e42)
![466e13c8fd1fc799d8f588c367ebfa24e1e99bf7](https://github.com/user-attachments/assets/09bbff39-e535-4c67-80a9-69421c3b05ee)
![c067c197c20b0f1de456357c49cdf0b0973c9b31](https://github.com/user-attachments/assets/688e3147-6e95-43b0-b9e7-dd9af40db8a0)

---

## 🤝 参与方式

本项目由核心团队独立维护。欢迎你通过以下方式参与：

- 🐛 提交 [Issue](https://github.com/saturndec/waoowaoo/issues) 反馈 Bug
- 💡 提交 [Issue](https://github.com/saturndec/waoowaoo/issues) 提出功能建议
- 🔧 提交 Pull Request 供参考 — 我们会认真审阅每一个 PR 的思路，但最终由团队自行实现修复，不会直接合并外部 PR

---

**Made with ❤️ by waoowaoo team**

## Star History

[![Star History Chart](https://api.star-history.com/svg?repos=saturndec/waoowaoo&type=date&legend=top-left)](https://www.star-history.com/#saturndec/waoowaoo&type=date&legend=top-left)
