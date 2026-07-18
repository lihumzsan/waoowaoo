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
> 本仓库当前只支持开发模式：Next.js、Worker、Watchdog、Bull Board 和 Warmup 均通过 `npm run dev` 在宿主机运行。Docker Compose 只用于提供本地 MySQL、Redis 和 MinIO，不包含应用镜像或部署流程。

## ✨ 功能特性

- 🎬 **AI 剧本分析** — 自动解析小说，提取角色、场景、剧情
- 🎨 **角色与场景生成** — AI 生成一致性人物和场景图片
- 📽️ **分镜视频制作** — 自动生成分镜头并合成视频
- 🎙️ **AI 配音** — 多角色语音合成
- 🌐 **多语言支持** — 中文 / 英文界面

## 🚀 开发环境启动

### 前提条件

- Node.js >= 18.18.0
- npm >= 9.0.0
- Docker Desktop（仅在本机运行 MySQL、Redis、MinIO 时需要）

### 初始化

```bash
git clone https://github.com/lihumzsan/waoowaoo.git
cd waoowaoo
cp .env.example .env
npm install
npm run infra:up
npx prisma db push
npm run dev
```

按需编辑 `.env` 中的开发配置和 AI 服务配置。启动后访问：

- 应用：[http://localhost:3000](http://localhost:3000)
- Bull Board：[http://localhost:3010/admin/queues](http://localhost:3010/admin/queues)
- MinIO 控制台：[http://localhost:19001](http://localhost:19001)

> [!WARNING]
> 首次启动前必须执行 `npx prisma db push`。跳过后数据库表不会创建。

### 基础设施命令

```bash
# 启动并等待 MySQL、Redis、MinIO 健康
npm run infra:up

# 查看服务状态
npm run infra:status

# 跟随基础设施日志
npm run infra:logs

# 停止服务但保留数据卷
npm run infra:down
```

不要使用 `docker compose down -v`，该命令会删除本地开发数据卷。

如果已经有本机或远程 MySQL、Redis、MinIO，可以跳过 `npm run infra:up`，直接在 `.env` 中配置对应地址。

## 🧪 验证命令

```bash
npm run lint:all
npm run typecheck
npm run test:all
npm run build
```

## 🎛️ ComfyUI 工作流

仓库内置 `src/lib/providers/comfyui/workflows`。不配置 `COMFYUI_WORKFLOW_ROOT` 时直接使用内置工作流；如需复用仓库外目录，可在 `.env` 中设置绝对路径。

## 🔧 API 配置

启动后进入设置中心配置 AI 服务 API Key，界面内包含配置说明。目前推荐使用各服务商官方 API。

## 📦 技术栈

- **框架**：Next.js 15 + React 19
- **数据库**：MySQL + Prisma ORM
- **队列**：Redis + BullMQ
- **对象存储**：MinIO / S3 Compatible
- **样式**：Tailwind CSS v4
- **认证**：NextAuth.js

## 📦 页面功能预览

![4f7b913264f7f26438c12560340e958c67fa833a](https://github.com/user-attachments/assets/fa0e9c57-9ea0-4df3-893e-b76c4c9d304b)
![67509361cbe6809d2496a550de5733b9f99a9702](https://github.com/user-attachments/assets/f2fb6a64-5ba8-4896-a064-be0ded213e42)
![466e13c8fd1fc799d8f588c367ebfa24e1e99bf7](https://github.com/user-attachments/assets/09bbff39-e535-4c67-80a9-69421c3b05ee)
![c067c197c20b0f1de456357c49cdf0b0973c9b31](https://github.com/user-attachments/assets/688e3147-6e95-43b0-b9e7-dd9af40db8a0)

## 🤝 参与方式

欢迎通过 Issue 反馈 Bug 或提出功能建议，也可以提交 Pull Request 供维护者审阅。

**Made with ❤️ by waoowaoo team**
